-- 006_view_extensions.down.sql
DROP INDEX IF EXISTS idx_views_render_kind;
DROP INDEX IF EXISTS idx_views_viewpoint;
-- SQLite 不支持 DROP COLUMN；只能整表重建。降级需手工处理。