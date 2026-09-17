// Package repository — 团队 CRUD（M4 W2）。
//
// 设计要点：
//   - 创建团队时自动把创建者加为 team_members(role=owner)
//   - team_members 是唯一来源；删除成员即失去访问
//   - 所有跨表操作走单一 *sql.DB（M4 W2 不引入事务，依赖 SetMaxOpenConns(1) 串行化）
package repository

import (
	"context"
	"database/sql"
	"errors"
	"strings"
	"time"

	"github.com/google/uuid"

	"github.com/sysmlv2/mbse-backend/internal/model"
)

// ─── Teams ────────────────────────────────────────────────────────────

// CreateTeam 创建团队并把 owner 用户作为 owner 成员加进去。
// 返回填充好 ID/CreatedAt 的 Team。
func (r *SQLiteRepository) CreateTeam(ctx context.Context, ownerUserID, name, description string) (*model.Team, error) {
	if name == "" {
		return nil, errors.New("team name 不能为空")
	}
	now := time.Now().UTC()
	t := &model.Team{
		ID:          newID(),
		Name:        strings.TrimSpace(name),
		Description: strings.TrimSpace(description),
		CreatedAt:   now,
		UpdatedAt:   now,
	}
	if err := r.inTx(func(tx *sql.Tx) error {
		if _, err := tx.ExecContext(ctx,
			`INSERT INTO teams (id, name, description, created_at, updated_at) VALUES (?, ?, ?, ?, ?)`,
			t.ID, t.Name, t.Description, t.CreatedAt, t.UpdatedAt,
		); err != nil {
			return err
		}
		_, err := tx.ExecContext(ctx,
			`INSERT INTO team_members (team_id, user_id, role, joined_at) VALUES (?, ?, 'owner', ?)`,
			t.ID, ownerUserID, now,
		)
		return err
	}); err != nil {
		return nil, err
	}
	t.MyRole = model.TeamRoleOwner
	t.MemberCount = 1
	return t, nil
}

// GetTeam 取一个团队基础信息（不含成员）。
func (r *SQLiteRepository) GetTeam(ctx context.Context, teamID string) (*model.Team, error) {
	row := r.db.QueryRowContext(ctx,
		`SELECT id, name, description, created_at, updated_at FROM teams WHERE id = ?`,
		teamID,
	)
	var t model.Team
	if err := row.Scan(&t.ID, &t.Name, &t.Description, &t.CreatedAt, &t.UpdatedAt); err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return nil, ErrNotFound
		}
		return nil, err
	}
	return &t, nil
}

// ListTeamsForUser 返回用户所在的团队（含成员数 + 当前用户在团队中的角色）。
func (r *SQLiteRepository) ListTeamsForUser(ctx context.Context, userID string) ([]*model.Team, error) {
	rows, err := r.db.QueryContext(ctx,
		`SELECT t.id, t.name, t.description, t.created_at, t.updated_at,
		        tm.role,
		        (SELECT COUNT(*) FROM team_members m2 WHERE m2.team_id = t.id) AS member_count
		 FROM teams t
		 JOIN team_members tm ON tm.team_id = t.id
		 WHERE tm.user_id = ?
		 ORDER BY t.updated_at DESC`,
		userID,
	)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []*model.Team
	for rows.Next() {
		var t model.Team
		if err := rows.Scan(&t.ID, &t.Name, &t.Description, &t.CreatedAt, &t.UpdatedAt, &t.MyRole, &t.MemberCount); err != nil {
			return nil, err
		}
		out = append(out, &t)
	}
	return out, rows.Err()
}

// UpdateTeam 更新 name / description。
func (r *SQLiteRepository) UpdateTeam(ctx context.Context, teamID, name, description string) error {
	now := time.Now().UTC()
	res, err := r.db.ExecContext(ctx,
		`UPDATE teams SET name = ?, description = ?, updated_at = ? WHERE id = ?`,
		strings.TrimSpace(name), strings.TrimSpace(description), now, teamID,
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

// DeleteTeam 删除团队（FK 级联删 team_members + team_project_access）。
func (r *SQLiteRepository) DeleteTeam(ctx context.Context, teamID string) error {
	res, err := r.db.ExecContext(ctx, `DELETE FROM teams WHERE id = ?`, teamID)
	if err != nil {
		return err
	}
	n, _ := res.RowsAffected()
	if n == 0 {
		return ErrNotFound
	}
	return nil
}

// ─── Members ──────────────────────────────────────────────────────────

// GetTeamMember 取一个成员关系（含 username/email 便于前端展示）。
func (r *SQLiteRepository) GetTeamMember(ctx context.Context, teamID, userID string) (*model.TeamMember, error) {
	row := r.db.QueryRowContext(ctx,
		`SELECT tm.team_id, tm.user_id, u.username, u.email, tm.role, tm.joined_at
		 FROM team_members tm
		 JOIN users u ON u.id = tm.user_id
		 WHERE tm.team_id = ? AND tm.user_id = ?`,
		teamID, userID,
	)
	var m model.TeamMember
	if err := row.Scan(&m.TeamID, &m.UserID, &m.Username, &m.Email, &m.Role, &m.JoinedAt); err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return nil, ErrNotFound
		}
		return nil, err
	}
	return &m, nil
}

// ListTeamMembers 列一个团队的所有成员（带 username/email）。
func (r *SQLiteRepository) ListTeamMembers(ctx context.Context, teamID string) ([]*model.TeamMember, error) {
	rows, err := r.db.QueryContext(ctx,
		`SELECT tm.team_id, tm.user_id, u.username, u.email, tm.role, tm.joined_at
		 FROM team_members tm
		 JOIN users u ON u.id = tm.user_id
		 WHERE tm.team_id = ?
		 ORDER BY tm.joined_at ASC`,
		teamID,
	)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []*model.TeamMember
	for rows.Next() {
		var m model.TeamMember
		if err := rows.Scan(&m.TeamID, &m.UserID, &m.Username, &m.Email, &m.Role, &m.JoinedAt); err != nil {
			return nil, err
		}
		out = append(out, &m)
	}
	return out, rows.Err()
}

// AddTeamMember 通过 userID 直接添加成员。
func (r *SQLiteRepository) AddTeamMember(ctx context.Context, teamID, userID, role string) error {
	if !model.IsValidRole(role) {
		return errors.New("非法角色")
	}
	now := time.Now().UTC()
	_, err := r.db.ExecContext(ctx,
		`INSERT OR IGNORE INTO team_members (team_id, user_id, role, joined_at) VALUES (?, ?, ?, ?)`,
		teamID, userID, role, now,
	)
	return err
}

// UpdateTeamMemberRole 改成员角色（不能改 owner 的 owner 角色 —— 业务上避免孤儿）。
func (r *SQLiteRepository) UpdateTeamMemberRole(ctx context.Context, teamID, userID, role string) error {
	if !model.IsValidRole(role) {
		return errors.New("非法角色")
	}
	// 防孤儿：禁止把最后一个 owner 降级
	if role != model.TeamRoleOwner {
		var ownerCount int
		if err := r.db.QueryRowContext(ctx,
			`SELECT COUNT(*) FROM team_members WHERE team_id = ? AND role = 'owner'`,
			teamID,
		).Scan(&ownerCount); err != nil {
			return err
		}
		// 当前用户是否就是 owner？
		var currentRole string
		row := r.db.QueryRowContext(ctx,
			`SELECT role FROM team_members WHERE team_id = ? AND user_id = ?`,
			teamID, userID,
		)
		if err := row.Scan(&currentRole); err != nil {
			if errors.Is(err, sql.ErrNoRows) {
				return ErrNotFound
			}
			return err
		}
		if currentRole == model.TeamRoleOwner && ownerCount <= 1 {
			return errors.New("不能降级最后一个 owner")
		}
	}

	res, err := r.db.ExecContext(ctx,
		`UPDATE team_members SET role = ? WHERE team_id = ? AND user_id = ?`,
		role, teamID, userID,
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

// RemoveTeamMember 删除成员关系。
func (r *SQLiteRepository) RemoveTeamMember(ctx context.Context, teamID, userID string) error {
	// 防孤儿：拒绝删除最后一个 owner
	var role string
	row := r.db.QueryRowContext(ctx,
		`SELECT role FROM team_members WHERE team_id = ? AND user_id = ?`,
		teamID, userID,
	)
	if err := row.Scan(&role); err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return ErrNotFound
		}
		return err
	}
	if role == model.TeamRoleOwner {
		var ownerCount int
		r.db.QueryRowContext(ctx,
			`SELECT COUNT(*) FROM team_members WHERE team_id = ? AND role = 'owner'`,
			teamID,
		).Scan(&ownerCount)
		if ownerCount <= 1 {
			return errors.New("不能删除最后一个 owner")
		}
	}
	res, err := r.db.ExecContext(ctx,
		`DELETE FROM team_members WHERE team_id = ? AND user_id = ?`,
		teamID, userID,
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

// ─── Project Access ───────────────────────────────────────────────────

// GrantTeamProjectAccess 团队 → 项目授权。
func (r *SQLiteRepository) GrantTeamProjectAccess(ctx context.Context, teamID, projectID, permission, grantedBy string) error {
	if !model.IsValidPermission(permission) {
		return errors.New("非法权限")
	}
	now := time.Now().UTC()
	_, err := r.db.ExecContext(ctx,
		`INSERT OR REPLACE INTO team_project_access (team_id, project_id, permission, granted_at, granted_by) VALUES (?, ?, ?, ?, ?)`,
		teamID, projectID, permission, now, grantedBy,
	)
	return err
}

// ListTeamProjectAccess 列出团队的所有项目授权。
func (r *SQLiteRepository) ListTeamProjectAccess(ctx context.Context, teamID string) ([]*model.TeamProjectAccess, error) {
	rows, err := r.db.QueryContext(ctx,
		`SELECT team_id, project_id, permission, granted_by, granted_at
		 FROM team_project_access WHERE team_id = ? ORDER BY granted_at DESC`,
		teamID,
	)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []*model.TeamProjectAccess
	for rows.Next() {
		var a model.TeamProjectAccess
		if err := rows.Scan(&a.TeamID, &a.ProjectID, &a.Permission, &a.GrantedBy, &a.GrantedAt); err != nil {
			return nil, err
		}
		out = append(out, &a)
	}
	return out, rows.Err()
}

// RevokeTeamProjectAccess 撤销团队对项目的授权。
func (r *SQLiteRepository) RevokeTeamProjectAccess(ctx context.Context, teamID, projectID string) error {
	res, err := r.db.ExecContext(ctx,
		`DELETE FROM team_project_access WHERE team_id = ? AND project_id = ?`,
		teamID, projectID,
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

// ─── 事务辅助 ─────────────────────────────────────────────────────────

// inTx 同步事务（依赖 SetMaxOpenConns(1)）。
func (r *SQLiteRepository) inTx(fn func(tx *sql.Tx) error) error {
	tx, err := r.db.Begin()
	if err != nil {
		return err
	}
	defer func() {
		if p := recover(); p != nil {
			_ = tx.Rollback()
			panic(p)
		}
	}()
	if err := fn(tx); err != nil {
		_ = tx.Rollback()
		return err
	}
	return tx.Commit()
}

// newID 生成 UUID v4。抽出来便于测试 stub。
var newID = func() string { return uuid.NewString() }
