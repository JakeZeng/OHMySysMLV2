// Package model 定义持久化层与 API 层共享的数据模型。
package model

import (
	"encoding/json"
	"time"
)

// User 表示一个注册用户。
type User struct {
	ID           string    `json:"id"`
	Username     string    `json:"username"`
	Email        string    `json:"email"`
	PasswordHash string    `json:"-"` // 不导出
	// M4.5 增量：首个注册用户自动获得 admin 权限；用于审计归档等管理操作。
	// /auth/me 端点暴露给前端用于 UI 权限控制；登录/注册响应也带上。
	IsAdmin   bool      `json:"isAdmin"`
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
	ID          string    `json:"id"`
	ProjectID   string    `json:"projectId"`
	Name        string    `json:"name"`
	Description string    `json:"description,omitempty"`
	Content     string    `json:"content"`
	Version     int       `json:"version"`
	CreatedAt   time.Time `json:"createdAt"`
	UpdatedAt   time.Time `json:"updatedAt"`
}

// ModelVersion 表示模型的一个历史版本（M4.5 增量）。
// 每次 UpdateModel 时自动保存旧版本到 model_versions 表。
type ModelVersion struct {
	ID        string    `json:"id"`
	ModelID   string    `json:"modelId"`
	Content   string    `json:"content"`
	Version   int       `json:"version"`
	SavedBy   string    `json:"savedBy,omitempty"`
	CreatedAt time.Time `json:"createdAt"`
}

// Package 表示一个 SysML v2 Package（M12 引入）。
//
// SysML v2 只有一个 Package metaclass；M12 把原"模型"概念并入 Package，
// Package 自身可包含 SysML 文本（Content）、可嵌套（ParentPackageID 自引用）。
//
// 注意：Project 是我们的域容器（非 SysML 概念）；Package 才是 SysML 世界起点。
type Package struct {
	ID              string            `json:"id"`
	ProjectID       string            `json:"projectId"`
	ParentPackageID string            `json:"parentPackageId,omitempty"` // 顶级包 = ""
	Name            string            `json:"name"`
	Description     string            `json:"description,omitempty"`
	Content         string            `json:"content"`             // SysML v2 文本
	Metadata        map[string]string `json:"metadata,omitempty"`  // K-V 标注；非 SysML 语义
	Version         int               `json:"version"`             // 乐观锁
	CreatedAt       time.Time         `json:"createdAt"`
	UpdatedAt       time.Time         `json:"updatedAt"`
}

// PackageSummary 列表返回的摘要（不含大字段 Content）。
type PackageSummary struct {
	ID              string    `json:"id"`
	ProjectID       string    `json:"projectId"`
	ParentPackageID string    `json:"parentPackageId,omitempty"`
	Name            string    `json:"name"`
	Description     string    `json:"description,omitempty"`
	Version         int       `json:"version"`
	UpdatedAt       time.Time `json:"updatedAt"`
}

// ExposedElement 是 View 解析 content 后缓存的引用元素。
type ExposedElement struct {
	QualifiedName string `json:"qualifiedName"` // e.g. "Pkg1.SubPkg.PartDef1"
	Kind          string `json:"kind"`          // "PartDef" | "PortDef" | ...
}

// View 表示一个 SysML v2 ViewDefinition（M12 引入为一等公民）。
//
// 语义对齐 SysML v2 spec §7.26：View 是 SysML v2 一等元素，
// 可在 Package / Project 下独立存在；可在 content 内跨包引用元素
// （ExposedElements 是解析缓存）。
//
// 注意：MVP 简化为单一 View 实体 ≈ ViewDefinition。ViewpointDefinition /
// ViewUsage vs ViewDefinition 区分留待 M12.x。
type View struct {
	ID                string            `json:"id"`
	ProjectID         string            `json:"projectId"`
	PackageID         string            `json:"packageId,omitempty"`         // 顶层 = ""
	Name              string            `json:"name"`
	Description       string            `json:"description,omitempty"`
	Content           string            `json:"content"`                    // SysML v2 view definition 文本
	ColorTag          string            `json:"colorTag,omitempty"`         // UI metadata；非 SysML 语义
	RenderingCategory string            `json:"renderingCategory,omitempty"` // UI hint；不强制画布过滤
	ExposedElements   []ExposedElement  `json:"exposedElements,omitempty"`   // 解析 content 缓存
	Metadata          map[string]string `json:"metadata,omitempty"`
	Version           int               `json:"version"`
	CreatedAt         time.Time         `json:"createdAt"`
	UpdatedAt         time.Time         `json:"updatedAt"`
}

// ViewSummary 列表返回的摘要（不含 Content / ExposedElements）。
type ViewSummary struct {
	ID                string    `json:"id"`
	ProjectID         string    `json:"projectId"`
	PackageID         string    `json:"packageId,omitempty"`
	Name              string    `json:"name"`
	Description       string    `json:"description,omitempty"`
	ColorTag          string    `json:"colorTag,omitempty"`
	RenderingCategory string    `json:"renderingCategory,omitempty"`
	Version           int       `json:"version"`
	UpdatedAt         time.Time `json:"updatedAt"`
}

// MarshalExposedElements 把 exposedElements 列表序列化为 JSON 字符串。
// 空切片写入 "[]"。
func MarshalExposedElements(items []ExposedElement) (string, error) {
	if len(items) == 0 {
		return "[]", nil
	}
	b, err := json.Marshal(items)
	if err != nil {
		return "", err
	}
	return string(b), nil
}

// UnmarshalExposedElements 从 JSON 字符串反序列化 exposedElements。
// 空串或 "[]" 视为 nil（不返回错误）。
func UnmarshalExposedElements(s string) ([]ExposedElement, error) {
	if s == "" || s == "[]" {
		return nil, nil
	}
	out := make([]ExposedElement, 0)
	if err := json.Unmarshal([]byte(s), &out); err != nil {
		return nil, err
	}
	return out, nil
}
