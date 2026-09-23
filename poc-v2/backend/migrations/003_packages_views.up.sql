-- 003_packages_views.up.sql — M12 一等 SysML v2 实体（Package + View）
--
-- 注意：本文件为文档来源，与 initSchema() (internal/repository/repository.go) 同步。
-- 运行时不会自动应用 —— M6 引入真 migration runner (e.g. golang-migrate)。
-- 添加/修改表请两边同步。
--
-- 表清单：
--   packages       SysML v2 Package（一等实体，可嵌套，含 SysML 文本）
--   views          SysML v2 ViewDefinition（一等实体；exposedElements 是解析缓存）
--
-- 关键约束：
--   - parent_package_id / package_id 允许 NULL（顶级包/顶层视图）
--   - 唯一性靠 COALESCE(parent_package_id, '') / COALESCE(package_id, '') 实现
--     （SQLite UNIQUE 把 NULL 视为不同；COALESCE 把 NULL 映射为空串以便参与唯一比较）
--   - parent_package_id 自引用 ON DELETE CASCADE — 删父包子包随之删除
--   - package_id ON DELETE SET NULL                — 删包时其下视图变为顶层视图（不级联删）

CREATE TABLE packages (
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
CREATE UNIQUE INDEX uq_packages_scope_name
    ON packages(project_id, COALESCE(parent_package_id, ''), name);
CREATE INDEX idx_packages_project ON packages(project_id);
CREATE INDEX idx_packages_parent ON packages(parent_package_id);
CREATE INDEX idx_packages_updated ON packages(updated_at DESC);

CREATE TABLE views (
    id                  TEXT PRIMARY KEY,
    project_id          TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    package_id          TEXT REFERENCES packages(id) ON DELETE SET NULL,
    name                TEXT NOT NULL,
    description         TEXT NOT NULL DEFAULT '',
    content             TEXT NOT NULL DEFAULT '',
    color_tag           TEXT NOT NULL DEFAULT '',
    rendering_category  TEXT NOT NULL DEFAULT '',
    exposed_elements    TEXT NOT NULL DEFAULT '[]',
    metadata_json       TEXT NOT NULL DEFAULT '{}',
    version             INTEGER NOT NULL DEFAULT 1,
    created_at          TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at          TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX uq_views_scope_name
    ON views(project_id, COALESCE(package_id, ''), name);
CREATE INDEX idx_views_project ON views(project_id);
CREATE INDEX idx_views_package ON views(package_id);
CREATE INDEX idx_views_updated ON views(updated_at DESC);

