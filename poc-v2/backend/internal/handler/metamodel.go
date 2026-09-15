// Package handler 提供 HTTP API 入口。
//
// metamodel.go 暴露 5 个 endpoint（按 metamodel-loader-design §4.3）：
//   GET /api/v1/metamodel/elements            所有元素摘要（按 kind 过滤可选）
//   GET /api/v1/metamodel/elements/:qname     单元素详情
//   GET /api/v1/metamodel/subtypes/:qname     所有直接子类
//   GET /api/v1/metamodel/edges/:qname        关系边（supertype/containment）
//   GET /api/v1/metamodel/search?q=...        模糊搜索
package handler

import (
	"net/http"
	"strings"

	"github.com/gin-gonic/gin"

	"github.com/sysmlv2/mbse-backend/internal/metamodel"
)

// MetaHandler 暴露 metamodel 查询 API。
type MetaHandler struct {
	registry *metamodel.Registry
}

// NewMetaHandler 创建 MetaHandler。
func NewMetaHandler(reg *metamodel.Registry) *MetaHandler {
	return &MetaHandler{registry: reg}
}

// ElementSummary 是 ListElements 返回的简化结构。
// 避免一次返回完整 MetaElement（含所有 properties）导致响应过大。
type ElementSummary struct {
	QualifiedName string `json:"qname"`
	Name          string `json:"name"`
	Namespace     string `json:"namespace"`
	Kind          string `json:"kind"`
	SuperType     string `json:"super_type,omitempty"`
}

// ListElements GET /metamodel/elements
// Query: ?kind=classifier  按 Kind 过滤（可选）
func (h *MetaHandler) ListElements(c *gin.Context) {
	kindParam := c.Query("kind")

	var elements []*metamodel.MetaElement
	if kindParam != "" {
		kind := metamodel.ParseKind(kindParam)
		if kind == metamodel.KindUnknown {
			c.JSON(http.StatusBadRequest, gin.H{
				"error": "invalid kind",
				"valid": []string{"element", "classifier", "feature", "relationship", "namespace", "type"},
			})
			return
		}
		elements = h.registry.ByKind(kind)
	} else {
		elements = h.registry.All()
	}

	summaries := make([]ElementSummary, 0, len(elements))
	for _, e := range elements {
		summaries = append(summaries, ElementSummary{
			QualifiedName: e.QualifiedName,
			Name:          e.Name,
			Namespace:     e.Namespace,
			Kind:          e.Kind.String(),
			SuperType:     e.SuperType,
		})
	}

	c.JSON(http.StatusOK, gin.H{
		"elements":  summaries,
		"count":     len(summaries),
		"source":    h.registry.Source(),
		"loaded_at": h.registry.LoadedAt(),
	})
}

// GetElement GET /metamodel/elements/:qname
// 返回完整 MetaElement（含 properties + subtypes）
func (h *MetaHandler) GetElement(c *gin.Context) {
	qname := c.Param("qname")
	e, ok := h.registry.Get(qname)
	if !ok {
		c.JSON(http.StatusNotFound, gin.H{
			"error": "element not found",
			"qname": qname,
		})
		return
	}

	// 构造响应（含完整 properties + subtypes）
	type PropertyResp struct {
		Name          string `json:"name"`
		Type          string `json:"type"`
		Multiplicity  string `json:"multiplicity"`
		Documentation string `json:"documentation,omitempty"`
		Required      bool   `json:"required"`
	}

	props := make([]PropertyResp, 0, len(e.Properties))
	for _, p := range e.Properties {
		props = append(props, PropertyResp{
			Name:          p.Name,
			Type:          p.Type,
			Multiplicity:  p.Multiplicity.String(),
			Documentation: p.Documentation,
			Required:      p.Required,
		})
	}

	// SubTypes 用名字而非对象（避免循环）
	subTypeNames := make([]string, len(e.SubTypes))
	copy(subTypeNames, e.SubTypes)

	c.JSON(http.StatusOK, gin.H{
		"qname":         e.QualifiedName,
		"name":          e.Name,
		"namespace":     e.Namespace,
		"kind":          e.Kind.String(),
		"super_type":    e.SuperType,
		"sub_types":     subTypeNames,
		"properties":    props,
		"documentation": e.Documentation,
	})
}

// SubTypes GET /metamodel/subtypes/:qname
func (h *MetaHandler) SubTypes(c *gin.Context) {
	qname := c.Param("qname")
	subs := h.registry.SubTypesOf(qname)

	names := make([]string, len(subs))
	for i, s := range subs {
		names[i] = s.QualifiedName
	}

	c.JSON(http.StatusOK, gin.H{
		"parent":  qname,
		"subtypes": names,
		"count":   len(names),
	})
}

// Edges GET /metamodel/edges/:qname
// 返回该元素的所有关系边（supertype 边 + 假设 containment 边）
func (h *MetaHandler) Edges(c *gin.Context) {
	qname := c.Param("qname")
	e, ok := h.registry.Get(qname)
	if !ok {
		c.JSON(http.StatusNotFound, gin.H{
			"error": "element not found",
			"qname": qname,
		})
		return
	}

	type EdgeResp struct {
		Type string `json:"type"`  // "supertype" / "containment" / "reference"
		From string `json:"from"`
		To   string `json:"to"`
	}

	edges := []EdgeResp{}
	if e.SuperType != "" {
		edges = append(edges, EdgeResp{
			Type: "supertype",
			From: e.QualifiedName,
			To:   e.SuperType,
		})
	}

	// 父类的 containment 边：把子类作为父类的 containment 候选
	if e.SubTypes != nil {
		for _, st := range e.SubTypes {
			edges = append(edges, EdgeResp{
				Type: "subtype",
				From: e.QualifiedName,
				To:   st,
			})
		}
	}

	c.JSON(http.StatusOK, gin.H{
		"element": qname,
		"edges":   edges,
	})
}

// Search GET /metamodel/search?q=...
// 模糊搜索元素名
func (h *MetaHandler) Search(c *gin.Context) {
	query := strings.TrimSpace(c.Query("q"))
	if query == "" {
		c.JSON(http.StatusBadRequest, gin.H{
			"error": "query parameter 'q' is required",
		})
		return
	}

	results := h.registry.Search(query)
	summaries := make([]ElementSummary, 0, len(results))
	for _, e := range results {
		summaries = append(summaries, ElementSummary{
			QualifiedName: e.QualifiedName,
			Name:          e.Name,
			Namespace:     e.Namespace,
			Kind:          e.Kind.String(),
			SuperType:     e.SuperType,
		})
	}

	c.JSON(http.StatusOK, gin.H{
		"query":   query,
		"results": summaries,
		"count":   len(summaries),
	})
}
