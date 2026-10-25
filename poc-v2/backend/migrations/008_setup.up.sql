-- M18：首次安装引导（setup wizard）状态 + 应用设置存储。
-- 与 internal/repository/repository.go initSchema() 中的 DDL 保持一致。

CREATE TABLE IF NOT EXISTS app_settings (
    key        TEXT PRIMARY KEY,
    value      TEXT NOT NULL DEFAULT '',
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS setup_state (
    id             INTEGER PRIMARY KEY CHECK (id = 1),
    initialized    INTEGER NOT NULL DEFAULT 0,
    initialized_at TIMESTAMP,
    completed_by   TEXT NOT NULL DEFAULT '',
    version        TEXT NOT NULL DEFAULT ''
);

INSERT OR IGNORE INTO setup_state (id, initialized, completed_by, version)
VALUES (1, 0, '', '');
