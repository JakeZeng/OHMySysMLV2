// Package model 定义持久化层与 API 层共享的数据模型。
package model

import "time"

// Viewpoint 表示一个 SysML v2 Viewpoint（M15 引入）。
//
// SysML v2 spec §7.26：Viewpoint 是 SysML v2 一等元素；
// 表达利益相关方对模型的关注点（stakeholder / concern）。
//
// M15 简化：
//   - 用 kind 字段区分 ViewpointDefinition vs ViewpointUsage（默认 'definition'）
//   - stakeholder / concern 是 UI hint（spec 允许，非 SysML 语义）
//   - 关联 ViewDefinition / ViewUsage 通过 View.viewpoint_id 外键实现
type Viewpoint struct {
	ID          string            `json:"id"`
	ProjectID   string            `json:"projectId"`
	PackageID   string            `json:"packageId,omitempty"` // 顶级 = ""
	Name        string            `json:"name"`
	Description string            `json:"description,omitempty"`
	Content     string            `json:"content"`              // SysML v2 viewpoint 文本
	Stakeholder string            `json:"stakeholder,omitempty"` // UI hint
	Concern     string            `json:"concern,omitempty"`     // 关注点描述
	Metadata    map[string]string `json:"metadata,omitempty"`
	Version     int               `json:"version"`
	CreatedAt   time.Time         `json:"createdAt"`
	UpdatedAt   time.Time         `json:"updatedAt"`
}

// ViewpointSummary 列表返回的摘要（不含 Content）。
type ViewpointSummary struct {
	ID          string    `json:"id"`
	ProjectID   string    `json:"projectId"`
	PackageID   string    `json:"packageId,omitempty"`
	Name        string    `json:"name"`
	Description string    `json:"description,omitempty"`
	Stakeholder string    `json:"stakeholder,omitempty"`
	Concern     string    `json:"concern,omitempty"`
	Version     int       `json:"version"`
	UpdatedAt   time.Time `json:"updatedAt"`
}

// ViewpointKind 在 viewUsage.go 中定义（M15 简化版本用；MVP 都用 'definition'）。
// ValidViewpointKinds 已移到 viewUsage.go。