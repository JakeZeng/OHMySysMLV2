package handler

import (
	"bytes"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"

	"github.com/sysmlv2/mbse-backend/internal/model"
	"github.com/sysmlv2/mbse-backend/internal/repository"
)

// newLegacyUser 构造一个「老安装」遗留用户（未经安装向导创建）。
func newLegacyUser() *model.User {
	return &model.User{
		ID:           uuid.NewString(),
		Username:     "legacy",
		Email:        "legacy@example.com",
		PasswordHash: hashPassword("secret123"),
		CreatedAt:    time.Now().UTC(),
	}
}

// setupTestRouterSetup 构造只挂载 setup 路由的测试引擎。
func setupTestRouterSetup(t *testing.T, disabled bool) (*gin.Engine, *repository.SQLiteRepository) {
	t.Helper()
	repo, err := repository.New(":memory:")
	if err != nil {
		t.Fatalf("创建测试仓库失败: %v", err)
	}
	t.Cleanup(func() { repo.Close() })

	aiH := NewAIHandler()
	setupH := NewSetupHandler(repo, aiH, "test-version", disabled)

	r := gin.New()
	v1 := r.Group("/api/v1")
	v1.GET("/setup/status", setupH.Status)
	v1.POST("/setup/admin", setupH.CreateAdmin)
	v1.POST("/setup/ai", setupH.SaveAIConfig)
	v1.POST("/setup/complete", setupH.Complete)
	return r, repo
}

func doJSON(t *testing.T, r *gin.Engine, method, path string, body any) (int, map[string]any) {
	t.Helper()
	var buf bytes.Buffer
	if body != nil {
		if err := json.NewEncoder(&buf).Encode(body); err != nil {
			t.Fatalf("编码请求体失败: %v", err)
		}
	}
	req := httptest.NewRequest(method, path, &buf)
	req.Header.Set("Content-Type", "application/json")
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)

	out := map[string]any{}
	_ = json.Unmarshal(w.Body.Bytes(), &out)
	return w.Code, out
}

// TestSetupStatus_FreshInstallNeedsSetup 全新安装应报告 needsSetup=true。
func TestSetupStatus_FreshInstallNeedsSetup(t *testing.T) {
	r, _ := setupTestRouterSetup(t, false)

	code, body := doJSON(t, r, "GET", "/api/v1/setup/status", nil)
	if code != http.StatusOK {
		t.Fatalf("期望 200，得到 %d", code)
	}
	data := body["data"].(map[string]any)
	if data["needsSetup"] != true {
		t.Errorf("期望 needsSetup=true，得到 %v", data["needsSetup"])
	}
	if data["initialized"] != false {
		t.Errorf("期望 initialized=false，得到 %v", data["initialized"])
	}
	if data["version"] != "test-version" {
		t.Errorf("期望 version=test-version，得到 %v", data["version"])
	}
}

// TestSetupFlow_AdminThenComplete 完整走通引导：创建管理员 → 保存 AI → 完成。
func TestSetupFlow_AdminThenComplete(t *testing.T) {
	r, _ := setupTestRouterSetup(t, false)

	code, body := doJSON(t, r, "POST", "/api/v1/setup/admin", map[string]string{
		"username": "admin",
		"email":    "admin@example.com",
		"password": "secret123",
	})
	if code != http.StatusOK {
		t.Fatalf("创建管理员期望 200，得到 %d: %v", code, body)
	}
	data := body["data"].(map[string]any)
	if data["token"] == "" || data["token"] == nil {
		t.Error("创建管理员后应返回 token")
	}

	code, _ = doJSON(t, r, "POST", "/api/v1/setup/ai", map[string]string{
		"provider": "deepseek",
		"apiKey":   "sk-test",
		"model":    "deepseek-chat",
	})
	if code != http.StatusOK {
		t.Fatalf("保存 AI 配置期望 200，得到 %d", code)
	}

	code, _ = doJSON(t, r, "POST", "/api/v1/setup/complete", nil)
	if code != http.StatusOK {
		t.Fatalf("完成安装期望 200，得到 %d", code)
	}

	code, body = doJSON(t, r, "GET", "/api/v1/setup/status", nil)
	data = body["data"].(map[string]any)
	if data["needsSetup"] != false {
		t.Errorf("完成后 needsSetup 应为 false，得到 %v", data["needsSetup"])
	}
	if data["aiConfigured"] != true {
		t.Errorf("完成后 aiConfigured 应为 true，得到 %v", data["aiConfigured"])
	}
}

// TestSetup_AfterCompleteWritesRejected 完成后写接口应返回 409。
func TestSetup_AfterCompleteWritesRejected(t *testing.T) {
	r, _ := setupTestRouterSetup(t, false)

	doJSON(t, r, "POST", "/api/v1/setup/admin", map[string]string{
		"username": "admin",
		"email":    "admin@example.com",
		"password": "secret123",
	})
	doJSON(t, r, "POST", "/api/v1/setup/complete", nil)

	code, body := doJSON(t, r, "POST", "/api/v1/setup/admin", map[string]string{
		"username": "admin2",
		"email":    "admin2@example.com",
		"password": "secret123",
	})
	if code != http.StatusConflict {
		t.Fatalf("完成后再次创建管理员期望 409，得到 %d", code)
	}
	errObj := body["error"].(map[string]any)
	if errObj["code"] != "SETUP_ALREADY_DONE" {
		t.Errorf("期望错误码 SETUP_ALREADY_DONE，得到 %v", errObj["code"])
	}
}

// TestSetup_LegacyInstallSkipsWizard 老安装（库里已有用户、未经向导）不应被要求走引导。
func TestSetup_LegacyInstallSkipsWizard(t *testing.T) {
	r, repo := setupTestRouterSetup(t, false)

	// 模拟老安装：库里已有一个用户，但没有向导标记
	if err := repo.CreateUser(t.Context(), newLegacyUser()); err != nil {
		t.Fatalf("创建历史用户失败: %v", err)
	}

	code, body := doJSON(t, r, "GET", "/api/v1/setup/status", nil)
	if code != http.StatusOK {
		t.Fatalf("status 期望 200，得到 %d", code)
	}
	data := body["data"].(map[string]any)
	if data["needsSetup"] != false {
		t.Errorf("老安装不应要求引导，得到 needsSetup=%v", data["needsSetup"])
	}
	if data["initialized"] != true {
		t.Errorf("老安装应视为已初始化，得到 %v", data["initialized"])
	}
}

// TestSetup_Disabled 安装引导关闭后所有写接口返回 403。
func TestSetup_Disabled(t *testing.T) {
	r, _ := setupTestRouterSetup(t, true)

	code, body := doJSON(t, r, "GET", "/api/v1/setup/status", nil)
	data := body["data"].(map[string]any)
	if data["needsSetup"] != false {
		t.Errorf("SETUP_DISABLED 时 needsSetup 应为 false，得到 %v", data["needsSetup"])
	}

	code, body = doJSON(t, r, "POST", "/api/v1/setup/admin", map[string]string{
		"username": "admin",
		"email":    "admin@example.com",
		"password": "secret123",
	})
	if code != http.StatusForbidden {
		t.Fatalf("期望 403，得到 %d", code)
	}
	errObj := body["error"].(map[string]any)
	if errObj["code"] != "SETUP_DISABLED" {
		t.Errorf("期望错误码 SETUP_DISABLED，得到 %v", errObj["code"])
	}
}

// TestSetup_Validation 校验必填项。
func TestSetup_Validation(t *testing.T) {
	r, _ := setupTestRouterSetup(t, false)

	cases := []map[string]string{
		{"username": "ab", "email": "a@b.com", "password": "secret123"},
		{"username": "admin", "email": "not-an-email", "password": "secret123"},
		{"username": "admin", "email": "a@b.com", "password": "123"},
	}
	for i, c := range cases {
		code, _ := doJSON(t, r, "POST", "/api/v1/setup/admin", c)
		if code != http.StatusBadRequest {
			t.Errorf("用例 %d 期望 400，得到 %d", i, code)
		}
	}
}
