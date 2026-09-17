package handler

import (
	"encoding/json"
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

// TestW3_AnonymousCannotWrite：即使 token 是 write，公开端点只 GET 元数据，没有 write 入口。
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
	// 公开端点只暴露 GET 项目 + GET 模型列表（不含 model 内容）；写路径不暴露
	wShared := doRequest(r, authedRequest("GET", "/api/v1/shared/"+linkToken, "", nil))
	if wShared.Code != http.StatusOK {
		t.Fatalf("公开 GET 应 200，实际 %d", wShared.Code)
	}
	d := parseJSON(t, wShared.Body.Bytes())["data"].(map[string]any)
	// models 数组只列元数据（id/name/version），不含 content
	models, _ := d["models"].([]any)
	if len(models) > 0 {
		m := models[0].(map[string]any)
		if _, hasContent := m["content"]; hasContent {
			t.Errorf("公开模型列表不应包含 content 字段")
		}
	}
	// 序列化时检查 raw JSON 不含 content 字段（双重保险）
	raw, _ := json.Marshal(d["models"])
	if got := string(raw); got != "" && got != "null" && got != "[]" {
		if containsJSONField(got, `"content":`) {
			t.Errorf("公开 models 不应含 content：%s", got)
		}
	}
}

func containsJSONField(haystack, needle string) bool {
	for i := 0; i+len(needle) <= len(haystack); i++ {
		if haystack[i:i+len(needle)] == needle {
			return true
		}
	}
	return false
}
