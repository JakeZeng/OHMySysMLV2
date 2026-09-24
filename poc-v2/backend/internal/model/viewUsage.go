// Package model 定义持久化层与 API 层共享的数据模型。
package model

import "time"

// ViewUsage 表示一个 SysML v2 ViewUsage（M15 引入）。
//
// SysML v2 spec §7.26：ViewUsage 是 ViewDefinition 的"实例化"，
// 用具体 expose 路径填充模板。可关联 ViewDefinition（viewDefinitionId 字段）；
// 可选地 `satisfies <ViewpointUsage>` 表达所属关注点。
//
// MVP 存储实现：共用 `views` 表 + kind='usage' 区分。
type ViewUsage = View

// ViewUsageSummary 列表返回的摘要（继承 ViewSummary）。
type ViewUsageSummary = ViewSummary

// CreateViewUsageRequest 创建 ViewUsage 的请求体。
type CreateViewUsageRequest struct {
	PackageID              string            `json:"packageId,omitempty"`
	ViewDefinitionID       string            `json:"viewDefinitionId,omitempty"`
	Name                   string            `json:"name"`
	Description            string            `json:"description,omitempty"`
	Content                string            `json:"content"`
	ViewpointID            string            `json:"viewpointId,omitempty"`
	ViewpointQualifiedName string            `json:"viewpointQualifiedName,omitempty"`
	RenderKind             RenderKind        `json:"renderKind,omitempty"`
	FilterQualifiedNames   []string          `json:"filterQualifiedNames,omitempty"`
	ColorTag               string            `json:"colorTag,omitempty"`
	Metadata               map[string]string `json:"metadata,omitempty"`
}

// UpdateViewUsageRequest 更新 ViewUsage 的请求体（乐观锁）。
type UpdateViewUsageRequest struct {
	PackageID              string            `json:"packageId,omitempty"`
	ViewDefinitionID       string            `json:"viewDefinitionId,omitempty"`
	Name                   string            `json:"name"`
	Description            string            `json:"description,omitempty"`
	Content                string            `json:"content"`
	ViewpointID            string            `json:"viewpointId,omitempty"`
	ViewpointQualifiedName string            `json:"viewpointQualifiedName,omitempty"`
	RenderKind             RenderKind        `json:"renderKind,omitempty"`
	FilterQualifiedNames   []string          `json:"filterQualifiedNames,omitempty"`
	ColorTag               string            `json:"colorTag,omitempty"`
	Metadata               map[string]string `json:"metadata,omitempty"`
	Version                int               `json:"version"`
	Force                  bool              `json:"force,omitempty"`
	BaseContent            string            `json:"baseContent,omitempty"`
}

// ViewpointKind 表示 Viewpoint 类型（M15 简化版用）。
type ViewpointKind string

const (
	ViewpointKindDefinition ViewpointKind = "definition"
	ViewpointKindUsage      ViewpointKind = "usage"
)

// CreateViewpointRequest 创建 Viewpoint 的请求体。
type CreateViewpointRequest struct {
	PackageID   string            `json:"packageId,omitempty"`
	Name        string            `json:"name"`
	Description string            `json:"description,omitempty"`
	Content     string            `json:"content"`
	Stakeholder string            `json:"stakeholder,omitempty"`
	Concern     string            `json:"concern,omitempty"`
	Metadata    map[string]string `json:"metadata,omitempty"`
}

// UpdateViewpointRequest 更新 Viewpoint 的请求体（乐观锁）。
type UpdateViewpointRequest struct {
	PackageID   string            `json:"packageId,omitempty"`
	Name        string            `json:"name"`
	Description string            `json:"description,omitempty"`
	Content     string            `json:"content"`
	Stakeholder string            `json:"stakeholder,omitempty"`
	Concern     string            `json:"concern,omitempty"`
	Metadata    map[string]string `json:"metadata,omitempty"`
	Version     int               `json:"version"`
}

var _ = time.Time{}