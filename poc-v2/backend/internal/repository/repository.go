// Package repository 实现 SQLite 持久化（MVP）。
package repository

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"time"

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

// New 打开或创建 SQLite 数据库，初始化全部 schema。
func New(path string) (*SQLiteRepository, error) {
	db, err := sql.Open("sqlite", path)
	if err != nil {
		return nil, fmt.Errorf("打开 SQLite 失败: %w", err)
	}
	db.SetMaxOpenConns(1)
	db.SetMaxIdleConns(1)
	db.SetConnMaxLifetime(0)

	repo := &SQLiteRepository{db: db}
	if err := repo.initSchema(); err != nil {
		_ = db.Close()
		return nil, err
	}
	return repo, nil
}

func (r *SQLiteRepository) initSchema() error {
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
`
	_, err := r.db.Exec(ddl)
	if err != nil {
		return fmt.Errorf("初始化 schema 失败: %w", err)
	}
	return nil
}

// Close 关闭数据库。
func (r *SQLiteRepository) Close() error { return r.db.Close() }

// ─── Users ──────────────────────────────────────────────────────────

func (r *SQLiteRepository) CreateUser(ctx context.Context, u *model.User) error {
	const q = `INSERT INTO users (id, username, email, password_hash, created_at)
              VALUES (?, ?, ?, ?, ?)`
	_, err := r.db.ExecContext(ctx, q, u.ID, u.Username, u.Email, u.PasswordHash, u.CreatedAt)
	return err
}

func (r *SQLiteRepository) GetUserByUsername(ctx context.Context, username string) (*model.User, error) {
	const q = `SELECT id, username, email, password_hash, created_at
              FROM users WHERE username = ?`
	row := r.db.QueryRowContext(ctx, q, username)
	var u model.User
	if err := row.Scan(&u.ID, &u.Username, &u.Email, &u.PasswordHash, &u.CreatedAt); err != nil {
		return nil, err
	}
	return &u, nil
}

func (r *SQLiteRepository) GetUserByEmail(ctx context.Context, email string) (*model.User, error) {
	const q = `SELECT id, username, email, password_hash, created_at
              FROM users WHERE email = ?`
	row := r.db.QueryRowContext(ctx, q, email)
	var u model.User
	if err := row.Scan(&u.ID, &u.Username, &u.Email, &u.PasswordHash, &u.CreatedAt); err != nil {
		return nil, err
	}
	return &u, nil
}

// ─── Projects ────────────────────────────────────────────────────────

func (r *SQLiteRepository) CreateProject(ctx context.Context, p *model.Project) error {
	const q = `INSERT INTO projects (id, name, description, owner_id, created_at, updated_at)
              VALUES (?, ?, ?, ?, ?, ?)`
	_, err := r.db.ExecContext(ctx, q, p.ID, p.Name, p.Description, p.OwnerID, p.CreatedAt, p.UpdatedAt)
	return err
}

func (r *SQLiteRepository) GetProject(ctx context.Context, id string) (*model.Project, error) {
	const q = `SELECT id, name, description, owner_id, created_at, updated_at
              FROM projects WHERE id = ?`
	row := r.db.QueryRowContext(ctx, q, id)
	var p model.Project
	if err := row.Scan(&p.ID, &p.Name, &p.Description, &p.OwnerID, &p.CreatedAt, &p.UpdatedAt); err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return nil, ErrNotFound
		}
		return nil, err
	}
	return &p, nil
}

func (r *SQLiteRepository) ListProjectsByUser(ctx context.Context, ownerID string) ([]*model.Project, error) {
	const q = `SELECT id, name, description, owner_id, created_at, updated_at
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
		if err := rows.Scan(&p.ID, &p.Name, &p.Description, &p.OwnerID, &p.CreatedAt, &p.UpdatedAt); err != nil {
			return nil, err
		}
		out = append(out, &p)
	}
	return out, rows.Err()
}

func (r *SQLiteRepository) UpdateProject(ctx context.Context, p *model.Project) error {
	const q = `UPDATE projects SET name = ?, description = ?, updated_at = ?
              WHERE id = ?`
	_, err := r.db.ExecContext(ctx, q, p.Name, p.Description, p.UpdatedAt, p.ID)
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
	const q = `INSERT INTO models (id, project_id, name, content, version, created_at, updated_at)
              VALUES (?, ?, ?, ?, ?, ?, ?)`
	_, err := r.db.ExecContext(ctx, q, m.ID, m.ProjectID, m.Name, m.Content, m.Version, m.CreatedAt, m.UpdatedAt)
	return err
}

func (r *SQLiteRepository) GetModel(ctx context.Context, id string) (*model.Model, error) {
	const q = `SELECT id, project_id, name, content, version, created_at, updated_at
              FROM models WHERE id = ?`
	row := r.db.QueryRowContext(ctx, q, id)
	var m model.Model
	if err := row.Scan(&m.ID, &m.ProjectID, &m.Name, &m.Content, &m.Version, &m.CreatedAt, &m.UpdatedAt); err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return nil, ErrNotFound
		}
		return nil, err
	}
	return &m, nil
}

func (r *SQLiteRepository) ListModelsByProject(ctx context.Context, projectID string) ([]*model.Model, error) {
	const q = `SELECT id, project_id, name, content, version, created_at, updated_at
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
		if err := rows.Scan(&m.ID, &m.ProjectID, &m.Name, &m.Content, &m.Version, &m.CreatedAt, &m.UpdatedAt); err != nil {
			return nil, err
		}
		out = append(out, &m)
	}
	return out, rows.Err()
}

// UpdateModel 乐观锁：版本不匹配返回 ErrVersionConflict。
func (r *SQLiteRepository) UpdateModel(ctx context.Context, m *model.Model) error {
	now := time.Now().UTC()
	const q = `UPDATE models SET name = ?, content = ?, version = version + 1, updated_at = ?
              WHERE id = ? AND version = ?`
	res, err := r.db.ExecContext(ctx, q, m.Name, m.Content, now, m.ID, m.Version)
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
