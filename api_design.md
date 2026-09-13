# SysMLv2 MBSE 系统 API 接口设计文档

**版本**: 1.0.0  
**最后更新**: 2026-09-12  
**基础 URL**: `https://api.mbse-system.com/api/v1`

---

## 目录

1. [认证模块 (Auth)](#1-认证模块-auth)
2. [用户模块 (Users)](#2-用户模块-users)
3. [团队模块 (Teams)](#3-团队模块-teams)
4. [项目模块 (Projects)](#4-项目模块-projects)
5. [模型模块 (Models)](#5-模型模块-models)
6. [模板模块 (Templates)](#6-模板模块-templates)
7. [AI 模块 (AI)](#7-ai-模块-ai)
8. [WebSocket 实时协作协议](#8-websocket-实时协作协议)
9. [错误码规范](#9-错误码规范)
10. [认证与授权](#10-认证与授权)

---

## 1. 认证模块 (Auth)

### 1.1 注册

```
POST /api/v1/auth/register
```

**请求体**:

```json
{
  "username": "string",        // 用户名，3-32字符，字母数字下划线
  "email": "string",          // 邮箱，唯一
  "password": "string",       // 密码，最少8字符
  "full_name": "string"       // 真实姓名
}
```

**响应** (201 Created):

```json
{
  "code": 0,
  "message": "success",
  "data": {
    "user_id": "usr_abc123xyz",
    "username": "john_doe",
    "email": "john@example.com",
    "full_name": "John Doe",
    "created_at": "2026-09-12T15:00:00Z"
  }
}
```

---

### 1.2 登录

```
POST /api/v1/auth/login
```

**请求体**:

```json
{
  "email": "string",          // 邮箱或用户名
  "password": "string"
}
```

**响应** (200 OK):

```json
{
  "code": 0,
  "message": "success",
  "data": {
    "access_token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
    "refresh_token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
    "expires_in": 3600,
    "token_type": "Bearer",
    "user": {
      "user_id": "usr_abc123xyz",
      "username": "john_doe",
      "email": "john@example.com",
      "full_name": "John Doe",
      "avatar_url": "https://..."
    }
  }
}
```

---

### 1.3 刷新令牌

```
POST /api/v1/auth/refresh
```

**请求头**:
```
Authorization: Bearer <refresh_token>
```

**响应** (200 OK):

```json
{
  "code": 0,
  "message": "success",
  "data": {
    "access_token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
    "refresh_token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
    "expires_in": 3600,
    "token_type": "Bearer"
  }
}
```

---

### 1.4 登出

```
POST /api/v1/auth/logout
```

**请求头**:
```
Authorization: Bearer <access_token>
```

**响应** (200 OK):

```json
{
  "code": 0,
  "message": "success",
  "data": null
}
```

---

## 2. 用户模块 (Users)

### 2.1 获取当前用户

```
GET /api/v1/users/me
```

**请求头**:
```
Authorization: Bearer <access_token>
```

**响应** (200 OK):

```json
{
  "code": 0,
  "message": "success",
  "data": {
    "user_id": "usr_abc123xyz",
    "username": "john_doe",
    "email": "john@example.com",
    "full_name": "John Doe",
    "avatar_url": "https://cdn.example.com/avatars/usr_abc123xyz.jpg",
    "organization": "Acme Corp",
    "role": "engineer",
    "timezone": "Asia/Shanghai",
    "settings": {
      "theme": "light",
      "language": "zh-CN",
      "notifications_enabled": true
    },
    "created_at": "2026-01-15T08:00:00Z",
    "last_login_at": "2026-09-12T14:30:00Z"
  }
}
```

---

### 2.2 更新当前用户

```
PUT /api/v1/users/me
```

**请求头**:
```
Authorization: Bearer <access_token>
```

**请求体**:

```json
{
  "full_name": "string",
  "avatar_url": "string",
  "organization": "string",
  "role": "string",
  "timezone": "string",
  "settings": {
    "theme": "light|dark",
    "language": "en-US|zh-CN",
    "notifications_enabled": true
  }
}
```

**响应** (200 OK):

```json
{
  "code": 0,
  "message": "success",
  "data": {
    "user_id": "usr_abc123xyz",
    "username": "john_doe",
    "email": "john@example.com",
    "full_name": "John Doe Updated",
    "avatar_url": "https://cdn.example.com/avatars/usr_abc123xyz.jpg",
    "organization": "New Acme Corp",
    "role": "senior_engineer",
    "timezone": "Asia/Shanghai",
    "settings": {
      "theme": "dark",
      "language": "zh-CN",
      "notifications_enabled": true
    },
    "updated_at": "2026-09-12T15:05:00Z"
  }
}
```

---

### 2.3 获取用户详情

```
GET /api/v1/users/:id
```

**路径参数**:
- `id`: 用户 ID

**请求头**:
```
Authorization: Bearer <access_token>
```

**响应** (200 OK):

```json
{
  "code": 0,
  "message": "success",
  "data": {
    "user_id": "usr_abc123xyz",
    "username": "jane_smith",
    "full_name": "Jane Smith",
    "avatar_url": "https://cdn.example.com/avatars/usr_xyz789.jpg",
    "organization": "Tech Corp",
    "role": "lead_engineer",
    "timezone": "America/New_York",
    "bio": "Systems Engineering Expert",
    "is_online": true,
    "last_active_at": "2026-09-12T15:10:00Z"
  }
}
```

---

## 3. 团队模块 (Teams)

### 3.1 获取我的团队列表

```
GET /api/v1/teams
```

**查询参数**:
- `page` (int, optional): 页码，默认 1
- `page_size` (int, optional): 每页数量，默认 20，最大 100
- `search` (string, optional): 搜索关键词

**请求头**:
```
Authorization: Bearer <access_token>
```

**响应** (200 OK):

```json
{
  "code": 0,
  "message": "success",
  "data": {
    "teams": [
      {
        "team_id": "team_abc123",
        "name": "航空系统团队",
        "description": "负责航空系统建模与仿真",
        "avatar_url": "https://cdn.example.com/teams/team_abc123.jpg",
        "member_count": 12,
        "project_count": 5,
        "owner": {
          "user_id": "usr_abc123xyz",
          "username": "john_doe",
          "full_name": "John Doe",
          "avatar_url": "https://..."
        },
        "my_role": "owner",
        "created_at": "2026-01-01T00:00:00Z"
      }
    ],
    "pagination": {
      "page": 1,
      "page_size": 20,
      "total": 3,
      "total_pages": 1
    }
  }
}
```

---

### 3.2 创建团队

```
POST /api/v1/teams
```

**请求头**:
```
Authorization: Bearer <access_token>
```

**请求体**:

```json
{
  "name": "string",           // 团队名称，2-50字符
  "description": "string",   // 团队描述
  "avatar_url": "string"     // 可选，头像 URL
}
```

**响应** (201 Created):

```json
{
  "code": 0,
  "message": "success",
  "data": {
    "team_id": "team_xyz789",
    "name": "新系统团队",
    "description": "系统设计与建模",
    "avatar_url": null,
    "member_count": 1,
    "project_count": 0,
    "owner": {
      "user_id": "usr_abc123xyz",
      "username": "john_doe",
      "full_name": "John Doe"
    },
    "my_role": "owner",
    "created_at": "2026-09-12T15:00:00Z"
  }
}
```

---

### 3.3 获取团队详情

```
GET /api/v1/teams/:id
```

**请求头**:
```
Authorization: Bearer <access_token>
```

**响应** (200 OK):

```json
{
  "code": 0,
  "message": "success",
  "data": {
    "team_id": "team_abc123",
    "name": "航空系统团队",
    "description": "负责航空系统建模与仿真",
    "avatar_url": "https://cdn.example.com/teams/team_abc123.jpg",
    "member_count": 12,
    "project_count": 5,
    "owner": {
      "user_id": "usr_abc123xyz",
      "username": "john_doe",
      "full_name": "John Doe",
      "avatar_url": "https://..."
    },
    "my_role": "owner",
    "settings": {
      "default_permission": "editor",
      "require_approval": false
    },
    "created_at": "2026-01-01T00:00:00Z",
    "updated_at": "2026-09-10T12:00:00Z"
  }
}
```

---

### 3.4 更新团队

```
PUT /api/v1/teams/:id
```

**请求头**:
```
Authorization: Bearer <access_token>
```

**请求体**:

```json
{
  "name": "string",
  "description": "string",
  "avatar_url": "string",
  "settings": {
    "default_permission": "viewer|editor",
    "require_approval": true
  }
}
```

**响应** (200 OK):

```json
{
  "code": 0,
  "message": "success",
  "data": {
    "team_id": "team_abc123",
    "name": "航空系统团队(更新)",
    "description": "负责航空系统建模与仿真 - 更新版",
    "avatar_url": "https://...",
    "updated_at": "2026-09-12T15:05:00Z"
  }
}
```

---

### 3.5 删除团队

```
DELETE /api/v1/teams/:id
```

**请求头**:
```
Authorization: Bearer <access_token>
```

**响应** (200 OK):

```json
{
  "code": 0,
  "message": "success",
  "data": null
}
```

---

### 3.6 添加团队成员

```
POST /api/v1/teams/:id/members
```

**请求头**:
```
Authorization: Bearer <access_token>
```

**请求体**:

```json
{
  "user_id": "string",        // 被添加的用户 ID
  "role": "viewer|editor|admin"  // 角色权限
}
```

**响应** (201 Created):

```json
{
  "code": 0,
  "message": "success",
  "data": {
    "user_id": "usr_newmember",
    "username": "new_member",
    "full_name": "New Member",
    "avatar_url": "https://...",
    "role": "editor",
    "joined_at": "2026-09-12T15:00:00Z"
  }
}
```

---

### 3.7 移除团队成员

```
DELETE /api/v1/teams/:id/members/:userId
```

**请求头**:
```
Authorization: Bearer <access_token>
```

**响应** (200 OK):

```json
{
  "code": 0,
  "message": "success",
  "data": null
}
```

---

## 4. 项目模块 (Projects)

### 4.1 获取项目列表

```
GET /api/v1/projects
```

**查询参数**:
- `team_id` (string, optional): 团队 ID 筛选
- `page` (int, optional): 页码，默认 1
- `page_size` (int, optional): 每页数量，默认 20
- `search` (string, optional): 搜索关键词

**请求头**:
```
Authorization: Bearer <access_token>
```

**响应** (200 OK):

```json
{
  "code": 0,
  "message": "success",
  "data": {
    "projects": [
      {
        "project_id": "proj_abc123",
        "name": "飞行器系统设计",
        "description": "大型客机系统级建模",
        "status": "active",
        "visibility": "team",
        "model_count": 8,
        "team": {
          "team_id": "team_abc123",
          "name": "航空系统团队"
        },
        "owner": {
          "user_id": "usr_abc123xyz",
          "username": "john_doe",
          "full_name": "John Doe"
        },
        "my_permission": "editor",
        "created_at": "2026-02-01T00:00:00Z",
        "updated_at": "2026-09-12T10:00:00Z"
      }
    ],
    "pagination": {
      "page": 1,
      "page_size": 20,
      "total": 10,
      "total_pages": 1
    }
  }
}
```

---

### 4.2 创建项目

```
POST /api/v1/projects
```

**请求头**:
```
Authorization: Bearer <access_token>
```

**请求体**:

```json
{
  "name": "string",           // 项目名称，2-100字符
  "description": "string",    // 项目描述
  "team_id": "string",        // 所属团队 ID
  "visibility": "private|team|public",  // 可见性
  "template_id": "string"     // 可选，模板 ID
}
```

**响应** (201 Created):

```json
{
  "code": 0,
  "message": "success",
  "data": {
    "project_id": "proj_xyz789",
    "name": "新项目",
    "description": "项目描述",
    "status": "active",
    "visibility": "team",
    "model_count": 0,
    "team": {
      "team_id": "team_abc123",
      "name": "航空系统团队"
    },
    "owner": {
      "user_id": "usr_abc123xyz",
      "username": "john_doe",
      "full_name": "John Doe"
    },
    "my_permission": "owner",
    "created_at": "2026-09-12T15:00:00Z"
  }
}
```

---

### 4.3 获取项目详情

```
GET /api/v1/projects/:id
```

**请求头**:
```
Authorization: Bearer <access_token>
```

**响应** (200 OK):

```json
{
  "code": 0,
  "message": "success",
  "data": {
    "project_id": "proj_abc123",
    "name": "飞行器系统设计",
    "description": "大型客机系统级建模",
    "status": "active",
    "visibility": "team",
    "model_count": 8,
    "team": {
      "team_id": "team_abc123",
      "name": "航空系统团队"
    },
    "owner": {
      "user_id": "usr_abc123xyz",
      "username": "john_doe",
      "full_name": "John Doe"
    },
    "my_permission": "editor",
    "settings": {
      "default_model_permission": "editor",
      "version_control_enabled": true,
      "auto_save_interval": 30
    },
    "tags": ["航空", "系统设计", "SysML"],
    "created_at": "2026-02-01T00:00:00Z",
    "updated_at": "2026-09-12T10:00:00Z"
  }
}
```

---

### 4.4 更新项目

```
PUT /api/v1/projects/:id
```

**请求头**:
```
Authorization: Bearer <access_token>
```

**请求体**:

```json
{
  "name": "string",
  "description": "string",
  "status": "active|archived",
  "visibility": "private|team|public",
  "settings": {
    "default_model_permission": "viewer|editor",
    "version_control_enabled": true,
    "auto_save_interval": 30
  },
  "tags": ["航空", "系统设计"]
}
```

**响应** (200 OK):

```json
{
  "code": 0,
  "message": "success",
  "data": {
    "project_id": "proj_abc123",
    "name": "飞行器系统设计(更新)",
    "description": "更新后的描述",
    "status": "active",
    "visibility": "team",
    "updated_at": "2026-09-12T15:05:00Z"
  }
}
```

---

### 4.5 删除项目

```
DELETE /api/v1/projects/:id
```

**请求头**:
```
Authorization: Bearer <access_token>
```

**响应** (200 OK):

```json
{
  "code": 0,
  "message": "success",
  "data": null
}
```

---

## 5. 模型模块 (Models)

### 5.1 获取项目内模型列表

```
GET /api/v1/models
```

**查询参数**:
- `project_id` (string, required): 项目 ID
- `page` (int, optional): 页码，默认 1
- `page_size` (int, optional): 每页数量，默认 20
- `search` (string, optional): 搜索关键词
- `type` (string, optional): 模型类型筛选 (block, requirement, parametric, etc.)

**请求头**:
```
Authorization: Bearer <access_token>
```

**响应** (200 OK):

```json
{
  "code": 0,
  "message": "success",
  "data": {
    "models": [
      {
        "model_id": "mdl_abc123",
        "name": "飞行器顶层架构",
        "description": "定义飞行器系统顶层结构和接口",
        "type": "block_definition",
        "version": 5,
        "status": "validated",
        "project_id": "proj_abc123",
        "owner": {
          "user_id": "usr_abc123xyz",
          "username": "john_doe",
          "full_name": "John Doe"
        },
        "my_permission": "editor",
        "tags": ["架构", "顶层设计"],
        "created_at": "2026-02-01T00:00:00Z",
        "updated_at": "2026-09-12T10:00:00Z"
      }
    ],
    "pagination": {
      "page": 1,
      "page_size": 20,
      "total": 15,
      "total_pages": 1
    }
  }
}
```

---

### 5.2 创建模型

```
POST /api/v1/models
```

**请求头**:
```
Authorization: Bearer <access_token>
```

**请求体**:

```json
{
  "project_id": "string",     // 项目 ID
  "name": "string",           // 模型名称
  "description": "string",    // 模型描述
  "type": "block_definition|block|requirement|parametric|sequence|state|use_case",  // 模型类型
  "content": {                // 可选，初始 SysMLv2 内容 (JSON 格式)
    "elements": [],
    "relationships": []
  },
  "template_id": "string",    // 可选，从模板创建
  "tags": ["string"]
}
```

**响应** (201 Created):

```json
{
  "code": 0,
  "message": "success",
  "data": {
    "model_id": "mdl_xyz789",
    "name": "新模型",
    "description": "模型描述",
    "type": "block_definition",
    "version": 1,
    "status": "draft",
    "project_id": "proj_abc123",
    "owner": {
      "user_id": "usr_abc123xyz",
      "username": "john_doe",
      "full_name": "John Doe"
    },
    "my_permission": "owner",
    "created_at": "2026-09-12T15:00:00Z"
  }
}
```

---

### 5.3 获取模型详情（包含内容）

```
GET /api/v1/models/:id
```

**查询参数**:
- `include_content` (bool, optional): 是否包含模型内容，默认 true

**请求头**:
```
Authorization: Bearer <access_token>
```

**响应** (200 OK):

```json
{
  "code": 0,
  "message": "success",
  "data": {
    "model_id": "mdl_abc123",
    "name": "飞行器顶层架构",
    "description": "定义飞行器系统顶层结构和接口",
    "type": "block_definition",
    "version": 5,
    "status": "validated",
    "project_id": "proj_abc123",
    "owner": {
      "user_id": "usr_abc123xyz",
      "username": "john_doe",
      "full_name": "John Doe"
    },
    "my_permission": "editor",
    "content": {
      "elements": [
        {
          "id": "elem_001",
          "type": "Block",
          "name": "Aircraft",
          "properties": {
            "isAbstract": false,
            "isEncapsulated": false
          },
          "parts": [
            {
              "id": "elem_002",
              "name": "fuselage",
              "type": "PartProperty",
              "block": "elem_003"
            }
          ]
        }
      ],
      "relationships": [
        {
          "id": "rel_001",
          "type": "Composition",
          "source": "elem_001",
          "target": "elem_002"
        }
      ]
    },
    "metadata": {
      "sysml_version": "2.0",
      "created_by": "usr_abc123xyz",
      "validated_by": "usr_xyz789",
      "validated_at": "2026-09-12T10:00:00Z"
    },
    "tags": ["架构", "顶层设计"],
    "created_at": "2026-02-01T00:00:00Z",
    "updated_at": "2026-09-12T10:00:00Z"
  }
}
```

---

### 5.4 更新模型

```
PUT /api/v1/models/:id
```

**请求头**:
```
Authorization: Bearer <access_token>
```

**请求体**:

```json
{
  "name": "string",
  "description": "string",
  "content": {
    "elements": [],
    "relationships": []
  },
  "tags": ["string"],
  "status": "draft|review|validated"
}
```

**响应** (200 OK):

```json
{
  "code": 0,
  "message": "success",
  "data": {
    "model_id": "mdl_abc123",
    "name": "飞行器顶层架构(更新)",
    "version": 6,
    "status": "draft",
    "updated_at": "2026-09-12T15:05:00Z"
  }
}
```

---

### 5.5 删除模型

```
DELETE /api/v1/models/:id
```

**请求头**:
```
Authorization: Bearer <access_token>
```

**响应** (200 OK):

```json
{
  "code": 0,
  "message": "success",
  "data": null
}
```

---

### 5.6 获取模型版本历史

```
GET /api/v1/models/:id/versions
```

**查询参数**:
- `page` (int, optional): 页码，默认 1
- `page_size` (int, optional): 每页数量，默认 20

**请求头**:
```
Authorization: Bearer <access_token>
```

**响应** (200 OK):

```json
{
  "code": 0,
  "message": "success",
  "data": {
    "versions": [
      {
        "version": 5,
        "message": "更新接口定义",
        "created_by": {
          "user_id": "usr_abc123xyz",
          "username": "john_doe",
          "full_name": "John Doe"
        },
        "created_at": "2026-09-12T10:00:00Z",
        "snapshot_id": "snap_abc123v5"
      },
      {
        "version": 4,
        "message": "添加新部件",
        "created_by": {
          "user_id": "usr_xyz789",
          "username": "jane_smith",
          "full_name": "Jane Smith"
        },
        "created_at": "2026-09-11T15:00:00Z",
        "snapshot_id": "snap_abc123v4"
      }
    ],
    "pagination": {
      "page": 1,
      "page_size": 20,
      "total": 5,
      "total_pages": 1
    }
  }
}
```

---

### 5.7 创建版本快照

```
POST /api/v1/models/:id/versions
```

**请求头**:
```
Authorization: Bearer <access_token>
```

**请求体**:

```json
{
  "message": "string"         // 版本说明
}
```

**响应** (201 Created):

```json
{
  "code": 0,
  "message": "success",
  "data": {
    "version": 6,
    "message": "重大重构",
    "created_by": {
      "user_id": "usr_abc123xyz",
      "username": "john_doe",
      "full_name": "John Doe"
    },
    "created_at": "2026-09-12T15:00:00Z",
    "snapshot_id": "snap_abc123v6"
  }
}
```

---

### 5.8 获取指定版本

```
GET /api/v1/models/:id/versions/:version
```

**请求头**:
```
Authorization: Bearer <access_token>
```

**响应** (200 OK):

```json
{
  "code": 0,
  "message": "success",
  "data": {
    "model_id": "mdl_abc123",
    "version": 4,
    "name": "飞行器顶层架构",
    "content": {
      "elements": [],
      "relationships": []
    },
    "message": "添加新部件",
    "created_by": {
      "user_id": "usr_xyz789",
      "username": "jane_smith",
      "full_name": "Jane Smith"
    },
    "created_at": "2026-09-11T15:00:00Z",
    "snapshot_id": "snap_abc123v4"
  }
}
```

---

### 5.9 验证模型

```
POST /api/v1/models/:id/validate
```

**请求头**:
```
Authorization: Bearer <access_token>
```

**请求体**:

```json
{
  "rules": ["syntax", "constraint", "consistency"],  // 可选，指定验证规则
  "strict_mode": false
}
```

**响应** (200 OK):

```json
{
  "code": 0,
  "message": "success",
  "data": {
    "valid": true,
    "model_id": "mdl_abc123",
    "version": 5,
    "validation_result": {
      "syntax": {
        "valid": true,
        "errors": []
      },
      "constraint": {
        "valid": true,
        "errors": []
      },
      "consistency": {
        "valid": true,
        "warnings": []
      }
    },
    "validated_by": "usr_abc123xyz",
    "validated_at": "2026-09-12T15:00:00Z"
  }
}
```

---

### 5.10 导入模型

```
POST /api/v1/models/import
```

**请求头**:
```
Authorization: Bearer <access_token>
Content-Type: multipart/form-data
```

**请求体** (multipart/form-data):
- `file`: 模型文件 (.sysml, .xmi, .json)
- `project_id`: 项目 ID
- `name`: 模型名称 (可选，默认使用文件名)
- `conflict_resolution`: overwrite|rename|skip

**支持格式**:
- SysML v1.x XMI
- SysML v2.0 JSON
- 自定义 JSON 格式

**响应** (201 Created):

```json
{
  "code": 0,
  "message": "success",
  "data": {
    "model_id": "mdl_imported",
    "name": "导入的模型",
    "imported_elements": 45,
    "warnings": [
      "3 个约束条件格式不兼容，已转换"
    ],
    "status": "draft"
  }
}
```

---

### 5.11 导出模型

```
GET /api/v1/models/:id/export
```

**查询参数**:
- `format` (string, required): 导出格式 (sysml2_json|xmi|svg|pdf|png)

**请求头**:
```
Authorization: Bearer <access_token>
```

**响应** (200 OK):

```json
{
  "code": 0,
  "message": "success",
  "data": {
    "download_url": "https://cdn.example.com/exports/mdl_abc123_20260912.sysml",
    "expires_at": "2026-09-12T16:00:00Z",
    "format": "sysml2_json",
    "size_bytes": 102400
  }
}
```

---

## 6. 模板模块 (Templates)

### 6.1 获取模板市场

```
GET /api/v1/templates
```

**查询参数**:
- `category` (string, optional): 分类 (architecture|requirement|analysis|parametric)
- `team_id` (string, optional): 团队 ID 筛选
- `scope` (string, optional): all|system|market (系统模板/市场模板)
- `page` (int, optional): 页码，默认 1
- `page_size` (int, optional): 每页数量，默认 20
- `search` (string, optional): 搜索关键词

**请求头**:
```
Authorization: Bearer <access_token>
```

**响应** (200 OK):

```json
{
  "code": 0,
  "message": "success",
  "data": {
    "templates": [
      {
        "template_id": "tpl_abc123",
        "name": "标准系统架构模板",
        "description": "包含完整的系统层级结构和标准接口定义模板",
        "category": "architecture",
        "scope": "market",
        "usage_count": 1250,
        "rating": 4.8,
        "author": {
          "user_id": "usr_system",
          "username": "system",
          "full_name": "System Template"
        },
        "preview_images": [
          "https://cdn.example.com/templates/tpl_abc123_preview1.jpg"
        ],
        "tags": ["系统架构", "标准", "航空"],
        "created_at": "2026-01-01T00:00:00Z"
      }
    ],
    "pagination": {
      "page": 1,
      "page_size": 20,
      "total": 50,
      "total_pages": 3
    }
  }
}
```

---

### 6.2 创建模板

```
POST /api/v1/templates
```

**请求头**:
```
Authorization: Bearer <access_token>
```

**请求体**:

```json
{
  "name": "string",           // 模板名称
  "description": "string",    // 模板描述
  "category": "architecture|requirement|analysis|parametric",
  "content": {
    "elements": [],
    "relationships": [],
    "parameters": []          // 可配置参数
  },
  "preview_images": ["string"],
  "tags": ["string"],
  "visibility": "private|team|market"
}
```

**响应** (201 Created):

```json
{
  "code": 0,
  "message": "success",
  "data": {
    "template_id": "tpl_xyz789",
    "name": "自定义模板",
    "description": "我的自定义系统架构模板",
    "category": "architecture",
    "scope": "private",
    "usage_count": 0,
    "author": {
      "user_id": "usr_abc123xyz",
      "username": "john_doe",
      "full_name": "John Doe"
    },
    "visibility": "private",
    "created_at": "2026-09-12T15:00:00Z"
  }
}
```

---

### 6.3 获取模板详情

```
GET /api/v1/templates/:id
```

**查询参数**:
- `include_content` (bool, optional): 是否包含模板内容

**请求头**:
```
Authorization: Bearer <access_token>
```

**响应** (200 OK):

```json
{
  "code": 0,
  "message": "success",
  "data": {
    "template_id": "tpl_abc123",
    "name": "标准系统架构模板",
    "description": "包含完整的系统层级结构和标准接口定义模板",
    "category": "architecture",
    "scope": "market",
    "usage_count": 1250,
    "rating": 4.8,
    "author": {
      "user_id": "usr_system",
      "username": "system",
      "full_name": "System Template"
    },
    "content": {
      "elements": [
        {
          "id": "elem_tpl_001",
          "type": "Block",
          "name": "System",
          "is_abstract": true,
          "parameters": [
            {
              "name": "systemName",
              "type": "string",
              "required": true,
              "description": "系统名称"
            }
          ]
        }
      ],
      "relationships": [],
      "parameters": [
        {
          "name": "systemName",
          "type": "string",
          "required": true,
          "default": "MySystem"
        }
      ]
    },
    "preview_images": [
      "https://cdn.example.com/templates/tpl_abc123_preview1.jpg"
    ],
    "tags": ["系统架构", "标准", "航空"],
    "created_at": "2026-01-01T00:00:00Z",
    "updated_at": "2026-06-15T00:00:00Z"
  }
}
```

---

### 6.4 更新模板

```
PUT /api/v1/templates/:id
```

**请求头**:
```
Authorization: Bearer <access_token>
```

**请求体**:

```json
{
  "name": "string",
  "description": "string",
  "content": {
    "elements": [],
    "relationships": [],
    "parameters": []
  },
  "preview_images": ["string"],
  "tags": ["string"],
  "visibility": "private|team|market"
}
```

**响应** (200 OK):

```json
{
  "code": 0,
  "message": "success",
  "data": {
    "template_id": "tpl_abc123",
    "name": "标准系统架构模板(更新)",
    "updated_at": "2026-09-12T15:05:00Z"
  }
}
```

---

### 6.5 删除模板

```
DELETE /api/v1/templates/:id
```

**请求头**:
```
Authorization: Bearer <access_token>
```

**响应** (200 OK):

```json
{
  "code": 0,
  "message": "success",
  "data": null
}
```

---

### 6.6 从模板创建模型

```
POST /api/v1/templates/:id/instantiate
```

**请求头**:
```
Authorization: Bearer <access_token>
```

**请求体**:

```json
{
  "project_id": "string",     // 目标项目 ID
  "name": "string",           // 新模型名称
  "parameters": {             // 模板参数值
    "systemName": "飞行器系统",
    "projectCode": "AC001"
  },
  "description": "string"     // 可选，模型描述
}
```

**响应** (201 Created):

```json
{
  "code": 0,
  "message": "success",
  "data": {
    "model_id": "mdl_new_from_tpl",
    "name": "飞行器系统",
    "description": "基于标准系统架构模板创建",
    "type": "block_definition",
    "version": 1,
    "status": "draft",
    "project_id": "proj_abc123",
    "template_id": "tpl_abc123",
    "created_at": "2026-09-12T15:00:00Z"
  }
}
```

---

## 7. AI 模块 (AI)

### 7.1 AI 对话

```
POST /api/v1/ai/chat
```

**请求头**:
```
Authorization: Bearer <access_token>
```

**请求体**:

```json
{
  "model_id": "string",       // 可选，关联的模型 ID
  "messages": [
    {
      "role": "user|assistant|system",
      "content": "string"
    }
  ],
  "context": {                // 可选，上下文信息
    "project_id": "string",
    "selected_elements": ["string"]
  },
  "stream": false
}
```

**响应** (200 OK):

```json
{
  "code": 0,
  "message": "success",
  "data": {
    "conversation_id": "conv_abc123",
    "message": {
      "role": "assistant",
      "content": "根据您的需求，我建议在系统中添加以下接口定义...",
      "suggestions": [
        "创建新的接口块",
        "定义端口类型",
        "添加连接器"
      ]
    },
    "tokens_used": 350,
    "model_version": "mbse-assistant-v2"
  }
}
```

---

### 7.2 生成模型

```
POST /api/v1/ai/generate
```

**请求头**:
```
Authorization: Bearer <access_token>
```

**请求体**:

```json
{
  "project_id": "string",     // 目标项目
  "prompt": "string",         // 生成描述
  "type": "block_definition|requirement|parametric",
  "options": {
    "complexity": "low|medium|high",
    "include_constraints": true,
    "include_requirements": true,
    "base_template": "string" // 可选，基础模板
  }
}
```

**响应** (202 Accepted):

```json
{
  "code": 0,
  "message": "success",
  "data": {
    "task_id": "task_gen_abc123",
    "status": "processing",
    "estimated_time_seconds": 30,
    "webhook_url": "https://api.mbse-system.com/api/v1/ai/tasks/task_gen_abc123"
  }
}
```

**轮询完成状态** (GET /api/v1/ai/tasks/:task_id):

```json
{
  "code": 0,
  "message": "success",
  "data": {
    "task_id": "task_gen_abc123",
    "status": "completed",
    "model_id": "mdl_generated",
    "model_name": "AI生成的飞行器系统",
    "preview": {
      "elements_count": 12,
      "relationships_count": 8
    },
    "confidence_score": 0.92
  }
}
```

---

### 7.3 AI 校验

```
POST /api/v1/ai/validate
```

**请求头**:
```
Authorization: Bearer <access_token>
```

**请求体**:

```json
{
  "model_id": "string",
  "validation_type": "consistency|completeness|best_practices|safety"
}
```

**响应** (200 OK):

```json
{
  "code": 0,
  "message": "success",
  "data": {
    "model_id": "mdl_abc123",
    "validation_type": "consistency",
    "issues": [
      {
        "severity": "warning",
        "type": "orphaned_element",
        "element_id": "elem_005",
        "message": "元素 'Unnamed_Block' 似乎未连接到任何其他元素",
        "suggestion": "考虑删除该元素或添加适当的连接关系"
      },
      {
        "severity": "info",
        "type": "naming_convention",
        "element_id": "elem_010",
        "message": "建议使用 PascalCase 命名",
        "suggestion": "将 'engine_controller' 重命名为 'EngineController'"
      }
    ],
    "overall_score": 0.85,
    "suggestions": [
      "建议为关键块添加文档注释",
      "考虑添加值属性约束"
    ]
  }
}
```

---

### 7.4 自动补全

```
POST /api/v1/ai/complete
```

**请求头**:
Authorization: Bearer <access_token>

**请求体**:

```json
{
  "model_id": "string",
  "cursor_position": {
    "element_id": "string",
    "offset": 0
  },
  "context": {
    "selected_elements": ["string"],
    "recent_changes": []
  },
  "max_suggestions": 5
}
```

**响应** (200 OK):

```json
{
  "code": 0,
  "message": "success",
  "data": {
    "suggestions": [
      {
        "type": "property",
        "label": "添加属性: maxSpeed",
        "value": {
          "name": "maxSpeed",
          "type": "Real",
          "defaultValue": "100_km_per_hr"
        },
        "confidence": 0.95
      },
      {
        "type": "part",
        "label": "添加部件: Engine",
        "value": {
          "name": "engine",
          "type": "PartProperty",
          "block": "Engine"
        },
        "confidence": 0.88
      },
      {
        "type": "constraint",
        "label": "添加约束: RangeCheck",
        "value": {
          "name": "rangeCheck",
          "specification": "self.speed >= 0"
        },
        "confidence": 0.75
      }
    ],
    "context_analysis": {
      "current_block": "Aircraft",
      "suggested_relationships": ["composition", "reference"]
    }
  }
}
```

---

## 8. WebSocket 实时协作协议

### 8.1 连接

```
WebSocket /ws/collab/:modelId
```

**连接参数** (Query String):
- `token`: JWT 访问令牌

**连接示例**:
```
wss://api.mbse-system.com/ws/collab/mdl_abc123?token=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...
```

---

### 8.2 消息格式

所有 WebSocket 消息使用 JSON 格式：

```json
{
  "type": "message_type",
  "id": "msg_uuid",
  "timestamp": "2026-09-12T15:00:00.000Z",
  "payload": {}
}
```

---

### 8.3 消息类型

#### 8.3.1 光标移动 (cursor_move)

**客户端 → 服务器**:

```json
{
  "type": "cursor_move",
  "id": "msg_001",
  "timestamp": "2026-09-12T15:00:00.000Z",
  "payload": {
    "user_id": "usr_abc123xyz",
    "user_name": "John Doe",
    "cursor": {
      "element_id": "elem_001",
      "x": 150.5,
      "y": 200.0
    },
    "selection": {
      "element_ids": ["elem_001", "elem_002"]
    }
  }
}
```

**服务器 → 客户端 (广播)**:

```json
{
  "type": "cursor_move",
  "id": "msg_001",
  "timestamp": "2026-09-12T15:00:00.000Z",
  "payload": {
    "user_id": "usr_abc123xyz",
    "user_name": "John Doe",
    "user_color": "#FF5733",
    "cursor": {
      "element_id": "elem_001",
      "x": 150.5,
      "y": 200.0
    },
    "selection": {
      "element_ids": ["elem_001", "elem_002"]
    }
  }
}
```

---

#### 8.3.2 内容变更 (content_change)

**客户端 → 服务器**:

```json
{
  "type": "content_change",
  "id": "msg_002",
  "timestamp": "2026-09-12T15:00:01.000Z",
  "payload": {
    "user_id": "usr_abc123xyz",
    "change_type": "element_update",
    "operations": [
      {
        "op": "update",
        "element_id": "elem_001",
        "changes": {
          "name": "Aircraft",
          "properties": {
            "isAbstract": true
          }
        },
        "version": 6
      }
    ],
    "base_version": 5
  }
}
```

**服务器 → 客户端 (确认)**:

```json
{
  "type": "change_ack",
  "id": "msg_002",
  "timestamp": "2026-09-12T15:00:01.050Z",
  "payload": {
    "accepted": true,
    "new_version": 6,
    "server_timestamp": "2026-09-12T15:00:01.050Z"
  }
}
```

**服务器 → 客户端 (广播)**:

```json
{
  "type": "content_change",
  "id": "msg_003",
  "timestamp": "2026-09-12T15:00:01.050Z",
  "payload": {
    "user_id": "usr_abc123xyz",
    "user_name": "John Doe",
    "change_type": "element_update",
    "operations": [
      {
        "op": "update",
        "element_id": "elem_001",
        "changes": {
          "name": "Aircraft",
          "properties": {
            "isAbstract": true
          }
        }
      }
    ],
    "new_version": 6
  }
}
```

---

#### 8.3.3 元素选中 (element_select)

**客户端 → 服务器**:

```json
{
  "type": "element_select",
  "id": "msg_004",
  "timestamp": "2026-09-12T15:00:02.000Z",
  "payload": {
    "user_id": "usr_abc123xyz",
    "selected_element_ids": ["elem_001", "elem_002", "elem_003"],
    "exclusive": true
  }
}
```

**服务器 → 客户端 (广播)**:

```json
{
  "type": "element_select",
  "id": "msg_004",
  "timestamp": "2026-09-12T15:00:02.000Z",
  "payload": {
    "user_id": "usr_abc123xyz",
    "user_name": "John Doe",
    "user_color": "#FF5733",
    "selected_element_ids": ["elem_001", "elem_002", "elem_003"],
    "exclusive": true
  }
}
```

---

#### 8.3.4 同步请求 (sync_request)

**客户端 → 服务器**:

```json
{
  "type": "sync_request",
  "id": "msg_005",
  "timestamp": "2026-09-12T15:00:00.000Z",
  "payload": {
    "last_known_version": 4,
    "requested_elements": ["elem_001", "elem_002"],
    "full_sync": false
  }
}
```

---

#### 8.3.5 同步响应 (sync_response)

**服务器 → 客户端**:

```json
{
  "type": "sync_response",
  "id": "msg_005",
  "timestamp": "2026-09-12T15:00:00.100Z",
  "payload": {
    "current_version": 6,
    "elements": [
      {
        "id": "elem_001",
        "type": "Block",
        "name": "Aircraft",
        "properties": {},
        "version": 6
      }
    ],
    "deleted_element_ids": [],
    "conflicts": []
  }
}
```

---

#### 8.3.6 冲突解决 (conflict_resolution)

**服务器 → 客户端**:

```json
{
  "type": "conflict_resolution",
  "id": "msg_006",
  "timestamp": "2026-09-12T15:00:02.000Z",
  "payload": {
    "conflict_id": "cf_001",
    "type": "concurrent_edit",
    "element_id": "elem_001",
    "conflicting_changes": [
      {
        "user_id": "usr_abc123xyz",
        "user_name": "John Doe",
        "change": {
          "name": "Aircraft_John"
        },
        "timestamp": "2026-09-12T15:00:01.000Z"
      },
      {
        "user_id": "usr_xyz789",
        "user_name": "Jane Smith",
        "change": {
          "name": "Aircraft_Jane"
        },
        "timestamp": "2026-09-12T15:00:01.500Z"
      }
    ],
    "resolution_options": [
      {
        "action": "keep_first",
        "description": "保留 John 的修改"
      },
      {
        "action": "keep_second",
        "description": "保留 Jane 的修改"
      },
      {
        "action": "merge",
        "description": "合并修改"
      }
    ]
  }
}
```

**客户端 → 服务器 (选择解决方案)**:

```json
{
  "type": "conflict_resolution",
  "id": "msg_006",
  "timestamp": "2026-09-12T15:00:03.000Z",
  "payload": {
    "conflict_id": "cf_001",
    "resolution": "merge",
    "merged_value": {
      "name": "Aircraft"
    }
  }
}
```

---

#### 8.3.7 用户加入/离开 (presence)

**服务器 → 客户端**:

```json
{
  "type": "presence",
  "id": "msg_007",
  "timestamp": "2026-09-12T15:00:00.000Z",
  "payload": {
    "event": "join|leave",
    "user": {
      "user_id": "usr_abc123xyz",
      "user_name": "John Doe",
      "avatar_url": "https://...",
      "user_color": "#FF5733"
    },
    "online_users": [
      {
        "user_id": "usr_abc123xyz",
        "user_name": "John Doe",
        "user_color": "#FF5733",
        "joined_at": "2026-09-12T15:00:00.000Z"
      },
      {
        "user_id": "usr_xyz789",
        "user_name": "Jane Smith",
        "user_color": "#33FF57",
        "joined_at": "2026-09-12T14:30:00.000Z"
      }
    ]
  }
}
```

---

### 8.4 心跳与重连

**心跳** (Ping/Pong):

```json
{
  "type": "ping",
  "id": "ping_001",
  "timestamp": "2026-09-12T15:00:00.000Z"
}
```

```json
{
  "type": "pong",
  "id": "ping_001",
  "timestamp": "2026-09-12T15:00:00.000Z"
}
```

**心跳间隔**: 30 秒

**重连策略**:
1. 连接断开后等待 1 秒
2. 指数退避: 1s, 2s, 4s, 8s, 最大 30s
3. 重新连接后发送 `sync_request` 获取最新状态

---

## 9. 错误码规范

### 9.1 错误响应格式

```json
{
  "code": 10001,
  "message": "错误信息描述",
  "details": {
    "field": "具体字段错误",
    "reason": "详细原因"
  },
  "request_id": "req_abc123xyz"
}
```

### 9.2 错误码范围

| 范围 | 模块 | 说明 |
|------|------|------|
| 10000-10999 | 通用 | 系统级错误 |
| 11000-11999 | 认证 | 认证授权相关 |
| 12000-12999 | 用户 | 用户管理相关 |
| 13000-13999 | 团队 | 团队管理相关 |
| 14000-14999 | 项目 | 项目管理相关 |
| 15000-15999 | 模型 | 模型管理相关 |
| 16000-16999 | 模板 | 模板管理相关 |
| 17000-17999 | AI | AI 服务相关 |
| 18000-18999 | WebSocket | 实时协作相关 |

### 9.3 详细错误码

#### 通用错误 (10000-10999)

| 错误码 | HTTP 状态码 | 消息 | 说明 |
|--------|-------------|------|------|
| 10000 | 500 | Internal Server Error | 服务器内部错误 |
| 10001 | 400 | Bad Request | 请求格式错误 |
| 10002 | 401 | Unauthorized | 未授权访问 |
| 10003 | 403 | Forbidden | 权限不足 |
| 10004 | 404 | Not Found | 资源不存在 |
| 10005 | 409 | Conflict | 资源冲突 |
| 10006 | 422 | Validation Error | 数据验证失败 |
| 10007 | 429 | Too Many Requests | 请求频率超限 |
| 10008 | 503 | Service Unavailable | 服务暂不可用 |
| 10009 | 504 | Gateway Timeout | 网关超时 |
| 10010 | 400 | Invalid Parameter | 参数无效 |

#### 认证错误 (11000-11999)

| 错误码 | HTTP 状态码 | 消息 | 说明 |
|--------|-------------|------|------|
| 11000 | 401 | Invalid Token | 无效的令牌 |
| 11001 | 401 | Token Expired | 令牌已过期 |
| 11002 | 401 | Token Revoked | 令牌已撤销 |
| 11003 | 401 | Invalid Credentials | 凭证无效 |
| 11004 | 400 | Invalid Email Format | 邮箱格式错误 |
| 11005 | 400 | Invalid Password | 密码不符合要求 |
| 11006 | 409 | Email Already Exists | 邮箱已存在 |
| 11007 | 409 | Username Already Exists | 用户名已存在 |
| 11008 | 401 | Refresh Token Required | 需要刷新令牌 |
| 11009 | 400 | Invalid Refresh Token | 无效的刷新令牌 |

#### 用户错误 (12000-12999)

| 错误码 | HTTP 状态码 | 消息 | 说明 |
|--------|-------------|------|------|
| 12000 | 404 | User Not Found | 用户不存在 |
| 12001 | 403 | Cannot Update Other User | 无法修改其他用户 |
| 12002 | 400 | Invalid Username | 用户名格式错误 |
| 12003 | 400 | Email Already Used | 邮箱已被使用 |
| 12004 | 400 | Invalid Timezone | 无效的时区 |

#### 团队错误 (13000-13999)

| 错误码 | HTTP 状态码 | 消息 | 说明 |
|--------|-------------|------|------|
| 13000 | 404 | Team Not Found | 团队不存在 |
| 13001 | 403 | Not Team Member | 非团队成员 |
| 13002 | 403 | Insufficient Team Permission | 权限不足 |
| 13003 | 403 | Cannot Remove Owner | 无法移除所有者 |
| 13004 | 409 | User Already In Team | 用户已在团队中 |
| 13005 | 404 | Member Not Found | 成员不存在 |
| 13006 | 400 | Invalid Team Name | 团队名称无效 |
| 13007 | 400 | Invalid Role | 无效的角色 |
| 13008 | 409 | Team Name Already Exists | 团队名称已存在 |
| 13009 | 409 | Cannot Delete Team With Projects | 无法删除有项目的团队 |

#### 项目错误 (14000-14999)

| 错误码 | HTTP 状态码 | 消息 | 说明 |
|--------|-------------|------|------|
| 14000 | 404 | Project Not Found | 项目不存在 |
| 14001 | 403 | Not Project Member | 非项目成员 |
| 14002 | 403 | Insufficient Project Permission | 权限不足 |
| 14003 | 409 | Project Name Already Exists | 项目名称已存在 |
| 14004 | 400 | Invalid Project Name | 项目名称无效 |
| 14005 | 409 | Cannot Delete Project With Models | 无法删除有模型的项目 |
| 14006 | 400 | Invalid Visibility | 无效的可见性设置 |
| 14007 | 400 | Team Required | 需要指定团队 |

#### 模型错误 (15000-15999)

| 错误码 | HTTP 状态码 | 消息 | 说明 |
|--------|-------------|------|------|
| 15000 | 404 | Model Not Found | 模型不存在 |
| 15001 | 403 | Not Model Owner | 非模型所有者 |
| 15002 | 403 | Insufficient Model Permission | 权限不足 |
| 15003 | 409 | Model Name Already Exists | 模型名称已存在 |
| 15004 | 400 | Invalid Model Name | 模型名称无效 |
| 15005 | 400 | Invalid Model Type | 无效的模型类型 |
| 15006 | 400 | Invalid Model Content | 无效的模型内容 |
| 15007 | 422 | Model Validation Failed | 模型验证失败 |
| 15008 | 404 | Model Version Not Found | 模型版本不存在 |
| 15009 | 400 | Invalid Version Number | 无效的版本号 |
| 15010 | 400 | Import Format Not Supported | 不支持的导入格式 |
| 15011 | 400 | Export Format Not Supported | 不支持的导出格式 |
| 15012 | 400 | Import File Too Large | 导入文件过大 |
| 15013 | 400 | Invalid SysML Content | 无效的 SysML 内容 |

#### 模板错误 (16000-16999)

| 错误码 | HTTP 状态码 | 消息 | 说明 |
|--------|-------------|------|------|
| 16000 | 404 | Template Not Found | 模板不存在 |
| 16001 | 403 | Not Template Owner | 非模板所有者 |
| 16002 | 400 | Invalid Template Category | 无效的模板分类 |
| 16003 | 409 | Template Name Already Exists | 模板名称已存在 |
| 16004 | 400 | Invalid Template Content | 无效的模板内容 |
| 16005 | 403 | Template Not Accessible | 模板不可访问 |
| 16006 | 400 | Invalid Template Parameters | 无效的模板参数 |
| 16007 | 400 | Missing Required Parameter | 缺少必需参数 |

#### AI 错误 (17000-17999)

| 错误码 | HTTP 状态码 | 消息 | 说明 |
|--------|-------------|------|------|
| 17000 | 503 | AI Service Unavailable | AI 服务暂不可用 |
| 17001 | 504 | AI Service Timeout | AI 服务超时 |
| 17002 | 400 | Invalid AI Request | 无效的 AI 请求 |
| 17003 | 400 | Model Not Found For AI | 关联模型不存在 |
| 17004 | 409 | AI Task Already Running | AI 任务已在运行 |
| 17005 | 404 | AI Task Not Found | AI 任务不存在 |
| 17006 | 400 | AI Task Not Completed | AI 任务未完成 |
| 17007 | 429 | AI Quota Exceeded | AI 配额超限 |
| 17008 | 400 | Generation Failed | 生成失败 |
| 17009 | 400 | Invalid Prompt | 无效的提示词 |

#### WebSocket 错误 (18000-18999)

| 错误码 | 消息 | 说明 |
|--------|------|------|
| 18000 | Connection Failed | 连接失败 |
| 18001 | Invalid Token | 无效的令牌 |
| 18002 | Model Not Found | 模型不存在 |
| 18003 | Not Model Collaborator | 非模型协作者 |
| 18004 | Permission Denied | 权限被拒绝 |
| 18005 | Version Conflict | 版本冲突 |
| 18006 | Rate Limit Exceeded | 频率限制超限 |
| 18007 | Invalid Message Format | 无效的消息格式 |
| 18008 | Message Too Large | 消息过大 |

---

## 10. 认证与授权

### 10.1 JWT 令牌结构

#### Access Token

```json
{
  "header": {
    "alg": "HS256",
    "typ": "JWT"
  },
  "payload": {
    "iss": "mbse-system",
    "sub": "usr_abc123xyz",
    "aud": "mbse-api",
    "exp": 1726147200,
    "iat": 1726143600,
    "jti": "jwt_unique_id",
    "type": "access",
    "user": {
      "user_id": "usr_abc123xyz",
      "username": "john_doe",
      "email": "john@example.com"
    },
    "permissions": [
      "project:read",
      "project:write",
      "model:read",
      "model:write"
    ]
  }
}
```

#### Refresh Token

```json
{
  "header": {
    "alg": "HS256",
    "typ": "JWT"
  },
  "payload": {
    "iss": "mbse-system",
    "sub": "usr_abc123xyz",
    "aud": "mbse-api",
    "exp": 1728739200,
    "iat": 1726143600,
    "jti": "refresh_unique_id",
    "type": "refresh",
    "token_family": "family_abc123"
  }
}
```

### 10.2 令牌有效期

| 令牌类型 | 有效期 | 说明 |
|----------|--------|------|
| Access Token | 1 小时 | 用于 API 访问 |
| Refresh Token | 30 天 | 用于刷新 Access Token |
| WebSocket Token | 24 小时 | 用于 WebSocket 连接 |

### 10.3 权限级别定义

#### 系统级权限

| 权限 | 说明 |
|------|------|
| system:admin | 系统管理员 |

#### 团队级权限

| 权限 | 说明 |
|------|------|
| team:create | 创建团队 |
| team:read | 查看团队 |
| team:update | 更新团队 |
| team:delete | 删除团队 |
| team:manage_members | 管理团队成员 |

#### 项目级权限

| 权限 | 说明 |
|------|------|
| project:create | 创建项目 |
| project:read | 查看项目 |
| project:update | 更新项目 |
| project:delete | 删除项目 |
| project:manage_members | 管理项目成员 |

#### 模型级权限

| 权限 | 说明 |
|------|------|
| model:create | 创建模型 |
| model:read | 查看模型 |
| model:update | 更新模型 |
| model:delete | 删除模型 |
| model:validate | 验证模型 |
| model:import | 导入模型 |
| model:export | 导出模型 |
| model:collaborate | 实时协作 |

#### 模板级权限

| 权限 | 说明 |
|------|------|
| template:create | 创建模板 |
| template:read | 查看模板 |
| template:update | 更新模板 |
| template:delete | 删除模板 |
| template:publish | 发布模板到市场 |

#### AI 级权限

| 权限 | 说明 |
|------|------|
| ai:chat | AI 对话 |
| ai:generate | AI 生成模型 |
| ai:validate | AI 校验 |
| ai:complete | AI 自动补全 |

### 10.4 角色权限矩阵

| 角色 | 团队 | 项目 | 模型 | 模板 |
|------|------|------|------|------|
| Viewer | read | read | read | read |
| Editor | read | read/write | read/write | read |
| Admin | read/write | read/write | read/write | read/write |
| Owner | all | all | all | all |

### 10.5 认证流程

```
┌─────────────────────────────────────────────────────────────────┐
│                        认证流程                                  │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  1. 注册 (POST /api/v1/auth/register)                          │
│     └── 创建用户账户                                            │
│                                                                 │
│  2. 登录 (POST /api/v1/auth/login)                             │
│     ├── 验证凭证                                                │
│     ├── 生成 Access Token + Refresh Token                      │
│     └── 返回令牌给客户端                                        │
│                                                                 │
│  3. API 访问                                                    │
│     └── 在请求头携带: Authorization: Bearer <access_token>       │
│                                                                 │
│  4. 令牌刷新 (POST /api/v1/auth/refresh)                       │
│     ├── 使用 Refresh Token 获取新令牌                           │
│     └── 旧 Refresh Token 失效                                  │
│                                                                 │
│  5. 登出 (POST /api/v1/auth/logout)                            │
│     ├── 撤销 Refresh Token                                      │
│     └── 清除客户端会话                                           │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

### 10.6 权限检查流程

```
┌─────────────────────────────────────────────────────────────────┐
│                       权限检查流程                                │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  请求 → 解析 JWT → 提取用户信息 → 检查资源权限 → 允许/拒绝      │
│                                                                 │
│  检查层级:                                                       │
│  1. 资源存在性检查                                               │
│  2. 团队成员检查 (team membership)                              │
│  3. 项目成员检查 (project membership)                           │
│  4. 资源权限检查 (owner/editor/viewer)                          │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

---

## 附录 A: 通用响应格式

### 成功响应

```json
{
  "code": 0,
  "message": "success",
  "data": { ... }
}
```

### 错误响应

```json
{
  "code": <错误码>,
  "message": "<错误消息>",
  "details": { ... },
  "request_id": "<请求追踪 ID>"
}
```

### 分页响应

```json
{
  "code": 0,
  "message": "success",
  "data": {
    "items": [ ... ],
    "pagination": {
      "page": 1,
      "page_size": 20,
      "total": 100,
      "total_pages": 5
    }
  }
}
```

---

## 附录 B: 公共请求头

| 请求头 | 必填 | 说明 |
|--------|------|------|
| Authorization | 是 | Bearer {access_token} |
| Content-Type | 是 | application/json |
| Accept | 否 | application/json |
| X-Request-ID | 否 | 客户端生成的请求 ID |
| X-Timezone | 否 | 客户端时区 |

---

## 附录 C: 限流策略

| 端点类型 | 限制 | 窗口 |
|----------|------|------|
| 认证相关 | 10 次 | 每分钟 |
| 读操作 (GET) | 100 次 | 每分钟 |
| 写操作 (POST/PUT/DELETE) | 30 次 | 每分钟 |
| 文件上传 | 10 次 | 每分钟 |
| AI 服务 | 20 次 | 每分钟 |

---

*文档结束*
