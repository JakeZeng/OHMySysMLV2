# SysMLv2 MBSE 系统数据库设计

> **技术栈**: PostgreSQL 16 + MongoDB 7 + Redis 7 + MinIO
> **文档版本**: 1.0
> **更新日期**: 2026-09-12

---

## 目录

1. [PostgreSQL 表设计](#1-postgresql-表设计)
2. [MongoDB 集合设计](#2-mongodb-集合设计)
3. [Redis 缓存策略](#3-redis-缓存策略)
4. [索引设计](#4-索引设计)
5. [表关系说明](#5-表关系说明)

---

## 1. PostgreSQL 表设计

### 1.1 用户表 (users)

```sql
CREATE TABLE users (
    id              UUID            PRIMARY KEY DEFAULT gen_random_uuid(),
    username        VARCHAR(50)     NOT NULL UNIQUE,
    email           VARCHAR(255)    NOT NULL UNIQUE,
    password_hash   VARCHAR(255)    NOT NULL,
    full_name       VARCHAR(100),
    avatar_url      TEXT,
    status          VARCHAR(20)     NOT NULL DEFAULT 'active' 
                                CHECK (status IN ('active', 'inactive', 'suspended')),
    email_verified  BOOLEAN         NOT NULL DEFAULT false,
    last_login_at   TIMESTAMPTZ,
    created_at      TIMESTAMPTZ     NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ     NOT NULL DEFAULT NOW(),
    deleted_at      TIMESTAMPTZ
);

CREATE INDEX idx_users_email ON users(email);
CREATE INDEX idx_users_status ON users(status);
```

**说明**:
- `id`: 使用 UUID 作为主键，便于分布式环境
- `status`: 用户账户状态，支持禁用和封禁
- `deleted_at`: 软删除标记，支持数据恢复

---

### 1.2 团队表 (teams)

```sql
CREATE TABLE teams (
    id              UUID            PRIMARY KEY DEFAULT gen_random_uuid(),
    name            VARCHAR(100)    NOT NULL,
    description     TEXT,
    avatar_url      TEXT,
    owner_id        UUID            NOT NULL REFERENCES users(id),
    visibility      VARCHAR(20)     NOT NULL DEFAULT 'private'
                                CHECK (visibility IN ('public', 'private', 'internal')),
    created_at      TIMESTAMPTZ     NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ     NOT NULL DEFAULT NOW(),
    deleted_at      TIMESTAMPTZ,
    UNIQUE(name, owner_id)
);

CREATE INDEX idx_teams_owner ON teams(owner_id);
CREATE INDEX idx_teams_visibility ON teams(visibility);
```

**团队成员关联表 (team_members)**

```sql
CREATE TABLE team_members (
    id              UUID            PRIMARY KEY DEFAULT gen_random_uuid(),
    team_id         UUID            NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
    user_id         UUID            NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    role            VARCHAR(30)     NOT NULL DEFAULT 'member'
                                CHECK (role IN ('owner', 'admin', 'member', 'guest')),
    invited_by      UUID            REFERENCES users(id),
    joined_at       TIMESTAMPTZ     NOT NULL DEFAULT NOW(),
    UNIQUE(team_id, user_id)
);

CREATE INDEX idx_team_members_team ON team_members(team_id);
CREATE INDEX idx_team_members_user ON team_members(user_id);
CREATE INDEX idx_team_members_role ON team_members(role);
```

**说明**:
- `owner_id`: 团队创建者，同时也是成员
- `role`: 角色层级 `owner > admin > member > guest`

---

### 1.3 项目表 (projects)

```sql
CREATE TABLE projects (
    id              UUID            PRIMARY KEY DEFAULT gen_random_uuid(),
    name            VARCHAR(100)    NOT NULL,
    description     TEXT,
    team_id         UUID            REFERENCES teams(id) ON DELETE SET NULL,
    owner_id        UUID            NOT NULL REFERENCES users(id),
    visibility      VARCHAR(20)     NOT NULL DEFAULT 'team'
                                CHECK (visibility IN ('public', 'private', 'team')),
    settings        JSONB           NOT NULL DEFAULT '{}',
    metadata        JSONB           NOT NULL DEFAULT '{}',
    created_at      TIMESTAMPTZ     NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ     NOT NULL DEFAULT NOW(),
    archived_at     TIMESTAMPTZ,
    deleted_at      TIMESTAMPTZ
);

CREATE INDEX idx_projects_team ON projects(team_id);
CREATE INDEX idx_projects_owner ON projects(owner_id);
CREATE INDEX idx_projects_visibility ON projects(visibility);
CREATE INDEX idx_projects_team_visibility ON projects(team_id, visibility);
```

**说明**:
- `settings`: 项目级配置（通知、默认视图等）
- `metadata`: 扩展元数据（SysML 版本、域等）

---

### 1.4 权限表 (permissions)

```sql
CREATE TABLE permissions (
    id              UUID            PRIMARY KEY DEFAULT gen_random_uuid(),
    resource_type   VARCHAR(50)     NOT NULL,
    resource_id     UUID            NOT NULL,
    subject_type    VARCHAR(20)     NOT NULL 
                                CHECK (subject_type IN ('user', 'team')),
    subject_id      UUID            NOT NULL,
    action          VARCHAR(30)     NOT NULL,
    conditions      JSONB,
    granted_by      UUID            REFERENCES users(id),
    created_at      TIMESTAMPTZ     NOT NULL DEFAULT NOW(),
    
    CONSTRAINT unique_permission UNIQUE(resource_type, resource_id, subject_type, subject_id, action)
);

CREATE INDEX idx_permissions_resource ON permissions(resource_type, resource_id);
CREATE INDEX idx_permissions_subject ON permissions(subject_type, subject_id);
CREATE INDEX idx_permissions_action ON permissions(action);

-- 权限动作枚举
COMMENT ON TABLE permissions IS '通用权限表，支持细粒度访问控制';
```

**权限矩阵参考**:

| 资源类型   | 动作           | 说明             |
| -------- | -------------- | ---------------- |
| project  | create         | 创建项目          |
| project  | read           | 查看项目          |
| project  | update         | 修改项目          |
| project  | delete         | 删除项目          |
| project  | manage_members | 管理项目成员       |
| model    | create         | 创建模型          |
| model    | read           | 查看模型          |
| model    | write          | 编辑模型          |
| model    | commit         | 提交模型版本       |
| model    | delete         | 删除模型          |
| model    | share          | 共享模型          |

---

### 1.5 模型版本表 (model_versions)

```sql
CREATE TABLE model_versions (
    id              UUID            PRIMARY KEY DEFAULT gen_random_uuid(),
    model_id        UUID            NOT NULL,  -- MongoDB ObjectId 存储为字符串
    version_number  INTEGER         NOT NULL,
    version_name    VARCHAR(100),
    message         TEXT,
    content_hash    VARCHAR(64)     NOT NULL,
    file_size       BIGINT,
    storage_path    TEXT,           -- MinIO 对象路径
    created_by      UUID            NOT NULL REFERENCES users(id),
    created_at      TIMESTAMPTZ     NOT NULL DEFAULT NOW(),
    parent_version_id UUID          REFERENCES model_versions(id),
    tags            TEXT[],
    UNIQUE(model_id, version_number)
);

CREATE INDEX idx_model_versions_model ON model_versions(model_id);
CREATE INDEX idx_model_versions_created_by ON model_versions(created_by);
CREATE INDEX idx_model_versions_created_at ON model_versions(created_at DESC);
CREATE INDEX idx_model_versions_hash ON model_versions(content_hash);
```

**说明**:
- `content_hash`: SHA-256 哈希，用于去重和变更检测
- `storage_path`: MinIO 中的实际存储路径
- `parent_version_id`: 支持分支和合并场景

---

### 1.6 模板表 (templates)

```sql
CREATE TABLE templates (
    id              UUID            PRIMARY KEY DEFAULT gen_random_uuid(),
    name            VARCHAR(100)    NOT NULL,
    description     TEXT,
    category        VARCHAR(50)     NOT NULL,
    template_type  VARCHAR(30)     NOT NULL
                                CHECK (template_type IN ('model', 'diagram', 'block', 'package')),
    content         JSONB           NOT NULL,
    thumbnail_url   TEXT,
    is_public       BOOLEAN         NOT NULL DEFAULT false,
    created_by      UUID            NOT NULL REFERENCES users(id),
    usage_count     INTEGER         NOT NULL DEFAULT 0,
    tags            TEXT[],
    created_at      TIMESTAMPTZ     NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ     NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_templates_category ON templates(category);
CREATE INDEX idx_templates_type ON templates(template_type);
CREATE INDEX idx_templates_public ON templates(is_public) WHERE is_public = true;
CREATE INDEX idx_templates_creator ON templates(created_by);
```

---

### 1.7 审计日志表 (audit_logs)

```sql
CREATE TABLE audit_logs (
    id              UUID            PRIMARY KEY DEFAULT gen_random_uuid(),
    actor_id        UUID            REFERENCES users(id),
    actor_ip        INET,
    actor_user_agent TEXT,
    action          VARCHAR(100)   NOT NULL,
    resource_type   VARCHAR(50)    NOT NULL,
    resource_id     UUID,
    details         JSONB           NOT NULL DEFAULT '{}',
    status          VARCHAR(20)     NOT NULL DEFAULT 'success'
                                CHECK (status IN ('success', 'failure', 'partial')),
    error_message   TEXT,
    created_at      TIMESTAMPTZ     NOT NULL DEFAULT NOW()
) PARTITION BY RANGE (created_at);

-- 按月分区
CREATE TABLE audit_logs_2026_09 PARTITION OF audit_logs
    FOR VALUES FROM ('2026-09-01') TO ('2026-10-01');
CREATE TABLE audit_logs_2026_10 PARTITION OF audit_logs
    FOR VALUES FROM ('2026-10-01') TO ('2026-11-01');
-- ... 更多分区

CREATE INDEX idx_audit_logs_actor ON audit_logs(actor_id);
CREATE INDEX idx_audit_logs_resource ON audit_logs(resource_type, resource_id);
CREATE INDEX idx_audit_logs_action ON audit_logs(action);
CREATE INDEX idx_audit_logs_created ON audit_logs(created_at DESC);
```

**审计事件参考**:

| 动作                    | 说明              |
| ---------------------- | ---------------- |
| user.login             | 用户登录          |
| user.logout            | 用户登出          |
| user.register          | 用户注册          |
| project.create         | 创建项目          |
| project.update         | 更新项目          |
| project.delete         | 删除项目          |
| model.create           | 创建模型          |
| model.commit           | 提交模型版本       |
| model.share            | 共享模型          |
| permission.grant       | 授予权限          |
| permission.revoke      | 撤销权限          |

---

## 2. MongoDB 集合设计

### 2.1 models 集合（模型文档）

```javascript
{
    "_id": ObjectId,
    "name": String,               // 模型名称
    "project_id": UUID,           // 关联项目
    "owner_id": UUID,             // 创建者
    "current_version": Number,    // 当前版本号
    
    // SysML v2 结构
    "structure": {
        "packages": [{
            "id": String,
            "name": String,
            "ownedElements": Array,
            "metadata": Object
        }],
        "imports": Array,
        "catalogs": Object
    },
    
    // 元数据
    "metadata": {
        "sysml_version": String,  // "2.0"
        "domain": String,         // "systems", "software", etc.
        "author": String,
        "description": String,
        "keywords": [String]
    },
    
    // 协作设置
    "collaboration": {
        "enabled": Boolean,
        "conflict_resolution": String,  // "last-write-wins", "manual"
        "auto_save_interval": Number   // 秒
    },
    
    // 状态
    "status": String,             // "draft", "review", "approved", "archived"
    "visibility": String,         // "private", "team", "public"
    
    // 时间戳
    "created_at": ISODate,
    "updated_at": ISODate,
    "last_accessed_at": ISODate
}
```

**索引**:
```javascript
db.models.createIndex({ "project_id": 1 })
db.models.createIndex({ "owner_id": 1 })
db.models.createIndex({ "status": 1 })
db.models.createIndex({ "metadata.domain": 1 })
db.models.createIndex({ "name": "text", "metadata.description": "text" })
```

---

### 2.2 model_revisions 集合（版本历史）

```javascript
{
    "_id": ObjectId,
    "model_id": ObjectId,         // 关联模型
    "version_number": Number,
    "version_name": String,
    "message": String,            // 提交信息
    
    // 变更内容（差异存储）
    "changes": {
        "added": Array,           // 新增元素
        "modified": Array,       // 修改元素
        "deleted": Array         // 删除元素 ID
    },
    
    // 完整快照（关键版本）
    "snapshot": {
        "structure": Object,     // 完整模型结构
        "checksum": String       // SHA-256
    },
    
    // 变更统计
    "stats": {
        "elements_added": Number,
        "elements_removed": Number,
        "elements_modified": Number
    },
    
    // 创建者信息
    "created_by": {
        "user_id": UUID,
        "username": String
    },
    
    "created_at": ISODate,
    "parent_version": ObjectId   // 父版本
}
```

**索引**:
```javascript
db.model_revisions.createIndex({ "model_id": 1, "version_number": -1 })
db.model_revisions.createIndex({ "created_by.user_id": 1 })
db.model_revisions.createIndex({ "created_at": -1 })
```

---

### 2.3 collaborative_edits 集合（协作编辑）

```javascript
{
    "_id": ObjectId,
    "model_id": ObjectId,
    "session_id": String,        // 编辑会话 ID
    
    // 参与者
    "participants": [{
        "user_id": UUID,
        "username": String,
        "status": String,        // "active", "idle", "offline"
        "cursor": {              // 光标位置
            "element_id": String,
            "offset": Number
        },
        "joined_at": ISODate,
        "last_activity_at": ISODate
    }],
    
    // 操作日志
    "operations": [{
        "user_id": UUID,
        "operation_type": String,    // "insert", "update", "delete"
        "target_path": String,      // JSON Pointer
        "old_value": Mixed,
        "new_value": Mixed,
        "timestamp": ISODate,
        "vector_clock": Object       // 冲突检测
    }],
    
    // 锁信息
    "locks": [{
        "element_id": String,
        "locked_by": UUID,
        "locked_at": ISODate,
        "expires_at": ISODate
    }],
    
    // 会话状态
    "status": String,             // "active", "paused", "closed"
    "created_at": ISODate,
    "closed_at": ISODate,
    "ttl_index": ISODate          // TTL 索引，7天后自动删除
}
```

**索引**:
```javascript
db.collaborative_edits.createIndex({ "model_id": 1, "status": 1 })
db.collaborative_edits.createIndex({ "session_id": 1 }, { unique: true })
db.collaborative_edits.createIndex({ "participants.user_id": 1 })
db.collaborative_edits.createIndex({ "ttl_index": 1 }, { expireAfterSeconds: 604800 }) // 7天
```

---

### 2.4 ai_conversations 集合（AI 对话历史）

```javascript
{
    "_id": ObjectId,
    "user_id": UUID,
    "model_id": ObjectId,
    "project_id": UUID,
    
    // 对话元数据
    "metadata": {
        "model_name": String,    // 使用的 AI 模型
        "system_prompt": String,
        "temperature": Number,
        "max_tokens": Number
    },
    
    // 对话消息
    "messages": [{
        "role": String,          // "system", "user", "assistant"
        "content": String,
        "attachments": [{
            "type": String,      // "model_element", "diagram", "file"
            "id": String,
            "name": String
        }],
        "usage": {
            "input_tokens": Number,
            "output_tokens": Number
        },
        "created_at": ISODate
    }],
    
    // 上下文引用
    "context_refs": [{
        "type": String,          // "package", "block", "requirement"
        "element_id": String,
        "description": String
    }],
    
    // 统计
    "stats": {
        "total_tokens": Number,
        "turns": Number,
        "cost_estimate": Number
    },
    
    "status": String,            // "active", "archived"
    "created_at": ISODate,
    "updated_at": ISODate
}
```

**索引**:
```javascript
db.ai_conversations.createIndex({ "user_id": 1, "created_at": -1 })
db.ai_conversations.createIndex({ "model_id": 1 })
db.ai_conversations.createIndex({ "project_id": 1 })
```

---

## 3. Redis 缓存策略

### 3.1 Session 存储

```
Key Pattern: session:{session_id}
Type: Hash
TTL: 7 days (604800 seconds)

Fields:
- user_id: 用户 UUID
- username: 用户名
- email: 邮箱
- team_ids: JSON 数组，所属团队
- permissions: 权限列表
- ip: 登录 IP
- user_agent: 浏览器标识
- created_at: 创建时间
- last_activity: 最后活跃时间
```

**操作示例**:
```python
# 创建 Session
SET session:{session_id} {hash_data} EX 604800

# 验证 Session
EXISTS session:{session_id}
HGET session:{session_id} user_id

# 刷新过期时间
EXPIRE session:{session_id} 604800

# 销毁 Session
DEL session:{session_id}
```

---

### 3.2 热点模型缓存

```
Key Pattern: model:cache:{model_id}
Type: String (JSON)
TTL: 1 hour (3600 seconds)
Max Size: 10MB

Purpose: 缓存高频访问的模型数据
Eviction: LRU + TTL
```

```
Key Pattern: model:version:latest:{model_id}
Type: String
TTL: 5 minutes (300 seconds)

Purpose: 缓存最新版本号
```

```
Key Pattern: model:access:count:{model_id}
Type: String (Counter)
TTL: 1 hour

Purpose: 模型访问计数，用于热点检测
INCR model:access:count:{model_id}
```

**缓存预热策略**:
1. 启动时加载最近 7 天活跃项目的模型
2. 访问计数 > 100 的模型常驻缓存
3. 批量操作后主动更新缓存

---

### 3.3 限流计数器

```
Key Pattern: ratelimit:{user_id}:{action}:{window}
Type: String (Counter)
TTL: 滑动窗口时间

滑动窗口算法:
- 使用 Redis Sorted Set 实现精确滑动窗口
- ZREMRANGEBYSCORE 移除过期记录
- ZCARD 统计窗口内请求数
- ZADD 记录当前请求
```

**限流规则**:

| 端点                    | 限制            | 窗口   |
| ---------------------- | --------------- | ------ |
| API 通用               | 1000 请求       | 1 小时  |
| 模型创建                | 10 个           | 1 小时  |
| 模型提交                | 30 个           | 1 小时  |
| 文件上传                | 100 MB          | 1 小时  |
| AI 对话                 | 50 次           | 1 小时  |
| 登录                    | 10 次           | 15 分钟 |

**实现示例**:
```python
def check_rate_limit(user_id, action, limit, window_seconds):
    key = f"ratelimit:{user_id}:{action}"
    now = time.time()
    window_start = now - window_seconds
    
    pipe = redis.pipeline()
    pipe.zremrangebyscore(key, 0, window_start)
    pipe.zcard(key)
    pipe.execute()
    
    count = redis.get(key)
    if count >= limit:
        ttl = redis.ttl(key)
        return False, ttl
    else:
        pipe = redis.pipeline()
        pipe.zadd(key, {str(now): now})
        pipe.expire(key, window_seconds)
        pipe.execute()
        return True, 0
```

---

### 3.4 消息队列

使用 Redis Stream 实现消息队列，支持发布/订阅模式。

```
Stream Key: mq:{queue_name}
Consumer Group: cg:{queue_name}:{consumer_id}
```

**队列设计**:

| 队列名称            | 用途                    | 消费者         |
| ----------------- | ---------------------- | ------------- |
| model_events      | 模型变更事件              | 通知服务、搜索引擎 |
| notification      | 用户通知                 | 通知服务       |
| email_queue       | 邮件发送                 | 邮件服务       |
| webhook_events    | Webhook 触发            | Webhook 服务  |
| ai_tasks          | AI 任务处理              | AI 服务       |

**消息格式**:
```json
{
    "id": "1694500000000-0",
    "type": "model.updated",
    "payload": {
        "model_id": "uuid",
        "version": 5,
        "updated_by": "uuid"
    },
    "metadata": {
        "timestamp": "2026-09-12T15:00:00Z",
        "retry_count": 0
    }
}
```

**操作示例**:
```python
# 生产者
redis.xadd("mq:model_events", {"type": "model.updated", "data": json.dumps(payload)})

# 消费者
redis.xreadgroup(
    "cg:model_events:worker1",
    "consumer1",
    {"mq:model_events": ">"},
    count=10,
    block=5000
)
```

---

## 4. 索引设计

### 4.1 PostgreSQL 索引

| 表名            | 索引名称                  | 字段                          | 类型        | 用途                    |
| -------------- | ----------------------- | ---------------------------- | ----------- | --------------------- |
| users          | idx_users_email         | email                        | B-tree      | 邮箱登录查找            |
| users          | idx_users_status        | status                       | B-tree      | 状态过滤               |
| teams          | idx_teams_owner         | owner_id                     | B-tree      | 查找用户创建的团队       |
| teams          | idx_teams_visibility    | visibility                   | B-tree      | 可见性过滤             |
| team_members   | idx_team_members_team   | team_id                      | B-tree      | 团队成员查询            |
| team_members   | idx_team_members_user   | user_id                      | B-tree      | 用户参与的团队查询       |
| projects       | idx_projects_team       | team_id                      | B-tree      | 团队项目查询            |
| projects       | idx_projects_owner      | owner_id                     | B-tree      | 用户项目查询            |
| projects       | idx_projects_team_vis   | (team_id, visibility)        | B-tree      | 团队内项目可见性过滤     |
| permissions    | idx_permissions_resource| (resource_type, resource_id)  | B-tree      | 资源权限查询            |
| permissions    | idx_permissions_subject | (subject_type, subject_id)   | B-tree      | 用户/团队权限查询       |
| model_versions | idx_model_versions_model| model_id                     | B-tree      | 模型版本查询            |
| model_versions | idx_model_versions_hash | content_hash                 | B-tree      | 内容去重/变更检测       |
| audit_logs     | idx_audit_logs_actor    | actor_id                     | B-tree      | 用户操作历史            |
| audit_logs     | idx_audit_logs_created | created_at                   | B-tree      | 时间范围查询            |

**全文搜索索引**:
```sql
-- 项目全文搜索
CREATE INDEX idx_projects_search ON projects 
    USING GIN (to_tsvector('chinese', name || ' ' || COALESCE(description, '')));

-- 模板全文搜索
CREATE INDEX idx_templates_search ON templates 
    USING GIN (to_tsvector('chinese', name || ' ' || COALESCE(description, '')));
```

---

### 4.2 MongoDB 索引

| 集合                | 索引名称                   | 字段                    | 类型        | 用途                |
| ------------------ | ------------------------ | ---------------------- | ----------- | ----------------- |
| models             | idx_models_project       | project_id             | B-tree      | 项目模型查询         |
| models             | idx_models_owner         | owner_id               | B-tree      | 用户模型查询         |
| models             | idx_models_status        | status                 | B-tree      | 状态过滤            |
| models             | idx_models_text          | name, metadata.desc    | Text        | 全文搜索            |
| model_revisions    | idx_revisions_model_ver  | (model_id, version)    | B-tree      | 版本查询            |
| collaborative_edits | idx_edits_model          | model_id, status       | B-tree      | 编辑会话查询         |
| collaborative_edits| idx_edits_participant    | participants.user_id   | B-tree      | 用户参与会话查询      |
| collaborative_edits| idx_edits_ttl            | ttl_index              | TTL         | 自动过期清理         |
| ai_conversations   | idx_conv_user            | user_id, created_at    | B-tree      | 用户对话历史查询      |

---

### 4.3 Redis 索引结构

```
会话管理:
- session:{id}                    → Hash (Session 数据)
- session:user:{user_id}          → Set (用户的活跃会话)

热点模型:
- model:cache:{id}               → String (JSON)
- model:version:{id}             → String (最新版本)
- model:access:{id}              → String (访问计数)
- model:hot                      → Sorted Set (热点评分)

限流:
- ratelimit:{user}:{action}      → Sorted Set (滑动窗口)
- ratelimit:ip:{ip}:{action}     → Sorted Set (IP 限流)

消息队列:
- mq:{queue}                     → Stream
- mq:{queue}:pending             → Stream (待处理消息)

缓存标签:
- cache:tag:project:{id}         → Set (项目相关缓存键)
- cache:tag:model:{id}           → Set (模型相关缓存键)
```

---

## 5. 表关系说明

### 5.1 ER 关系图

```
┌─────────────┐       ┌─────────────┐       ┌─────────────┐
│   users     │       │   teams     │       │  projects   │
├─────────────┤       ├─────────────┤       ├─────────────┤
│ id (PK)     │──┐    │ id (PK)     │──┐    │ id (PK)     │
│ username    │  │    │ name        │  │    │ name        │
│ email       │  │    │ owner_id(FK)│──┼────│ owner_id(FK)│
│ ...         │  │    │ ...         │  │    │ team_id(FK) │←─┐
└─────────────┘  │    └─────────────┘  │    └─────────────┘  │
       │        │           │          │           │         │
       │        │           │          │           │         │
       │        │    ┌──────┴──────┐    │           │         │
       │        │    │team_members│    │           │         │
       ├────────┼────│ id (PK)    │────┘           │         │
       │        │    │ team_id(FK)│                │         │
       │        │    │ user_id(FK)│────────────────┘         │
       │        │    │ role       │                          │
       │        │    └────────────┘                          │
       │        │                                            │
       │        │    ┌─────────────────┐      ┌─────────────────┐
       │        │    │ permissions     │      │ model_versions  │
       │        └────│ id (PK)        │      ├─────────────────┤
       │             │ resource_type  │      │ id (PK)         │
       │             │ resource_id    │      │ model_id        │
       │             │ subject_type   │      │ version_number  │
       │             │ subject_id    ─┼──────│ created_by (FK) │
       │             │ action        │      │ ...             │
       │             └───────────────┘      └─────────────────┘
       │
       │        ┌─────────────┐       ┌─────────────────────┐
       │        │  templates  │       │    audit_logs       │
       ├────────│ id (PK)     │       ├─────────────────────┤
       │        │ name        │       │ id (PK)             │
       │        │ category    │       │ actor_id (FK)       │
       │        │ created_by  │───────│ action              │
       │        │ ...         │       │ resource_type       │
       └────────└─────────────┘       │ resource_id         │
                                      │ created_at         │
                                      └─────────────────────┘

MongoDB Collections:
┌─────────────────────┐     ┌─────────────────────┐
│       models        │     │   model_revisions   │
├─────────────────────┤     ├─────────────────────┤
│ _id (ObjectId)      │────▶│ _id (ObjectId)       │
│ name                │     │ model_id (FK)       │
│ project_id (UUID)   │     │ version_number       │
│ structure (JSON)    │     │ changes              │
│ ...                 │     │ snapshot             │
└─────────────────────┘     └─────────────────────┘
         │
         │
┌─────────────────────┐     ┌─────────────────────┐
│  collaborative_edits │     │  ai_conversations    │
├─────────────────────┤     ├─────────────────────┤
│ _id (ObjectId)      │     │ _id (ObjectId)       │
│ model_id (FK)       │     │ user_id (UUID)      │
│ session_id          │     │ model_id (FK)       │
│ participants        │     │ messages            │
│ operations          │     │ context_refs         │
└─────────────────────┘     └─────────────────────┘
```

---

### 5.2 关系说明

#### 用户与团队 (多对多)
- 一个用户可以属于多个团队
- 一个团队可以有多个成员
- 通过 `team_members` 关联表实现
- 成员角色: `owner > admin > member > guest`

#### 用户与项目 (多对多 + 所有者)
- 项目有明确所有者 (`owner_id`)
- 项目可分配给团队 (`team_id`)
- 通过 `permissions` 表实现细粒度权限控制

#### 团队与项目 (一对多)
- 一个团队可拥有多个项目
- 通过 `team_id` 外键关联

#### 项目与模型 (一对多)
- 一个项目可包含多个 SysML 模型
- 模型存储在 MongoDB `models` 集合
- 版本信息存储在 PostgreSQL `model_versions` 表

#### 模型与版本 (一对多)
- 每个模型有多个版本
- `model_versions` 表记录版本元数据
- 实际模型内容存储在 MinIO

#### 权限继承关系
```
项目权限 ──┬── 自动继承到项目内所有模型
           │
团队权限 ──┴── 继承给团队成员
```

---

### 5.3 数据流转

```
用户操作流程:
┌──────────┐    ┌──────────┐    ┌──────────┐    ┌──────────┐
│  客户端   │───▶│  API 网关 │───▶│ 业务服务  │───▶│  数据存储  │
└──────────┘    └──────────┘    └──────────┘    └──────────┘
                                     │
                                     ▼
                              ┌──────────┐
                              │  Redis   │
                              │ (缓存/队列)│
                              └──────────┘

模型保存流程:
1. 用户编辑 → WebSocket 实时同步
2. 自动保存 → MongoDB (collaborative_edits)
3. 手动提交 → PostgreSQL (model_versions) + MinIO (文件)
4. 事件通知 → Redis Stream (mq:model_events)
```

---

### 5.4 一致性策略

| 数据类型       | 存储位置        | 一致性策略              |
| ------------ | ------------- | --------------------- |
| 用户认证信息    | PostgreSQL    | 强一致                 |
| 项目元数据      | PostgreSQL    | 强一致                 |
| 模型内容        | MongoDB + MinIO | 最终一致（异步同步）      |
| 版本元数据      | PostgreSQL    | 强一致                 |
| 权限数据        | PostgreSQL    | 强一致 + 缓存失效        |
| 会话数据        | Redis         | 最终一致（TTL 自动过期）   |
| 协作操作        | MongoDB       | 最终一致（向量时钟冲突检测） |
| 审计日志        | PostgreSQL    | 异步写入（消息队列缓冲）    |

---

## 附录

### A. 版本兼容性说明

- PostgreSQL 16: 支持 JSONB、UUID、范围分区
- MongoDB 7: 支持变更流、事务、搜索索引
- Redis 7: 支持 Stream、多线程 IO
- MinIO: S3 兼容对象存储

### B. 容量估算参考

| 数据类型        | 单条大小     | 预估数量     | 总容量   |
| ------------- | ---------- | ---------- | ------ |
| 用户           | 1 KB       | 100,000    | 100 MB |
| 团队           | 2 KB       | 10,000     | 20 MB  |
| 项目           | 5 KB       | 50,000     | 250 MB |
| 模型           | 500 KB - 5 MB | 100,000  | 50 - 500 GB |
| 版本元数据       | 2 KB       | 1,000,000  | 2 GB   |
| 审计日志         | 1 KB       | 10,000,000 | 10 GB  |

### C. 备份策略

| 数据类型        | 备份方式        | 频率     | RPO     |
| ------------- | ------------- | ------- | ------- |
| PostgreSQL    | WAL + 全量备份  | 每小时 WAL, 每天全量 | 1 小时  |
| MongoDB       | 副本集 Oplog    | 实时复制  | 分钟级   |
| Redis         | RDB + AOF     | 5分钟增量 | 5 分钟  |
| MinIO         | 多站点复制       | 实时     | 实时    |
