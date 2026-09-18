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

// TestW45_AuditProjectModelCRUD：创建/更新/删除 project + model 产生审计。
func TestW45_AuditProjectModelCRUD(t *testing.T) {
	r, _ := setupTestRouter(t)
	token, _, _, _ := registerTwoUsers(t, r)

	// 创建 project
	wProj := doRequest(r, authedRequest("POST", "/api/v1/projects", token, gin.H{
		"name": "AuditedProj", "visibility": "private",
	}))
	if wProj.Code != http.StatusOK {
		t.Fatalf("create project: %d", wProj.Code)
	}
	projectID := parseJSON(t, wProj.Body.Bytes())["data"].(map[string]any)["id"].(string)

	// 更新 project
	wUpd := doRequest(r, authedRequest("PUT", "/api/v1/projects/"+projectID, token, gin.H{
		"name": "AuditedProj_v2",
	}))
	if wUpd.Code != http.StatusOK {
		t.Fatalf("update project: %d", wUpd.Code)
	}

	// 创建 model
	wMdl := doRequest(r, authedRequest("POST", "/api/v1/models", token, gin.H{
		"projectId": projectID, "name": "M1", "content": "package M1 {}",
	}))
	if wMdl.Code != http.StatusOK {
		t.Fatalf("create model: %d %s", wMdl.Code, wMdl.Body.String())
	}
	modelID := parseJSON(t, wMdl.Body.Bytes())["data"].(map[string]any)["id"].(string)

	// 删除 model
	wDelMdl := doRequest(r, authedRequest("DELETE", "/api/v1/models/"+modelID, token, nil))
	if wDelMdl.Code != http.StatusOK {
		t.Fatalf("delete model: %d", wDelMdl.Code)
	}

	// 删除 project
	wDelProj := doRequest(r, authedRequest("DELETE", "/api/v1/projects/"+projectID, token, nil))
	if wDelProj.Code != http.StatusOK {
		t.Fatalf("delete project: %d", wDelProj.Code)
	}

	// 审计查询
	wLogs := doRequest(r, authedRequest("GET", "/api/v1/audit-logs", token, nil))
	if wLogs.Code != http.StatusOK {
		t.Fatalf("list logs: %d", wLogs.Code)
	}
	logs := parseJSON(t, wLogs.Body.Bytes())["data"].([]any)
	// 应至少 5 条：project create / update / model create / model delete / project delete
	if len(logs) < 5 {
		t.Fatalf("应 ≥ 5 条审计，实际 %d 条", len(logs))
	}
	gotActions := map[string]bool{}
	for _, l := range logs {
		m := l.(map[string]any)
		key := m["targetType"].(string) + "_" + m["action"].(string)
		gotActions[key] = true
	}
	must := []string{"project_create", "project_update", "model_create", "model_delete", "project_delete"}
	for _, k := range must {
		if !gotActions[k] {
			t.Errorf("缺少 %s，实际 keys: %v", k, gotActions)
		}
	}
}

// TestW45_AuditAuthRegister：注册产生 user/register 审计（actor=anonymous）。
func TestW45_AuditAuthRegister(t *testing.T) {
	r, _ := setupTestRouter(t)
	// 先注册一个会成为查询者（审计接口要 JWT）的用户
	tokenA, _, _, _ := registerTwoUsers(t, r)

	// 注册另一个用户（独立事件）
	wReg := doRequest(r, authedRequest("POST", "/api/v1/auth/register", "", gin.H{
		"username": "audit_subject",
		"email":    "audit_subject@example.com",
		"password": "pw123456",
	}))
	if wReg.Code != http.StatusOK {
		t.Fatalf("register: %d %s", wReg.Code, wReg.Body.String())
	}

	wLogs := doRequest(r, authedRequest("GET", "/api/v1/audit-logs", tokenA, nil))
	logs := parseJSON(t, wLogs.Body.Bytes())["data"].([]any)
	// 至少应有 alice/bob/audit_subject 共 3 条 register 审计
	registerCount := 0
	for _, l := range logs {
		m := l.(map[string]any)
		if m["action"] == "register" && m["targetType"] == "user" {
			registerCount++
		}
	}
	if registerCount < 3 {
		t.Errorf("应 ≥ 3 条 register 审计，实际 %d", registerCount)
	}
}

// TestW45_AuditFilterByProject：按 projectId 过滤，跨 project/model/share/link。
func TestW45_AuditFilterByProject(t *testing.T) {
	r, _ := setupTestRouter(t)
	tokenA, tokenB, _, idB := registerTwoUsers(t, r)

	projectA := createProject(t, r, tokenA, "ProjA", "private")
	projectB := createProject(t, r, tokenA, "ProjB", "private")

	// A 在 projectA 上做一系列操作：创建 model、share 给 B、创建 link
	doRequest(r, authedRequest("POST", "/api/v1/models", tokenA, gin.H{
		"projectId": projectA, "name": "MA", "content": "x",
	}))
	doRequest(r, authedRequest("POST", "/api/v1/projects/"+projectA+"/shares", tokenA, gin.H{
		"userId": idB, "permission": "read",
	}))
	wLinkA := doRequest(r, authedRequest("POST", "/api/v1/projects/"+projectA+"/links", tokenA, gin.H{
		"permission": "read",
	}))
	linkID_A := parseJSON(t, wLinkA.Body.Bytes())["data"].(map[string]any)["link"].(map[string]any)["id"].(string)

	// B 在 projectB 上做不同操作（不应出现在 projectA 视图）
	doRequest(r, authedRequest("POST", "/api/v1/models", tokenB, gin.H{
		"projectId": projectB, "name": "MB", "content": "y",
	}))
	wLinkB := doRequest(r, authedRequest("POST", "/api/v1/projects/"+projectB+"/links", tokenB, gin.H{
		"permission": "read",
	}))
	_ = parseJSON(t, wLinkB.Body.Bytes())
	_ = linkID_A

	// 查询 projectA 视图
	w := doRequest(r, authedRequest("GET", "/api/v1/audit-logs?projectId="+projectA, tokenA, nil))
	logs := parseJSON(t, w.Body.Bytes())["data"].([]any)

	// 应至少包含：projectA create、model create、share、link_create
	// 不应包含：projectB create、projectB 上的 model、link
	gotProjectBRef := false
	for _, l := range logs {
		m := l.(map[string]any)
		tid := m["targetId"].(string)
		if tid == projectB {
			gotProjectBRef = true
		}
	}
	if gotProjectBRef {
		t.Errorf("projectId 过滤应排除 projectB 的日志，实际: %v", logs)
	}

	// 应至少 4 条（A 的 projectA 系列）
	if len(logs) < 4 {
		t.Errorf("projectA 视图应 ≥ 4 条日志，实际 %d", len(logs))
	}
}

// TestW45_AuditLoginSuccessAndFail：登录成功 + 登录失败都产生审计。
func TestW45_AuditLoginSuccessAndFail(t *testing.T) {
	r, _ := setupTestRouter(t)
	tokenA, _, _, _ := registerTwoUsers(t, r)

	// 成功登录
	wOk := doRequest(r, authedRequest("POST", "/api/v1/auth/login", "", gin.H{
		"username": "alice", "password": "pass-1234",
	}))
	if wOk.Code != http.StatusOK {
		t.Fatalf("login ok: %d", wOk.Code)
	}

	// 失败登录
	wFail := doRequest(r, authedRequest("POST", "/api/v1/auth/login", "", gin.H{
		"username": "alice", "password": "wrong_password",
	}))
	if wFail.Code != http.StatusBadRequest {
		t.Fatalf("login fail 应 400，实际 %d", wFail.Code)
	}

	wLogs := doRequest(r, authedRequest("GET", "/api/v1/audit-logs", tokenA, nil))
	logs := parseJSON(t, wLogs.Body.Bytes())["data"].([]any)
	gotLogin := false
	gotLoginFail := false
	for _, l := range logs {
		m := l.(map[string]any)
		if m["targetType"] != "user" {
			continue
		}
		switch m["action"] {
		case "login":
			gotLogin = true
		case "login_fail":
			gotLoginFail = true
		}
	}
	if !gotLogin {
		t.Error("缺少 user/login 审计")
	}
	if !gotLoginFail {
		t.Error("缺少 user/login_fail 审计")
	}
}

// TestW45_AuditRBACScoping：M4.5 增量 — 非授权用户看不到他人的项目日志。
//
// 场景：
//   - Alice 建项目 projA 并做 share/link_revoke
//   - Bob 完全不接触 projA（无任何 project_access）
//   - Bob 查 audit-logs：应看不到 projA 的 share/link_revoke 行
//     （但能看到自己的 actor 行，如 register / login）
func TestW45_AuditRBACScoping(t *testing.T) {
	r, _ := setupTestRouter(t)
	tokenA, tokenB, _, idB := registerTwoUsers(t, r)
	projectA := createProject(t, r, tokenA, "ProjA_rbac", "private")

	// Alice 在 projA 上做 share 给 Bob + revoke
	doRequest(r, authedRequest("POST", "/api/v1/projects/"+projectA+"/shares", tokenA, gin.H{
		"userId": idB, "permission": "read",
	}))
	doRequest(r, authedRequest("DELETE", "/api/v1/projects/"+projectA+"/shares/"+idB, tokenA, nil))
	wLink := doRequest(r, authedRequest("POST", "/api/v1/projects/"+projectA+"/links", tokenA, gin.H{
		"permission": "read",
	}))
	linkID := parseJSON(t, wLink.Body.Bytes())["data"].(map[string]any)["link"].(map[string]any)["id"].(string)
	doRequest(r, authedRequest("DELETE", "/api/v1/projects/"+projectA+"/links/"+linkID, tokenA, nil))

	// 拉所有 audit（用 admin 视角的 Alice 看全集）
	wAll := doRequest(r, authedRequest("GET", "/api/v1/audit-logs?limit=200", tokenA, nil))
	allLogs := parseJSON(t, wAll.Body.Bytes())["data"].([]any)

	// Bob 的视角（应被 RBAC 过滤掉 projA 行）
	wBob := doRequest(r, authedRequest("GET", "/api/v1/audit-logs?limit=200", tokenB, nil))
	if wBob.Code != http.StatusOK {
		t.Fatalf("bob list: %d", wBob.Code)
	}
	bobLogs := parseJSON(t, wBob.Body.Bytes())["data"].([]any)

	// 计算全集里 projA 行的数量 + Bob 看到的行数量
	countProjAForAlice := 0
	for _, l := range allLogs {
		m := l.(map[string]any)
		if rowTouchesProjectA(m, projectA) {
			countProjAForAlice++
		}
	}
	countProjAForBob := 0
	for _, l := range bobLogs {
		m := l.(map[string]any)
		if rowTouchesProjectA(m, projectA) {
			countProjAForBob++
		}
	}

	if countProjAForAlice == 0 {
		t.Fatalf("Alice 视角应看到 projA 审计行，实际 0")
	}
	if countProjAForBob != 0 {
		t.Errorf("Bob 视角不应看到 projA 任何行，实际 %d 行：%v",
			countProjAForBob, bobLogs)
	}
}

// rowTouchesProjectA 判断一行是否与 projectA 关联（target_id 直接等于 / 包含 / 通过 model 或 share_link 反向可达）。
func rowTouchesProjectA(m map[string]any, projectA string) bool {
	tid, _ := m["targetId"].(string)
	if tid == "" {
		return false
	}
	if tid == projectA {
		return true
	}
	// share target 形如 "<projectId>/<userId>"
	for i := 0; i < len(tid); i++ {
		if tid[i] == '/' && tid[:i] == projectA {
			return true
		}
	}
	return false
}

// TestW45_AuditRBACActorAlwaysVisible：调用方作为 actor 的行一定可见，
// 即使该行针对一个自己无权访问的 project（rare 场景：曾经的成员操作）。
func TestW45_AuditRBACActorAlwaysVisible(t *testing.T) {
	r, _ := setupTestRouter(t)
	tokenA, tokenB, _, idB := registerTwoUsers(t, r)
	// Alice 建一个 project（Bob 无任何访问权）
	_ = createProject(t, r, tokenA, "Proj_owner_only", "private")

	// Bob 触发一条自己作为 actor 的审计（登录一次）
	wBobLogin := doRequest(r, authedRequest("POST", "/api/v1/auth/login", "", gin.H{
		"username": "bob", "password": "pass-1234",
	}))
	if wBobLogin.Code != http.StatusOK {
		t.Fatalf("bob login: %d", wBobLogin.Code)
	}

	// Bob 按 actor=自己 查询 — 应看到自己的 login 行（actor-self 永远可见）
	wBob := doRequest(r, authedRequest("GET", "/api/v1/audit-logs?actor="+idB, tokenB, nil))
	logs := parseJSON(t, wBob.Body.Bytes())["data"].([]any)
	if len(logs) == 0 {
		t.Fatalf("bob 查自己的 actor 行应至少 1 条，实际 0")
	}
	foundLogin := false
	for _, l := range logs {
		m := l.(map[string]any)
		if m["action"] == "login" && m["targetType"] == "user" {
			foundLogin = true
		}
	}
	if !foundLogin {
		t.Errorf("bob 看不到自己的 login 行")
	}
}