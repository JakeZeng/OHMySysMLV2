-- 005_viewpoints.down.sql
DROP INDEX IF EXISTS idx_viewpoints_updated;
DROP INDEX IF EXISTS idx_viewpoints_package;
DROP INDEX IF EXISTS idx_viewpoints_project;
DROP INDEX IF EXISTS uq_viewpoints_scope_name;
DROP TABLE IF EXISTS viewpoints;