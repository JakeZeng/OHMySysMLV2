-- 005_viewpoints.up.sql — M15 SysML v2 §7.26 Viewpoint（一等 SysML v2 实体）
--
-- 与 initSchema() (internal/repository/repository.go) 同步。
-- 运行时不会自动应用 —— 修改请两边同步。
--
-- 表：viewpoints
--   - SysML v2 ViewpointDefinition / ViewpointUsage 统一存储（M15 简化：用 kind 字段区分）
--   - stakeholder / concern 是 UI hint（spec 允许 viewpoint 包含这些元数据）
--   - package_id 允许 NULL（顶层视角 = project 下）
--   - UNIQUE(project_id, COALESCE(package_id, ''), name) — 同一作用域内同名约束

CREATE TABLE viewpoints (
    id              TEXT PRIMARY KEY,
    project_id      TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    package_id      TEXT REFERENCES packages(id) ON DELETE SET NULL,
    name            TEXT NOT NULL,
    description     TEXT NOT NULL DEFAULT '',
    content         TEXT NOT NULL DEFAULT '',
    stakeholder     TEXT NOT NULL DEFAULT '',
    concern         TEXT NOT NULL DEFAULT '',
    metadata_json   TEXT NOT NULL DEFAULT '{}',
    version         INTEGER NOT NULL DEFAULT 1,
    created_at      TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at      TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX uq_viewpoints_scope_name
    ON viewpoints(project_id, COALESCE(package_id, ''), name);
CREATE INDEX idx_viewpoints_project ON viewpoints(project_id);
CREATE INDEX idx_viewpoints_package ON viewpoints(package_id);
CREATE INDEX idx_viewpoints_updated ON viewpoints(updated_at DESC);