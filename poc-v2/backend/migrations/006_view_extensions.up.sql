-- 006_view_extensions.up.sql — M15 把现有 views 升级为 ViewDefinition（一等 SysML v2 实体）
--
-- 与 initSchema() (internal/repository/repository.go) 同步。
-- 运行时不会自动应用 —— 修改请两边同步。
--
-- 字段语义：
--   - viewpoint_id  — 关联 viewpoint.id（nullable，外键 SET NULL）
--   - viewpoint_qualified_name — 解析自 `satisfy X;`（body 内子句）或 legacy `view ... satisfies X;`
--   - render_kind — 由 `render <RenderingRef>;` 的引用名推导，默认 'interconnection'
--   - filter_qualified_names — JSON 数组，解析自 `filter @X;` 子句列表
--   - inner_elements — JSON 数组，view body 内 owned 的元素（part def X 等），含 kind/location
--   - exposed_elements_unresolved — JSON 数组，expose 路径无法 resolve 的元素（path + reason）
--
-- 旧字段含义保持：
--   - exposed_elements  → resolved 元素（路径真实存在于项目包树内）
--   - color_tag → UI hint（保留用于树徽章）
--   - rendering_category → deprecated，仍写入保持向后兼容

ALTER TABLE views ADD COLUMN viewpoint_id TEXT REFERENCES viewpoints(id) ON DELETE SET NULL;
ALTER TABLE views ADD COLUMN viewpoint_qualified_name TEXT NOT NULL DEFAULT '';
ALTER TABLE views ADD COLUMN render_kind TEXT NOT NULL DEFAULT 'interconnection';
ALTER TABLE views ADD COLUMN filter_qualified_names TEXT NOT NULL DEFAULT '[]';
ALTER TABLE views ADD COLUMN inner_elements TEXT NOT NULL DEFAULT '[]';
ALTER TABLE views ADD COLUMN exposed_elements_unresolved TEXT NOT NULL DEFAULT '[]';

CREATE INDEX IF NOT EXISTS idx_views_viewpoint ON views(viewpoint_id);
CREATE INDEX IF NOT EXISTS idx_views_render_kind ON views(render_kind);