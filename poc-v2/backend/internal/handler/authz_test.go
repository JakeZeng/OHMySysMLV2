package handler

import (
	"bytes"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/gin-gonic/gin"

	"github.com/sysmlv2/mbse-backend/internal/model"
)

// ─── W1 跨用户授权回归测试 ──────────────────────────────────────────────
//
// 验证：项目/模型资源不再对任意登录用户开放。
// 覆盖：
//   - ListProjects 仅返回 user 可访问的项目（owner/team/direct share 三路）
//   - GetProject / UpdateProject / DeleteProject：B 不能操作 A 的项目
//   - ListModels / GetModel / UpdateModel / DeleteModel：B 不能操作 A 的模型
//   - visibility=public 允许匿名 read；private 不允许匿名
//   - project_shares 直分享路径生效
//   - team_project_access 团队分享路径生效

// helper：注册两个用户 A 和 B，返回两个 token
func registerTwoUsers(t *testing.T, r *gin.Engine) (tokenA, tokenB, idA, idB string) {
	t.Helper()
	respA := registerUser(t, r, "alice", "alice@example.com", "pass-1234")
	respB := registerUser(t, r, "bob", "bob@example.com", "pass-1234")
	return authToken(t, respA), authToken(t, respB),
		userIDFromResp(respA), userIDFromResp(respB)
}

func userIDFromResp(resp map[string]any) string {
	data := resp["data"].(map[string]any)
	user := data["user"].(map[string]any)
	return user["id"].(string)
}

// helper：authedRequest 带 JWT + Content-Type
func authedRequest(method, path, token string, body any) *http.Request {
	var buf *bytes.Buffer
	if body != nil {
		b, _ := json.Marshal(body)
		buf = bytes.NewBuffer(b)
	} else {
		buf = bytes.NewBuffer(nil)
	}
	req := httptest.NewRequest(method, path, buf)
	req.Header.Set("Authorization", "Bearer "+token)
	req.Header.Set("Content-Type", "application/json")
	return req
}

func doRequest(r *gin.Engine, req *http.Request) *httptest.ResponseRecorder {
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)
	return w
}

// A 创建项目
func createProject(t *testing.T, r *gin.Engine, token, name, visibility string) string {
	t.Helper()
	req := authedRequest("POST", "/api/v1/projects", token, gin.H{
		"name": name, "description": "test", "visibility": visibility,
	})
	w := doRequest(r, req)
	if w.Code != http.StatusOK {
		t.Fatalf("create project failed: status=%d body=%s", w.Code, w.Body.String())
	}
	data := parseJSON(t, w.Body.Bytes())["data"].(map[string]any)
	return data["id"].(string)
}

// ─── 核心场景 ─────────────────────────────────────────────────────────

// TestW1_CrossUserProjectIsolation：用户隔离最基础场景
func TestW1_CrossUserProjectIsolation(t *testing.T) {
	r, _ := setupTestRouter(t)
	tokenA, tokenB, _, _ := registerTwoUsers(t, r)

	// A 创建项目
	projectID := createProject(t, r, tokenA, "A's Project", "private")

	// A 自己能 ListProjects 看到
	wA := doRequest(r, authedRequest("GET", "/api/v1/projects", tokenA, nil))
	if wA.Code != http.StatusOK {
		t.Fatalf("A list failed: %d", wA.Code)
	}
	projectsA := parseJSON(t, wA.Body.Bytes())["data"].([]any)
	if len(projectsA) != 1 {
		t.Errorf("A 应该看到 1 个项目，实际 %d", len(projectsA))
	}

	// B 看 ListProjects：空
	wB := doRequest(r, authedRequest("GET", "/api/v1/projects", tokenB, nil))
	projectsB := parseJSON(t, wB.Body.Bytes())["data"].([]any)
	if len(projectsB) != 0 {
		t.Errorf("B 不应看到 A 的项目，实际看到 %d 个", len(projectsB))
	}

	// B GET A 的项目 → 403（项目存在但 B 无权限）
	wBGet := doRequest(r, authedRequest("GET", "/api/v1/projects/"+projectID, tokenB, nil))
	if wBGet.Code != http.StatusForbidden {
		t.Errorf("B GET A 的项目应返回 403，实际 %d (body=%s)", wBGet.Code, wBGet.Body.String())
	}

	// B PUT A 的项目 → 403
	wBPut := doRequest(r, authedRequest("PUT", "/api/v1/projects/"+projectID, tokenB, gin.H{
		"name": "hijacked", "description": "no",
	}))
	if wBPut.Code != http.StatusForbidden {
		t.Errorf("B PUT A 的项目应返回 403，实际 %d", wBPut.Code)
	}

	// B DELETE A 的项目 → 403
	wBDel := doRequest(r, authedRequest("DELETE", "/api/v1/projects/"+projectID, tokenB, nil))
	if wBDel.Code != http.StatusForbidden {
		t.Errorf("B DELETE A 的项目应返回 403，实际 %d", wBDel.Code)
	}

	// A 自己仍能正常操作
	wAGet := doRequest(r, authedRequest("GET", "/api/v1/projects/"+projectID, tokenA, nil))
	if wAGet.Code != http.StatusOK {
		t.Errorf("A GET 自己的项目应 200，实际 %d", wAGet.Code)
	}
}

// TestW1_CrossUserModelIsolation：模型隔离
func TestW1_CrossUserModelIsolation(t *testing.T) {
	r, _ := setupTestRouter(t)
	tokenA, tokenB, _, _ := registerTwoUsers(t, r)

	projectID := createProject(t, r, tokenA, "A's Project", "private")

	// A 在项目里创建模型
	req := authedRequest("POST", "/api/v1/projects/"+projectID+"/models", tokenA, gin.H{
		"name": "engine", "content": "package V { part def Engine; }",
	})
	w := doRequest(r, req)
	if w.Code != http.StatusOK {
		t.Fatalf("A create model failed: %d %s", w.Code, w.Body.String())
	}
	modelID := parseJSON(t, w.Body.Bytes())["data"].(map[string]any)["id"].(string)

	// B 不能通过 /projects/:id/models 列举
	wBList := doRequest(r, authedRequest("GET", "/api/v1/projects/"+projectID+"/models", tokenB, nil))
	if wBList.Code != http.StatusForbidden {
		t.Errorf("B list A 项目下的模型应 403，实际 %d", wBList.Code)
	}

	// B 不能通过 /models/:id 取模型
	wBGet := doRequest(r, authedRequest("GET", "/api/v1/models/"+modelID, tokenB, nil))
	if wBGet.Code != http.StatusForbidden {
		t.Errorf("B GET A 的模型应 403，实际 %d", wBGet.Code)
	}

	// B 不能 PUT
	wBPut := doRequest(r, authedRequest("PUT", "/api/v1/models/"+modelID, tokenB, gin.H{
		"name": "x", "content": "y", "version": 1,
	}))
	if wBPut.Code != http.StatusForbidden {
		t.Errorf("B PUT A 的模型应 403，实际 %d", wBPut.Code)
	}

	// B 不能 DELETE
	wBDel := doRequest(r, authedRequest("DELETE", "/api/v1/models/"+modelID, tokenB, nil))
	if wBDel.Code != http.StatusForbidden {
		t.Errorf("B DELETE A 的模型应 403，实际 %d", wBDel.Code)
	}

	// A 仍可正常 PUT
	wAPut := doRequest(r, authedRequest("PUT", "/api/v1/models/"+modelID, tokenA, gin.H{
		"name": "engine-v2", "content": "package V { part def EngineV2; }", "version": 1,
	}))
	if wAPut.Code != http.StatusOK {
		t.Errorf("A PUT 自己的模型应 200，实际 %d body=%s", wAPut.Code, wAPut.Body.String())
	}
}

// TestW1_PublicProjectAnonymousRead：visibility=public 时 owner 能正常读
// （公开匿名读的真实路径是 /shared/:token，W3 实现；本测试只验证 visibility 字段不影响 owner）
func TestW1_PublicProjectOwnerRead(t *testing.T) {
	r, _ := setupTestRouter(t)
	tokenA, _, _, _ := registerTwoUsers(t, r)

	projectID := createProject(t, r, tokenA, "Public Project", "public")
	wB := doRequest(r, authedRequest("GET", "/api/v1/projects/"+projectID, tokenA, nil))
	if wB.Code != http.StatusOK {
		t.Errorf("A GET 自己的 public 项目应 200，实际 %d", wB.Code)
	}
}

// TestW1_VisibilityStoredCorrectly：visibility 字段读写一致
func TestW1_VisibilityStoredCorrectly(t *testing.T) {
	r, _ := setupTestRouter(t)
	token, _, _, _ := registerTwoUsers(t, r)

	for _, vis := range []string{"private", "team", "public"} {
		pid := createProject(t, r, token, "P-"+vis, vis)
		w := doRequest(r, authedRequest("GET", "/api/v1/projects/"+pid, token, nil))
		if w.Code != http.StatusOK {
			t.Fatalf("GET %s failed: %d", vis, w.Code)
		}
		data := parseJSON(t, w.Body.Bytes())["data"].(map[string]any)
		if data["visibility"] != vis {
			t.Errorf("visibility 应为 %s，实际 %v", vis, data["visibility"])
		}
	}
}

// TestW1_ListAccessibleProjects_OwnsOnly：W1 阶段团队表为空时只返回 owner 的项目
func TestW1_ListAccessibleProjects_OwnsOnly(t *testing.T) {
	r, _ := setupTestRouter(t)
	tokenA, tokenB, _, _ := registerTwoUsers(t, r)

	_ = createProject(t, r, tokenA, "A1", "private")
	_ = createProject(t, r, tokenA, "A2", "private")
	_ = createProject(t, r, tokenB, "B1", "private")

	wA := doRequest(r, authedRequest("GET", "/api/v1/projects", tokenA, nil))
	wB := doRequest(r, authedRequest("GET", "/api/v1/projects", tokenB, nil))

	listA := parseJSON(t, wA.Body.Bytes())["data"].([]any)
	listB := parseJSON(t, wB.Body.Bytes())["data"].([]any)

	if len(listA) != 2 {
		t.Errorf("A 应看到 2 个，实际 %d", len(listA))
	}
	if len(listB) != 1 {
		t.Errorf("B 应看到 1 个，实际 %d", len(listB))
	}
}

// TestW1_DirectShare：M4 W2 后此场景由 team_project_access 触发；此处用 INSERT 模拟 W3 直分享
// （W1 仅验证 ListAccessibleProjects UNION 子句本身正确）
func TestW1_ListAccessibleProjects_DirectShare(t *testing.T) {
	r, repo := setupTestRouter(t)
	tokenA, tokenB, idA, idB := registerTwoUsers(t, r)

	projectID := createProject(t, r, tokenA, "Shared with B", "private")

	// 直接往 project_shares 写一条记录（W2/W3 还没有 endpoint）
	_, err := repo.DB().Exec(
		`INSERT INTO project_shares (project_id, user_id, permission, granted_by) VALUES (?, ?, 'read', ?)`,
		projectID, idB, idA,
	)
	if err != nil {
		t.Fatalf("insert project_shares failed: %v", err)
	}

	wB := doRequest(r, authedRequest("GET", "/api/v1/projects", tokenB, nil))
	listB := parseJSON(t, wB.Body.Bytes())["data"].([]any)
	if len(listB) != 1 {
		t.Errorf("B 应通过直分享看到 1 个项目，实际 %d", len(listB))
	}

	// B GET 应 200（read 权限）
	wBGet := doRequest(r, authedRequest("GET", "/api/v1/projects/"+projectID, tokenB, nil))
	if wBGet.Code != http.StatusOK {
		t.Errorf("B GET 被分享的项目应 200，实际 %d", wBGet.Code)
	}

	// B PUT 应 403（只有 read，无 write）
	wBPut := doRequest(r, authedRequest("PUT", "/api/v1/projects/"+projectID, tokenB, gin.H{
		"name": "hijack", "description": "",
	}))
	if wBPut.Code != http.StatusForbidden {
		t.Errorf("B PUT read-only 项目应 403，实际 %d", wBPut.Code)
	}
}

// TestW1_TeamShare：团队授权路径
func TestW1_TeamShare(t *testing.T) {
	r, repo := setupTestRouter(t)
	tokenA, tokenB, idA, idB := registerTwoUsers(t, r)

	projectID := createProject(t, r, tokenA, "Team-shared", "private")

	// 直接构造 team + membership + access（W2 endpoint 未到位）
	teamID := "test-team-1"
	now := time.Now().UTC()
	_, err := repo.DB().Exec(
		`INSERT INTO teams (id, name, created_at, updated_at) VALUES (?, ?, ?, ?)`,
		teamID, "Test Team", now, now,
	)
	if err != nil {
		t.Fatalf("insert team failed: %v", err)
	}
	_, err = repo.DB().Exec(
		`INSERT INTO team_members (team_id, user_id, role) VALUES (?, ?, 'owner'), (?, ?, 'member')`,
		teamID, idA, teamID, idB,
	)
	if err != nil {
		t.Fatalf("insert team_members failed: %v", err)
	}
	_, err = repo.DB().Exec(
		`INSERT INTO team_project_access (team_id, project_id, permission, granted_by) VALUES (?, ?, 'write', ?)`,
		teamID, projectID, idA,
	)
	if err != nil {
		t.Fatalf("insert team_project_access failed: %v", err)
	}

	// B 现在能看到这个项目（team write）
	wBList := doRequest(r, authedRequest("GET", "/api/v1/projects", tokenB, nil))
	listB := parseJSON(t, wBList.Body.Bytes())["data"].([]any)
	if len(listB) != 1 {
		t.Errorf("B 应通过团队看到 1 个项目，实际 %d", len(listB))
	}

	// B 可以 PUT（write 权限）
	wBPut := doRequest(r, authedRequest("PUT", "/api/v1/projects/"+projectID, tokenB, gin.H{
		"name": "B updated", "description": "via team",
	}))
	if wBPut.Code != http.StatusOK {
		t.Errorf("B PUT team-write 项目应 200，实际 %d body=%s", wBPut.Code, wBPut.Body.String())
	}

	// 但 B 不能改 visibility（仅 owner 可改）
	wBVis := doRequest(r, authedRequest("PUT", "/api/v1/projects/"+projectID, tokenB, gin.H{
		"name": "B updated", "description": "via team", "visibility": "public",
	}))
	if wBVis.Code != http.StatusForbidden {
		t.Errorf("B 改 visibility 应 403（仅 owner），实际 %d", wBVis.Code)
	}
}

// TestW1_VisibilityBadValueRejected：非法 visibility 字符串被拒绝（400）
func TestW1_VisibilityBadValueRejected(t *testing.T) {
	r, _ := setupTestRouter(t)
	token, _, _, _ := registerTwoUsers(t, r)

	// 非法值（handler 校验拒绝，不入 SQL）
	body, _ := json.Marshal(gin.H{"name": "BadVis", "description": "", "visibility": "evil"})
	req := httptest.NewRequest("POST", "/api/v1/projects", bytes.NewReader(body))
	req.Header.Set("Authorization", "Bearer "+token)
	req.Header.Set("Content-Type", "application/json")
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)

	if w.Code != http.StatusBadRequest {
		t.Errorf("非法 visibility 应 400，实际 %d body=%s", w.Code, w.Body.String())
	}
}

// 避免 unused import
var _ = model.VisibilityPrivate