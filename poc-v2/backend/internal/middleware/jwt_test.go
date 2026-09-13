package middleware

import (
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/gin-gonic/gin"
)

func init() {
	gin.SetMode(gin.TestMode)
}

// ─── GenerateToken + ValidateToken roundtrip ────────────────────────

func TestGenerateAndValidateToken(t *testing.T) {
	userID := "user-abc-123"

	token, err := GenerateToken(userID, 1*time.Hour)
	if err != nil {
		t.Fatalf("GenerateToken: %v", err)
	}
	if token == "" {
		t.Fatal("expected non-empty token")
	}

	payload, err := ValidateToken(token)
	if err != nil {
		t.Fatalf("ValidateToken: %v", err)
	}
	if payload.UserID != userID {
		t.Errorf("UserID = %q, want %q", payload.UserID, userID)
	}

	// Iat should be within a few seconds of now.
	now := time.Now().Unix()
	if payload.Iat > now+5 || payload.Iat < now-5 {
		t.Errorf("Iat = %d, expected close to %d", payload.Iat, now)
	}

	// Exp should be ~1 hour from Iat.
	if payload.Exp-payload.Iat != int64((1 * time.Hour).Seconds()) {
		t.Errorf("Exp-Iat = %d, want %d", payload.Exp-payload.Iat, int64((1*time.Hour).Seconds()))
	}
}

func TestValidateToken_Expired(t *testing.T) {
	// Generate a token that already expired.
	token, err := GenerateToken("user-x", -1*time.Hour)
	if err != nil {
		t.Fatalf("GenerateToken: %v", err)
	}

	_, err = ValidateToken(token)
	if err == nil {
		t.Fatal("expected error for expired token, got nil")
	}
	if err.Error() != "token expired" {
		t.Errorf("error = %q, want %q", err.Error(), "token expired")
	}
}

func TestValidateToken_InvalidSignature(t *testing.T) {
	token, err := GenerateToken("user-y", 1*time.Hour)
	if err != nil {
		t.Fatalf("GenerateToken: %v", err)
	}

	// Tamper with the signature by replacing the last character.
	tampered := token[:len(token)-1]
	if token[len(token)-1] == 'A' {
		tampered += "B"
	} else {
		tampered += "A"
	}

	_, err = ValidateToken(tampered)
	if err == nil {
		t.Fatal("expected error for tampered token, got nil")
	}
	if err.Error() != "invalid signature" {
		t.Errorf("error = %q, want %q", err.Error(), "invalid signature")
	}
}

func TestValidateToken_Malformed(t *testing.T) {
	tests := []struct {
		name  string
		token string
	}{
		{"empty", ""},
		{"one_part", "abcdef"},
		{"two_parts", "abc.def"},
		{"garbage", "not.a.jwt.at.all"},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			_, err := ValidateToken(tc.token)
			if err == nil {
				t.Error("expected error for malformed token, got nil")
			}
		})
	}
}

// ─── AuthRequired middleware ────────────────────────────────────────

func TestAuthRequired_MissingHeader(t *testing.T) {
	r := gin.New()
	r.Use(AuthRequired())
	r.GET("/protected", func(c *gin.Context) {
		c.JSON(http.StatusOK, gin.H{"ok": true})
	})

	req := httptest.NewRequest(http.MethodGet, "/protected", nil)
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)

	if w.Code != http.StatusUnauthorized {
		t.Errorf("status = %d, want %d", w.Code, http.StatusUnauthorized)
	}
}

func TestAuthRequired_InvalidFormat(t *testing.T) {
	r := gin.New()
	r.Use(AuthRequired())
	r.GET("/protected", func(c *gin.Context) {
		c.JSON(http.StatusOK, gin.H{"ok": true})
	})

	tests := []struct {
		name   string
		header string
	}{
		{"no_bearer_prefix", "some-token"},
		{"wrong_scheme", "Basic dXNlcjpwYXNz"},
		{"empty_value", "Bearer"},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			req := httptest.NewRequest(http.MethodGet, "/protected", nil)
			req.Header.Set("Authorization", tc.header)
			w := httptest.NewRecorder()
			r.ServeHTTP(w, req)

			if w.Code != http.StatusUnauthorized {
				t.Errorf("status = %d, want %d", w.Code, http.StatusUnauthorized)
			}
		})
	}
}

func TestAuthRequired_InvalidToken(t *testing.T) {
	r := gin.New()
	r.Use(AuthRequired())
	r.GET("/protected", func(c *gin.Context) {
		c.JSON(http.StatusOK, gin.H{"ok": true})
	})

	req := httptest.NewRequest(http.MethodGet, "/protected", nil)
	req.Header.Set("Authorization", "Bearer garbage.token.value")
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)

	if w.Code != http.StatusUnauthorized {
		t.Errorf("status = %d, want %d", w.Code, http.StatusUnauthorized)
	}
}

func TestAuthRequired_ValidToken(t *testing.T) {
	r := gin.New()
	r.Use(AuthRequired())
	var capturedUserID string
	r.GET("/protected", func(c *gin.Context) {
		capturedUserID = c.GetString("user_id")
		c.JSON(http.StatusOK, gin.H{"ok": true})
	})

	token, err := GenerateToken("user-42", 1*time.Hour)
	if err != nil {
		t.Fatalf("GenerateToken: %v", err)
	}

	req := httptest.NewRequest(http.MethodGet, "/protected", nil)
	req.Header.Set("Authorization", "Bearer "+token)
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)

	if w.Code != http.StatusOK {
		t.Errorf("status = %d, want %d", w.Code, http.StatusOK)
	}
	if capturedUserID != "user-42" {
		t.Errorf("user_id = %q, want %q", capturedUserID, "user-42")
	}
}

func TestAuthRequired_ExpiredToken(t *testing.T) {
	r := gin.New()
	r.Use(AuthRequired())
	r.GET("/protected", func(c *gin.Context) {
		c.JSON(http.StatusOK, gin.H{"ok": true})
	})

	token, err := GenerateToken("user-exp", -1*time.Minute)
	if err != nil {
		t.Fatalf("GenerateToken: %v", err)
	}

	req := httptest.NewRequest(http.MethodGet, "/protected", nil)
	req.Header.Set("Authorization", "Bearer "+token)
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)

	if w.Code != http.StatusUnauthorized {
		t.Errorf("status = %d, want %d", w.Code, http.StatusUnauthorized)
	}
}
