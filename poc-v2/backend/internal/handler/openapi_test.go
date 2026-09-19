package handler

import (
	"encoding/json"
	"net/http"
	"strings"
	"testing"

	"gopkg.in/yaml.v3"
)

// TestOpenAPISpecYAMLEmbedded：embed.FS 必须成功加载 openapi.yaml。
// 若文件被误删或路径错误，编译期就能发现（//go:embed）。
func TestOpenAPISpecYAMLEmbedded(t *testing.T) {
	spec := OpenAPISpecYAML()
	if len(spec) == 0 {
		t.Fatal("OpenAPISpecYAML() 返回空字节")
	}
	if !strings.HasPrefix(string(spec), "openapi:") {
		t.Errorf("OpenAPI spec 必须以 'openapi:' 开头，实际：%.80s", string(spec))
	}
}

// TestOpenAPISpecLoadsAsYAML：YAML 自身能解析，且关键字段正确。
func TestOpenAPISpecLoadsAsYAML(t *testing.T) {
	var doc map[string]any
	if err := yaml.Unmarshal(OpenAPISpecYAML(), &doc); err != nil {
		t.Fatalf("yaml.Unmarshal 失败：%v", err)
	}
	v, ok := doc["openapi"].(string)
	if !ok {
		t.Fatal("openapi 字段缺失")
	}
	if !strings.HasPrefix(v, "3.") {
		t.Errorf("OpenAPI 主版本应为 3.x，实际 %q", v)
	}
	paths, ok := doc["paths"].(map[string]any)
	if !ok {
		t.Fatal("paths 字段缺失")
	}
	if len(paths) < 20 {
		t.Errorf("paths 太少 (%d)，期望 ≥ 20 个端点", len(paths))
	}
	// 至少覆盖所有核心路由
	required := []string{
		"/health",
		"/api/v1/auth/register",
		"/api/v1/auth/login",
		"/api/v1/auth/me",
		"/api/v1/projects",
		"/api/v1/teams",
		"/api/v1/audit-logs",
		"/api/v1/metamodel/elements",
		"/api/v1/templates",
		"/api/v1/webhooks",
		"/api/v1/api-keys",
		"/api/v1/import/papyrus",
		"/api/v1/reports/generate",
		"/api/v1/plugins",
		"/api/v1/subscription",
		"/api/v1/notifications",
		"/api/v1/codegen/generate",
		"/api/v1/presence/heartbeat",
	}
	for _, p := range required {
		if _, ok := paths[p]; !ok {
			t.Errorf("paths 缺少 %q", p)
		}
	}
}

// TestGetOpenAPIYAML：GET /openapi.yaml 返回 200 + application/yaml + 有效 YAML。
func TestGetOpenAPIYAML(t *testing.T) {
	r, _ := setupTestRouter(t)
	w := doRequest(r, authedRequest("GET", "/openapi.yaml", "", nil))
	if w.Code != http.StatusOK {
		t.Fatalf("status = %d", w.Code)
	}
	ct := w.Header().Get("Content-Type")
	if !strings.HasPrefix(ct, "application/yaml") {
		t.Errorf("Content-Type = %q，应为 application/yaml", ct)
	}
	body := w.Body.String()
	if !strings.HasPrefix(body, "openapi:") {
		t.Errorf("body 不像 OpenAPI YAML，前 80 字节：%q", body[:minLen(80, len(body))])
	}
}

// TestGetOpenAPIJSON：GET /openapi.json 返回 200 + 有效 JSON，转换无损。
func TestGetOpenAPIJSON(t *testing.T) {
	r, _ := setupTestRouter(t)
	w := doRequest(r, authedRequest("GET", "/openapi.json", "", nil))
	if w.Code != http.StatusOK {
		t.Fatalf("status = %d, body=%s", w.Code, w.Body.String())
	}
	var doc map[string]any
	if err := json.Unmarshal(w.Body.Bytes(), &doc); err != nil {
		t.Fatalf("JSON 解析失败：%v", err)
	}
	if _, ok := doc["paths"]; !ok {
		t.Fatal("JSON 响应缺少 paths")
	}
	// 检查 components.schemas 至少包含 5 个核心 schema
	comps, _ := doc["components"].(map[string]any)
	schemas, _ := comps["schemas"].(map[string]any)
	if len(schemas) < 5 {
		t.Errorf("components.schemas 太少 (%d)", len(schemas))
	}
}
