-- 002_team_space.down.sql — 回滚 M4 W1-W3 表
-- 注意：down 不真正运行；仅供文档。

ALTER TABLE projects DROP COLUMN visibility;

DROP TABLE IF EXISTS share_links;
DROP TABLE IF EXISTS project_shares;
DROP TABLE IF EXISTS team_project_access;
DROP TABLE IF EXISTS team_members;
DROP TABLE IF EXISTS teams;