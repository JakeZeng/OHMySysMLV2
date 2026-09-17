package middleware

import (
	"net/http"
	"net/http/httptest"
	"sync"
	"testing"
	"time"

	"github.com/gin-gonic/gin"
)

func init() {
	gin.SetMode(gin.TestMode)
}

func TestCORS_AllowedOrigin(t *testing.T) {
	cfg := DefaultCORSConfig()
	r := gin.New()
	r.Use(CORS(cfg))
	r.GET("/test", func(c *gin.Context) {
		c.String(200, "ok")
	})

	req := httptest.NewRequest("GET", "/test", nil)
	req.Header.Set("Origin", "http://localhost:3000")
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)

	if w.Code != 200 {
		t.Errorf("expected 200, got %d", w.Code)
	}
	if got := w.Header().Get("Access-Control-Allow-Origin"); got != "http://localhost:3000" {
		t.Errorf("expected origin header, got %q", got)
	}
}

func TestCORS_DisallowedOrigin(t *testing.T) {
	cfg := DefaultCORSConfig()
	r := gin.New()
	r.Use(CORS(cfg))
	r.GET("/test", func(c *gin.Context) {
		c.String(200, "ok")
	})

	req := httptest.NewRequest("GET", "/test", nil)
	req.Header.Set("Origin", "http://evil.com")
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)

	if w.Code != 403 {
		t.Errorf("expected 403 for disallowed origin, got %d", w.Code)
	}
}

func TestRateLimiter(t *testing.T) {
	rl := NewRateLimiter(3, time.Second)

	// 前 3 次应该通过
	for i := 0; i < 3; i++ {
		ok, _ := rl.Allow("1.2.3.4")
		if !ok {
			t.Errorf("call %d: expected allowed, got blocked", i)
		}
	}

	// 第 4 次应该被拒绝
	ok, retryAfter := rl.Allow("1.2.3.4")
	if ok {
		t.Error("4th call: expected blocked, got allowed")
	}
	if retryAfter < 1 {
		t.Errorf("expected retry-after >= 1, got %d", retryAfter)
	}

	// 不同 IP 互不影响
	ok, _ = rl.Allow("5.6.7.8")
	if !ok {
		t.Error("different IP: expected allowed")
	}
}

func TestRateLimitMiddleware(t *testing.T) {
	rl := NewRateLimiter(2, time.Second)
	r := gin.New()
	r.Use(RateLimit(rl))
	r.GET("/test", func(c *gin.Context) {
		c.String(200, "ok")
	})

	for i := 0; i < 2; i++ {
		req := httptest.NewRequest("GET", "/test", nil)
		req.RemoteAddr = "9.9.9.9:1234"
		w := httptest.NewRecorder()
		r.ServeHTTP(w, req)
		if w.Code != 200 {
			t.Errorf("call %d: expected 200, got %d", i, w.Code)
		}
	}

	req := httptest.NewRequest("GET", "/test", nil)
	req.RemoteAddr = "9.9.9.9:1234"
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)
	if w.Code != 429 {
		t.Errorf("expected 429, got %d", w.Code)
	}
}

func TestCSRF_GeneratesTokenOnGET(t *testing.T) {
	cfg := DefaultCSRFConfig()
	r := gin.New()
	r.Use(CSRF(cfg))
	r.GET("/test", func(c *gin.Context) {
		c.String(200, "ok")
	})

	req := httptest.NewRequest("GET", "/test", nil)
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)

	if w.Code != 200 {
		t.Errorf("expected 200, got %d", w.Code)
	}
	cookie := w.Header().Get("Set-Cookie")
	if cookie == "" {
		t.Error("expected csrf cookie to be set on GET")
	}
}

func TestCSRF_BlocksPOSTWithoutToken(t *testing.T) {
	cfg := DefaultCSRFConfig()
	r := gin.New()
	r.Use(CSRF(cfg))
	r.POST("/test", func(c *gin.Context) {
		c.String(200, "ok")
	})

	// 不带任何 cookie 直接 POST
	req := httptest.NewRequest("POST", "/test", nil)
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)

	if w.Code != 403 {
		t.Errorf("expected 403, got %d", w.Code)
	}
}

func TestCSRF_AllowsWithMatchingToken(t *testing.T) {
	cfg := DefaultCSRFConfig()
	r := gin.New()
	r.Use(CSRF(cfg))
	r.POST("/test", func(c *gin.Context) {
		c.String(200, "ok")
	})

	// 第一次 GET 拿 cookie
	getReq := httptest.NewRequest("GET", "/test", nil)
	getW := httptest.NewRecorder()
	r.ServeHTTP(getW, getReq)
	cookies := getW.Header().Values("Set-Cookie")
	if len(cookies) == 0 {
		t.Fatal("no cookies set")
	}

	// 从 Set-Cookie header 解析 token（简化为第一个 chunk）
	cookieValue := ""
	for _, c := range cookies {
		for i := 0; i < len(c); i++ {
			if c[i] == '=' {
				end := i + 1
				for end < len(c) && c[end] != ';' {
					end++
				}
				cookieValue = c[i+1 : end]
				break
			}
		}
		if cookieValue != "" {
			break
		}
	}

	// POST 带 cookie + header
	postReq := httptest.NewRequest("POST", "/test", nil)
	postReq.Header.Set("X-CSRF-Token", cookieValue)
	postReq.AddCookie(&http.Cookie{Name: "csrf_token", Value: cookieValue})
	postW := httptest.NewRecorder()
	r.ServeHTTP(postW, postReq)

	if postW.Code != 200 {
		t.Errorf("expected 200, got %d", postW.Code)
	}
}

// TestCSRF_StrictRejectsProjectPOST：StrictCSRFConfig 应拒绝不带 token 的 /api/v1/projects POST。
func TestCSRF_StrictRejectsProjectPOST(t *testing.T) {
	cfg := StrictCSRFConfig()
	r := gin.New()
	r.Use(CSRF(cfg))
	r.POST("/api/v1/projects", func(c *gin.Context) {
		c.String(200, "ok")
	})

	// 不带任何 cookie + header
	req := httptest.NewRequest("POST", "/api/v1/projects", nil)
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)
	if w.Code != 403 {
		t.Errorf("Strict 模式下无 token POST 应 403，实际 %d", w.Code)
	}
}

// TestCSRF_StrictAllowsLoginRegisterShared：Strict 模式下 login/register/shared 仍放行。
func TestCSRF_StrictAllowsLoginRegisterShared(t *testing.T) {
	cfg := StrictCSRFConfig()
	r := gin.New()
	r.Use(CSRF(cfg))
	r.POST("/api/v1/auth/login", func(c *gin.Context) { c.String(200, "ok") })
	r.POST("/api/v1/auth/register", func(c *gin.Context) { c.String(200, "ok") })
	r.GET("/api/v1/shared/abc123", func(c *gin.Context) { c.String(200, "ok") })

	for _, path := range []string{
		"/api/v1/auth/login",
		"/api/v1/auth/register",
	} {
		req := httptest.NewRequest("POST", path, nil)
		w := httptest.NewRecorder()
		r.ServeHTTP(w, req)
		if w.Code != 200 {
			t.Errorf("Strict 模式 %s 应放行，实际 %d", path, w.Code)
		}
	}

	req := httptest.NewRequest("GET", "/api/v1/shared/abc123", nil)
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)
	if w.Code != 200 {
		t.Errorf("Strict 模式 shared 应放行，实际 %d", w.Code)
	}
}

// TestCSRF_DefaultPermitsProjectsPOST：dev 模式（Default）对 /api/v1/projects POST 放行
// （依赖 JWT + CORS 提供跨域保护；测试 StrictCSRFConfig 与 DefaultCSRFConfig 的差别）。
func TestCSRF_DefaultPermitsProjectsPOST(t *testing.T) {
	cfg := DefaultCSRFConfig()
	r := gin.New()
	r.Use(CSRF(cfg))
	r.POST("/api/v1/projects", func(c *gin.Context) {
		c.String(200, "ok")
	})

	req := httptest.NewRequest("POST", "/api/v1/projects", nil)
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)
	if w.Code != 200 {
		t.Errorf("Default 模式 projects POST 应放行（dev 兼容），实际 %d", w.Code)
	}
}

func TestBodySizeLimit(t *testing.T) {
	r := gin.New()
	r.Use(BodySizeLimit(100))
	r.POST("/test", func(c *gin.Context) {
		c.String(200, "ok")
	})

	// 大 body
	bigBody := make([]byte, 200)
	for i := range bigBody {
		bigBody[i] = 'x'
	}
	req := httptest.NewRequest("POST", "/test", nil)
	req.ContentLength = int64(len(bigBody))
	req.Body = http.MaxBytesReader(nil, nil, 100)
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)

	if w.Code != 413 && w.Code != 400 {
		t.Errorf("expected 413 or 400, got %d", w.Code)
	}
}

// 避免未用警告
var _ = sync.Mutex{}