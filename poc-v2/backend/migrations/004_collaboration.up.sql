-- 004_collaboration.up.sql — M13 多人协同 + 冲突解决
--
-- 注意：本文件为文档来源，与 initSchema() (internal/repository/repository.go) 同步。
-- 运行时不会自动应用 —— M6 引入真 migration runner (e.g. golang-migrate)。
-- 添加/修改表请两边同步。
--
-- 表清单：
--   presence       DB 持久化的在线状态（之前是内存 map）；按 scope 维度
--                  scope = "package:<id>" | "view:<id>" | "model:<id>"（兼容旧）
--                  TTL 30s（last_seen < now-30s 视为离线）
--   edit_locks     advisory lock with TTL（owner + expires_at + base_version）
--                  scope PRIMARY KEY；过期自动失效
--   comments       DB 持久化的评论（之前是内存 map）；scope 通用化

CREATE TABLE IF NOT EXISTS presence (
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
);
CREATE INDEX IF NOT EXISTS idx_presence_scope_seen ON presence(scope, last_seen);

CREATE TABLE IF NOT EXISTS edit_locks (
    scope         TEXT PRIMARY KEY,
    owner_id      TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    username      TEXT NOT NULL,
    acquired_at   TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    expires_at    TIMESTAMP NOT NULL,
    base_version  INTEGER NOT NULL DEFAULT 1
);
CREATE INDEX IF NOT EXISTS idx_edit_locks_expires ON edit_locks(expires_at);

CREATE TABLE IF NOT EXISTS comments (
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
);
CREATE INDEX IF NOT EXISTS idx_comments_scope ON comments(scope, created_at DESC);
