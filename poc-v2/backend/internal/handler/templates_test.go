package handler

import (
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/gin-gonic/gin"
)

func init() {
	gin.SetMode(gin.TestMode)
}

// makeTemplatesRouter returns a router with the templates routes mounted
// (no auth middleware so we can test directly).
func makeTemplatesRouter(h *Handler) *gin.Engine {
	r := gin.New()
	v1 := r.Group("/api/v1")
	v1.GET("/templates", h.ListTemplates)
	v1.GET("/templates/:id", h.GetTemplate)
	return r
}

func TestListTemplates(t *testing.T) {
	r := makeTemplatesRouter(&Handler{})

	req := httptest.NewRequest("GET", "/api/v1/templates", nil)
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)

	if w.Code != 200 {
		t.Fatalf("expected 200, got %d (body: %s)", w.Code, w.Body.String())
	}

	body := w.Body.String()
	if !contains(body, "automotive-powertrain") {
		t.Error("expected automotive-powertrain in list")
	}
	if !contains(body, "aerospace-flight-control") {
		t.Error("expected aerospace-flight-control in list")
	}
	if !contains(body, "software-microservice") {
		t.Error("expected software-microservice in list")
	}
}

func TestListTemplates_FilterByIndustry(t *testing.T) {
	r := makeTemplatesRouter(&Handler{})

	req := httptest.NewRequest("GET", "/api/v1/templates?industry=software", nil)
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)

	if w.Code != 200 {
		t.Fatalf("expected 200, got %d", w.Code)
	}

	body := w.Body.String()
	if !contains(body, "software-microservice") {
		t.Error("expected software-microservice")
	}
	if contains(body, "automotive-powertrain") {
		t.Error("automotive should be filtered out")
	}
}

func TestGetTemplate_Success(t *testing.T) {
	r := makeTemplatesRouter(&Handler{})

	req := httptest.NewRequest("GET", "/api/v1/templates/software-microservice", nil)
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)

	if w.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d", w.Code)
	}

	body := w.Body.String()
	if !contains(body, "package SoftwareMicroservice") {
		t.Error("expected content to include package declaration")
	}
	if !contains(body, "part def APIGateway") {
		t.Error("expected content to include APIGateway")
	}
}

func TestGetTemplate_NotFound(t *testing.T) {
	r := makeTemplatesRouter(&Handler{})

	req := httptest.NewRequest("GET", "/api/v1/templates/nonexistent", nil)
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)

	if w.Code != http.StatusNotFound {
		t.Fatalf("expected 404, got %d", w.Code)
	}
}