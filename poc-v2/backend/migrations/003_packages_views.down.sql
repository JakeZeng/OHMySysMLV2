-- 003_packages_views.down.sql — M12 一等 SysML v2 实体（Package + View）
DROP INDEX IF EXISTS idx_views_updated;
DROP INDEX IF EXISTS idx_views_package;
DROP INDEX IF EXISTS idx_views_project;
DROP TABLE IF EXISTS views;

DROP INDEX IF EXISTS idx_packages_updated;
DROP INDEX IF EXISTS idx_packages_parent;
DROP INDEX IF EXISTS idx_packages_project;
DROP TABLE IF EXISTS packages;
