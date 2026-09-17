package handler

import (
	"net/http"
	"testing"

	"github.com/gin-gonic/gin"
)

// ─── M4.5 审计日志测试 ───────────────────────────────────────────
//
// 覆盖：
//   - 每次 share / unshare / link_create / link_revoke 都产生一条 audit log
//   - GET /audit-logs?actor=... 过滤正确
//   - GET /audit-logs?targetType=...&targetId=... 过滤正确
//   - 未登录应 401

// TestW45_AuditShareAndLink：分享 + 链接 + 撤销都产生日志。
func TestW45_AuditShareAndLink(t *testing.T) {
	r, _ := setupTestRouter(t)
	tokenA, _, _, idB := registerTwoUsers(t, r)
	projectID := createProject(t, r, tokenA, "Audited", "private")

	// 1. 直分享
	wAdd := doRequest(r, authedRequest("POST", "/api/v1/projects/"+projectID+"/shares", tokenA, gin.H{
		"userId": idB, "permission": "read",
	}))
	if wAdd.Code != http.StatusOK {
		t.Fatalf("add share: %d", wAdd.Code)
	}

	// 2. 创建链接
	wLink := doRequest(r, authedRequest("POST", "/api/v1/projects/"+projectID+"/links", tokenA, gin.H{
		"permission": "read",
	}))
	if wLink.Code != http.StatusOK {
		t.Fatalf("create link: %d", wLink.Code)
	}
	body := parseJSON(t, wLink.Body.Bytes())["data"].(map[string]any)
	linkID := body["link"].(map[string]any)["id"].(string)

	// 3. 撤销直分享
	wRevShare := doRequest(r, authedRequest("DELETE", "/api/v1/projects/"+projectID+"/shares/"+idB, tokenA, nil))
	if wRevShare.Code != http.StatusOK {
		t.Fatalf("revoke share: %d", wRevShare.Code)
	}

	// 4. 撤销链接
	wRevLink := doRequest(r, authedRequest("DELETE", "/api/v1/projects/"+projectID+"/links/"+linkID, tokenA, nil))
	if wRevLink.Code != http.StatusOK {
		t.Fatalf("revoke link: %d", wRevLink.Code)
	}

	// 查询 — 应有 4 条
	wLogs := doRequest(r, authedRequest("GET", "/api/v1/audit-logs", tokenA, nil))
	if wLogs.Code != http.StatusOK {
		t.Fatalf("list logs: %d %s", wLogs.Code, wLogs.Body.String())
	}
	logs := parseJSON(t, wLogs.Body.Bytes())["data"].([]any)
	if len(logs) != 4 {
		t.Fatalf("应 4 条审计日志，实际 %d", len(logs))
	}
	// 4 个 action 都应出现（顺序非确定性，因 TIMESTAMP 列秒精度）。
	want := map[string]bool{
		"share":       true,
		"unshare":     true,
		"link_create": true,
		"link_revoke": true,
	}
	for _, l := range logs {
		m := l.(map[string]any)
		delete(want, m["action"].(string))
	}
	if len(want) != 0 {
		t.Errorf("缺少 action: %v", want)
	}
}

// TestW45_AuditFilterByActor：按 actor 过滤。
func TestW45_AuditFilterByActor(t *testing.T) {
	r, _ := setupTestRouter(t)
	tokenA, tokenB, idA, idB := registerTwoUsers(t, r)
	projectA := createProject(t, r, tokenA, "A_audit", "private")
	projectB := createProject(t, r, tokenB, "B_audit", "private")

	// A 分享给 B（自己项目）
	doRequest(r, authedRequest("POST", "/api/v1/projects/"+projectA+"/shares", tokenA, gin.H{
		"userId": idB, "permission": "read",
	}))
	// B 分享给 A（自己项目）
	doRequest(r, authedRequest("POST", "/api/v1/projects/"+projectB+"/shares", tokenB, gin.H{
		"userId": idA, "permission": "write",
	}))

	// 查询 actor=A 应 1 条
	wA := doRequest(r, authedRequest("GET", "/api/v1/audit-logs?actor="+idA, tokenA, nil))
	logsA := parseJSON(t, wA.Body.Bytes())["data"].([]any)
	if len(logsA) != 1 {
		t.Errorf("alice 应 1 条日志，实际 %d", len(logsA))
	}
	if logsA[0].(map[string]any)["actorId"] != idA {
		t.Errorf("actorId 不匹配")
	}

	// 查询 actor=B 应 1 条
	wB := doRequest(r, authedRequest("GET", "/api/v1/audit-logs?actor="+idB, tokenA, nil))
	logsB := parseJSON(t, wB.Body.Bytes())["data"].([]any)
	if len(logsB) != 1 {
		t.Errorf("bob 应 1 条日志，实际 %d", len(logsB))
	}
}

// TestW45_AuditFilterByTarget：按 target_type + target_id 过滤。
func TestW45_AuditFilterByTarget(t *testing.T) {
	r, _ := setupTestRouter(t)
	token, _, _, idB := registerTwoUsers(t, r)
	projectID := createProject(t, r, token, "T_audit", "private")

	doRequest(r, authedRequest("POST", "/api/v1/projects/"+projectID+"/shares", token, gin.H{
		"userId": idB, "permission": "read",
	}))

	// target=share + idB 应 1 条
	w := doRequest(r, authedRequest("GET",
		"/api/v1/audit-logs?targetType=share&targetId="+projectID+"/"+idB, token, nil))
	logs := parseJSON(t, w.Body.Bytes())["data"].([]any)
	if len(logs) != 1 {
		t.Errorf("应 1 条 target-filter 日志，实际 %d", len(logs))
	}
	if logs[0].(map[string]any)["action"] != "share" {
		t.Errorf("action 应 share")
	}
}

// TestW45_AuditUnauthenticated：未登录应 401。
func TestW45_AuditUnauthenticated(t *testing.T) {
	r, _ := setupTestRouter(t)
	w := doRequest(r, authedRequest("GET", "/api/v1/audit-logs", "", nil))
	if w.Code != http.StatusUnauthorized {
		t.Errorf("应 401，实际 %d", w.Code)
	}
	_ = gin.H{}
}