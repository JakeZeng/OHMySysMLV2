package handler

import (
	"net/http"
	"testing"

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
