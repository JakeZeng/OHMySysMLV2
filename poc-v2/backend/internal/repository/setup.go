package repository

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
)

// SetupState 记录「首次安装引导」状态。
//
// 语义：
//   - initialized=0 且库中已有用户 → 老安装（升级上来），视为已完成，见 NeedsSetup。
//   - initialized=1 → 向导已走完。
type SetupState struct {
	Initialized   bool
	InitializedAt sql.NullTime
	CompletedBy   string
	Version       string
}

// GetSetupState 读取安装状态（不存在时返回零值 + initialized=false）。
func (r *SQLiteRepository) GetSetupState(ctx context.Context) (*SetupState, error) {
	var s SetupState
	var initialized int
	var initializedAt sql.NullTime
	err := r.db.QueryRowContext(ctx,
		`SELECT initialized, initialized_at, completed_by, version FROM setup_state WHERE id = 1`,
	).Scan(&initialized, &initializedAt, &s.CompletedBy, &s.Version)
	if err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return &SetupState{}, nil
		}
		return nil, err
	}
	s.Initialized = initialized != 0
	s.InitializedAt = initializedAt
	return &s, nil
}

// MarkSetupInitialized 标记安装引导已完成（幂等）。
func (r *SQLiteRepository) MarkSetupInitialized(ctx context.Context, completedBy, version string) error {
	if version == "" {
		version = "unknown"
	}
	_, err := r.db.ExecContext(ctx,
		`INSERT INTO setup_state (id, initialized, initialized_at, completed_by, version)
		 VALUES (1, 1, CURRENT_TIMESTAMP, ?, ?)
		 ON CONFLICT(id) DO UPDATE SET
		   initialized   = 1,
		   initialized_at = CURRENT_TIMESTAMP,
		   completed_by  = excluded.completed_by,
		   version       = excluded.version`,
		completedBy, version,
	)
	if err != nil {
		return fmt.Errorf("标记安装状态失败: %w", err)
	}
	return nil
}

// GetSetting 读取单个应用设置（不存在返回空串）。
func (r *SQLiteRepository) GetSetting(ctx context.Context, key string) (string, error) {
	var v string
	err := r.db.QueryRowContext(ctx, `SELECT value FROM app_settings WHERE key = ?`, key).Scan(&v)
	if err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return "", nil
		}
		return "", err
	}
	return v, nil
}

// SetSetting 写入（覆盖）单个应用设置。
func (r *SQLiteRepository) SetSetting(ctx context.Context, key, value string) error {
	_, err := r.db.ExecContext(ctx,
		`INSERT INTO app_settings (key, value, updated_at)
		 VALUES (?, ?, CURRENT_TIMESTAMP)
		 ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = CURRENT_TIMESTAMP`,
		key, value,
	)
	if err != nil {
		return fmt.Errorf("写入设置失败 (key=%s): %w", key, err)
	}
	return nil
}

// AllSettings 读取全部应用设置。
func (r *SQLiteRepository) AllSettings(ctx context.Context) (map[string]string, error) {
	rows, err := r.db.QueryContext(ctx, `SELECT key, value FROM app_settings`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	out := map[string]string{}
	for rows.Next() {
		var k, v string
		if err := rows.Scan(&k, &v); err != nil {
			return nil, err
		}
		out[k] = v
	}
	return out, rows.Err()
}

// CountUsers 返回用户总数（用于判断是否「首次安装」）。
func (r *SQLiteRepository) CountUsers(ctx context.Context) (int, error) {
	var n int
	if err := r.db.QueryRowContext(ctx, `SELECT COUNT(*) FROM users`).Scan(&n); err != nil {
		return 0, err
	}
	return n, nil
}
