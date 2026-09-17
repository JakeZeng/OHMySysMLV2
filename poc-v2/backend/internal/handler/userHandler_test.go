package handler

import (
	"net/http"
	"testing"

	"github.com/gin-gonic/gin"
)

// ─── 用户搜索端点（M4 W3 补充）───────────────────────────────────
//
// 覆盖：
//   - 登录用户能搜到匹配 username 前缀的用户
//   - 登录用户能搜到匹配 email 前缀的用户
//   - 未登录应 401
//   - 空 q 应 400
//   - 响应中不暴露 passwordHash / password_hash

// TestW3_UserSearch_UsernamePrefix：按 username 前缀匹配。
func TestW3_UserSearch_UsernamePrefix(t *testing.T) {
	r, _ := setupTestRouter(t)
	registerUser(t, r, "alice", "alice@example.com", "pass-1234")
	registerUser(t, r, "alicia", "alicia@example.com", "pass-1234")
	registerUser(t, r, "bob", "bob@example.com", "pass-1234")
	tok := authToken(t, registerUser(t, r, "carol", "carol@example.com", "pass-1234"))

	w := doRequest(r, authedRequest("GET", "/api/v1/users/search?q=ali", tok, nil))
	if w.Code != http.StatusOK {
		t.Fatalf("status = %d, body = %s", w.Code, w.Body.String())
	}
	d := parseJSON(t, w.Body.Bytes())["data"].(map[string]any)
	users, _ := d["users"].([]any)
	if len(users) != 2 {
		t.Fatalf("应匹配 alice + alicia，实际 %d", len(users))
	}
	for _, u := range users {
		m := u.(map[string]any)
		if _, has := m["passwordHash"]; has {
			t.Errorf("响应不应暴露 passwordHash：%v", m)
		}
		if _, has := m["password_hash"]; has {
			t.Errorf("响应不应暴露 password_hash：%v", m)
		}
	}
}

// TestW3_UserSearch_EmailPrefix：按 email 前缀匹配。
func TestW3_UserSearch_EmailPrefix(t *testing.T) {
	r, _ := setupTestRouter(t)
	registerUser(t, r, "alice", "alice@example.com", "pass-1234")
	registerUser(t, r, "bob", "bob@example.com", "pass-1234")
	tok := authToken(t, registerUser(t, r, "carol", "carol@example.com", "pass-1234"))

	w := doRequest(r, authedRequest("GET", "/api/v1/users/search?q=alice@", tok, nil))
	if w.Code != http.StatusOK {
		t.Fatalf("status = %d", w.Code)
	}
	users := parseJSON(t, w.Body.Bytes())["data"].(map[string]any)["users"].([]any)
	if len(users) != 1 {
		t.Fatalf("应仅 1 条，实际 %d", len(users))
	}
	if users[0].(map[string]any)["username"] != "alice" {
		t.Errorf("匹配错误")
	}
}

// TestW3_UserSearch_Unauthenticated：未登录应 401。
func TestW3_UserSearch_Unauthenticated(t *testing.T) {
	r, _ := setupTestRouter(t)
	w := doRequest(r, authedRequest("GET", "/api/v1/users/search?q=alice", "", nil))
	if w.Code != http.StatusUnauthorized {
		t.Errorf("未登录应 401，实际 %d", w.Code)
	}
	_ = gin.H{}
}

// TestW3_UserSearch_EmptyQ：空 query 应 400。
func TestW3_UserSearch_EmptyQ(t *testing.T) {
	r, _ := setupTestRouter(t)
	tok := authToken(t, registerUser(t, r, "alice", "alice@example.com", "pass-1234"))
	w := doRequest(r, authedRequest("GET", "/api/v1/users/search?q=", tok, nil))
	if w.Code != http.StatusBadRequest {
		t.Errorf("空 q 应 400，实际 %d", w.Code)
	}
}