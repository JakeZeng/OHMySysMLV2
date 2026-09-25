// Package model 定义持久化层与 API 层共享的数据模型。
package model

import "time"

// ViewDefinition 表示一个 SysML v2 ViewDefinition（M15 引入）。
//
// SysML v2 spec §7.26：ViewDefinition 是"模板"性质的视图定义，
// 描述渲染/过滤规则（render <RenderingRef> / filter @），不包含具体 expose 路径。
// ViewDefinition 可以被 ViewUsage 实例化（通过 view_definition_id 关联）。
//
// MVP 存储实现：共用 `views` 表 + kind='definition' 区分。
// 语义上 ViewDefinition 与 ViewUsage 完全独立（API 层隔离）。
type ViewDefinition = View

// ViewDefinitionSummary 列表返回的摘要（继承 ViewSummary）。
type ViewDefinitionSummary = ViewSummary

// CreateViewDefinitionRequest 创建 ViewDefinition 的请求体。
type CreateViewDefinitionRequest struct {
	PackageID              string            `json:"packageId,omitempty"`
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

// UpdateViewDefinitionRequest 更新 ViewDefinition 的请求体（乐观锁）。
type UpdateViewDefinitionRequest struct {
	PackageID              string            `json:"packageId,omitempty"`
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

// Compile-time 保证引用存在（避免 import-only check 失败）。
var _ = time.Time{}