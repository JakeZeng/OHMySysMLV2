package handler

import (
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/gin-gonic/gin"
)

// ─── Packages ─────────────────────────────────────────────────────────

func TestPackagesCRUD(t *testing.T) {
	r, _ := setupTestRouter(t)
	resp := registerUser(t, r, "pkger", "pkger@example.com", "pass123456")
	token := authToken(t, resp)
	authHeader := "Bearer " + token

	// Create a project.
	body := jsonBody(gin.H{"name": "PkgProject"})
	req := httptest.NewRequest(http.MethodPost, "/api/v1/projects", body)
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Authorization", authHeader)
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)
	projectID := parseJSON(t, w.Body.Bytes())["data"].(map[string]any)["id"].(string)

	var pkgID string
	var pkgV1 float64

	t.Run("Create", func(t *testing.T) {
		body := jsonBody(gin.H{
			"name":        "Pkg1",
			"description": "顶层包",
			"content":     "package Pkg1 { part def Vehicle { } }",
			"metadata":    gin.H{"author": "alice"},
		})
		req := httptest.NewRequest(http.MethodPost, "/api/v1/projects/"+projectID+"/packages", body)
		req.Header.Set("Content-Type", "application/json")
		req.Header.Set("Authorization", authHeader)
		w := httptest.NewRecorder()
		r.ServeHTTP(w, req)
		if w.Code != http.StatusOK {
			t.Fatalf("status = %d, body = %s", w.Code, w.Body.String())
		}
		data := parseJSON(t, w.Body.Bytes())["data"].(map[string]any)
		pkgID, _ = data["id"].(string)
		pkgV1 = data["version"].(float64)
		if pkgID == "" {
			t.Fatal("empty package id")
		}
		if pkgV1 != 1 {
			t.Errorf("version = %v, want 1", pkgV1)
		}
	})

	t.Run("Get", func(t *testing.T) {
		req := httptest.NewRequest(http.MethodGet, "/api/v1/packages/"+pkgID, nil)
		req.Header.Set("Authorization", authHeader)
		w := httptest.NewRecorder()
		r.ServeHTTP(w, req)
		if w.Code != http.StatusOK {
			t.Fatalf("status = %d", w.Code)
		}
		data := parseJSON(t, w.Body.Bytes())["data"].(map[string]any)
		if data["name"] != "Pkg1" {
			t.Errorf("name = %v, want Pkg1", data["name"])
		}
		if data["content"] != "package Pkg1 { part def Vehicle { } }" {
			t.Errorf("content mismatch")
		}
	})

	t.Run("List", func(t *testing.T) {
		req := httptest.NewRequest(http.MethodGet, "/api/v1/projects/"+projectID+"/packages", nil)
		req.Header.Set("Authorization", authHeader)
		w := httptest.NewRecorder()
		r.ServeHTTP(w, req)
		if w.Code != http.StatusOK {
			t.Fatalf("status = %d", w.Code)
		}
		list := parseJSON(t, w.Body.Bytes())["data"].([]any)
		if len(list) != 1 {
			t.Errorf("len = %d, want 1", len(list))
		}
	})

	t.Run("Update", func(t *testing.T) {
		body := jsonBody(gin.H{
			"name":        "Pkg1-renamed",
			"description": "updated",
			"content":     "package Pkg1 { part def Vehicle; part def Wheel; }",
			"version":     int(pkgV1),
		})
		req := httptest.NewRequest(http.MethodPut, "/api/v1/packages/"+pkgID, body)
		req.Header.Set("Content-Type", "application/json")
		req.Header.Set("Authorization", authHeader)
		w := httptest.NewRecorder()
		r.ServeHTTP(w, req)
		if w.Code != http.StatusOK {
			t.Fatalf("status = %d, body = %s", w.Code, w.Body.String())
		}
		data := parseJSON(t, w.Body.Bytes())["data"].(map[string]any)
		if data["name"] != "Pkg1-renamed" {
			t.Errorf("name = %v, want Pkg1-renamed", data["name"])
		}
		if data["version"].(float64) != 2 {
			t.Errorf("version = %v, want 2", data["version"])
		}
	})

	t.Run("Update_VersionConflict", func(t *testing.T) {
		body := jsonBody(gin.H{"name": "stale", "content": "x", "version": 1})
		req := httptest.NewRequest(http.MethodPut, "/api/v1/packages/"+pkgID, body)
		req.Header.Set("Content-Type", "application/json")
		req.Header.Set("Authorization", authHeader)
		w := httptest.NewRecorder()
		r.ServeHTTP(w, req)
		if w.Code != http.StatusConflict {
			t.Errorf("status = %d, want 409", w.Code)
		}
	})

	t.Run("Create_DuplicateName", func(t *testing.T) {
		body := jsonBody(gin.H{"name": "Pkg1-renamed", "content": "y"})
		req := httptest.NewRequest(http.MethodPost, "/api/v1/projects/"+projectID+"/packages", body)
		req.Header.Set("Content-Type", "application/json")
		req.Header.Set("Authorization", authHeader)
		w := httptest.NewRecorder()
		r.ServeHTTP(w, req)
		if w.Code != http.StatusConflict {
			t.Errorf("status = %d, want 409", w.Code)
		}
		errObj := parseJSON(t, w.Body.Bytes())["error"].(map[string]any)
		if errObj["code"] != "E_PACKAGE_NAME_CONFLICT" {
			t.Errorf("code = %v, want E_PACKAGE_NAME_CONFLICT", errObj["code"])
		}
	})

	t.Run("Delete", func(t *testing.T) {
		req := httptest.NewRequest(http.MethodDelete, "/api/v1/packages/"+pkgID, nil)
		req.Header.Set("Authorization", authHeader)
		w := httptest.NewRecorder()
		r.ServeHTTP(w, req)
		if w.Code != http.StatusOK {
			t.Fatalf("status = %d, body = %s", w.Code, w.Body.String())
		}
	})
}

func TestPackagesAuth(t *testing.T) {
	r, _ := setupTestRouter(t)

	// Create owner + project
	resp := registerUser(t, r, "owner", "owner@example.com", "pass123456")
	token := authToken(t, resp)
	authHeader := "Bearer " + token

	body := jsonBody(gin.H{"name": "AuthProj"})
	req := httptest.NewRequest(http.MethodPost, "/api/v1/projects", body)
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Authorization", authHeader)
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)
	projectID := parseJSON(t, w.Body.Bytes())["data"].(map[string]any)["id"].(string)

	// Anonymous GET should be denied (no Authorization header)
	req = httptest.NewRequest(http.MethodGet, "/api/v1/projects/"+projectID+"/packages", nil)
	w = httptest.NewRecorder()
	r.ServeHTTP(w, req)
	if w.Code != http.StatusUnauthorized {
		t.Errorf("anonymous list: status = %d, want 401", w.Code)
	}

	// Other user has no access
	resp2 := registerUser(t, r, "outsider", "outsider@example.com", "pass123456")
	otherToken := authToken(t, resp2)
	req = httptest.NewRequest(http.MethodGet, "/api/v1/projects/"+projectID+"/packages", nil)
	req.Header.Set("Authorization", "Bearer "+otherToken)
	w = httptest.NewRecorder()
	r.ServeHTTP(w, req)
	if w.Code != http.StatusForbidden {
		t.Errorf("outsider list: status = %d, want 403", w.Code)
	}
}

// ─── Views ────────────────────────────────────────────────────────────

func TestViewsCRUD(t *testing.T) {
	r, _ := setupTestRouter(t)
	resp := registerUser(t, r, "viewer", "viewer@example.com", "pass123456")
	token := authToken(t, resp)
	authHeader := "Bearer " + token

	// Project
	body := jsonBody(gin.H{"name": "ViewProject"})
	req := httptest.NewRequest(http.MethodPost, "/api/v1/projects", body)
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Authorization", authHeader)
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)
	projectID := parseJSON(t, w.Body.Bytes())["data"].(map[string]any)["id"].(string)

	var viewID string
	var viewV1 float64

	// M15：测试 view expose resolve 校验 — 需要先创建包 Pkg1 让路径合法
	t.Run("Setup_Pkg1", func(t *testing.T) {
		body := jsonBody(gin.H{
			"name":    "Pkg1",
			"content": "package Pkg1 { part def Vehicle; }",
		})
		req := httptest.NewRequest(http.MethodPost, "/api/v1/projects/"+projectID+"/packages", body)
		req.Header.Set("Content-Type", "application/json")
		req.Header.Set("Authorization", authHeader)
		w := httptest.NewRecorder()
		r.ServeHTTP(w, req)
		if w.Code != http.StatusOK {
			t.Fatalf("setup Pkg1 failed: status = %d, body = %s", w.Code, w.Body.String())
		}
	})

	t.Run("Create", func(t *testing.T) {
		body := jsonBody(gin.H{
			"name":              "StructuralView",
			"description":       "结构视图",
			"content":           "view V { expose Pkg1::Vehicle; }",
			"colorTag":          "#3b82f6",
			"renderingCategory": "structure",
		})
		req := httptest.NewRequest(http.MethodPost, "/api/v1/projects/"+projectID+"/views", body)
		req.Header.Set("Content-Type", "application/json")
		req.Header.Set("Authorization", authHeader)
		w := httptest.NewRecorder()
		r.ServeHTTP(w, req)
		if w.Code != http.StatusOK {
			t.Fatalf("status = %d, body = %s", w.Code, w.Body.String())
		}
		data := parseJSON(t, w.Body.Bytes())["data"].(map[string]any)
		viewID, _ = data["id"].(string)
		viewV1 = data["version"].(float64)
		// exposedElements 解析缓存应包含 Pkg1::Vehicle
		exposed, _ := data["exposedElements"].([]any)
		if len(exposed) != 1 {
			t.Errorf("exposedElements len = %d, want 1", len(exposed))
		} else if exposed[0].(map[string]any)["qualifiedName"] != "Pkg1::Vehicle" {
			t.Errorf("exposedElements[0].qualifiedName = %v, want Pkg1::Vehicle",
				exposed[0].(map[string]any)["qualifiedName"])
		}
	})

	t.Run("Get", func(t *testing.T) {
		req := httptest.NewRequest(http.MethodGet, "/api/v1/views/"+viewID, nil)
		req.Header.Set("Authorization", authHeader)
		w := httptest.NewRecorder()
		r.ServeHTTP(w, req)
		if w.Code != http.StatusOK {
			t.Fatalf("status = %d", w.Code)
		}
		data := parseJSON(t, w.Body.Bytes())["data"].(map[string]any)
		if data["name"] != "StructuralView" {
			t.Errorf("name = %v", data["name"])
		}
		if data["colorTag"] != "#3b82f6" {
			t.Errorf("colorTag = %v", data["colorTag"])
		}
	})

	t.Run("Update_RecomputesExposed", func(t *testing.T) {
		body := jsonBody(gin.H{
			"name":    "V2",
			"content": "view V2 { expose Pkg1::A; expose Pkg1::B; }",
			"version": int(viewV1),
		})
		req := httptest.NewRequest(http.MethodPut, "/api/v1/views/"+viewID, body)
		req.Header.Set("Content-Type", "application/json")
		req.Header.Set("Authorization", authHeader)
		w := httptest.NewRecorder()
		r.ServeHTTP(w, req)
		if w.Code != http.StatusOK {
			t.Fatalf("status = %d, body = %s", w.Code, w.Body.String())
		}
		data := parseJSON(t, w.Body.Bytes())["data"].(map[string]any)
		exposed, _ := data["exposedElements"].([]any)
		if len(exposed) != 2 {
			t.Errorf("after update exposedElements len = %d, want 2", len(exposed))
		}
		if data["version"].(float64) != 2 {
			t.Errorf("version = %v, want 2", data["version"])
		}
	})

	t.Run("Delete", func(t *testing.T) {
		req := httptest.NewRequest(http.MethodDelete, "/api/v1/views/"+viewID, nil)
		req.Header.Set("Authorization", authHeader)
		w := httptest.NewRecorder()
		r.ServeHTTP(w, req)
		if w.Code != http.StatusOK {
			t.Fatalf("status = %d", w.Code)
		}
	})
}

func TestViewsAuth(t *testing.T) {
	r, _ := setupTestRouter(t)

	resp := registerUser(t, r, "view-owner", "view-owner@example.com", "pass123456")
	token := authToken(t, resp)
	authHeader := "Bearer " + token

	body := jsonBody(gin.H{"name": "ViewAuthProj"})
	req := httptest.NewRequest(http.MethodPost, "/api/v1/projects", body)
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Authorization", authHeader)
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)
	projectID := parseJSON(t, w.Body.Bytes())["data"].(map[string]any)["id"].(string)

	// Anonymous denied
	req = httptest.NewRequest(http.MethodGet, "/api/v1/projects/"+projectID+"/views", nil)
	w = httptest.NewRecorder()
	r.ServeHTTP(w, req)
	if w.Code != http.StatusUnauthorized {
		t.Errorf("anonymous list: status = %d, want 401", w.Code)
	}
}

// ─── Viewpoints（M15）───────────────────────────────────

func TestViewpointsCRUD(t *testing.T) {
	r, _ := setupTestRouter(t)
	resp := registerUser(t, r, "vp-user", "vp@example.com", "pass123456")
	token := authToken(t, resp)
	authHeader := "Bearer " + token

	// Project
	body := jsonBody(gin.H{"name": "ViewpointProject"})
	req := httptest.NewRequest(http.MethodPost, "/api/v1/projects", body)
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Authorization", authHeader)
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)
	projectID := parseJSON(t, w.Body.Bytes())["data"].(map[string]any)["id"].(string)

	var vpID string
	var vpV1 float64

	t.Run("Create", func(t *testing.T) {
		body := jsonBody(gin.H{
			"name":        "StakeholderView",
			"description": "利益相关方关注点",
			"content":     "viewpoint StakeholderView { concern: 整车结构; }",
			"stakeholder": "SafetyEngineer",
			"concern":     "整车结构 + 失效模式",
		})
		req := httptest.NewRequest(http.MethodPost, "/api/v1/projects/"+projectID+"/viewpoints", body)
		req.Header.Set("Content-Type", "application/json")
		req.Header.Set("Authorization", authHeader)
		w := httptest.NewRecorder()
		r.ServeHTTP(w, req)
		if w.Code != http.StatusOK {
			t.Fatalf("status = %d, body = %s", w.Code, w.Body.String())
		}
		data := parseJSON(t, w.Body.Bytes())["data"].(map[string]any)
		vpID, _ = data["id"].(string)
		vpV1 = data["version"].(float64)
		if vpID == "" {
			t.Fatal("empty viewpoint id")
		}
		if vpV1 != 1 {
			t.Errorf("version = %v, want 1", vpV1)
		}
		if data["stakeholder"] != "SafetyEngineer" {
			t.Errorf("stakeholder = %v, want SafetyEngineer", data["stakeholder"])
		}
		if data["concern"] != "整车结构 + 失效模式" {
			t.Errorf("concern = %v", data["concern"])
		}
	})

	t.Run("Get", func(t *testing.T) {
		req := httptest.NewRequest(http.MethodGet, "/api/v1/viewpoints/"+vpID, nil)
		req.Header.Set("Authorization", authHeader)
		w := httptest.NewRecorder()
		r.ServeHTTP(w, req)
		if w.Code != http.StatusOK {
			t.Fatalf("status = %d", w.Code)
		}
		data := parseJSON(t, w.Body.Bytes())["data"].(map[string]any)
		if data["name"] != "StakeholderView" {
			t.Errorf("name = %v", data["name"])
		}
	})

	t.Run("List", func(t *testing.T) {
		req := httptest.NewRequest(http.MethodGet, "/api/v1/projects/"+projectID+"/viewpoints", nil)
		req.Header.Set("Authorization", authHeader)
		w := httptest.NewRecorder()
		r.ServeHTTP(w, req)
		if w.Code != http.StatusOK {
			t.Fatalf("status = %d", w.Code)
		}
		list := parseJSON(t, w.Body.Bytes())["data"].([]any)
		if len(list) != 1 {
			t.Errorf("len = %d, want 1", len(list))
		}
	})

	t.Run("Update", func(t *testing.T) {
		body := jsonBody(gin.H{
			"name":        "SafetyView",
			"description": "更新后的视角",
			"content":     "viewpoint SafetyView { concern: 安全; }",
			"stakeholder": "SafetyOfficer",
			"concern":     "功能安全",
			"version":     int(vpV1),
		})
		req := httptest.NewRequest(http.MethodPut, "/api/v1/viewpoints/"+vpID, body)
		req.Header.Set("Content-Type", "application/json")
		req.Header.Set("Authorization", authHeader)
		w := httptest.NewRecorder()
		r.ServeHTTP(w, req)
		if w.Code != http.StatusOK {
			t.Fatalf("status = %d, body = %s", w.Code, w.Body.String())
		}
		data := parseJSON(t, w.Body.Bytes())["data"].(map[string]any)
		if data["version"].(float64) != 2 {
			t.Errorf("version = %v, want 2", data["version"])
		}
		if data["stakeholder"] != "SafetyOfficer" {
			t.Errorf("stakeholder = %v, want SafetyOfficer", data["stakeholder"])
		}
	})

	t.Run("Update_VersionConflict", func(t *testing.T) {
		body := jsonBody(gin.H{"name": "stale", "content": "x", "version": 1})
		req := httptest.NewRequest(http.MethodPut, "/api/v1/viewpoints/"+vpID, body)
		req.Header.Set("Content-Type", "application/json")
		req.Header.Set("Authorization", authHeader)
		w := httptest.NewRecorder()
		r.ServeHTTP(w, req)
		if w.Code != http.StatusConflict {
			t.Errorf("status = %d, want 409", w.Code)
		}
	})

	t.Run("Delete", func(t *testing.T) {
		req := httptest.NewRequest(http.MethodDelete, "/api/v1/viewpoints/"+vpID, nil)
		req.Header.Set("Authorization", authHeader)
		w := httptest.NewRecorder()
		r.ServeHTTP(w, req)
		if w.Code != http.StatusOK {
			t.Fatalf("status = %d, body = %s", w.Code, w.Body.String())
		}
	})
}

func TestViewpointsAuth(t *testing.T) {
	r, _ := setupTestRouter(t)
	resp := registerUser(t, r, "vp-owner", "vp-owner@example.com", "pass123456")
	token := authToken(t, resp)
	authHeader := "Bearer " + token

	body := jsonBody(gin.H{"name": "ViewpointAuthProj"})
	req := httptest.NewRequest(http.MethodPost, "/api/v1/projects", body)
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Authorization", authHeader)
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)
	projectID := parseJSON(t, w.Body.Bytes())["data"].(map[string]any)["id"].(string)

	// Anonymous denied
	req = httptest.NewRequest(http.MethodGet, "/api/v1/projects/"+projectID+"/viewpoints", nil)
	w = httptest.NewRecorder()
	r.ServeHTTP(w, req)
	if w.Code != http.StatusUnauthorized {
		t.Errorf("anonymous list: status = %d, want 401", w.Code)
	}
}
