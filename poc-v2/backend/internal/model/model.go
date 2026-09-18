// Package model 定义持久化层与 API 层共享的数据模型。
package model

import "time"

// User 表示一个注册用户。
type User struct {
	ID           string    `json:"id"`
	Username     string    `json:"username"`
	Email        string    `json:"email"`
	PasswordHash string    `json:"-"` // 不导出
	// M4.5 增量：首个注册用户自动获得 admin 权限；用于审计归档等管理操作。
	// 暂不暴露给 JSON（避免普通接口返回内部标志）；管理员相关接口按需读取。
	IsAdmin   bool      `json:"-"`
	CreatedAt time.Time `json:"createdAt"`
}

// ProjectVisibility 项目可见性（M4 W1 引入）。
//   private: 仅 owner + 显式分享者可访问
//   team:    owner + 任何团队成员 + 显式分享者可访问
//   public:  持有有效 share_link token 即可读
const (
	VisibilityPrivate = "private"
	VisibilityTeam    = "team"
	VisibilityPublic  = "public"
)

// Project 表示用户的一个项目。
type Project struct {
	ID          string    `json:"id"`
	Name        string    `json:"name"`
	Description string    `json:"description"`
	OwnerID     string    `json:"ownerId"`
	Visibility  string    `json:"visibility"`
	CreatedAt   time.Time `json:"createdAt"`
	UpdatedAt   time.Time `json:"updatedAt"`
}

// Model 表示一个 SysML v2 模型。
// Content 是原始 SysML 文本。
type Model struct {
	ID        string    `json:"id"`
	ProjectID string    `json:"projectId"`
	Name      string    `json:"name"`
	Content   string    `json:"content"`
	Version   int       `json:"version"`
	CreatedAt time.Time `json:"createdAt"`
	UpdatedAt time.Time `json:"updatedAt"`
}
