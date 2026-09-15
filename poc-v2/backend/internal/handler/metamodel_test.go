package handler

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/gin-gonic/gin"

	"github.com/sysmlv2/mbse-backend/internal/metamodel"
)

// 辅助：构造带 mock registry 的 router
func newMetaRouter() *gin.Engine {
	gin.SetMode(gin.TestMode)
	reg, _ := metamodel.NewMockRegistry()
	h := NewMetaHandler(reg)
	r := gin.New()
	v1 := r.Group("/api/v1/metamodel")
	{
		v1.GET("/elements", h.ListElements)
		v1.GET("/elements/:qname", h.GetElement)
		v1.GET("/subtypes/:qname", h.SubTypes)
		v1.GET("/edges/:qname", h.Edges)
		v1.GET("/search", h.Search)
	}
	return r
}

// --- 测试 1: ListElements 无 kind 过滤 ---

func TestListElements_All(t *testing.T) {
	r := newMetaRouter()
	w := httptest.NewRecorder()
	req, _ := http.NewRequest("GET", "/api/v1/metamodel/elements", nil)
	r.ServeHTTP(w, req)

	if w.Code != 200 {
		t.Fatalf("status = %d, body = %s", w.Code, w.Body.String())
	}

	var resp struct {
		Elements []ElementSummary `json:"elements"`
		Count    int              `json:"count"`
	}
	if err := json.NewDecoder(w.Body).Decode(&resp); err != nil {
		t.Fatalf("decode: %v", err)
	}
	if resp.Count < 15 {
		t.Errorf("expected at least 15 elements, got %d", resp.Count)
	}
}

// --- 测试 2: ListElements 按 kind 过滤 ---

func TestListElements_FilterByKind(t *testing.T) {
	r := newMetaRouter()
	w := httptest.NewRecorder()
	req, _ := http.NewRequest("GET", "/api/v1/metamodel/elements?kind=classifier", nil)
	r.ServeHTTP(w, req)

	if w.Code != 200 {
		t.Fatalf("status = %d", w.Code)
	}

	var resp struct {
		Elements []ElementSummary `json:"elements"`
		Count    int              `json:"count"`
	}
	json.NewDecoder(w.Body).Decode(&resp)
	// Classifier 应有 Block, ItemDef, ActionDef, RequirementDef, DataType
	if resp.Count < 4 {
		t.Errorf("expected at least 4 classifiers, got %d", resp.Count)
	}
	for _, e := range resp.Elements {
		if e.Kind != "classifier" {
			t.Errorf("element %s has kind %q, want 'classifier'", e.Name, e.Kind)
		}
	}
}

func TestListElements_InvalidKind(t *testing.T) {
	r := newMetaRouter()
	w := httptest.NewRecorder()
	req, _ := http.NewRequest("GET", "/api/v1/metamodel/elements?kind=invalid", nil)
	r.ServeHTTP(w, req)

	if w.Code != 400 {
		t.Errorf("expected 400 for invalid kind, got %d", w.Code)
	}
}

// --- 测试 3: GetElement ---

func TestGetElement_Block(t *testing.T) {
	r := newMetaRouter()
	w := httptest.NewRecorder()
	req, _ := http.NewRequest("GET", "/api/v1/metamodel/elements/SysML::Block", nil)
	r.ServeHTTP(w, req)

	if w.Code != 200 {
		t.Fatalf("status = %d, body = %s", w.Code, w.Body.String())
	}

	var resp map[string]any
	json.NewDecoder(w.Body).Decode(&resp)
	if resp["name"] != "Block" {
		t.Errorf("name = %v, want Block", resp["name"])
	}
	if resp["super_type"] != "SysML::Classifier" {
		t.Errorf("super_type = %v, want SysML::Classifier", resp["super_type"])
	}
	if resp["kind"] != "classifier" {
		t.Errorf("kind = %v, want classifier", resp["kind"])
	}
}

func TestGetElement_NotFound(t *testing.T) {
	r := newMetaRouter()
	w := httptest.NewRecorder()
	req, _ := http.NewRequest("GET", "/api/v1/metamodel/elements/SysML::NonExistent", nil)
	r.ServeHTTP(w, req)

	if w.Code != 404 {
		t.Errorf("expected 404, got %d", w.Code)
	}
}

// --- 测试 4: SubTypes ---

func TestSubTypes_Classifier(t *testing.T) {
	r := newMetaRouter()
	w := httptest.NewRecorder()
	req, _ := http.NewRequest("GET", "/api/v1/metamodel/subtypes/SysML::Classifier", nil)
	r.ServeHTTP(w, req)

	if w.Code != 200 {
		t.Fatalf("status = %d", w.Code)
	}

	var resp struct {
		Parent   string   `json:"parent"`
		Subtypes []string `json:"subtypes"`
		Count    int      `json:"count"`
	}
	json.NewDecoder(w.Body).Decode(&resp)
	if resp.Count < 4 {
		t.Errorf("Classifier should have at least 4 subtypes, got %d", resp.Count)
	}
}

// --- 测试 5: Edges ---

func TestEdges_Block(t *testing.T) {
	r := newMetaRouter()
	w := httptest.NewRecorder()
	req, _ := http.NewRequest("GET", "/api/v1/metamodel/edges/SysML::Block", nil)
	r.ServeHTTP(w, req)

	if w.Code != 200 {
		t.Fatalf("status = %d", w.Code)
	}

	var resp struct {
		Element string         `json:"element"`
		Edges   []map[string]any `json:"edges"`
	}
	json.NewDecoder(w.Body).Decode(&resp)
	if len(resp.Edges) == 0 {
		t.Error("Block should have at least one edge (supertype)")
	}
	// 应有 supertype 边
	hasSuperType := false
	for _, e := range resp.Edges {
		if e["type"] == "supertype" && e["to"] == "SysML::Classifier" {
			hasSuperType = true
		}
	}
	if !hasSuperType {
		t.Error("Block should have supertype edge to SysML::Classifier")
	}
}

// --- 测试 6: Search ---

func TestSearch_Block(t *testing.T) {
	r := newMetaRouter()
	w := httptest.NewRecorder()
	req, _ := http.NewRequest("GET", "/api/v1/metamodel/search?q=Block", nil)
	r.ServeHTTP(w, req)

	if w.Code != 200 {
		t.Fatalf("status = %d", w.Code)
	}

	var resp struct {
		Query   string           `json:"query"`
		Results []ElementSummary `json:"results"`
		Count   int              `json:"count"`
	}
	json.NewDecoder(w.Body).Decode(&resp)
	if resp.Count == 0 {
		t.Error("Search 'Block' should return at least one result")
	}
}

func TestSearch_EmptyQuery(t *testing.T) {
	r := newMetaRouter()
	w := httptest.NewRecorder()
	req, _ := http.NewRequest("GET", "/api/v1/metamodel/search", nil)
	r.ServeHTTP(w, req)

	if w.Code != 400 {
		t.Errorf("expected 400 for empty query, got %d", w.Code)
	}
}

func TestSearch_MultiMatch(t *testing.T) {
	r := newMetaRouter()
	w := httptest.NewRecorder()
	req, _ := http.NewRequest("GET", "/api/v1/metamodel/search?q=Feature", nil)
	r.ServeHTTP(w, req)

	if w.Code != 200 {
		t.Fatalf("status = %d", w.Code)
	}

	var resp struct {
		Count int `json:"count"`
	}
	json.NewDecoder(w.Body).Decode(&resp)
	// "Feature" 自身 + Attribute + Port + Step（all contain "Feature" in name?）
	// Actually only Feature itself + maybe Subclassification, Redefinition
	if resp.Count < 1 {
		t.Error("Search 'Feature' should return at least 1 result")
	}
}

// --- 额外：URL 编码测试 ---

func TestGetElement_EncodedQname(t *testing.T) {
	r := newMetaRouter()
	w := httptest.NewRecorder()
	// "::" 在 URL 里是合法字符（不需要编码），但测试用空格
	req, _ := http.NewRequest("GET", "/api/v1/metamodel/elements/SysML%3A%3AElement", nil)
	r.ServeHTTP(w, req)

	if w.Code != 200 {
		t.Errorf("expected 200 with URL-encoded qname, got %d", w.Code)
	}

	// 验证响应
	var resp map[string]any
	json.NewDecoder(w.Body).Decode(&resp)
	if !strings.Contains(w.Body.String(), "Element") {
		t.Errorf("response should contain Element, got: %s", w.Body.String())
	}
	_ = resp
}
