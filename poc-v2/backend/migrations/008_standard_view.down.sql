-- 008_standard_view.down.sql — 回滚 M19 的标准视图类型列
--
-- 保留索引的显式删除：SQLite 的 ALTER TABLE DROP COLUMN 不支持带索引的列，
-- 索引会残留成孤儿。

ALTER TABLE views DROP COLUMN rendering_ref;
ALTER TABLE views DROP COLUMN specializes_ref;
ALTER TABLE views DROP COLUMN rendering_kind;
ALTER TABLE views DROP COLUMN standard_view;

DROP INDEX IF EXISTS idx_views_standard_view;