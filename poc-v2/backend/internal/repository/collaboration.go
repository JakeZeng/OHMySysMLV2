// Repository methods for M13 collaboration (presence / edit_locks / comments).
//
// 设计：
//   - Presence：upsert by (scope, user_id)；lazy clean on read
//   - EditLock：upsert by scope；expire on read（自动清理过期锁）
//   - Comment：标准 CRUD
//
// 与 initSchema()（004_collaboration.up.sql）配套。

package repository

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"time"

	"github.com/sysmlv2/mbse-backend/internal/model"
)

// ─── Presence ──────────────────────────────────────────────────────

// UpsertPresence 更新或插入 presence 记录。
//
// last_seen 自动取 now()；color 是预分配颜色（前端不再分配）。
func (r *SQLiteRepository) UpsertPresence(ctx context.Context, p *model.Presence) error {
	const q = `
		INSERT INTO presence (scope, user_id, username, color,
			cursor_line, cursor_col,
			sel_start_line, sel_start_col, sel_end_line, sel_end_col,
			content_hash, last_seen)
		VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
		ON CONFLICT(scope, user_id) DO UPDATE SET
			username = excluded.username,
			color = excluded.color,
			cursor_line = excluded.cursor_line,
			cursor_col = excluded.cursor_col,
			sel_start_line = excluded.sel_start_line,
			sel_start_col = excluded.sel_start_col,
			sel_end_line = excluded.sel_end_line,
			sel_end_col = excluded.sel_end_col,
			content_hash = excluded.content_hash,
			last_seen = CURRENT_TIMESTAMP
	`
	_, err := r.db.ExecContext(ctx, q,
		p.Scope, p.UserID, p.Username, p.Color,
		nullableInt(p.CursorLine), nullableInt(p.CursorCol),
		nullableInt(p.SelStartLine), nullableInt(p.SelStartCol),
		nullableInt(p.SelEndLine), nullableInt(p.SelEndCol),
		p.ContentHash,
	)
	return err
}

// ListPresence 返回 scope 下的活跃用户（TTL 内）。
//
// excludeUserID 用于"不返回自己"；lazy clean 顺手删除过期记录。
// ttlSeconds 推荐 30；< 5 视为无意义。
func (r *SQLiteRepository) ListPresence(ctx context.Context, scope, excludeUserID string, ttlSeconds int) ([]*model.Presence, error) {
	if ttlSeconds < 5 {
		ttlSeconds = 30
	}

	// 懒清理（用 SQLite 的 datetime() 避免 Go/DB 时区错位）
	// 注意：datetime() 的 modifier 必须是字符串（如 '-30 seconds'），不能用 -N 整数。
	mod := fmt.Sprintf("-%d seconds", ttlSeconds)
	_, _ = r.db.ExecContext(ctx,
		`DELETE FROM presence WHERE scope = ? AND last_seen < datetime('now', ?)`,
		scope, mod)

	const q = `
		SELECT scope, user_id, username, color,
			cursor_line, cursor_col,
			sel_start_line, sel_start_col, sel_end_line, sel_end_col,
			content_hash, last_seen
		FROM presence
		WHERE scope = ? AND last_seen >= datetime('now', ?) AND user_id != ?
		ORDER BY last_seen DESC
	`
	rows, err := r.db.QueryContext(ctx, q, scope, mod, excludeUserID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	out := make([]*model.Presence, 0)
	for rows.Next() {
		p := &model.Presence{}
		var cLine, cCol, sSL, sSC, sEL, sEC sql.NullInt64
		if err := rows.Scan(&p.Scope, &p.UserID, &p.Username, &p.Color,
			&cLine, &cCol, &sSL, &sSC, &sEL, &sEC,
			&p.ContentHash, &p.LastSeen); err != nil {
			return nil, err
		}
		p.CursorLine = nullIntToPtr(cLine)
		p.CursorCol = nullIntToPtr(cCol)
		p.SelStartLine = nullIntToPtr(sSL)
		p.SelStartCol = nullIntToPtr(sSC)
		p.SelEndLine = nullIntToPtr(sEL)
		p.SelEndCol = nullIntToPtr(sEC)
		out = append(out, p)
	}
	return out, rows.Err()
}

// DeletePresence 删除某用户的 presence（用户离开时）。
func (r *SQLiteRepository) DeletePresence(ctx context.Context, scope, userID string) error {
	_, err := r.db.ExecContext(ctx, `DELETE FROM presence WHERE scope = ? AND user_id = ?`, scope, userID)
	return err
}

// PruneStalePresence 清理全表过期 presence（后台 ticker 调用）。
//
// 返回删除的行数；不返错（best-effort）。
func (r *SQLiteRepository) PruneStalePresence(ctx context.Context, ttlSeconds int) (int64, error) {
	if ttlSeconds < 5 {
		ttlSeconds = 30
	}
	res, err := r.db.ExecContext(ctx, `DELETE FROM presence WHERE last_seen < datetime('now', ?)`, fmt.Sprintf("-%d seconds", ttlSeconds))
	if err != nil {
		return 0, err
	}
	return res.RowsAffected()
}

// ─── Edit Locks ────────────────────────────────────────────────────

// ErrLockHeldByOther 表示锁被他人持有。
var ErrLockHeldByOther = errors.New("lock held by other user")

// TryAcquireLock 尝试获取锁；成功返回 nil，已被他人持有返 ErrLockHeldByOther。
//
// 若锁存在但已过期 → 强制覆盖（视为接管）。
// baseVersion 应取调用方持有的当前实体版本；用于后端校验"锁过期后保存的 base 是否合法"。
func (r *SQLiteRepository) TryAcquireLock(ctx context.Context, l *model.EditLock) error {
	now := time.Now().UTC()

	// 事务：检查并写入
	tx, err := r.db.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer func() { _ = tx.Rollback() }()

	// 读现有锁
	var (
		existingOwner string
		existingExp   time.Time
	)
	err = tx.QueryRowContext(ctx,
		`SELECT owner_id, expires_at FROM edit_locks WHERE scope = ?`, l.Scope,
	).Scan(&existingOwner, &existingExp)

	if err == nil {
		// 锁存在
		if existingOwner != l.OwnerID && existingExp.After(now) {
			// 被他人持有且未过期
			return ErrLockHeldByOther
		}
		// 自己的锁 or 过期 → 接管/续期
	} else if err != sql.ErrNoRows {
		return err
	}

	// upsert
	const upsert = `
		INSERT INTO edit_locks (scope, owner_id, username, acquired_at, expires_at, base_version)
		VALUES (?, ?, ?, ?, ?, ?)
		ON CONFLICT(scope) DO UPDATE SET
			owner_id = excluded.owner_id,
			username = excluded.username,
			acquired_at = CASE WHEN edit_locks.owner_id = excluded.owner_id THEN edit_locks.acquired_at ELSE excluded.acquired_at END,
			expires_at = excluded.expires_at,
			base_version = excluded.base_version
	`
	if _, err := tx.ExecContext(ctx, upsert,
		l.Scope, l.OwnerID, l.Username, now, l.ExpiresAt, l.BaseVersion,
	); err != nil {
		return err
	}
	if err := tx.Commit(); err != nil {
		return err
	}
	l.AcquiredAt = now
	return nil
}

// HeartbeatLock 续期锁（仅 owner）；非 owner 返 ErrLockHeldByOther。
func (r *SQLiteRepository) HeartbeatLock(ctx context.Context, scope, ownerID string, ttlSeconds int) error {
	if ttlSeconds < 10 {
		ttlSeconds = model.LockTTLSeconds
	}
	now := time.Now().UTC()
	exp := now.Add(time.Duration(ttlSeconds) * time.Second)
	res, err := r.db.ExecContext(ctx,
		`UPDATE edit_locks SET expires_at = ?
		 WHERE scope = ? AND owner_id = ? AND expires_at > ?`,
		exp, scope, ownerID, now,
	)
	if err != nil {
		return err
	}
	n, _ := res.RowsAffected()
	if n == 0 {
		return ErrLockHeldByOther
	}
	return nil
}

// GetLock 读取锁；若已过期则视作无锁（删除之）。
//
// 返回 (lock, ok)：ok=false 表示无锁。
func (r *SQLiteRepository) GetLock(ctx context.Context, scope string) (*model.EditLock, bool, error) {
	now := time.Now().UTC()
	const q = `SELECT scope, owner_id, username, acquired_at, expires_at, base_version
	           FROM edit_locks WHERE scope = ?`
	row := r.db.QueryRowContext(ctx, q, scope)
	l := &model.EditLock{}
	err := row.Scan(&l.Scope, &l.OwnerID, &l.Username, &l.AcquiredAt, &l.ExpiresAt, &l.BaseVersion)
	if err == sql.ErrNoRows {
		return nil, false, nil
	}
	if err != nil {
		return nil, false, err
	}
	if !l.ExpiresAt.After(now) {
		// 过期 → 清理 + 视为无锁
		_, _ = r.db.ExecContext(ctx, `DELETE FROM edit_locks WHERE scope = ?`, scope)
		return nil, false, nil
	}
	return l, true, nil
}

// ReleaseLock 释放锁（仅 owner）。
//
// 返回 ok=true 表示成功释放；ok=false 表示锁不存在 / 不属于该 owner / 已过期。
func (r *SQLiteRepository) ReleaseLock(ctx context.Context, scope, ownerID string) (bool, error) {
	res, err := r.db.ExecContext(ctx,
		`DELETE FROM edit_locks WHERE scope = ? AND owner_id = ?`,
		scope, ownerID,
	)
	if err != nil {
		return false, err
	}
	n, _ := res.RowsAffected()
	return n > 0, nil
}

// ForceReleaseLock 强制释放锁（admin 调用）。
func (r *SQLiteRepository) ForceReleaseLock(ctx context.Context, scope string) (bool, error) {
	res, err := r.db.ExecContext(ctx, `DELETE FROM edit_locks WHERE scope = ?`, scope)
	if err != nil {
		return false, err
	}
	n, _ := res.RowsAffected()
	return n > 0, nil
}

// PruneExpiredLocks 清理过期锁（后台 ticker 调用）。
func (r *SQLiteRepository) PruneExpiredLocks(ctx context.Context) (int64, error) {
	now := time.Now().UTC()
	res, err := r.db.ExecContext(ctx, `DELETE FROM edit_locks WHERE expires_at <= ?`, now)
	if err != nil {
		return 0, err
	}
	return res.RowsAffected()
}

// ─── Comments ──────────────────────────────────────────────────────

// AddComment 插入一条评论；返回完整对象（含 id / time）。
func (r *SQLiteRepository) AddComment(ctx context.Context, c *model.Comment) error {
	if c.ID == "" {
		// 由 handler 生成；这里兜底
		return errors.New("comment id 必填")
	}
	const q = `INSERT INTO comments (id, scope, user_id, username, element_id, line, content, resolved, created_at, updated_at)
	           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
	_, err := r.db.ExecContext(ctx, q,
		c.ID, c.Scope, c.UserID, c.Username, c.ElementID, c.Line, c.Content,
		boolToInt(c.Resolved), c.CreatedAt, c.UpdatedAt,
	)
	return err
}

// ListComments 列出 scope 下的评论（按 created_at DESC）。
func (r *SQLiteRepository) ListComments(ctx context.Context, scope string) ([]*model.Comment, error) {
	const q = `SELECT id, scope, user_id, username, element_id, line, content, resolved, created_at, updated_at
	           FROM comments WHERE scope = ? ORDER BY created_at DESC`
	rows, err := r.db.QueryContext(ctx, q, scope)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := make([]*model.Comment, 0)
	for rows.Next() {
		c := &model.Comment{}
		var resolved int
		if err := rows.Scan(&c.ID, &c.Scope, &c.UserID, &c.Username, &c.ElementID, &c.Line, &c.Content, &resolved, &c.CreatedAt, &c.UpdatedAt); err != nil {
			return nil, err
		}
		c.Resolved = resolved != 0
		out = append(out, c)
	}
	return out, rows.Err()
}

// DeleteComment 删除评论；返回是否成功。
func (r *SQLiteRepository) DeleteComment(ctx context.Context, scope, commentID, userID string) (bool, error) {
	res, err := r.db.ExecContext(ctx,
		`DELETE FROM comments WHERE id = ? AND scope = ? AND user_id = ?`,
		commentID, scope, userID,
	)
	if err != nil {
		return false, err
	}
	n, _ := res.RowsAffected()
	return n > 0, nil
}

// ToggleCommentResolved 切换 resolved 状态（任何有权限的用户都可）。
func (r *SQLiteRepository) ToggleCommentResolved(ctx context.Context, scope, commentID string) (*model.Comment, error) {
	now := time.Now().UTC()
	res, err := r.db.ExecContext(ctx,
		`UPDATE comments SET resolved = 1 - resolved, updated_at = ? WHERE id = ? AND scope = ?`,
		now, commentID, scope,
	)
	if err != nil {
		return nil, err
	}
	n, _ := res.RowsAffected()
	if n == 0 {
		return nil, ErrNotFound
	}
	c := &model.Comment{}
	var resolved int
	err = r.db.QueryRowContext(ctx,
		`SELECT id, scope, user_id, username, element_id, line, content, resolved, created_at, updated_at
		 FROM comments WHERE id = ?`, commentID,
	).Scan(&c.ID, &c.Scope, &c.UserID, &c.Username, &c.ElementID, &c.Line, &c.Content, &resolved, &c.CreatedAt, &c.UpdatedAt)
	if err != nil {
		return nil, err
	}
	c.Resolved = resolved != 0
	return c, nil
}

// ─── helpers ───────────────────────────────────────────────────────

func nullableInt(p *int) any {
	if p == nil {
		return nil
	}
	return *p
}

func nullIntToPtr(n sql.NullInt64) *int {
	if !n.Valid {
		return nil
	}
	v := int(n.Int64)
	return &v
}

func boolToInt(b bool) int {
	if b {
		return 1
	}
	return 0
}
