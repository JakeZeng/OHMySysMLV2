// Package repository 实现 SQLite 持久化（MVP）。
package repository

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"time"

	"github.com/google/uuid"
	_ "modernc.org/sqlite"

	"github.com/sysmlv2/mbse-backend/internal/model"
)

// 业务级错误
var (
	ErrNotFound        = errors.New("not found")
	ErrVersionConflict = errors.New("version conflict")
)

// SQLiteRepository 单一数据库，承载 user/project/model。
type SQLiteRepository struct {
	db *sql.DB
}

// DB 返回底层 *sql.DB，给 handler/authz.go 等需要直接查 SQL 的位置使用。
// M4 引入：跨切面授权（userHeldPermission 等）需要直接 UNION，保留这一入口。
func (r *SQLiteRepository) DB() *sql.DB { return r.db }

// Counts 返回各表的行数。M4.5 用于 /health 端点的轻量监控。
//
// 单次查询一张表，best-effort；任一失败记 0 不阻塞整体响应。
func (r *SQLiteRepository) Counts(ctx context.Context) map[string]int64 {
	out := map[string]int64{
		"users":      0,
		"projects":   0,
		"models":     0,
		"teams":      0,
		"shares":     0,
		"share_links": 0,
		"audit_logs": 0,
	}
	for _, table := range []string{
		"users", "projects", "models", "teams",
		"project_shares", "share_links", "audit_logs",
	} {
		var n int64
		_ = r.db.QueryRowContext(ctx, "SELECT COUNT(*) FROM "+table).Scan(&n)
		out[table] = n
	}
	return out
}

// New 打开或创建 SQLite 数据库，初始化全部 schema。
func New(path string) (*SQLiteRepository, error) {
	db, err := sql.Open("sqlite", path)
	if err != nil {
		return nil, fmt.Errorf("打开 SQLite 失败: %w", err)
	}
	db.SetMaxOpenConns(1)
	db.SetMaxIdleConns(1)
	db.SetConnMaxLifetime(0)

	// M4：启用外键约束，让 ON DELETE CASCADE 真正生效。
	// modernc.org/sqlite 默认 PRAGMA foreign_keys=OFF。
	if _, err := db.Exec("PRAGMA foreign_keys = ON"); err != nil {
		_ = db.Close()
		return nil, fmt.Errorf("启用外键失败: %w", err)
	}

	repo := &SQLiteRepository{db: db}
	if err := repo.initSchema(); err != nil {
		_ = db.Close()
		return nil, err
	}
	return repo, nil
}

func (r *SQLiteRepository) initSchema() error {
	// Schema source of truth: migrations/001_init.up.sql（users/projects/models）
	// 与 migrations/002_team_space.up.sql（teams/team_members/team_project_access/project_shares/share_links）。
	// 修改此处请同步更新对应 .sql 文件；M6 引入真 migration runner。
	const ddl = `
CREATE TABLE IF NOT EXISTS users (
    id            TEXT PRIMARY KEY,
    username      TEXT NOT NULL UNIQUE,
    email         TEXT NOT NULL UNIQUE,
    password_hash TEXT NOT NULL,
    created_at    TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);

CREATE TABLE IF NOT EXISTS projects (
    id          TEXT PRIMARY KEY,
    name        TEXT NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    owner_id    TEXT NOT NULL,
    visibility  TEXT NOT NULL DEFAULT 'private' CHECK(visibility IN ('private', 'team', 'public')),
    created_at  TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at  TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_projects_owner ON projects(owner_id);

CREATE TABLE IF NOT EXISTS models (
    id         TEXT PRIMARY KEY,
    project_id TEXT NOT NULL,
    name       TEXT NOT NULL,
    content    TEXT NOT NULL DEFAULT '',
    version    INTEGER NOT NULL DEFAULT 1,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_models_project ON models(project_id);
CREATE INDEX IF NOT EXISTS idx_models_updated ON models(updated_at DESC);

-- M4 W1: 团队空间 + 模型分享 表结构
CREATE TABLE IF NOT EXISTS teams (
    id          TEXT PRIMARY KEY,
    name        TEXT NOT NULL UNIQUE,
    description TEXT NOT NULL DEFAULT '',
    created_at  TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at  TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_teams_name ON teams(name);

CREATE TABLE IF NOT EXISTS team_members (
    team_id   TEXT NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
    user_id   TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    role      TEXT NOT NULL DEFAULT 'member' CHECK(role IN ('owner', 'admin', 'member')),
    joined_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (team_id, user_id)
);
CREATE INDEX IF NOT EXISTS idx_team_members_user ON team_members(user_id);

CREATE TABLE IF NOT EXISTS team_project_access (
    team_id     TEXT NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
    project_id  TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    permission  TEXT NOT NULL CHECK(permission IN ('read', 'write', 'admin')),
    granted_at  TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    granted_by  TEXT NOT NULL REFERENCES users(id),
    PRIMARY KEY (team_id, project_id)
);
CREATE INDEX IF NOT EXISTS idx_team_project_access_project ON team_project_access(project_id);

CREATE TABLE IF NOT EXISTS project_shares (
    project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    permission TEXT NOT NULL CHECK(permission IN ('read', 'write', 'admin')),
    granted_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    granted_by TEXT NOT NULL REFERENCES users(id),
    PRIMARY KEY (project_id, user_id)
);
CREATE INDEX IF NOT EXISTS idx_project_shares_user ON project_shares(user_id);

CREATE TABLE IF NOT EXISTS share_links (
    id         TEXT PRIMARY KEY,
    project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    token_hash TEXT NOT NULL UNIQUE,
    permission TEXT NOT NULL CHECK(permission IN ('read', 'write')),
    created_by TEXT NOT NULL REFERENCES users(id),
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    expires_at TIMESTAMP,
    revoked_at TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_share_links_project ON share_links(project_id);
`
	if _, err := r.db.Exec(ddl); err != nil {
		return fmt.Errorf("初始化 schema 失败: %w", err)
	}
	// M4.5 增量：share_links 加 view_count + last_viewed_at 列（用于防滥用统计）。
	// SQLite ALTER TABLE ADD COLUMN 不可逆；旧库上"duplicate column"错误需忽略。
	if _, err := r.db.Exec(
		`ALTER TABLE share_links ADD COLUMN view_count INTEGER NOT NULL DEFAULT 0`,
	); err != nil {
		// 兼容历史 DB：列已存在时忽略
	}
	if _, err := r.db.Exec(
		`ALTER TABLE share_links ADD COLUMN last_viewed_at TIMESTAMP`,
	); err != nil {
		// 忽略
	}
	if _, err := r.db.Exec(
		`ALTER TABLE share_links ADD COLUMN max_views INTEGER`,
	); err != nil {
		// 兼容历史 DB：列已存在时忽略
	}

	// M4.5 增量：admin 角色（首个注册用户自动成为 admin，用于审计归档等管理操作）
	if _, err := r.db.Exec(
		`ALTER TABLE users ADD COLUMN is_admin INTEGER NOT NULL DEFAULT 0`,
	); err != nil {
		// 兼容历史 DB：列已存在时忽略
	}

	// M4.5 增量：模型描述字段
	if _, err := r.db.Exec(
		`ALTER TABLE models ADD COLUMN description TEXT NOT NULL DEFAULT ''`,
	); err != nil {
		// 兼容历史 DB：列已存在时忽略
	}

	// M4.5 增量：审计日志表。
	if _, err := r.db.Exec(
		`CREATE TABLE IF NOT EXISTS audit_logs (
			id          TEXT PRIMARY KEY,
			actor_id    TEXT,
			action      TEXT NOT NULL,
			target_type TEXT NOT NULL,
			target_id   TEXT NOT NULL,
			metadata    TEXT NOT NULL DEFAULT '',
			ip          TEXT NOT NULL DEFAULT '',
			user_agent  TEXT NOT NULL DEFAULT '',
			created_at  TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
		)`,
	); err != nil {
		return fmt.Errorf("创建 audit_logs 表失败: %w", err)
	}
	if _, err := r.db.Exec(
		`CREATE INDEX IF NOT EXISTS idx_audit_actor ON audit_logs(actor_id, created_at DESC)`,
	); err != nil {
		return fmt.Errorf("创建 audit_logs actor 索引失败: %w", err)
	}
	if _, err := r.db.Exec(
		`CREATE INDEX IF NOT EXISTS idx_audit_target ON audit_logs(target_type, target_id, created_at DESC)`,
	); err != nil {
		return fmt.Errorf("创建 audit_logs target 索引失败: %w", err)
	}
	// M4.5 增量：单列 created_at 索引 — 加速归档清理（DELETE WHERE created_at < ?）
	// 与无过滤的列表查询（ORDER BY created_at DESC LIMIT）。
	// 与上面复合索引互补：复合索引只在带 actor/target 过滤时命中。
	if _, err := r.db.Exec(
		`CREATE INDEX IF NOT EXISTS idx_audit_created ON audit_logs(created_at DESC)`,
	); err != nil {
		return fmt.Errorf("创建 audit_logs created_at 索引失败: %w", err)
	}

	// M4.5 增量：模型版本历史表 — 每次 UpdateModel 时自动保存旧版本。
	if _, err := r.db.Exec(
		`CREATE TABLE IF NOT EXISTS model_versions (
			id         TEXT PRIMARY KEY,
			model_id   TEXT NOT NULL,
			content    TEXT NOT NULL,
			version    INTEGER NOT NULL,
			saved_by   TEXT,
			created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
		)`,
	); err != nil {
		return fmt.Errorf("创建 model_versions 表失败: %w", err)
	}
	if _, err := r.db.Exec(
		`CREATE INDEX IF NOT EXISTS idx_model_versions_model ON model_versions(model_id, version DESC)`,
	); err != nil {
		return fmt.Errorf("创建 model_versions 索引失败: %w", err)
	}

	return nil
}

// Close 关闭数据库。
func (r *SQLiteRepository) Close() error { return r.db.Close() }

// ─── Users ──────────────────────────────────────────────────────────

func (r *SQLiteRepository) CreateUser(ctx context.Context, u *model.User) error {
	// M4.5 增量：第一个注册的用户自动成为 admin（bootstrap 模式）。
	// 后续注册的用户 is_admin=0。M5+ 可扩展为邀请码 / 角色管理 UI。
	var count int
	if err := r.db.QueryRowContext(ctx, `SELECT COUNT(*) FROM users`).Scan(&count); err != nil {
		return err
	}
	const q = `INSERT INTO users (id, username, email, password_hash, is_admin, created_at)
              VALUES (?, ?, ?, ?, ?, ?)`
	isAdmin := 0
	if count == 0 {
		isAdmin = 1
		u.IsAdmin = true
	}
	_, err := r.db.ExecContext(ctx, q, u.ID, u.Username, u.Email, u.PasswordHash, isAdmin, u.CreatedAt)
	return err
}

func (r *SQLiteRepository) GetUserByUsername(ctx context.Context, username string) (*model.User, error) {
	const q = `SELECT id, username, email, password_hash, is_admin, created_at
              FROM users WHERE username = ?`
	row := r.db.QueryRowContext(ctx, q, username)
	var u model.User
	var isAdmin int
	if err := row.Scan(&u.ID, &u.Username, &u.Email, &u.PasswordHash, &isAdmin, &u.CreatedAt); err != nil {
		return nil, err
	}
	u.IsAdmin = isAdmin == 1
	return &u, nil
}

func (r *SQLiteRepository) GetUserByEmail(ctx context.Context, email string) (*model.User, error) {
	const q = `SELECT id, username, email, password_hash, is_admin, created_at
              FROM users WHERE email = ?`
	row := r.db.QueryRowContext(ctx, q, email)
	var u model.User
	var isAdmin int
	if err := row.Scan(&u.ID, &u.Username, &u.Email, &u.PasswordHash, &isAdmin, &u.CreatedAt); err != nil {
		return nil, err
	}
	u.IsAdmin = isAdmin == 1
	return &u, nil
}

// ListModelVersions 返回模型的历史版本（M4.5 增量）。
func (r *SQLiteRepository) ListModelVersions(
	ctx context.Context, modelID string, limit int,
) ([]*model.ModelVersion, error) {
	if limit <= 0 || limit > 100 {
		limit = 20
	}
	rows, err := r.db.QueryContext(ctx,
		`SELECT id, model_id, content, version, COALESCE(saved_by, ''), created_at
         FROM model_versions WHERE model_id = ? ORDER BY version DESC LIMIT ?`,
		modelID, limit,
	)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []*model.ModelVersion
	for rows.Next() {
		var v model.ModelVersion
		if err := rows.Scan(&v.ID, &v.ModelID, &v.Content, &v.Version, &v.SavedBy, &v.CreatedAt); err != nil {
			return nil, err
		}
		out = append(out, &v)
	}
	return out, rows.Err()
}

// GetUserByID 按 id 查用户；用于 /auth/me（M4.5 增量）。
func (r *SQLiteRepository) GetUserByID(ctx context.Context, id string) (*model.User, error) {
	const q = `SELECT id, username, email, password_hash, is_admin, created_at
              FROM users WHERE id = ?`
	row := r.db.QueryRowContext(ctx, q, id)
	var u model.User
	var isAdmin int
	if err := row.Scan(&u.ID, &u.Username, &u.Email, &u.PasswordHash, &isAdmin, &u.CreatedAt); err != nil {
		return nil, err
	}
	u.IsAdmin = isAdmin == 1
	return &u, nil
}

// SearchUsers 按 username 或 email 前缀模糊匹配，最多返回 limit 条（默认 10，上限 50）。
// 用于"邀请成员 / 分享给用户"等场景下解析 username → userId。
// 排除 password_hash 字段，对外仅暴露 username/email/id。
func (r *SQLiteRepository) SearchUsers(ctx context.Context, query string, limit int) ([]*model.User, error) {
	if limit <= 0 || limit > 50 {
		limit = 10
	}
	if query == "" {
		return nil, nil
	}
	pattern := query + "%"
	const q = `SELECT id, username, email, password_hash, created_at
              FROM users
              WHERE username LIKE ? OR email LIKE ?
              ORDER BY username
              LIMIT ?`
	rows, err := r.db.QueryContext(ctx, q, pattern, pattern, limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var out []*model.User
	for rows.Next() {
		var u model.User
		if err := rows.Scan(&u.ID, &u.Username, &u.Email, &u.PasswordHash, &u.CreatedAt); err != nil {
			return nil, err
		}
		out = append(out, &u)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	return out, nil
}

// ─── Projects ────────────────────────────────────────────────────────

func (r *SQLiteRepository) CreateProject(ctx context.Context, p *model.Project) error {
	const q = `INSERT INTO projects (id, name, description, owner_id, visibility, created_at, updated_at)
              VALUES (?, ?, ?, ?, ?, ?, ?)`
	if p.Visibility == "" {
		p.Visibility = model.VisibilityPrivate
	}
	_, err := r.db.ExecContext(ctx, q, p.ID, p.Name, p.Description, p.OwnerID, p.Visibility, p.CreatedAt, p.UpdatedAt)
	return err
}

func (r *SQLiteRepository) GetProject(ctx context.Context, id string) (*model.Project, error) {
	const q = `SELECT id, name, description, owner_id, visibility, created_at, updated_at
              FROM projects WHERE id = ?`
	row := r.db.QueryRowContext(ctx, q, id)
	var p model.Project
	if err := row.Scan(&p.ID, &p.Name, &p.Description, &p.OwnerID, &p.Visibility, &p.CreatedAt, &p.UpdatedAt); err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return nil, ErrNotFound
		}
		return nil, err
	}
	return &p, nil
}

func (r *SQLiteRepository) ListProjectsByUser(ctx context.Context, ownerID string) ([]*model.Project, error) {
	const q = `SELECT id, name, description, owner_id, visibility, created_at, updated_at
              FROM projects WHERE owner_id = ? ORDER BY updated_at DESC`
	rows, err := r.db.QueryContext(ctx, q, ownerID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	// 用 make 避免空结果返回 nil slice（会被 JSON 序列化为 null）。
	out := make([]*model.Project, 0)
	for rows.Next() {
		var p model.Project
		if err := rows.Scan(&p.ID, &p.Name, &p.Description, &p.OwnerID, &p.Visibility, &p.CreatedAt, &p.UpdatedAt); err != nil {
			return nil, err
		}
		out = append(out, &p)
	}
	return out, rows.Err()
}

// ListAccessibleProjects 列出 userID 可访问的所有项目（owner/team/direct share）。
// M4 W1 引入：替代 ListProjectsByUser 的纯 owner 过滤。
func (r *SQLiteRepository) ListAccessibleProjects(ctx context.Context, userID string) ([]*model.Project, error) {
	// UNION 自动去重（DISTINCT 行为）；按 updated_at DESC 排序。
	// 三路来源：
	//   1. owner 自己的项目
	//   2. 通过 team_project_access 间接获得的项目（用户所在的团队）
	//   3. 通过 project_shares 直接被分享的项目
	const q = `
SELECT id, name, description, owner_id, visibility, created_at, updated_at FROM projects
 WHERE owner_id = ?
UNION
SELECT p.id, p.name, p.description, p.owner_id, p.visibility, p.created_at, p.updated_at FROM projects p
 JOIN team_project_access tpa ON tpa.project_id = p.id
 JOIN team_members tm ON tm.team_id = tpa.team_id
 WHERE tm.user_id = ?
UNION
SELECT p.id, p.name, p.description, p.owner_id, p.visibility, p.created_at, p.updated_at FROM projects p
 JOIN project_shares ps ON ps.project_id = p.id
 WHERE ps.user_id = ?
 ORDER BY updated_at DESC`
	rows, err := r.db.QueryContext(ctx, q, userID, userID, userID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := make([]*model.Project, 0)
	for rows.Next() {
		var p model.Project
		if err := rows.Scan(&p.ID, &p.Name, &p.Description, &p.OwnerID, &p.Visibility, &p.CreatedAt, &p.UpdatedAt); err != nil {
			return nil, err
		}
		out = append(out, &p)
	}
	return out, rows.Err()
}

func (r *SQLiteRepository) UpdateProject(ctx context.Context, p *model.Project) error {
	const q = `UPDATE projects SET name = ?, description = ?, visibility = ?, updated_at = ?
              WHERE id = ?`
	_, err := r.db.ExecContext(ctx, q, p.Name, p.Description, p.Visibility, p.UpdatedAt, p.ID)
	return err
}

func (r *SQLiteRepository) DeleteProject(ctx context.Context, id string) error {
	res, err := r.db.ExecContext(ctx, `DELETE FROM projects WHERE id = ?`, id)
	if err != nil {
		return err
	}
	n, _ := res.RowsAffected()
	if n == 0 {
		return ErrNotFound
	}
	return nil
}

// ─── Models ──────────────────────────────────────────────────────────

func (r *SQLiteRepository) CreateModel(ctx context.Context, m *model.Model) error {
	const q = `INSERT INTO models (id, project_id, name, description, content, version, created_at, updated_at)
              VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
	_, err := r.db.ExecContext(ctx, q, m.ID, m.ProjectID, m.Name, m.Description, m.Content, m.Version, m.CreatedAt, m.UpdatedAt)
	return err
}

func (r *SQLiteRepository) GetModel(ctx context.Context, id string) (*model.Model, error) {
	const q = `SELECT id, project_id, name, COALESCE(description, ''), content, version, created_at, updated_at
              FROM models WHERE id = ?`
	row := r.db.QueryRowContext(ctx, q, id)
	var m model.Model
	if err := row.Scan(&m.ID, &m.ProjectID, &m.Name, &m.Description, &m.Content, &m.Version, &m.CreatedAt, &m.UpdatedAt); err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return nil, ErrNotFound
		}
		return nil, err
	}
	return &m, nil
}

func (r *SQLiteRepository) ListModelsByProject(ctx context.Context, projectID string) ([]*model.Model, error) {
	const q = `SELECT id, project_id, name, COALESCE(description, ''), content, version, created_at, updated_at
              FROM models WHERE project_id = ? ORDER BY updated_at DESC`
	rows, err := r.db.QueryContext(ctx, q, projectID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	// 用 make 而非 var，避免空结果返回 nil slice（会被 JSON 序列化为 null，
	// 前端 axios 解包后 models 变成 null，访问 .length 炸掉）。
	out := make([]*model.Model, 0)
	for rows.Next() {
		var m model.Model
		if err := rows.Scan(&m.ID, &m.ProjectID, &m.Name, &m.Description, &m.Content, &m.Version, &m.CreatedAt, &m.UpdatedAt); err != nil {
			return nil, err
		}
		out = append(out, &m)
	}
	return out, rows.Err()
}

// UpdateModel 乐观锁：版本不匹配返回 ErrVersionConflict。
func (r *SQLiteRepository) UpdateModel(ctx context.Context, m *model.Model, savedBy string) error {
	now := time.Now().UTC()

	// M4.5 增量：保存旧版本到 model_versions（best-effort，不阻塞更新）
	if m.Version > 0 {
		_, _ = r.db.ExecContext(ctx,
			`INSERT INTO model_versions (id, model_id, content, version, saved_by, created_at)
             VALUES (?, ?, ?, ?, ?, ?)`,
			uuid.NewString(), m.ID, m.Content, m.Version, savedBy, now,
		)
	}

	const q = `UPDATE models SET name = ?, description = ?, content = ?, version = version + 1, updated_at = ?
              WHERE id = ? AND version = ?`
	res, err := r.db.ExecContext(ctx, q, m.Name, m.Description, m.Content, now, m.ID, m.Version)
	if err != nil {
		return err
	}
	n, _ := res.RowsAffected()
	if n == 0 {
		return ErrVersionConflict
	}
	// 回读最新
	updated, err := r.GetModel(ctx, m.ID)
	if err != nil {
		return err
	}
	*m = *updated
	return nil
}

func (r *SQLiteRepository) DeleteModel(ctx context.Context, id string) error {
	res, err := r.db.ExecContext(ctx, `DELETE FROM models WHERE id = ?`, id)
	if err != nil {
		return err
	}
	n, _ := res.RowsAffected()
	if n == 0 {
		return ErrNotFound
	}
	return nil
}
