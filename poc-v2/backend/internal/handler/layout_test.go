package handler

import (
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/gin-gonic/gin"
)

// M16 P5/Q10：画布布局后端持久化 —— 独立表 + 独立 endpoint，
// 不 bump version、不触发协同冲突。

// 布局测试里的公共脚手架：注册用户 + 建工程
func setupLayoutTest(t *testing.T, projectName string) (*gin.Engine, string, string) {
	t.Helper()
	r, _ := setupTestRouter(t)
	resp := registerUser(t, r, projectName+"-owner", projectName+"@example.com", "pass123456")
	authHeader := "Bearer " + authToken(t, resp)
	body := jsonBody(gin.H{"name": projectName})
	req := httptest.NewRequest(http.MethodPost, "/api/v1/projects", body)
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Authorization", authHeader)
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)
	if w.Code != http.StatusOK {
		t.Fatalf("create project: status = %d, body = %s", w.Code, w.Body.String())
	}
	projectID := parseJSON(t, w.Body.Bytes())["data"].(map[string]any)["id"].(string)
	return r, authHeader, projectID
}

func createLayoutPkg(t *testing.T, r *gin.Engine, authHeader, projectID, name, content string) string {
	t.Helper()
	body := jsonBody(gin.H{"name": name, "content": content})
	req := httptest.NewRequest(http.MethodPost, "/api/v1/projects/"+projectID+"/packages", body)
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Authorization", authHeader)
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)
	if w.Code != http.StatusOK {
		t.Fatalf("create package: status = %d, body = %s", w.Code, w.Body.String())
	}
	return parseJSON(t, w.Body.Bytes())["data"].(map[string]any)["id"].(string)
}

func TestLayout_SaveAndGet(t *testing.T) {
	r, authHeader, projectID := setupLayoutTest(t, "LayoutProject")
	pkgID := createLayoutPkg(t, r, authHeader, projectID, "LayoutPkg", "package LayoutPkg {\n  part def A;\n}")

	// 1) 保存布局
	body := jsonBody(gin.H{
		"nodes": map[string]any{
			"pd:1": map[string]float64{"x": 120.5, "y": -30},
			"pd:2": map[string]float64{"x": 0, "y": 0},
		},
	})
	req := httptest.NewRequest(http.MethodPut, "/api/v1/layouts/package/"+pkgID, body)
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Authorization", authHeader)
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)
	if w.Code != http.StatusOK {
		t.Fatalf("save layout: status = %d, body = %s", w.Code, w.Body.String())
	}

	// 2) 读回
	req = httptest.NewRequest(http.MethodGet, "/api/v1/layouts/package/"+pkgID, nil)
	req.Header.Set("Authorization", authHeader)
	w = httptest.NewRecorder()
	r.ServeHTTP(w, req)
	if w.Code != http.StatusOK {
		t.Fatalf("get layout: status = %d, body = %s", w.Code, w.Body.String())
	}
	data := parseJSON(t, w.Body.Bytes())["data"].(map[string]any)
	nodes, ok := data["nodes"].(map[string]any)
	if !ok || len(nodes) != 2 {
		t.Fatalf("nodes = %v, want 2 项", data["nodes"])
	}
	n1 := nodes["pd:1"].(map[string]any)
	if n1["x"].(float64) != 120.5 || n1["y"].(float64) != -30 {
		t.Errorf("pd:1 = %v, want {120.5, -30}", n1)
	}

	// 3) 包内容 / version 不被布局保存影响（layout 是呈现辅助）
	req = httptest.NewRequest(http.MethodGet, "/api/v1/packages/"+pkgID, nil)
	req.Header.Set("Authorization", authHeader)
	w = httptest.NewRecorder()
	r.ServeHTTP(w, req)
	if w.Code != http.StatusOK {
		t.Fatalf("get package: status = %d", w.Code)
	}
	pkg := parseJSON(t, w.Body.Bytes())["data"].(map[string]any)
	if v, _ := pkg["version"].(float64); v != 1 {
		t.Errorf("package version = %v, want 1（布局保存不得 bump version）", pkg["version"])
	}
}

func TestLayout_ViewKind(t *testing.T) {
	r, authHeader, projectID := setupLayoutTest(t, "LayoutViewProject")

	body := jsonBody(gin.H{"name": "ExposeView", "content": "view ExposeView { }"})
	req := httptest.NewRequest(http.MethodPost, "/api/v1/projects/"+projectID+"/views", body)
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Authorization", authHeader)
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)
	if w.Code != http.StatusOK {
		t.Fatalf("create view: status = %d, body = %s", w.Code, w.Body.String())
	}
	viewID := parseJSON(t, w.Body.Bytes())["data"].(map[string]any)["id"].(string)

	body2 := jsonBody(gin.H{"nodes": map[string]any{"pd:x": map[string]float64{"x": 1, "y": 2}}})
	req = httptest.NewRequest(http.MethodPut, "/api/v1/layouts/view/"+viewID, body2)
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Authorization", authHeader)
	w = httptest.NewRecorder()
	r.ServeHTTP(w, req)
	if w.Code != http.StatusOK {
		t.Fatalf("save view layout: status = %d, body = %s", w.Code, w.Body.String())
	}

	req = httptest.NewRequest(http.MethodGet, "/api/v1/layouts/view/"+viewID, nil)
	req.Header.Set("Authorization", authHeader)
	w = httptest.NewRecorder()
	r.ServeHTTP(w, req)
	nodes := parseJSON(t, w.Body.Bytes())["data"].(map[string]any)["nodes"].(map[string]any)
	if len(nodes) != 1 {
		t.Fatalf("view nodes = %v, want 1 项", nodes)
	}
}

func TestLayout_RejectsUnknownKind(t *testing.T) {
	r, authHeader, _ := setupLayoutTest(t, "LayoutBadKind")
	req := httptest.NewRequest(http.MethodGet, "/api/v1/layouts/unknown/abc", nil)
	req.Header.Set("Authorization", authHeader)
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)
	if w.Code != http.StatusBadRequest {
		t.Errorf("status = %d, want 400", w.Code)
	}
}

func TestLayout_AnonymousDenied(t *testing.T) {
	r, _, _ := setupLayoutTest(t, "LayoutAnon")
	req := httptest.NewRequest(http.MethodGet, "/api/v1/layouts/package/whatever", nil)
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)
	if w.Code != http.StatusUnauthorized {
		t.Errorf("anonymous: status = %d, want 401", w.Code)
	}
}
