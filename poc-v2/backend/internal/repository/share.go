// Package repository — M4 W3 项目分享（直接用户 + 链接）。
package repository

import (
	"context"
	"crypto/rand"
	"crypto/sha256"
	"database/sql"
	"encoding/hex"
	"errors"
	"time"

	"github.com/sysmlv2/mbse-backend/internal/model"
)

// ─── 直接分享 project_shares ───────────────────────────────────────────

// ShareProjectWithUser 添加/更新一个项目的用户分享。
func (r *SQLiteRepository) ShareProjectWithUser(
	ctx context.Context,
	projectID, userID, permission, grantedBy string,
) error {
	if !model.IsValidPermission(permission) {
		return errors.New("非法权限")
	}
	now := time.Now().UTC()
	_, err := r.db.ExecContext(ctx,
		`INSERT OR REPLACE INTO project_shares (project_id, user_id, permission, granted_at, granted_by)
		 VALUES (?, ?, ?, ?, ?)`,
		projectID, userID, permission, now, grantedBy,
	)
	return err
}

// ListProjectShares 列出项目的所有用户分享（不含 owner）。
func (r *SQLiteRepository) ListProjectShares(ctx context.Context, projectID string) ([]*model.ProjectShare, error) {
	rows, err := r.db.QueryContext(ctx,
		`SELECT ps.project_id, ps.user_id, u.username, u.email, ps.permission, ps.granted_by, ps.granted_at
		 FROM project_shares ps
		 JOIN users u ON u.id = ps.user_id
		 WHERE ps.project_id = ?
		 ORDER BY ps.granted_at DESC`,
		projectID,
	)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []*model.ProjectShare
	for rows.Next() {
		var s model.ProjectShare
		if err := rows.Scan(
			&s.ProjectID, &s.UserID, &s.Username, &s.Email,
			&s.Permission, &s.GrantedBy, &s.GrantedAt,
		); err != nil {
			return nil, err
		}
		out = append(out, &s)
	}
	return out, rows.Err()
}

// RevokeProjectShare 删除一条用户分享。
func (r *SQLiteRepository) RevokeProjectShare(ctx context.Context, projectID, userID string) error {
	res, err := r.db.ExecContext(ctx,
		`DELETE FROM project_shares WHERE project_id = ? AND user_id = ?`,
		projectID, userID,
	)
	if err != nil {
		return err
	}
	n, _ := res.RowsAffected()
	if n == 0 {
		return ErrNotFound
	}
	return nil
}

// ─── 链接分享 share_links ─────────────────────────────────────────────

// NewShareLink 创建一条分享链接；返回 ShareLink（含明文 token + 完整 URL base 由调用方拼接）。
// 仅创建时返回一次明文 token —— DB 只存 hash。
func (r *SQLiteRepository) NewShareLink(
	ctx context.Context,
	projectID, permission, createdBy string,
	expiresAt *time.Time,
) (*model.ShareLink, string, error) {
	if permission != "read" && permission != "write" {
		return nil, "", errors.New("链接权限只允许 read 或 write")
	}

	// 生成 16 字节随机 token → base64url（22 字符）
	raw := make([]byte, 16)
	if _, err := rand.Read(raw); err != nil {
		return nil, "", err
	}
	token := base64URL(raw)
	hash := HashShareToken(token)

	now := time.Now().UTC()
	sl := &model.ShareLink{
		ID:         newID(),
		ProjectID:  projectID,
		TokenHash:  hash,
		Permission: permission,
		CreatedBy:  createdBy,
		CreatedAt:  now,
		ExpiresAt:  expiresAt,
	}
	_, err := r.db.ExecContext(ctx,
		`INSERT INTO share_links (id, project_id, token_hash, permission, created_by, created_at, expires_at)
		 VALUES (?, ?, ?, ?, ?, ?, ?)`,
		sl.ID, sl.ProjectID, sl.TokenHash, sl.Permission, sl.CreatedBy, sl.CreatedAt, sl.ExpiresAt,
	)
	if err != nil {
		return nil, "", err
	}
	return sl, token, nil
}

// ListProjectShareLinks 列出项目的所有链接（不含明文 token，只返回 hash 前 8 字符 + 元数据）。
func (r *SQLiteRepository) ListProjectShareLinks(ctx context.Context, projectID string) ([]*model.ShareLink, error) {
	rows, err := r.db.QueryContext(ctx,
		`SELECT id, project_id, permission, created_by, created_at, expires_at, revoked_at
		 FROM share_links WHERE project_id = ? ORDER BY created_at DESC`,
		projectID,
	)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []*model.ShareLink
	for rows.Next() {
		var sl model.ShareLink
		if err := rows.Scan(
			&sl.ID, &sl.ProjectID, &sl.Permission, &sl.CreatedBy,
			&sl.CreatedAt, &sl.ExpiresAt, &sl.RevokedAt,
		); err != nil {
			return nil, err
		}
		out = append(out, &sl)
	}
	return out, rows.Err()
}

// LookupShareLinkByToken 用明文 token 查一条有效（未撤销且未过期）的链接；返回 nil 即视为不存在/失效。
func (r *SQLiteRepository) LookupShareLinkByToken(ctx context.Context, token string) (*model.ShareLink, error) {
	hash := HashShareToken(token)
	row := r.db.QueryRowContext(ctx,
		`SELECT id, project_id, permission, created_by, created_at, expires_at, revoked_at
		 FROM share_links WHERE token_hash = ?`,
		hash,
	)
	var sl model.ShareLink
	if err := row.Scan(
		&sl.ID, &sl.ProjectID, &sl.Permission, &sl.CreatedBy,
		&sl.CreatedAt, &sl.ExpiresAt, &sl.RevokedAt,
	); err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return nil, ErrNotFound
		}
		return nil, err
	}
	// 校验：revoked? expired?
	now := time.Now().UTC()
	if sl.RevokedAt != nil {
		return nil, ErrNotFound
	}
	if sl.ExpiresAt != nil && sl.ExpiresAt.Before(now) {
		return nil, ErrNotFound
	}
	return &sl, nil
}

// RevokeShareLink 撤销一条链接。
func (r *SQLiteRepository) RevokeShareLink(ctx context.Context, linkID string) error {
	now := time.Now().UTC()
	res, err := r.db.ExecContext(ctx,
		`UPDATE share_links SET revoked_at = ? WHERE id = ? AND revoked_at IS NULL`,
		now, linkID,
	)
	if err != nil {
		return err
	}
	n, _ := res.RowsAffected()
	if n == 0 {
		return ErrNotFound
	}
	return nil
}

// ─── helpers ──────────────────────────────────────────────────────────

// HashShareToken SHA-256(原始 token) → hex。
func HashShareToken(token string) string {
	h := sha256.Sum256([]byte(token))
	return hex.EncodeToString(h[:])
}

// base64URL 用 base64url 编码（无 padding），22 字符。
func base64URL(b []byte) string {
	const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_"
	out := make([]byte, 0, ((len(b)+2)/3)*4)
	i := 0
	for ; i+3 <= len(b); i += 3 {
		v := uint32(b[i])<<16 | uint32(b[i+1])<<8 | uint32(b[i+2])
		out = append(out,
			alphabet[(v>>18)&0x3f],
			alphabet[(v>>12)&0x3f],
			alphabet[(v>>6)&0x3f],
			alphabet[v&0x3f],
		)
	}
	switch len(b) - i {
	case 1:
		v := uint32(b[i]) << 16
		out = append(out,
			alphabet[(v>>18)&0x3f],
			alphabet[(v>>12)&0x3f],
		)
	case 2:
		v := uint32(b[i])<<16 | uint32(b[i+1])<<8
		out = append(out,
			alphabet[(v>>18)&0x3f],
			alphabet[(v>>12)&0x3f],
			alphabet[(v>>6)&0x3f],
		)
	}
	return string(out)
}
