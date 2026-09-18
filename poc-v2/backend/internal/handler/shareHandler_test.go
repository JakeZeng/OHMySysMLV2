package handler

import (
	"net/http"
	"testing"
	"time"

	"github.com/gin-gonic/gin"
)

// ─── W3 项目分享测试 ───────────────────────────────────────────────────
//
// 覆盖：
//   - 直分享：owner 加/查/删 project_shares；非 owner 拒绝
//   - 链接分享：生成 + 公开 /shared/:token 读取；revoked/expired 一律 404
//   - 链接不能授权 admin（绑定限制）
//   - anonymous 不能通过 /shared/:token 写（即使 token 持 write 权限，也仅暴露 GET 视图）

// TestW3_DirectShareCRUD：完整 CRUD。
func TestW3_DirectShareCRUD(t *testing.T) {
	r, _ := setupTestRouter(t)
	tokenA, tokenB, _, idB := registerTwoUsers(t, r)

	projectID := createProject(t, r, tokenA, "DirectShare", "private")

	// A 加 B 为 read
	wAdd := doRequest(r, authedRequest("POST", "/api/v1/projects/"+projectID+"/shares", tokenA, gin.H{
		"userId": idB, "permission": "read",
	}))
	if wAdd.Code != http.StatusOK {
		t.Fatalf("add share: %d %s", wAdd.Code, wAdd.Body.String())
	}

	// 列出
	wList := doRequest(r, authedRequest("GET", "/api/v1/projects/"+projectID+"/shares", tokenA, nil))
	shares := parseJSON(t, wList.Body.Bytes())["data"].([]any)
	if len(shares) != 1 {
		t.Errorf("应 1 条分享，实际 %d", len(shares))
	}

	// 非 owner 列出应 403
	wListByB := doRequest(r, authedRequest("GET", "/api/v1/projects/"+projectID+"/shares", tokenB, nil))
	if wListByB.Code != http.StatusForbidden {
		t.Errorf("非 owner 列分享应 403，实际 %d", wListByB.Code)
	}

	// 撤销
	wDel := doRequest(r, authedRequest("DELETE", "/api/v1/projects/"+projectID+"/shares/"+idB, tokenA, nil))
	if wDel.Code != http.StatusOK {
		t.Errorf("撤销应 200，实际 %d", wDel.Code)
	}

	// 撤销后再撤销 → 404
	wDel2 := doRequest(r, authedRequest("DELETE", "/api/v1/projects/"+projectID+"/shares/"+idB, tokenA, nil))
	if wDel2.Code != http.StatusNotFound {
		t.Errorf("重复撤销应 404，实际 %d", wDel2.Code)
	}
}

// TestW3_LinkViewCountIncrement：每次访问 /shared/:token 应 +1。
func TestW3_LinkViewCountIncrement(t *testing.T) {
	r, _ := setupTestRouter(t)
	token, _, _, _ := registerTwoUsers(t, r)
	projectID := createProject(t, r, token, "ViewCount", "private")

	wCreate := doRequest(r, authedRequest("POST", "/api/v1/projects/"+projectID+"/links", token, gin.H{
		"permission": "read",
	}))
	body := parseJSON(t, wCreate.Body.Bytes())["data"].(map[string]any)
	linkID := body["link"].(map[string]any)["id"].(string)
	linkToken, _ := body["token"].(string)

	// 第一次访问
	w1 := doRequest(r, authedRequest("GET", "/api/v1/shared/"+linkToken, "", nil))
	if w1.Code != http.StatusOK {
		t.Fatalf("first visit: %d", w1.Code)
	}
	// 第二次
	w2 := doRequest(r, authedRequest("GET", "/api/v1/shared/"+linkToken, "", nil))
	if w2.Code != http.StatusOK {
		t.Fatalf("second visit: %d", w2.Code)
	}
	// 第三次
	w3 := doRequest(r, authedRequest("GET", "/api/v1/shared/"+linkToken, "", nil))
	if w3.Code != http.StatusOK {
		t.Fatalf("third visit: %d", w3.Code)
	}
	_ = linkID

	// 列表应反映 view_count=3
	wList := doRequest(r, authedRequest("GET", "/api/v1/projects/"+projectID+"/links", token, nil))
	links := parseJSON(t, wList.Body.Bytes())["data"].([]any)
	if len(links) != 1 {
		t.Fatalf("应 1 条链接，实际 %d", len(links))
	}
	got := links[0].(map[string]any)["viewCount"]
	if vc, ok := got.(float64); !ok || vc != 3 {
		t.Errorf("viewCount 应 3，实际 %v", got)
	}
	if links[0].(map[string]any)["lastViewedAt"] == nil {
		t.Error("lastViewedAt 应非空")
	}
}

// TestW3_LinkCreateAndAccess：生成 link → 公开端点拿到项目。
func TestW3_LinkCreateAndAccess(t *testing.T) {
	r, _ := setupTestRouter(t)
	token, _, _, _ := registerTwoUsers(t, r)
	projectID := createProject(t, r, token, "LinkProject", "private")

	wCreate := doRequest(r, authedRequest("POST", "/api/v1/projects/"+projectID+"/links", token, gin.H{
		"permission": "read",
	}))
	if wCreate.Code != http.StatusOK {
		t.Fatalf("create link: %d %s", wCreate.Code, wCreate.Body.String())
	}
	body := parseJSON(t, wCreate.Body.Bytes())["data"].(map[string]any)
	token1, _ := body["token"].(string)
	if token1 == "" {
		t.Fatal("未返回 token")
	}

	// 不带 token 访问 → 404
	wBad := doRequest(r, authedRequest("GET", "/api/v1/shared/badtoken", "", nil))
	if wBad.Code != http.StatusNotFound {
		t.Errorf("无效 token 应 404，实际 %d", wBad.Code)
	}

	// 用真 token 访问 → 200 + 项目元数据
	wOK := doRequest(r, authedRequest("GET", "/api/v1/shared/"+token1, "", nil))
	if wOK.Code != http.StatusOK {
		t.Fatalf("有效 token 应 200，实际 %d %s", wOK.Code, wOK.Body.String())
	}
	d := parseJSON(t, wOK.Body.Bytes())["data"].(map[string]any)
	proj := d["project"].(map[string]any)
	if proj["id"] != projectID {
		t.Errorf("拿到的项目 id 不匹配")
	}
	if d["permission"] != "read" {
		t.Errorf("permission 应为 read，实际 %v", d["permission"])
	}
}

// TestW3_LinkRevoke：revoke 后 token 失效。
func TestW3_LinkRevoke(t *testing.T) {
	r, _ := setupTestRouter(t)
	token, _, _, _ := registerTwoUsers(t, r)
	projectID := createProject(t, r, token, "Revoke", "private")

	wCreate := doRequest(r, authedRequest("POST", "/api/v1/projects/"+projectID+"/links", token, gin.H{
		"permission": "write",
	}))
	body := parseJSON(t, wCreate.Body.Bytes())["data"].(map[string]any)
	linkID := body["link"].(map[string]any)["id"].(string)
	linkToken, _ := body["token"].(string)

	// 撤销
	wRev := doRequest(r, authedRequest("DELETE", "/api/v1/projects/"+projectID+"/links/"+linkID, token, nil))
	if wRev.Code != http.StatusOK {
		t.Fatalf("revoke: %d", wRev.Code)
	}

	// 撤销后 token 应失效
	wAfter := doRequest(r, authedRequest("GET", "/api/v1/shared/"+linkToken, "", nil))
	if wAfter.Code != http.StatusNotFound {
		t.Errorf("revoked token 应 404，实际 %d", wAfter.Code)
	}
}

// TestW3_LinkPermissionRejectedAdmin：链接不能授权 admin（验证 binding 限制）。
func TestW3_LinkPermissionRejectedAdmin(t *testing.T) {
	r, _ := setupTestRouter(t)
	token, _, _, _ := registerTwoUsers(t, r)
	projectID := createProject(t, r, token, "AdminLink", "private")

	w := doRequest(r, authedRequest("POST", "/api/v1/projects/"+projectID+"/links", token, gin.H{
		"permission": "admin", // 不允许
	}))
	if w.Code != http.StatusBadRequest {
		t.Errorf("admin 权限链接应 400，实际 %d", w.Code)
	}
}

// TestW3_LinkExpiration：过期 token 失效（DB 直接 update 不走 API）。
func TestW3_LinkExpiration(t *testing.T) {
	r, repo := setupTestRouter(t)
	token, _, _, _ := registerTwoUsers(t, r)
	projectID := createProject(t, r, token, "Expired", "private")

	wCreate := doRequest(r, authedRequest("POST", "/api/v1/projects/"+projectID+"/links", token, gin.H{
		"permission": "read",
	}))
	body := parseJSON(t, wCreate.Body.Bytes())["data"].(map[string]any)
	linkID := body["link"].(map[string]any)["id"].(string)
	linkToken, _ := body["token"].(string)

	// 把 expires_at 设为过去
	_, err := repo.DB().Exec(`UPDATE share_links SET expires_at = '2000-01-01 00:00:00' WHERE id = ?`, linkID)
	if err != nil {
		t.Fatalf("update expires: %v", err)
	}

	w := doRequest(r, authedRequest("GET", "/api/v1/shared/"+linkToken, "", nil))
	if w.Code != http.StatusNotFound {
		t.Errorf("过期 token 应 404，实际 %d", w.Code)
	}
}

// TestW3_AnonymousCannotWrite：即使 token 是 write，公开端点没有 write 入口。
// M4.5 起 content 会被公开（供 Monaco 只读渲染）；写路径仍然全部 401/403。
func TestW3_AnonymousCannotWrite(t *testing.T) {
	r, _ := setupTestRouter(t)
	token, _, _, _ := registerTwoUsers(t, r)
	projectID := createProject(t, r, token, "WriteProtected", "private")

	wCreate := doRequest(r, authedRequest("POST", "/api/v1/projects/"+projectID+"/links", token, gin.H{
		"permission": "write",
	}))
	body := parseJSON(t, wCreate.Body.Bytes())["data"].(map[string]any)
	linkToken, _ := body["token"].(string)

	// 匿名尝试 POST 模型到 /models（无 JWT）→ 401（AuthRequired）
	wAnon := doRequest(r, authedRequest("POST", "/api/v1/models", "", gin.H{
		"projectId": projectID, "name": "x", "content": "y",
	}))
	if wAnon.Code != http.StatusUnauthorized {
		t.Errorf("匿名 POST 应 401，实际 %d", wAnon.Code)
	}
	// 公开端点可读，但写路径不暴露
	wShared := doRequest(r, authedRequest("GET", "/api/v1/shared/"+linkToken, "", nil))
	if wShared.Code != http.StatusOK {
		t.Fatalf("公开 GET 应 200，实际 %d", wShared.Code)
	}
	// 不再断言 content 字段缺失（M4.5 起故意暴露给 Monaco 只读渲染；
	// 内容可读性见 TestW45_SharedProjectExposesModelContent）
}

func containsJSONField(haystack, needle string) bool {
	for i := 0; i+len(needle) <= len(haystack); i++ {
		if haystack[i:i+len(needle)] == needle {
			return true
		}
	}
	return false
}

// TestW45_LinkMaxViews：maxViews=N 时，第 N+1 次访问应 404（uniform 失效）。
func TestW45_LinkMaxViews(t *testing.T) {
	r, _ := setupTestRouter(t)
	token, _, _, _ := registerTwoUsers(t, r)
	projectID := createProject(t, r, token, "MaxViews", "private")

	max := 2
	wCreate := doRequest(r, authedRequest("POST", "/api/v1/projects/"+projectID+"/links", token, gin.H{
		"permission": "read",
		"maxViews":   max,
	}))
	if wCreate.Code != http.StatusOK {
		t.Fatalf("create link: %d %s", wCreate.Code, wCreate.Body.String())
	}
	body := parseJSON(t, wCreate.Body.Bytes())["data"].(map[string]any)
	linkID := body["link"].(map[string]any)["id"].(string)
	linkToken, _ := body["token"].(string)

	// maxViews=2：前 2 次访问应成功
	for i := 1; i <= max; i++ {
		w := doRequest(r, authedRequest("GET", "/api/v1/shared/"+linkToken, "", nil))
		if w.Code != http.StatusOK {
			t.Fatalf("第 %d 次访问应 200，实际 %d", i, w.Code)
		}
	}

	// 第 3 次应 404（与 revoked/expired 一致 uniform 响应）
	wAfter := doRequest(r, authedRequest("GET", "/api/v1/shared/"+linkToken, "", nil))
	if wAfter.Code != http.StatusNotFound {
		t.Errorf("达到 max_views 后应 404，实际 %d", wAfter.Code)
	}
	_ = linkID
}

// TestW45_LinkMaxViewsRejectNegative：负数 maxViews 应 400。
func TestW45_LinkMaxViewsRejectNegative(t *testing.T) {
	r, _ := setupTestRouter(t)
	token, _, _, _ := registerTwoUsers(t, r)
	projectID := createProject(t, r, token, "BadMax", "private")

	w := doRequest(r, authedRequest("POST", "/api/v1/projects/"+projectID+"/links", token, gin.H{
		"permission": "read",
		"maxViews":   -1,
	}))
	if w.Code != http.StatusBadRequest {
		t.Errorf("负数 maxViews 应 400，实际 %d", w.Code)
	}
}

// TestW45_LinkUnlimitedWhenNull：maxViews=null 或缺省 → 不限次。
func TestW45_LinkUnlimitedWhenNull(t *testing.T) {
	r, _ := setupTestRouter(t)
	token, _, _, _ := registerTwoUsers(t, r)
	projectID := createProject(t, r, token, "Unlimited", "private")

	wCreate := doRequest(r, authedRequest("POST", "/api/v1/projects/"+projectID+"/links", token, gin.H{
		"permission": "read",
	}))
	body := parseJSON(t, wCreate.Body.Bytes())["data"].(map[string]any)
	linkToken, _ := body["token"].(string)

	// 访问 5 次都应成功
	for i := 0; i < 5; i++ {
		w := doRequest(r, authedRequest("GET", "/api/v1/shared/"+linkToken, "", nil))
		if w.Code != http.StatusOK {
			t.Fatalf("第 %d 次访问应 200（无限），实际 %d", i+1, w.Code)
		}
	}
}

// TestW45_SharedProjectExposesModelContent：M4.5 增量 — 公开项目视图暴露
// model.content 字段，让前端 Monaco 只读渲染可以工作。仍无 write 入口。
func TestW45_SharedProjectExposesModelContent(t *testing.T) {
	r, _ := setupTestRouter(t)
	token, _, _, _ := registerTwoUsers(t, r)
	projectID := createProject(t, r, token, "ReadOnlyView", "private")

	// owner 在项目下创建一个模型，含 SysML 内容
	wCreate := doRequest(r, authedRequest("POST", "/api/v1/models", token, gin.H{
		"projectId": projectID,
		"name":      "VehiclePkg",
		"content":   "package Vehicle { part engine; }",
	}))
	if wCreate.Code != http.StatusOK {
		t.Fatalf("create model: %d %s", wCreate.Code, wCreate.Body.String())
	}

	// 创建 read link
	wLink := doRequest(r, authedRequest("POST", "/api/v1/projects/"+projectID+"/links", token, gin.H{
		"permission": "read",
	}))
	body := parseJSON(t, wLink.Body.Bytes())["data"].(map[string]any)
	linkToken, _ := body["token"].(string)

	// 公开访问
	wShared := doRequest(r, authedRequest("GET", "/api/v1/shared/"+linkToken, "", nil))
	if wShared.Code != http.StatusOK {
		t.Fatalf("shared view: %d", wShared.Code)
	}
	d := parseJSON(t, wShared.Body.Bytes())["data"].(map[string]any)
	models := d["models"].([]any)
	if len(models) != 1 {
		t.Fatalf("应 1 个模型，实际 %d", len(models))
	}
	m := models[0].(map[string]any)
	if got, _ := m["content"].(string); got != "package Vehicle { part engine; }" {
		t.Errorf("content 应被公开暴露供 Monaco 只读渲染，实际 %q", got)
	}
}

// TestW45_LinkRotation：rotate 后旧 token 立即失效，新 token 工作。
func TestW45_LinkRotation(t *testing.T) {
	r, _ := setupTestRouter(t)
	token, _, _, _ := registerTwoUsers(t, r)
	projectID := createProject(t, r, token, "Rotate", "private")

	// 创建初始 link
	wCreate := doRequest(r, authedRequest("POST", "/api/v1/projects/"+projectID+"/links", token, gin.H{
		"permission": "read",
	}))
	body := parseJSON(t, wCreate.Body.Bytes())["data"].(map[string]any)
	oldLinkID := body["link"].(map[string]any)["id"].(string)
	oldToken, _ := body["token"].(string)

	// rotate
	wRot := doRequest(r, authedRequest("POST", "/api/v1/projects/"+projectID+"/links/"+oldLinkID+"/rotate", token, nil))
	if wRot.Code != http.StatusOK {
		t.Fatalf("rotate: %d %s", wRot.Code, wRot.Body.String())
	}
	rotBody := parseJSON(t, wRot.Body.Bytes())["data"].(map[string]any)
	newLinkID := rotBody["link"].(map[string]any)["id"].(string)
	newToken, _ := rotBody["token"].(string)

	if newLinkID == oldLinkID {
		t.Errorf("rotate 后应是新 link id，与旧相同")
	}
	if newToken == oldToken {
		t.Errorf("rotate 后应是新 token，与旧相同")
	}

	// 旧 token 失效
	wOld := doRequest(r, authedRequest("GET", "/api/v1/shared/"+oldToken, "", nil))
	if wOld.Code != http.StatusNotFound {
		t.Errorf("rotate 后旧 token 应 404，实际 %d", wOld.Code)
	}

	// 新 token 工作
	wNew := doRequest(r, authedRequest("GET", "/api/v1/shared/"+newToken, "", nil))
	if wNew.Code != http.StatusOK {
		t.Errorf("rotate 后新 token 应 200，实际 %d", wNew.Code)
	}

	// 旧 link 的 revoked_at 应被设置
	wList := doRequest(r, authedRequest("GET", "/api/v1/projects/"+projectID+"/links", token, nil))
	links := parseJSON(t, wList.Body.Bytes())["data"].([]any)
	if len(links) != 2 {
		t.Errorf("rotate 后应 2 条链接（1 revoked + 1 新），实际 %d", len(links))
	}
}

// TestW45_LinkRotationRejectedAfterRevoke：已撤销的 link 不能 rotate。
func TestW45_LinkRotationRejectedAfterRevoke(t *testing.T) {
	r, _ := setupTestRouter(t)
	token, _, _, _ := registerTwoUsers(t, r)
	projectID := createProject(t, r, token, "RotateRevoke", "private")

	wCreate := doRequest(r, authedRequest("POST", "/api/v1/projects/"+projectID+"/links", token, gin.H{
		"permission": "read",
	}))
	linkID := parseJSON(t, wCreate.Body.Bytes())["data"].(map[string]any)["link"].(map[string]any)["id"].(string)

	// 先撤销
	doRequest(r, authedRequest("DELETE", "/api/v1/projects/"+projectID+"/links/"+linkID, token, nil))

	// 再 rotate 应 400
	wRot := doRequest(r, authedRequest("POST", "/api/v1/projects/"+projectID+"/links/"+linkID+"/rotate", token, nil))
	if wRot.Code != http.StatusBadRequest {
		t.Errorf("已撤销 link rotate 应 400，实际 %d", wRot.Code)
	}
}
	r, _ := setupTestRouter(t)
	token, _, _, _ := registerTwoUsers(t, r)
	projectID := createProject(t, r, token, "ReadOnlyView", "private")

	// owner 在项目下创建一个模型，含 SysML 内容
	wCreate := doRequest(r, authedRequest("POST", "/api/v1/models", token, gin.H{
		"projectId": projectID,
		"name":      "VehiclePkg",
		"content":   "package Vehicle { part engine; }",
	}))
	if wCreate.Code != http.StatusOK {
		t.Fatalf("create model: %d %s", wCreate.Code, wCreate.Body.String())
	}

	// 创建 read link
	wLink := doRequest(r, authedRequest("POST", "/api/v1/projects/"+projectID+"/links", token, gin.H{
		"permission": "read",
	}))
	body := parseJSON(t, wLink.Body.Bytes())["data"].(map[string]any)
	linkToken, _ := body["token"].(string)

	// 公开访问
	wShared := doRequest(r, authedRequest("GET", "/api/v1/shared/"+linkToken, "", nil))
	if wShared.Code != http.StatusOK {
		t.Fatalf("shared view: %d", wShared.Code)
	}
	d := parseJSON(t, wShared.Body.Bytes())["data"].(map[string]any)
	models := d["models"].([]any)
	if len(models) != 1 {
		t.Fatalf("应 1 个模型，实际 %d", len(models))
	}
	m := models[0].(map[string]any)
	if got, _ := m["content"].(string); got != "package Vehicle { part engine; }" {
		t.Errorf("content 应被公开暴露供 Monaco 只读渲染，实际 %q", got)
	}
}

// TestW45_AbuseMonitorUnit：滑动窗口单独单测（不走 HTTP）。
func TestW45_AbuseMonitorUnit(t *testing.T) {
	m := newAbuseMonitor(5, time.Minute)
	linkID, ip := "link-1", "1.2.3.4"
	// 前 4 次不触发
	for i := 0; i < 4; i++ {
		if m.recordAndCheck(linkID, ip) {
			t.Fatalf("第 %d 次不应触发 abuse", i+1)
		}
	}
	// 第 5 次刚好达阈值，应触发
	if !m.recordAndCheck(linkID, ip) {
		t.Errorf("第 5 次应触发 abuse 信号")
	}
	// 节流：同 key 立即再访问不应再次触发
	if m.recordAndCheck(linkID, ip) {
		t.Errorf("节流期内同 key 不应再次触发")
	}
	// 不同 IP 独立计数
	if m.recordAndCheck(linkID, "9.9.9.9") {
		t.Errorf("不同 IP 应独立计数，不应触发 abuse")
	}
}

// TestW45_LinkAbuseAuditOnExcess：M4.5 增量 — 公开端点超阈值后写 link_abuse 审计。
func TestW45_LinkAbuseAuditOnExcess(t *testing.T) {
	r, _ := setupTestRouter(t)
	token, _, _, _ := registerTwoUsers(t, r)
	projectID := createProject(t, r, token, "AbuseTest", "private")

	wLink := doRequest(r, authedRequest("POST", "/api/v1/projects/"+projectID+"/links", token, gin.H{
		"permission": "read",
	}))
	linkID := parseJSON(t, wLink.Body.Bytes())["data"].(map[string]any)["link"].(map[string]any)["id"].(string)
	tokenStr := parseJSON(t, wLink.Body.Bytes())["data"].(map[string]any)["token"].(string)

	// 临时调小阈值便于测试
	prev := defaultAbuseMonitor
	defaultAbuseMonitor = newAbuseMonitor(3, time.Minute)
	t.Cleanup(func() { defaultAbuseMonitor = prev })

	// 连访 5 次 — 触发一次 abuse（阈值 3，节流防重复）
	for i := 0; i < 5; i++ {
		w := doRequest(r, authedRequest("GET", "/api/v1/shared/"+tokenStr, "", nil))
		if w.Code != http.StatusOK {
			t.Fatalf("第 %d 次访问公开页：%d", i+1, w.Code)
		}
	}

	// 查询审计 — 应有 link_abuse 行（target=share_link.id）
	wLogs := doRequest(r, authedRequest("GET", "/api/v1/audit-logs?targetType=link&targetId="+linkID, token, nil))
	logs := parseJSON(t, wLogs.Body.Bytes())["data"].([]any)
	found := false
	for _, l := range logs {
		m := l.(map[string]any)
		if m["action"] == "link_abuse" {
			found = true
			break
		}
	}
	if !found {
		t.Errorf("应产生 link_abuse 审计，实际：%v", logs)
	}
}
