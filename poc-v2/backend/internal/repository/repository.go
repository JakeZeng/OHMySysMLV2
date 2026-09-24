// Package repository 实现 SQLite 持久化（MVP）。
package repository

import (
	"context"
	"database/sql"
	"encoding/json"
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
		"packages":   0,
		"views":      0,
		"viewpoints": 0,
		"teams":      0,
		"shares":     0,
		"share_links": 0,
		"audit_logs": 0,
	}
	for _, table := range []string{
		"users", "projects", "models", "packages", "views", "viewpoints", "teams",
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

-- M12 增量：packages 表（一等 SysML v2 实体，含 SysML 文本、可嵌套）
-- 注意：parent_package_id 允许 NULL（顶级包）；同时 UNIQUE(project_id, parent_package_id, name)
-- 把 NULL 视为不同 — 我们在应用层把空字符串映射为 NULL。
CREATE TABLE IF NOT EXISTS packages (
    id                TEXT PRIMARY KEY,
    project_id        TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    parent_package_id TEXT REFERENCES packages(id) ON DELETE CASCADE,
    name              TEXT NOT NULL,
    description       TEXT NOT NULL DEFAULT '',
    content           TEXT NOT NULL DEFAULT '',
    metadata_json     TEXT NOT NULL DEFAULT '{}',
    version           INTEGER NOT NULL DEFAULT 1,
    created_at        TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at        TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);
-- 显式创建唯一索引（NULL 在 UNIQUE 中视为不同 — 我们靠应用层保证唯一性）。
CREATE UNIQUE INDEX IF NOT EXISTS uq_packages_scope_name
    ON packages(project_id, COALESCE(parent_package_id, ''), name);
CREATE INDEX IF NOT EXISTS idx_packages_project ON packages(project_id);
CREATE INDEX IF NOT EXISTS idx_packages_parent ON packages(parent_package_id);
CREATE INDEX IF NOT EXISTS idx_packages_updated ON packages(updated_at DESC);

-- M12 增量：views 表（一等 SysML v2 ViewDefinition 实体）
-- 注意：package_id 允许 NULL（顶层视图）；应用层把空字符串映射为 NULL。
-- M15 增量：kind / viewpoint_id / render_kind / filter_qualified_names / inner_elements /
--          exposed_elements_unresolved；见 migration 006_view_extensions.up.sql
CREATE TABLE IF NOT EXISTS views (
    id                  TEXT PRIMARY KEY,
    project_id          TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    package_id          TEXT REFERENCES packages(id) ON DELETE SET NULL,
    name                TEXT NOT NULL,
    description         TEXT NOT NULL DEFAULT '',
    content             TEXT NOT NULL DEFAULT '',
    kind                TEXT NOT NULL DEFAULT 'definition',
    view_definition_id  TEXT REFERENCES views(id) ON DELETE SET NULL,
    viewpoint_id        TEXT,
    viewpoint_qualified_name TEXT NOT NULL DEFAULT '',
    render_kind         TEXT NOT NULL DEFAULT 'interconnection',
    filter_qualified_names TEXT NOT NULL DEFAULT '[]',
    color_tag           TEXT NOT NULL DEFAULT '',
    rendering_category  TEXT NOT NULL DEFAULT '',
    exposed_elements    TEXT NOT NULL DEFAULT '[]',
    exposed_elements_unresolved TEXT NOT NULL DEFAULT '[]',
    inner_elements      TEXT NOT NULL DEFAULT '[]',
    metadata_json       TEXT NOT NULL DEFAULT '{}',
    version             INTEGER NOT NULL DEFAULT 1,
    created_at          TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at          TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_views_scope_name
    ON views(project_id, COALESCE(package_id, ''), name);
CREATE INDEX IF NOT EXISTS idx_views_project ON views(project_id);
CREATE INDEX IF NOT EXISTS idx_views_package ON views(package_id);
CREATE INDEX IF NOT EXISTS idx_views_updated ON views(updated_at DESC);

-- M15 增量：viewpoints 表（一等 SysML v2 Viewpoint 实体）
CREATE TABLE IF NOT EXISTS viewpoints (
    id              TEXT PRIMARY KEY,
    project_id      TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    package_id      TEXT REFERENCES packages(id) ON DELETE SET NULL,
    name            TEXT NOT NULL,
    description     TEXT NOT NULL DEFAULT '',
    content         TEXT NOT NULL DEFAULT '',
    stakeholder     TEXT NOT NULL DEFAULT '',
    concern         TEXT NOT NULL DEFAULT '',
    inner_elements  TEXT NOT NULL DEFAULT '[]',
    metadata_json   TEXT NOT NULL DEFAULT '{}',
    version         INTEGER NOT NULL DEFAULT 1,
    created_at      TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at      TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_viewpoints_scope_name
    ON viewpoints(project_id, COALESCE(package_id, ''), name);
CREATE INDEX IF NOT EXISTS idx_viewpoints_project ON viewpoints(project_id);
CREATE INDEX IF NOT EXISTS idx_viewpoints_package ON viewpoints(package_id);
CREATE INDEX IF NOT EXISTS idx_viewpoints_updated ON viewpoints(updated_at DESC);
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

	// M13 增量：协作三件套 — presence / edit_locks / comments（从内存迁到 SQLite）
	// Schema source of truth: migrations/004_collaboration.up.sql。
	if _, err := r.db.Exec(
		`CREATE TABLE IF NOT EXISTS presence (
			scope          TEXT NOT NULL,
			user_id        TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
			username       TEXT NOT NULL,
			color          TEXT NOT NULL DEFAULT '',
			cursor_line    INTEGER,
			cursor_col     INTEGER,
			sel_start_line INTEGER,
			sel_start_col  INTEGER,
			sel_end_line   INTEGER,
			sel_end_col    INTEGER,
			content_hash   TEXT NOT NULL DEFAULT '',
			last_seen      TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
			PRIMARY KEY (scope, user_id)
		)`,
	); err != nil {
		return fmt.Errorf("创建 presence 表失败: %w", err)
	}
	if _, err := r.db.Exec(
		`CREATE INDEX IF NOT EXISTS idx_presence_scope_seen ON presence(scope, last_seen)`,
	); err != nil {
		return fmt.Errorf("创建 presence 索引失败: %w", err)
	}

	if _, err := r.db.Exec(
		`CREATE TABLE IF NOT EXISTS edit_locks (
			scope         TEXT PRIMARY KEY,
			owner_id      TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
			username      TEXT NOT NULL,
			acquired_at   TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
			expires_at    TIMESTAMP NOT NULL,
			base_version  INTEGER NOT NULL DEFAULT 1
		)`,
	); err != nil {
		return fmt.Errorf("创建 edit_locks 表失败: %w", err)
	}
	if _, err := r.db.Exec(
		`CREATE INDEX IF NOT EXISTS idx_edit_locks_expires ON edit_locks(expires_at)`,
	); err != nil {
		return fmt.Errorf("创建 edit_locks 索引失败: %w", err)
	}

	if _, err := r.db.Exec(
		`CREATE TABLE IF NOT EXISTS comments (
			id          TEXT PRIMARY KEY,
			scope       TEXT NOT NULL,
			user_id     TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
			username    TEXT NOT NULL,
			element_id  TEXT NOT NULL DEFAULT '',
			line        INTEGER NOT NULL DEFAULT 0,
			content     TEXT NOT NULL,
			resolved    INTEGER NOT NULL DEFAULT 0,
			created_at  TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
			updated_at  TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
		)`,
	); err != nil {
		return fmt.Errorf("创建 comments 表失败: %w", err)
	}
	if _, err := r.db.Exec(
		`CREATE INDEX IF NOT EXISTS idx_comments_scope ON comments(scope, created_at DESC)`,
	); err != nil {
		return fmt.Errorf("创建 comments 索引失败: %w", err)
	}

	// M15 增量：views 表加 kind / view_definition_id / viewpoint_id / viewpoint_qualified_name /
	//           render_kind / filter_qualified_names / inner_elements / exposed_elements_unresolved
	// SQLite ALTER TABLE ADD COLUMN 不可逆；列已存在时忽略错误。
	for _, stmt := range []string{
		`ALTER TABLE views ADD COLUMN kind TEXT NOT NULL DEFAULT 'definition'`,
		`ALTER TABLE views ADD COLUMN view_definition_id TEXT REFERENCES views(id) ON DELETE SET NULL`,
		`ALTER TABLE views ADD COLUMN viewpoint_id TEXT`,
		`ALTER TABLE views ADD COLUMN viewpoint_qualified_name TEXT NOT NULL DEFAULT ''`,
		`ALTER TABLE views ADD COLUMN render_kind TEXT NOT NULL DEFAULT 'interconnection'`,
		`ALTER TABLE views ADD COLUMN filter_qualified_names TEXT NOT NULL DEFAULT '[]'`,
		`ALTER TABLE views ADD COLUMN inner_elements TEXT NOT NULL DEFAULT '[]'`,
		`ALTER TABLE views ADD COLUMN exposed_elements_unresolved TEXT NOT NULL DEFAULT '[]'`,
	} {
		if _, err := r.db.Exec(stmt); err != nil {
			// 兼容历史 DB：列已存在时忽略
		}
	}
	// M15 增量：viewpoints 表加 inner_elements 列（viewpoint body 内 owned 元素）
	if _, err := r.db.Exec(`ALTER TABLE viewpoints ADD COLUMN inner_elements TEXT NOT NULL DEFAULT '[]'`); err != nil {
		// 兼容历史 DB：列已存在时忽略
	}
	if _, err := r.db.Exec(`CREATE INDEX IF NOT EXISTS idx_views_viewpoint ON views(viewpoint_id)`); err != nil {
		// 忽略（索引已存在时）
	}
	if _, err := r.db.Exec(`CREATE INDEX IF NOT EXISTS idx_views_render_kind ON views(render_kind)`); err != nil {
		// 忽略
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

// SearchModels 跨项目搜索模型名称 + 描述（M4.5 增量）。
//
// 只返回调用方有 read 权限的项目下的模型。
// 用 userHeldPermission 在 handler 层做过滤太慢（N+1），
// 所以这里直接用 SQL JOIN：owner 项目 + direct share 项目 + team share 项目。
func (r *SQLiteRepository) SearchModels(
	ctx context.Context, query, userID string, limit int,
) ([]*model.Model, error) {
	if limit <= 0 || limit > 100 {
		limit = 20
	}
	like := "%" + query + "%"
	rows, err := r.db.QueryContext(ctx,
		`SELECT m.id, m.project_id, m.name, COALESCE(m.description, ''), m.content, m.version, m.created_at, m.updated_at
         FROM models m
         JOIN projects p ON p.id = m.project_id
         WHERE (m.name LIKE ? OR m.description LIKE ?)
           AND (
             p.owner_id = ?
             OR p.id IN (SELECT project_id FROM project_shares WHERE user_id = ?)
             OR p.id IN (
               SELECT tpa.project_id FROM team_project_access tpa
               JOIN team_members tm ON tm.team_id = tpa.team_id
               WHERE tm.user_id = ?
             )
           )
         ORDER BY m.updated_at DESC
         LIMIT ?`,
		like, like, userID, userID, userID, limit,
	)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
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

// ─── Packages (M12 一等 SysML v2 实体) ────────────────────────────────

// marshalMetadata 把 map 序列化为 JSON 字符串。空 map 写入 "{}"。
func marshalMetadata(m map[string]string) (string, error) {
	if len(m) == 0 {
		return "{}", nil
	}
	b, err := json.Marshal(m)
	if err != nil {
		return "", err
	}
	return string(b), nil
}

// unmarshalMetadata 从 JSON 字符串反序列化。空串或 "{}" 视为空 map。
func unmarshalMetadata(s string) (map[string]string, error) {
	if s == "" || s == "{}" {
		return nil, nil
	}
	out := map[string]string{}
	if err := json.Unmarshal([]byte(s), &out); err != nil {
		return nil, err
	}
	return out, nil
}

// scanPackage 把 row 扫描到 Package（含 content/metadata）。
func scanPackage(row interface {
	Scan(dest ...any) error
}) (*model.Package, error) {
	var (
		p             model.Package
		parentPkgID   sql.NullString
		desc          string
		metadataJSON  string
	)
	if err := row.Scan(&p.ID, &p.ProjectID, &parentPkgID, &p.Name, &desc, &p.Content, &metadataJSON, &p.Version, &p.CreatedAt, &p.UpdatedAt); err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return nil, ErrNotFound
		}
		return nil, err
	}
	p.ParentPackageID = parentPkgID.String
	p.Description = desc
	if md, err := unmarshalMetadata(metadataJSON); err == nil {
		p.Metadata = md
	}
	return &p, nil
}

// scanPackageSummary 把 row 扫描到 PackageSummary（不含 content）。
func scanPackageSummary(row interface {
	Scan(dest ...any) error
}) (*model.PackageSummary, error) {
	var (
		ps           model.PackageSummary
		parentPkgID  sql.NullString
		desc         string
	)
	if err := row.Scan(&ps.ID, &ps.ProjectID, &parentPkgID, &ps.Name, &desc, &ps.Version, &ps.UpdatedAt); err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return nil, ErrNotFound
		}
		return nil, err
	}
	ps.ParentPackageID = parentPkgID.String
	ps.Description = desc
	return &ps, nil
}

func (r *SQLiteRepository) CreatePackage(ctx context.Context, p *model.Package) error {
	mdJSON, err := marshalMetadata(p.Metadata)
	if err != nil {
		return fmt.Errorf("序列化 metadata 失败: %w", err)
	}
	// 顶层包规范化：parent_package_id 空字符串存为 NULL，
	// 避免空字符串触发 self-FK (packages.id = '') 失败。
	var parentPkgID any
	if p.ParentPackageID != "" {
		parentPkgID = p.ParentPackageID
	}
	const q = `INSERT INTO packages (id, project_id, parent_package_id, name, description, content, metadata_json, version, created_at, updated_at)
              VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
	_, err = r.db.ExecContext(ctx, q, p.ID, p.ProjectID, parentPkgID, p.Name, p.Description, p.Content, mdJSON, p.Version, p.CreatedAt, p.UpdatedAt)
	return err
}

func (r *SQLiteRepository) GetPackage(ctx context.Context, id string) (*model.Package, error) {
	const q = `SELECT id, project_id, parent_package_id, name, description, content, metadata_json, version, created_at, updated_at
              FROM packages WHERE id = ?`
	row := r.db.QueryRowContext(ctx, q, id)
	return scanPackage(row)
}

func (r *SQLiteRepository) GetPackageSummary(ctx context.Context, id string) (*model.PackageSummary, error) {
	const q = `SELECT id, project_id, parent_package_id, name, description, version, updated_at
              FROM packages WHERE id = ?`
	row := r.db.QueryRowContext(ctx, q, id)
	return scanPackageSummary(row)
}

func (r *SQLiteRepository) ListPackagesByProject(ctx context.Context, projectID string) ([]*model.PackageSummary, error) {
	const q = `SELECT id, project_id, parent_package_id, name, description, version, updated_at
              FROM packages WHERE project_id = ? ORDER BY updated_at DESC`
	rows, err := r.db.QueryContext(ctx, q, projectID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := make([]*model.PackageSummary, 0)
	for rows.Next() {
		ps, err := scanPackageSummary(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, ps)
	}
	return out, rows.Err()
}

// ListPackageContentRefsByProject 返回工程下所有包的 (id, name, parent, content)。
//
// M15：专供 View expose 路径的严格 resolve —— 校验目标 def 是否真存在于包 body。
// 与 ListPackagesByProject 的区别：这个带 Content，且不返回 description/version 等
// resolve 用不到的列（视图保存是低频操作，可接受整表 content 的传输成本）。
func (r *SQLiteRepository) ListPackageContentRefsByProject(ctx context.Context, projectID string) ([]model.PackageContentRef, error) {
	const q = `SELECT id, name, COALESCE(parent_package_id, ''), content
              FROM packages WHERE project_id = ?`
	rows, err := r.db.QueryContext(ctx, q, projectID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := make([]model.PackageContentRef, 0)
	for rows.Next() {
		var ref model.PackageContentRef
		if err := rows.Scan(&ref.ID, &ref.Name, &ref.ParentPackageID, &ref.Content); err != nil {
			return nil, err
		}
		out = append(out, ref)
	}
	return out, rows.Err()
}

// UpdatePackage 乐观锁：版本不匹配返回 ErrVersionConflict。
func (r *SQLiteRepository) UpdatePackage(ctx context.Context, p *model.Package) error {
	now := time.Now().UTC()
	mdJSON, err := marshalMetadata(p.Metadata)
	if err != nil {
		return fmt.Errorf("序列化 metadata 失败: %w", err)
	}
	var parentPkgID any
	if p.ParentPackageID != "" {
		parentPkgID = p.ParentPackageID
	}
	const q = `UPDATE packages SET name = ?, parent_package_id = ?, description = ?, content = ?, metadata_json = ?, version = version + 1, updated_at = ?
              WHERE id = ? AND version = ?`
	res, err := r.db.ExecContext(ctx, q, p.Name, parentPkgID, p.Description, p.Content, mdJSON, now, p.ID, p.Version)
	if err != nil {
		return err
	}
	n, _ := res.RowsAffected()
	if n == 0 {
		return ErrVersionConflict
	}
	updated, err := r.GetPackage(ctx, p.ID)
	if err != nil {
		return err
	}
	*p = *updated
	return nil
}

func (r *SQLiteRepository) DeletePackage(ctx context.Context, id string) error {
	res, err := r.db.ExecContext(ctx, `DELETE FROM packages WHERE id = ?`, id)
	if err != nil {
		return err
	}
	n, _ := res.RowsAffected()
	if n == 0 {
		return ErrNotFound
	}
	return nil
}

// ─── Views (M12 一等 SysML v2 ViewDefinition，M15 升级含 kind / renderKind / viewpoint 等) ───

// viewSelectColumns 共享的 SELECT 列（避免 CreateView / scanView / GetView 重复硬编码）。
const viewSelectColumns = `id, project_id, package_id, name, description, content,
		kind, view_definition_id, viewpoint_id, viewpoint_qualified_name,
		render_kind, filter_qualified_names,
		color_tag, rendering_category,
		exposed_elements, exposed_elements_unresolved, inner_elements,
		metadata_json, version, created_at, updated_at`

// viewSummarySelectColumns ViewSummary 用的精简列。
//
// M15：追加 filter_qualified_names / exposed_elements / exposed_elements_unresolved /
// inner_elements —— 树需要 expose 计数徽章 + view-private 元素子树，一次性带回避免 N+1。
const viewSummarySelectColumns = `id, project_id, package_id, name, description,
		kind, view_definition_id, viewpoint_id, viewpoint_qualified_name,
		render_kind, color_tag, rendering_category,
		filter_qualified_names, exposed_elements, exposed_elements_unresolved, inner_elements,
		version, updated_at`

// scanView 把 row 扫描到 View（含 M15 全字段）。
func scanView(row interface {
	Scan(dest ...any) error
}) (*model.View, error) {
	var (
		v                       model.View
		pkgID                   sql.NullString
		viewDefID               sql.NullString
		viewpointID             sql.NullString
		desc                    string
		colorTag                string
		renderCat               string
		exposedJSON             string
		exposedUnresolvedJSON   string
		innerJSON               string
		filterJSON              string
		metadataJSON            string
		kind                    string
		renderKind              string
		viewpointQName          string
	)
	if err := row.Scan(
		&v.ID, &v.ProjectID, &pkgID, &v.Name, &desc, &v.Content,
		&kind, &viewDefID, &viewpointID, &viewpointQName,
		&renderKind, &filterJSON,
		&colorTag, &renderCat,
		&exposedJSON, &exposedUnresolvedJSON, &innerJSON,
		&metadataJSON, &v.Version, &v.CreatedAt, &v.UpdatedAt,
	); err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return nil, ErrNotFound
		}
		return nil, err
	}
	v.PackageID = pkgID.String
	v.ViewDefinitionID = viewDefID.String
	v.ViewpointID = viewpointID.String
	v.ViewpointQualifiedName = viewpointQName
	v.Description = desc
	v.ColorTag = colorTag
	v.RenderingCategory = renderCat
	v.Kind = model.ViewKind(kind)
	if v.Kind == "" {
		v.Kind = model.ViewKindDefinition
	}
	v.RenderKind = model.NormalizeRenderKind(renderKind)
	if exposed, err := model.UnmarshalExposedElements(exposedJSON); err == nil {
		v.ExposedElements = exposed
	}
	if exposedUn, err := model.UnmarshalExposedElements(exposedUnresolvedJSON); err == nil {
		v.ExposedElementsUnresolved = exposedUn
	}
	if inner, err := model.UnmarshalInnerElements(innerJSON); err == nil {
		v.InnerElements = inner
	}
	if filter, err := model.UnmarshalStringSlice(filterJSON); err == nil {
		v.FilterQualifiedNames = filter
	}
	if md, err := unmarshalMetadata(metadataJSON); err == nil {
		v.Metadata = md
	}
	return &v, nil
}

// scanViewSummary 把 row 扫描到 ViewSummary（含 M15 kind/renderKind/viewpointId）。
func scanViewSummary(row interface {
	Scan(dest ...any) error
}) (*model.ViewSummary, error) {
	var (
		vs             model.ViewSummary
		pkgID          sql.NullString
		viewDefID      sql.NullString
		viewpointID    sql.NullString
		desc           string
		colorTag       string
		renderCat      string
		kind           string
		renderKind     string
		viewpointQName string
		filterJSON     string
		exposedJSON    string
		exposedUnJSON  string
		innerJSON      string
	)
	if err := row.Scan(
		&vs.ID, &vs.ProjectID, &pkgID, &vs.Name, &desc,
		&kind, &viewDefID, &viewpointID, &viewpointQName,
		&renderKind, &colorTag, &renderCat,
		&filterJSON, &exposedJSON, &exposedUnJSON, &innerJSON,
		&vs.Version, &vs.UpdatedAt,
	); err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return nil, ErrNotFound
		}
		return nil, err
	}
	vs.PackageID = pkgID.String
	vs.ViewDefinitionID = viewDefID.String
	vs.ViewpointID = viewpointID.String
	vs.ViewpointQName = viewpointQName
	vs.Description = desc
	vs.ColorTag = colorTag
	vs.RenderingCategory = renderCat
	vs.Kind = model.ViewKind(kind)
	if vs.Kind == "" {
		vs.Kind = model.ViewKindDefinition
	}
	vs.RenderKind = model.NormalizeRenderKind(renderKind)

	// M15：树渲染增量 —— 解析失败不致命（退化为空），避免列表整体 500
	if inner, err := model.UnmarshalInnerElements(innerJSON); err == nil {
		vs.InnerElements = inner
	}
	if filter, err := model.UnmarshalStringSlice(filterJSON); err == nil {
		vs.FilterQualifiedNames = filter
	}
	if exposed, err := model.UnmarshalExposedElements(exposedJSON); err == nil {
		vs.ExposeCount = len(exposed)
	}
	if exposedUn, err := model.UnmarshalExposedElements(exposedUnJSON); err == nil {
		vs.ExposeUnresolvedCount = len(exposedUn)
	}
	return &vs, nil
}

func (r *SQLiteRepository) CreateView(ctx context.Context, v *model.View) error {
	mdJSON, err := marshalMetadata(v.Metadata)
	if err != nil {
		return fmt.Errorf("序列化 metadata 失败: %w", err)
	}
	exposedJSON, err := model.MarshalExposedElements(v.ExposedElements)
	if err != nil {
		return fmt.Errorf("序列化 exposedElements 失败: %w", err)
	}
	exposedUnresolvedJSON, err := model.MarshalExposedElements(v.ExposedElementsUnresolved)
	if err != nil {
		return fmt.Errorf("序列化 exposedElementsUnresolved 失败: %w", err)
	}
	innerJSON, err := model.MarshalInnerElements(v.InnerElements)
	if err != nil {
		return fmt.Errorf("序列化 innerElements 失败: %w", err)
	}
	filterJSON, err := model.MarshalStringSlice(v.FilterQualifiedNames)
	if err != nil {
		return fmt.Errorf("序列化 filterQualifiedNames 失败: %w", err)
	}
	// 顶层视图规范化：package_id 空字符串存为 NULL
	var pkgID, viewDefID, viewpointID any
	if v.PackageID != "" {
		pkgID = v.PackageID
	}
	if v.ViewDefinitionID != "" {
		viewDefID = v.ViewDefinitionID
	}
	if v.ViewpointID != "" {
		viewpointID = v.ViewpointID
	}
	kind := string(v.Kind)
	if kind == "" {
		kind = string(model.ViewKindDefinition)
	}
	renderKind := string(v.RenderKind)
	if renderKind == "" {
		renderKind = string(model.RenderKindInterconnection)
	}
	const q = `INSERT INTO views (
		id, project_id, package_id, name, description, content,
		kind, view_definition_id, viewpoint_id, viewpoint_qualified_name,
		render_kind, filter_qualified_names,
		color_tag, rendering_category,
		exposed_elements, exposed_elements_unresolved, inner_elements,
		metadata_json, version, created_at, updated_at
	) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
	_, err = r.db.ExecContext(ctx, q,
		v.ID, v.ProjectID, pkgID, v.Name, v.Description, v.Content,
		kind, viewDefID, viewpointID, v.ViewpointQualifiedName,
		renderKind, filterJSON,
		v.ColorTag, v.RenderingCategory,
		exposedJSON, exposedUnresolvedJSON, innerJSON,
		mdJSON, v.Version, v.CreatedAt, v.UpdatedAt)
	return err
}

func (r *SQLiteRepository) GetView(ctx context.Context, id string) (*model.View, error) {
	q := `SELECT ` + viewSelectColumns + ` FROM views WHERE id = ?`
	row := r.db.QueryRowContext(ctx, q, id)
	return scanView(row)
}

func (r *SQLiteRepository) ListViewsByProject(ctx context.Context, projectID string) ([]*model.ViewSummary, error) {
	q := `SELECT ` + viewSummarySelectColumns + ` FROM views WHERE project_id = ? ORDER BY updated_at DESC`
	rows, err := r.db.QueryContext(ctx, q, projectID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := make([]*model.ViewSummary, 0)
	for rows.Next() {
		vs, err := scanViewSummary(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, vs)
	}
	return out, rows.Err()
}

// ListViewsByKind 列出工程下指定 kind 的视图（M15）。
func (r *SQLiteRepository) ListViewsByKind(ctx context.Context, projectID string, kind model.ViewKind) ([]*model.ViewSummary, error) {
	q := `SELECT ` + viewSummarySelectColumns + ` FROM views WHERE project_id = ? AND kind = ? ORDER BY updated_at DESC`
	rows, err := r.db.QueryContext(ctx, q, projectID, string(kind))
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := make([]*model.ViewSummary, 0)
	for rows.Next() {
		vs, err := scanViewSummary(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, vs)
	}
	return out, rows.Err()
}

// UpdateView 乐观锁：版本不匹配返回 ErrVersionConflict。
// 每次更新重算 exposedElements / exposedElementsUnresolved / innerElements（解析 content）。
// parseFn：传入 content 返回完整解析结果（含 resolved/unresolved split）。
func (r *SQLiteRepository) UpdateView(ctx context.Context, v *model.View, parseFn func(content string) (resolved, unresolved []model.ExposedElement, renderKind model.RenderKind, filterNames []string, inner []model.InnerElement)) error {
	now := time.Now().UTC()
	mdJSON, err := marshalMetadata(v.Metadata)
	if err != nil {
		return fmt.Errorf("序列化 metadata 失败: %w", err)
	}
	// 重算暴露 / 过滤 / 渲染 / 内嵌元素（如调用方传了 parser）
	if parseFn != nil {
		resolved, unresolved, renderKind, filterNames, inner := parseFn(v.Content)
		v.ExposedElements = resolved
		v.ExposedElementsUnresolved = unresolved
		v.RenderKind = renderKind
		v.FilterQualifiedNames = filterNames
		v.InnerElements = inner
	}
	exposedJSON, err := model.MarshalExposedElements(v.ExposedElements)
	if err != nil {
		return fmt.Errorf("序列化 exposedElements 失败: %w", err)
	}
	exposedUnresolvedJSON, err := model.MarshalExposedElements(v.ExposedElementsUnresolved)
	if err != nil {
		return fmt.Errorf("序列化 exposedElementsUnresolved 失败: %w", err)
	}
	innerJSON, err := model.MarshalInnerElements(v.InnerElements)
	if err != nil {
		return fmt.Errorf("序列化 innerElements 失败: %w", err)
	}
	filterJSON, err := model.MarshalStringSlice(v.FilterQualifiedNames)
	if err != nil {
		return fmt.Errorf("序列化 filterQualifiedNames 失败: %w", err)
	}
	var pkgID, viewDefID, viewpointID any
	if v.PackageID != "" {
		pkgID = v.PackageID
	}
	if v.ViewDefinitionID != "" {
		viewDefID = v.ViewDefinitionID
	}
	if v.ViewpointID != "" {
		viewpointID = v.ViewpointID
	}
	kind := string(v.Kind)
	if kind == "" {
		kind = string(model.ViewKindDefinition)
	}
	renderKind := string(v.RenderKind)
	if renderKind == "" {
		renderKind = string(model.RenderKindInterconnection)
	}
	const q = `UPDATE views SET
		name = ?, package_id = ?, description = ?, content = ?,
		kind = ?, view_definition_id = ?, viewpoint_id = ?, viewpoint_qualified_name = ?,
		render_kind = ?, filter_qualified_names = ?,
		color_tag = ?, rendering_category = ?,
		exposed_elements = ?, exposed_elements_unresolved = ?, inner_elements = ?,
		metadata_json = ?, version = version + 1, updated_at = ?
              WHERE id = ? AND version = ?`
	res, err := r.db.ExecContext(ctx, q,
		v.Name, pkgID, v.Description, v.Content,
		kind, viewDefID, viewpointID, v.ViewpointQualifiedName,
		renderKind, filterJSON,
		v.ColorTag, v.RenderingCategory,
		exposedJSON, exposedUnresolvedJSON, innerJSON,
		mdJSON, now, v.ID, v.Version)
	if err != nil {
		return err
	}
	n, _ := res.RowsAffected()
	if n == 0 {
		return ErrVersionConflict
	}
	updated, err := r.GetView(ctx, v.ID)
	if err != nil {
		return err
	}
	*v = *updated
	return nil
}

func (r *SQLiteRepository) DeleteView(ctx context.Context, id string) error {
	res, err := r.db.ExecContext(ctx, `DELETE FROM views WHERE id = ?`, id)
	if err != nil {
		return err
	}
	n, _ := res.RowsAffected()
	if n == 0 {
		return ErrNotFound
	}
	return nil
}

// ─── Viewpoints (M15 一等 SysML v2 Viewpoint 实体) ──────────────────────────

// viewpointSelectColumns 共享 SELECT 列。
const viewpointSelectColumns = `id, project_id, package_id, name, description,
		content, stakeholder, concern, inner_elements,
		metadata_json, version, created_at, updated_at`

// viewpointSummarySelectColumns ViewpointSummary 用的精简列。
const viewpointSummarySelectColumns = `id, project_id, package_id, name, description,
		stakeholder, concern, inner_elements,
		version, updated_at`

// scanViewpoint 把 row 扫描到 Viewpoint。
func scanViewpoint(row interface {
	Scan(dest ...any) error
}) (*model.Viewpoint, error) {
	var (
		vp           model.Viewpoint
		pkgID        sql.NullString
		desc         string
		stakeholder  string
		concern      string
		innerJSON    string
		metadataJSON string
	)
	if err := row.Scan(
		&vp.ID, &vp.ProjectID, &pkgID, &vp.Name, &desc,
		&vp.Content, &stakeholder, &concern, &innerJSON,
		&metadataJSON, &vp.Version, &vp.CreatedAt, &vp.UpdatedAt,
	); err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return nil, ErrNotFound
		}
		return nil, err
	}
	vp.PackageID = pkgID.String
	vp.Description = desc
	vp.Stakeholder = stakeholder
	vp.Concern = concern
	if inner, err := model.UnmarshalInnerElements(innerJSON); err == nil {
		vp.InnerElements = inner
	}
	if md, err := unmarshalMetadata(metadataJSON); err == nil {
		vp.Metadata = md
	}
	return &vp, nil
}

// scanViewpointSummary 把 row 扫描到 ViewpointSummary。
func scanViewpointSummary(row interface {
	Scan(dest ...any) error
}) (*model.ViewpointSummary, error) {
	var (
		vps         model.ViewpointSummary
		pkgID       sql.NullString
		desc        string
		stakeholder string
		concern     string
		innerJSON   string
	)
	if err := row.Scan(
		&vps.ID, &vps.ProjectID, &pkgID, &vps.Name, &desc,
		&stakeholder, &concern, &innerJSON,
		&vps.Version, &vps.UpdatedAt,
	); err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return nil, ErrNotFound
		}
		return nil, err
	}
	vps.PackageID = pkgID.String
	vps.Description = desc
	vps.Stakeholder = stakeholder
	vps.Concern = concern
	if inner, err := model.UnmarshalInnerElements(innerJSON); err == nil {
		vps.InnerElements = inner
	}
	return &vps, nil
}

func (r *SQLiteRepository) CreateViewpoint(ctx context.Context, vp *model.Viewpoint) error {
	mdJSON, err := marshalMetadata(vp.Metadata)
	if err != nil {
		return fmt.Errorf("序列化 metadata 失败: %w", err)
	}
	innerJSON, err := model.MarshalInnerElements(vp.InnerElements)
	if err != nil {
		return fmt.Errorf("序列化 innerElements 失败: %w", err)
	}
	var pkgID any
	if vp.PackageID != "" {
		pkgID = vp.PackageID
	}
	const q = `INSERT INTO viewpoints (
		id, project_id, package_id, name, description,
		content, stakeholder, concern, inner_elements,
		metadata_json, version, created_at, updated_at
	) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
	_, err = r.db.ExecContext(ctx, q,
		vp.ID, vp.ProjectID, pkgID, vp.Name, vp.Description,
		vp.Content, vp.Stakeholder, vp.Concern, innerJSON,
		mdJSON, vp.Version, vp.CreatedAt, vp.UpdatedAt)
	return err
}

func (r *SQLiteRepository) GetViewpoint(ctx context.Context, id string) (*model.Viewpoint, error) {
	q := `SELECT ` + viewpointSelectColumns + ` FROM viewpoints WHERE id = ?`
	row := r.db.QueryRowContext(ctx, q, id)
	return scanViewpoint(row)
}

func (r *SQLiteRepository) ListViewpointsByProject(ctx context.Context, projectID string) ([]*model.ViewpointSummary, error) {
	q := `SELECT ` + viewpointSummarySelectColumns + ` FROM viewpoints WHERE project_id = ? ORDER BY updated_at DESC`
	rows, err := r.db.QueryContext(ctx, q, projectID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := make([]*model.ViewpointSummary, 0)
	for rows.Next() {
		vps, err := scanViewpointSummary(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, vps)
	}
	return out, rows.Err()
}

func (r *SQLiteRepository) UpdateViewpoint(ctx context.Context, vp *model.Viewpoint) error {
	now := time.Now().UTC()
	mdJSON, err := marshalMetadata(vp.Metadata)
	if err != nil {
		return fmt.Errorf("序列化 metadata 失败: %w", err)
	}
	innerJSON, err := model.MarshalInnerElements(vp.InnerElements)
	if err != nil {
		return fmt.Errorf("序列化 innerElements 失败: %w", err)
	}
	var pkgID any
	if vp.PackageID != "" {
		pkgID = vp.PackageID
	}
	const q = `UPDATE viewpoints SET
		name = ?, package_id = ?, description = ?,
		content = ?, stakeholder = ?, concern = ?, inner_elements = ?,
		metadata_json = ?, version = version + 1, updated_at = ?
              WHERE id = ? AND version = ?`
	res, err := r.db.ExecContext(ctx, q,
		vp.Name, pkgID, vp.Description,
		vp.Content, vp.Stakeholder, vp.Concern, innerJSON,
		mdJSON, now, vp.ID, vp.Version)
	if err != nil {
		return err
	}
	n, _ := res.RowsAffected()
	if n == 0 {
		return ErrVersionConflict
	}
	updated, err := r.GetViewpoint(ctx, vp.ID)
	if err != nil {
		return err
	}
	*vp = *updated
	return nil
}

func (r *SQLiteRepository) DeleteViewpoint(ctx context.Context, id string) error {
	res, err := r.db.ExecContext(ctx, `DELETE FROM viewpoints WHERE id = ?`, id)
	if err != nil {
		return err
	}
	n, _ := res.RowsAffected()
	if n == 0 {
		return ErrNotFound
	}
	return nil
}
