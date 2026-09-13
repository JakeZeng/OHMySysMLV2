package handler

import (
	"bytes"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/gin-gonic/gin"

	"github.com/sysmlv2/mbse-backend/internal/middleware"
	"github.com/sysmlv2/mbse-backend/internal/repository"
)

func init() {
	gin.SetMode(gin.TestMode)
}

// ─── Test helpers ───────────────────────────────────────────────────

// setupTestRouter creates a fresh in-memory repo, handler, and gin engine
// wired identically to the production routes.
func setupTestRouter(t *testing.T) (*gin.Engine, *repository.SQLiteRepository) {
	t.Helper()
	repo, err := repository.New(":memory:")
	if err != nil {
		t.Fatalf("failed to create test repo: %v", err)
	}
	t.Cleanup(func() { repo.Close() })

	h := New(repo)
	r := gin.New()

	r.GET("/health", h.Health)

	v1 := r.Group("/api/v1")
	v1.POST("/auth/register", h.Register)
	v1.POST("/auth/login", h.Login)

	projects := v1.Group("/projects")
	projects.Use(middleware.AuthRequired())
	{
		projects.GET("", h.ListProjects)
		projects.POST("", h.CreateProject)
		projects.GET("/:id", h.GetProject)
		projects.PUT("/:id", h.UpdateProject)
		projects.DELETE("/:id", h.DeleteProject)

		projects.GET("/:id/models", h.ListModelsByProject)
		projects.POST("/:id/models", h.CreateModelInProject)
		projects.GET("/:id/models/:modelId", h.GetModel)
		projects.PUT("/:id/models/:modelId", h.UpdateModel)
		projects.DELETE("/:id/models/:modelId", h.DeleteModel)
	}

	models := v1.Group("/models")
	models.Use(middleware.AuthRequired())
	{
		models.GET("", h.ListModels)
		models.POST("", h.CreateModel)
		models.GET("/:id", h.GetModel)
		models.PUT("/:id", h.UpdateModel)
		models.DELETE("/:id", h.DeleteModel)
	}

	return r, repo
}

// registerUser hits POST /auth/register and returns the raw response map.
func registerUser(t *testing.T, r *gin.Engine, username, email, password string) map[string]any {
	t.Helper()
	body, _ := json.Marshal(gin.H{
		"username": username,
		"email":    email,
		"password": password,
	})
	req := httptest.NewRequest(http.MethodPost, "/api/v1/auth/register", bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)
	if w.Code != http.StatusOK {
		t.Fatalf("register failed: status=%d body=%s", w.Code, w.Body.String())
	}
	return parseJSON(t, w.Body.Bytes())
}

// authToken extracts the token string from a register/login response.
func authToken(t *testing.T, resp map[string]any) string {
	t.Helper()
	data, ok := resp["data"].(map[string]any)
	if !ok {
		t.Fatalf("response data is not a map: %v", resp["data"])
	}
	tok, _ := data["token"].(string)
	if tok == "" {
		t.Fatal("token is empty in response")
	}
	return tok
}

// parseJSON unmarshals a JSON body into a generic map.
func parseJSON(t *testing.T, b []byte) map[string]any {
	t.Helper()
	var m map[string]any
	if err := json.Unmarshal(b, &m); err != nil {
		t.Fatalf("json.Unmarshal: %v", err)
	}
	return m
}

// jsonBody is a shortcut for building a JSON request body.
func jsonBody(v any) *bytes.Buffer {
	b, _ := json.Marshal(v)
	return bytes.NewBuffer(b)
}

// ─── Register ───────────────────────────────────────────────────────

func TestRegister(t *testing.T) {
	t.Run("Success", func(t *testing.T) {
		r, _ := setupTestRouter(t)
		resp := registerUser(t, r, "alice", "alice@example.com", "password123")
		tok := authToken(t, resp)
		if tok == "" {
			t.Error("expected non-empty token")
		}

		data := resp["data"].(map[string]any)
		user := data["user"].(map[string]any)
		if user["username"] != "alice" {
			t.Errorf("username = %v, want alice", user["username"])
		}
		if user["email"] != "alice@example.com" {
			t.Errorf("email = %v, want alice@example.com", user["email"])
		}
	})

	t.Run("DuplicateUsername", func(t *testing.T) {
		r, _ := setupTestRouter(t)
		registerUser(t, r, "bob", "bob@example.com", "password123")

		body, _ := json.Marshal(gin.H{
			"username": "bob", "email": "bob2@example.com", "password": "password123",
		})
		req := httptest.NewRequest(http.MethodPost, "/api/v1/auth/register", bytes.NewReader(body))
		req.Header.Set("Content-Type", "application/json")
		w := httptest.NewRecorder()
		r.ServeHTTP(w, req)

		if w.Code != http.StatusBadRequest {
			t.Errorf("status = %d, want %d", w.Code, http.StatusBadRequest)
		}
		resp := parseJSON(t, w.Body.Bytes())
		errObj := resp["error"].(map[string]any)
		if errObj["code"] != "E_BAD_REQUEST" {
			t.Errorf("error code = %v, want E_BAD_REQUEST", errObj["code"])
		}
	})

	t.Run("DuplicateEmail", func(t *testing.T) {
		r, _ := setupTestRouter(t)
		registerUser(t, r, "carol", "carol@example.com", "password123")

		body, _ := json.Marshal(gin.H{
			"username": "dave", "email": "carol@example.com", "password": "password123",
		})
		req := httptest.NewRequest(http.MethodPost, "/api/v1/auth/register", bytes.NewReader(body))
		req.Header.Set("Content-Type", "application/json")
		w := httptest.NewRecorder()
		r.ServeHTTP(w, req)

		if w.Code != http.StatusBadRequest {
			t.Errorf("status = %d, want %d", w.Code, http.StatusBadRequest)
		}
	})

	t.Run("InvalidInput", func(t *testing.T) {
		r, _ := setupTestRouter(t)
		// Missing required fields.
		body := bytes.NewBufferString(`{"username":"ab"}`)
		req := httptest.NewRequest(http.MethodPost, "/api/v1/auth/register", body)
		req.Header.Set("Content-Type", "application/json")
		w := httptest.NewRecorder()
		r.ServeHTTP(w, req)

		if w.Code != http.StatusBadRequest {
			t.Errorf("status = %d, want %d", w.Code, http.StatusBadRequest)
		}
	})
}

// ─── Login ──────────────────────────────────────────────────────────

func TestLogin(t *testing.T) {
	t.Run("Success", func(t *testing.T) {
		r, _ := setupTestRouter(t)
		registerUser(t, r, "alice", "alice@example.com", "secret123")

		body, _ := json.Marshal(gin.H{"username": "alice", "password": "secret123"})
		req := httptest.NewRequest(http.MethodPost, "/api/v1/auth/login", bytes.NewReader(body))
		req.Header.Set("Content-Type", "application/json")
		w := httptest.NewRecorder()
		r.ServeHTTP(w, req)

		if w.Code != http.StatusOK {
			t.Errorf("status = %d, want %d", w.Code, http.StatusOK)
		}
		tok := authToken(t, parseJSON(t, w.Body.Bytes()))
		if tok == "" {
			t.Error("expected non-empty token")
		}
	})

	t.Run("WrongPassword", func(t *testing.T) {
		r, _ := setupTestRouter(t)
		registerUser(t, r, "bob", "bob@example.com", "correct")

		body, _ := json.Marshal(gin.H{"username": "bob", "password": "wrong"})
		req := httptest.NewRequest(http.MethodPost, "/api/v1/auth/login", bytes.NewReader(body))
		req.Header.Set("Content-Type", "application/json")
		w := httptest.NewRecorder()
		r.ServeHTTP(w, req)

		if w.Code != http.StatusBadRequest {
			t.Errorf("status = %d, want %d", w.Code, http.StatusBadRequest)
		}
	})

	t.Run("UnknownUser", func(t *testing.T) {
		r, _ := setupTestRouter(t)
		body, _ := json.Marshal(gin.H{"username": "ghost", "password": "x"})
		req := httptest.NewRequest(http.MethodPost, "/api/v1/auth/login", bytes.NewReader(body))
		req.Header.Set("Content-Type", "application/json")
		w := httptest.NewRecorder()
		r.ServeHTTP(w, req)

		if w.Code != http.StatusBadRequest {
			t.Errorf("status = %d, want %d", w.Code, http.StatusBadRequest)
		}
	})
}

// ─── Projects CRUD ──────────────────────────────────────────────────

func TestProjectsCRUD(t *testing.T) {
	r, _ := setupTestRouter(t)
	resp := registerUser(t, r, "owner", "owner@example.com", "pass123456")
	token := authToken(t, resp)

	authHeader := "Bearer " + token

	t.Run("Create", func(t *testing.T) {
		body := jsonBody(gin.H{"name": "ProjectA", "description": "desc A"})
		req := httptest.NewRequest(http.MethodPost, "/api/v1/projects", body)
		req.Header.Set("Content-Type", "application/json")
		req.Header.Set("Authorization", authHeader)
		w := httptest.NewRecorder()
		r.ServeHTTP(w, req)

		if w.Code != http.StatusOK {
			t.Fatalf("status = %d, body = %s", w.Code, w.Body.String())
		}
		resp := parseJSON(t, w.Body.Bytes())
		data := resp["data"].(map[string]any)
		if data["name"] != "ProjectA" {
			t.Errorf("name = %v, want ProjectA", data["name"])
		}
		if data["ownerId"] == nil || data["ownerId"] == "" {
			t.Error("ownerId should be set")
		}
	})

	t.Run("Get", func(t *testing.T) {
		// List to find the project ID.
		req := httptest.NewRequest(http.MethodGet, "/api/v1/projects", nil)
		req.Header.Set("Authorization", authHeader)
		w := httptest.NewRecorder()
		r.ServeHTTP(w, req)

		if w.Code != http.StatusOK {
			t.Fatalf("list status = %d", w.Code)
		}
		listResp := parseJSON(t, w.Body.Bytes())
		projects := listResp["data"].([]any)
		if len(projects) != 1 {
			t.Fatalf("expected 1 project, got %d", len(projects))
		}
		projID := projects[0].(map[string]any)["id"].(string)

		// Get by ID.
		req = httptest.NewRequest(http.MethodGet, "/api/v1/projects/"+projID, nil)
		req.Header.Set("Authorization", authHeader)
		w = httptest.NewRecorder()
		r.ServeHTTP(w, req)

		if w.Code != http.StatusOK {
			t.Fatalf("get status = %d, body = %s", w.Code, w.Body.String())
		}
		getResp := parseJSON(t, w.Body.Bytes())
		data := getResp["data"].(map[string]any)
		if data["name"] != "ProjectA" {
			t.Errorf("name = %v, want ProjectA", data["name"])
		}
	})

	t.Run("List", func(t *testing.T) {
		req := httptest.NewRequest(http.MethodGet, "/api/v1/projects", nil)
		req.Header.Set("Authorization", authHeader)
		w := httptest.NewRecorder()
		r.ServeHTTP(w, req)

		if w.Code != http.StatusOK {
			t.Fatalf("status = %d", w.Code)
		}
		resp := parseJSON(t, w.Body.Bytes())
		projects := resp["data"].([]any)
		if len(projects) < 1 {
			t.Errorf("expected at least 1 project, got %d", len(projects))
		}
	})

	t.Run("Update", func(t *testing.T) {
		// Get existing project ID.
		req := httptest.NewRequest(http.MethodGet, "/api/v1/projects", nil)
		req.Header.Set("Authorization", authHeader)
		w := httptest.NewRecorder()
		r.ServeHTTP(w, req)
		projects := parseJSON(t, w.Body.Bytes())["data"].([]any)
		projID := projects[0].(map[string]any)["id"].(string)

		body := jsonBody(gin.H{"name": "ProjectA-v2", "description": "updated"})
		req = httptest.NewRequest(http.MethodPut, "/api/v1/projects/"+projID, body)
		req.Header.Set("Content-Type", "application/json")
		req.Header.Set("Authorization", authHeader)
		w = httptest.NewRecorder()
		r.ServeHTTP(w, req)

		if w.Code != http.StatusOK {
			t.Fatalf("update status = %d, body = %s", w.Code, w.Body.String())
		}
		data := parseJSON(t, w.Body.Bytes())["data"].(map[string]any)
		if data["name"] != "ProjectA-v2" {
			t.Errorf("name = %v, want ProjectA-v2", data["name"])
		}
	})

	t.Run("Delete", func(t *testing.T) {
		// Get existing project ID.
		req := httptest.NewRequest(http.MethodGet, "/api/v1/projects", nil)
		req.Header.Set("Authorization", authHeader)
		w := httptest.NewRecorder()
		r.ServeHTTP(w, req)
		projects := parseJSON(t, w.Body.Bytes())["data"].([]any)
		projID := projects[0].(map[string]any)["id"].(string)

		req = httptest.NewRequest(http.MethodDelete, "/api/v1/projects/"+projID, nil)
		req.Header.Set("Authorization", authHeader)
		w = httptest.NewRecorder()
		r.ServeHTTP(w, req)

		if w.Code != http.StatusOK {
			t.Fatalf("delete status = %d, body = %s", w.Code, w.Body.String())
		}

		// Verify it's gone.
		req = httptest.NewRequest(http.MethodGet, "/api/v1/projects/"+projID, nil)
		req.Header.Set("Authorization", authHeader)
		w = httptest.NewRecorder()
		r.ServeHTTP(w, req)
		if w.Code != http.StatusNotFound {
			t.Errorf("get after delete: status = %d, want %d", w.Code, http.StatusNotFound)
		}
	})

	t.Run("Get_NotFound", func(t *testing.T) {
		req := httptest.NewRequest(http.MethodGet, "/api/v1/projects/nonexistent", nil)
		req.Header.Set("Authorization", authHeader)
		w := httptest.NewRecorder()
		r.ServeHTTP(w, req)
		if w.Code != http.StatusNotFound {
			t.Errorf("status = %d, want %d", w.Code, http.StatusNotFound)
		}
	})

	t.Run("Unauthorized", func(t *testing.T) {
		req := httptest.NewRequest(http.MethodGet, "/api/v1/projects", nil)
		w := httptest.NewRecorder()
		r.ServeHTTP(w, req)
		if w.Code != http.StatusUnauthorized {
			t.Errorf("status = %d, want %d", w.Code, http.StatusUnauthorized)
		}
	})
}

// ─── Models CRUD ────────────────────────────────────────────────────

func TestModelsCRUD(t *testing.T) {
	r, _ := setupTestRouter(t)
	resp := registerUser(t, r, "modeler", "modeler@example.com", "pass123456")
	token := authToken(t, resp)
	authHeader := "Bearer " + token

	// Create a project to hold models.
	body := jsonBody(gin.H{"name": "ModelProject", "description": ""})
	req := httptest.NewRequest(http.MethodPost, "/api/v1/projects", body)
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Authorization", authHeader)
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)
	if w.Code != http.StatusOK {
		t.Fatalf("create project: status = %d, body = %s", w.Code, w.Body.String())
	}
	projectID := parseJSON(t, w.Body.Bytes())["data"].(map[string]any)["id"].(string)

	var modelID string

	t.Run("Create", func(t *testing.T) {
		body := jsonBody(gin.H{
			"projectId": projectID,
			"name":      "Block1",
			"content":   "part def Block1;",
		})
		req := httptest.NewRequest(http.MethodPost, "/api/v1/models", body)
		req.Header.Set("Content-Type", "application/json")
		req.Header.Set("Authorization", authHeader)
		w := httptest.NewRecorder()
		r.ServeHTTP(w, req)

		if w.Code != http.StatusOK {
			t.Fatalf("status = %d, body = %s", w.Code, w.Body.String())
		}
		data := parseJSON(t, w.Body.Bytes())["data"].(map[string]any)
		modelID, _ = data["id"].(string)
		if modelID == "" {
			t.Fatal("expected non-empty model ID")
		}
		if data["version"].(float64) != 1 {
			t.Errorf("version = %v, want 1", data["version"])
		}
	})

	t.Run("Get", func(t *testing.T) {
		req := httptest.NewRequest(http.MethodGet, "/api/v1/models/"+modelID, nil)
		req.Header.Set("Authorization", authHeader)
		w := httptest.NewRecorder()
		r.ServeHTTP(w, req)

		if w.Code != http.StatusOK {
			t.Fatalf("status = %d, body = %s", w.Code, w.Body.String())
		}
		data := parseJSON(t, w.Body.Bytes())["data"].(map[string]any)
		if data["name"] != "Block1" {
			t.Errorf("name = %v, want Block1", data["name"])
		}
	})

	t.Run("List", func(t *testing.T) {
		req := httptest.NewRequest(http.MethodGet, "/api/v1/models?projectId="+projectID, nil)
		req.Header.Set("Authorization", authHeader)
		w := httptest.NewRecorder()
		r.ServeHTTP(w, req)

		if w.Code != http.StatusOK {
			t.Fatalf("status = %d", w.Code)
		}
		models := parseJSON(t, w.Body.Bytes())["data"].([]any)
		if len(models) != 1 {
			t.Errorf("len = %d, want 1", len(models))
		}
	})

	t.Run("List_MissingProjectId", func(t *testing.T) {
		req := httptest.NewRequest(http.MethodGet, "/api/v1/models", nil)
		req.Header.Set("Authorization", authHeader)
		w := httptest.NewRecorder()
		r.ServeHTTP(w, req)

		if w.Code != http.StatusBadRequest {
			t.Errorf("status = %d, want %d", w.Code, http.StatusBadRequest)
		}
	})

	t.Run("Update", func(t *testing.T) {
		body := jsonBody(gin.H{
			"name":    "Block1-v2",
			"content": "part def Block1 { attr x: Real; }",
			"version": 1,
		})
		req := httptest.NewRequest(http.MethodPut, "/api/v1/models/"+modelID, body)
		req.Header.Set("Content-Type", "application/json")
		req.Header.Set("Authorization", authHeader)
		w := httptest.NewRecorder()
		r.ServeHTTP(w, req)

		if w.Code != http.StatusOK {
			t.Fatalf("status = %d, body = %s", w.Code, w.Body.String())
		}
		data := parseJSON(t, w.Body.Bytes())["data"].(map[string]any)
		if data["name"] != "Block1-v2" {
			t.Errorf("name = %v, want Block1-v2", data["name"])
		}
		// After successful update the version should have bumped to 2.
		if data["version"].(float64) != 2 {
			t.Errorf("version = %v, want 2", data["version"])
		}
	})

	t.Run("Update_VersionConflict", func(t *testing.T) {
		// Try updating with the stale version=1 (DB is now at version 2).
		body := jsonBody(gin.H{
			"name":    "Block1-conflict",
			"content": "should not stick",
			"version": 1,
		})
		req := httptest.NewRequest(http.MethodPut, "/api/v1/models/"+modelID, body)
		req.Header.Set("Content-Type", "application/json")
		req.Header.Set("Authorization", authHeader)
		w := httptest.NewRecorder()
		r.ServeHTTP(w, req)

		if w.Code != http.StatusConflict {
			t.Errorf("status = %d, want %d", w.Code, http.StatusConflict)
		}
		errResp := parseJSON(t, w.Body.Bytes())
		errObj := errResp["error"].(map[string]any)
		if errObj["code"] != "E_VERSION_CONFLICT" {
			t.Errorf("error code = %v, want E_VERSION_CONFLICT", errObj["code"])
		}
	})

	t.Run("Update_NotFound", func(t *testing.T) {
		body := jsonBody(gin.H{"name": "x", "content": "", "version": 1})
		req := httptest.NewRequest(http.MethodPut, "/api/v1/models/nonexistent", body)
		req.Header.Set("Content-Type", "application/json")
		req.Header.Set("Authorization", authHeader)
		w := httptest.NewRecorder()
		r.ServeHTTP(w, req)

		if w.Code != http.StatusNotFound {
			t.Errorf("status = %d, want %d", w.Code, http.StatusNotFound)
		}
	})

	t.Run("Delete", func(t *testing.T) {
		req := httptest.NewRequest(http.MethodDelete, "/api/v1/models/"+modelID, nil)
		req.Header.Set("Authorization", authHeader)
		w := httptest.NewRecorder()
		r.ServeHTTP(w, req)

		if w.Code != http.StatusOK {
			t.Fatalf("delete status = %d, body = %s", w.Code, w.Body.String())
		}

		// Verify gone.
		req = httptest.NewRequest(http.MethodGet, "/api/v1/models/"+modelID, nil)
		req.Header.Set("Authorization", authHeader)
		w = httptest.NewRecorder()
		r.ServeHTTP(w, req)
		if w.Code != http.StatusNotFound {
			t.Errorf("get after delete: status = %d, want %d", w.Code, http.StatusNotFound)
		}
	})

	t.Run("CreateModelInProject", func(t *testing.T) {
		body := jsonBody(gin.H{"name": "NestedModel", "content": "part def N;"})
		url := fmt.Sprintf("/api/v1/projects/%s/models", projectID)
		req := httptest.NewRequest(http.MethodPost, url, body)
		req.Header.Set("Content-Type", "application/json")
		req.Header.Set("Authorization", authHeader)
		w := httptest.NewRecorder()
		r.ServeHTTP(w, req)

		if w.Code != http.StatusOK {
			t.Fatalf("status = %d, body = %s", w.Code, w.Body.String())
		}
		data := parseJSON(t, w.Body.Bytes())["data"].(map[string]any)
		if data["projectId"] != projectID {
			t.Errorf("projectId = %v, want %v", data["projectId"], projectID)
		}
		if data["name"] != "NestedModel" {
			t.Errorf("name = %v, want NestedModel", data["name"])
		}
	})

	t.Run("ListModelsByProject", func(t *testing.T) {
		url := fmt.Sprintf("/api/v1/projects/%s/models", projectID)
		req := httptest.NewRequest(http.MethodGet, url, nil)
		req.Header.Set("Authorization", authHeader)
		w := httptest.NewRecorder()
		r.ServeHTTP(w, req)

		if w.Code != http.StatusOK {
			t.Fatalf("status = %d", w.Code)
		}
		// We have the "NestedModel" from the sub-test above.
		models := parseJSON(t, w.Body.Bytes())["data"].([]any)
		if len(models) != 1 {
			t.Errorf("len = %d, want 1", len(models))
		}
	})
}

// ─── Health ─────────────────────────────────────────────────────────

func TestHealth(t *testing.T) {
	r, _ := setupTestRouter(t)
	req := httptest.NewRequest(http.MethodGet, "/health", nil)
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)

	if w.Code != http.StatusOK {
		t.Errorf("status = %d, want %d", w.Code, http.StatusOK)
	}
}
