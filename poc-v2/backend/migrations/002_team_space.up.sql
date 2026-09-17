-- 002_team_space.up.sql — M4 团队空间 + 模型分享
--
-- 注意：本文件为文档来源，与 initSchema() (internal/repository/repository.go) 同步。
-- 运行时不会自动应用 —— M6 引入真 migration runner (e.g. golang-migrate)。
-- 添加/修改表请两边同步。
--
-- 表清单：
--   teams               团队本身
--   team_members        成员关系 + 角色
--   team_project_access 团队对项目的权限
--   project_shares      直接分享给用户
--   share_links         链接分享（存 token_hash 不存明文）

-- projects.visibility 列新增（M4 W1）
ALTER TABLE projects ADD COLUMN visibility TEXT NOT NULL DEFAULT 'private'
  CHECK(visibility IN ('private', 'team', 'public'));
-- private: 仅 owner + 显式分享者可访问
-- team:    owner + 任何团队成员 + 显式分享者可访问
-- public:  持有有效 share_link token 即可读

CREATE TABLE teams (
    id          TEXT PRIMARY KEY,
    name        TEXT NOT NULL UNIQUE,
    description TEXT NOT NULL DEFAULT '',
    created_at  TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at  TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX idx_teams_name ON teams(name);

CREATE TABLE team_members (
    team_id   TEXT NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
    user_id   TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    role      TEXT NOT NULL DEFAULT 'member' CHECK(role IN ('owner', 'admin', 'member')),
    joined_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (team_id, user_id)
);
CREATE INDEX idx_team_members_user ON team_members(user_id);

CREATE TABLE team_project_access (
    team_id     TEXT NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
    project_id  TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    permission  TEXT NOT NULL CHECK(permission IN ('read', 'write', 'admin')),
    granted_at  TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    granted_by  TEXT NOT NULL REFERENCES users(id),
    PRIMARY KEY (team_id, project_id)
);
CREATE INDEX idx_team_project_access_project ON team_project_access(project_id);

CREATE TABLE project_shares (
    project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    permission TEXT NOT NULL CHECK(permission IN ('read', 'write', 'admin')),
    granted_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    granted_by TEXT NOT NULL REFERENCES users(id),
    PRIMARY KEY (project_id, user_id)
);
CREATE INDEX idx_project_shares_user ON project_shares(user_id);

CREATE TABLE share_links (
    id         TEXT PRIMARY KEY,
    project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    token_hash TEXT NOT NULL UNIQUE,
    permission TEXT NOT NULL CHECK(permission IN ('read', 'write')),
    created_by TEXT NOT NULL REFERENCES users(id),
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    expires_at TIMESTAMP,
    revoked_at TIMESTAMP
);
CREATE INDEX idx_share_links_project ON share_links(project_id);