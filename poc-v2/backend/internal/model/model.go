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
//
// M15：增加 Reason 字段，记录 unresolved 时的原因（路径不存在等）。
type ExposedElement struct {
	QualifiedName string `json:"qualifiedName"`    // e.g. "Pkg1.SubPkg.PartDef1"
	Kind          string `json:"kind"`             // "PartDef" | "PortDef" | ...
	Reason        string `json:"reason,omitempty"` // 仅 Unresolved 时使用
}

// PackageContentRef 是「包 + 内容」的最小投影，专供视图 expose 路径 resolve 使用。
//
// 为什么不复用 PackageSummary：摘要刻意不带 Content（列表接口不应传输全部 SysML 文本）；
// 而 expose 路径的严格校验必须能看到目标包 body 里到底定义了哪些 def。
// 也不复用 Package：那个结构含 metadata / version / 时间戳等 resolve 用不到的字段。
type PackageContentRef struct {
	ID              string `json:"id"`
	Name            string `json:"name"`
	ParentPackageID string `json:"parentPackageId,omitempty"`
	Content         string `json:"content"`
}

// View 表示一个 SysML v2 视图（M12 引入为一等公民，M15 升级）。
//
// M15 升级要点：
//   - kind 字段区分 Definition（template） vs Usage（实例）
//   - 解析 expose / render <RenderingRef> / filter @ / satisfy X 子句
//   - 跨包路径 resolve：ExposedElements = resolved；ExposedElementsUnresolved = unresolved
//   - InnerElements = view body 内 owned 元素（view-private）
//   - ViewpointID 关联外部 Viewpoint 实体（M15 新增）
//
// 关于 Definition vs Usage：
//   - kind='definition' 时，content 描述 filter/render 规则
//   - kind='usage' 时，content 含具体 expose 路径，关联 ViewDefinitionID（可选）
//   - MVP：单表 + kind 字段；Definition 与 Usage 在 API 层完全独立
type View struct {
	ID          string `json:"id"`
	ProjectID   string `json:"projectId"`
	PackageID   string `json:"packageId,omitempty"` // 顶层 = ""
	Name        string `json:"name"`
	Description string `json:"description,omitempty"`
	Content     string `json:"content"` // SysML v2 视图文本

	// M15：kind 区分 Definition vs Usage
	Kind ViewKind `json:"kind"`

	// M15：关联的 ViewDefinition（仅 kind='usage' 时设置）
	ViewDefinitionID string `json:"viewDefinitionId,omitempty"`

	// M15：满足的 Viewpoint（外键；解析自 `view ... satisfies X;`）
	ViewpointID            string `json:"viewpointId,omitempty"`
	ViewpointQualifiedName string `json:"viewpointQualifiedName,omitempty"`

	// M15：渲染方式（由 `render <RenderingRef>;` 的引用名推导；legacy `render as <kind>;` 也识别）
	RenderKind RenderKind `json:"renderKind"`

	// M15：过滤规则列表（解析自 `filter @X;`，算子文本随名字一起保留）
	FilterQualifiedNames []string `json:"filterQualifiedNames"`

	// 已解析的 expose 元素（resolve 成功）
	ExposedElements []ExposedElement `json:"exposedElements,omitempty"`

	// 未解析的 expose（路径不存在于项目包树）
	ExposedElementsUnresolved []ExposedElement `json:"exposedElementsUnresolved,omitempty"`

	// M15：view body 内 owned 元素（view-private）
	InnerElements []InnerElement `json:"innerElements,omitempty"`

	// 兼容 M12 字段
	ColorTag          string            `json:"colorTag,omitempty"`
	RenderingCategory string            `json:"renderingCategory,omitempty"` // deprecated
	Metadata          map[string]string `json:"metadata,omitempty"`

	Version   int       `json:"version"`
	CreatedAt time.Time `json:"createdAt"`
	UpdatedAt time.Time `json:"updatedAt"`
}

// ViewSummary 列表返回的摘要（不含 Content）。
//
// M15 增量：为了支撑「元素上树」，摘要额外携带树渲染所需的解析结果：
//   - InnerElements：view body 内 owned 元素（view-private，进 view 节点子树）
//   - ExposeCount / ExposeUnresolvedCount：expose 引用计数（树节点徽章，不进子树）
//   - FilterQualifiedNames：filter @ 子句（ViewpointSummary 顶部条展示）
//
// 这些字段都很小（每视图最多几十项），随列表一次性返回可避免树展开时的 N+1 请求。
type ViewSummary struct {
	ID                string     `json:"id"`
	ProjectID         string     `json:"projectId"`
	PackageID         string     `json:"packageId,omitempty"`
	Name              string     `json:"name"`
	Description       string     `json:"description,omitempty"`
	Kind              ViewKind   `json:"kind"`
	RenderKind        RenderKind `json:"renderKind"`
	ViewDefinitionID  string     `json:"viewDefinitionId,omitempty"`
	ViewpointID       string     `json:"viewpointId,omitempty"`
	ViewpointQName    string     `json:"viewpointQualifiedName,omitempty"`
	ColorTag          string     `json:"colorTag,omitempty"`
	RenderingCategory string     `json:"renderingCategory,omitempty"` // deprecated
	Version           int        `json:"version"`
	UpdatedAt         time.Time  `json:"updatedAt"`

	// M15 树渲染增量
	InnerElements            []InnerElement `json:"innerElements,omitempty"`
	ExposeCount              int            `json:"exposeCount"`
	ExposeUnresolvedCount    int            `json:"exposeUnresolvedCount"`
	FilterQualifiedNames     []string       `json:"filterQualifiedNames,omitempty"`
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

// MarshalInnerElements 把 innerElements 序列化为 JSON 字符串。
func MarshalInnerElements(items []InnerElement) (string, error) {
	if len(items) == 0 {
		return "[]", nil
	}
	b, err := json.Marshal(items)
	if err != nil {
		return "", err
	}
	return string(b), nil
}

// UnmarshalInnerElements 从 JSON 字符串反序列化 innerElements。
func UnmarshalInnerElements(s string) ([]InnerElement, error) {
	if s == "" || s == "[]" {
		return nil, nil
	}
	out := make([]InnerElement, 0)
	if err := json.Unmarshal([]byte(s), &out); err != nil {
		return nil, err
	}
	return out, nil
}

// MarshalStringSlice 把 []string 序列化为 JSON 字符串。
func MarshalStringSlice(items []string) (string, error) {
	if len(items) == 0 {
		return "[]", nil
	}
	b, err := json.Marshal(items)
	if err != nil {
		return "", err
	}
	return string(b), nil
}

// UnmarshalStringSlice 从 JSON 字符串反序列化 []string。
func UnmarshalStringSlice(s string) ([]string, error) {
	if s == "" || s == "[]" {
		return nil, nil
	}
	out := make([]string, 0)
	if err := json.Unmarshal([]byte(s), &out); err != nil {
		return nil, err
	}
	return out, nil
}

// ViewKind 表示视图是定义（template）还是实例（concrete usage）。
type ViewKind string

const (
	ViewKindDefinition ViewKind = "definition"
	ViewKindUsage      ViewKind = "usage"
)

// RenderKind 视图渲染方式 —— 由 `render <RenderingRef>;` 的引用名推导
// （标准里 render 的参数是 rendering 用法的引用，本实现按名字映射到可用 renderer）。
type RenderKind string

const (
	RenderKindInterconnection RenderKind = "interconnection"
	RenderKindTree            RenderKind = "tree"
	RenderKindState           RenderKind = "state"
	RenderKindAction          RenderKind = "action"
	RenderKindRequirement     RenderKind = "requirement"
	RenderKindSnapshot        RenderKind = "snapshot"
)

// ValidRenderKinds 用于校验 renderKind 是否在合法集合内。
func ValidRenderKinds() map[RenderKind]bool {
	return map[RenderKind]bool{
		RenderKindInterconnection: true,
		RenderKindTree:            true,
		RenderKindState:           true,
		RenderKindAction:          true,
		RenderKindRequirement:     true,
		RenderKindSnapshot:        true,
	}
}

// NormalizeRenderKind 把未知 renderKind 归一为 interconnection（M15 默认）。
func NormalizeRenderKind(s string) RenderKind {
	if s == "" {
		return RenderKindInterconnection
	}
	k := RenderKind(s)
	if ValidRenderKinds()[k] {
		return k
	}
	return RenderKindInterconnection
}

// InnerElement 表示 view body 内 owned 的元素（part def X / requirement def Y 等）。
//
// 与 ExposedElement 区别：InnerElement 是 owned by view body（view-private），
// ExposedElement 是从包内 expose 的引用。
type InnerElement struct {
	Name string `json:"name"`   // 元素名（view 内唯一）
	Kind string `json:"kind"`   // "PartDef" / "RequirementDef" / ...
	Line int    `json:"line"`   // 源位置（编辑器跳转用）
	Col  int    `json:"column"` // 源列
}
