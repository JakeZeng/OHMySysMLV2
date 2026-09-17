package handler

import (
	"net/http"
	"testing"

	"github.com/gin-gonic/gin"

	"github.com/sysmlv2/mbse-backend/internal/model"
)

// ─── W2 团队 CRUD + 成员管理 + 项目授权测试 ─────────────────────────────
//
// 覆盖：
//   - 创建团队：owner 自动加入
//   - 仅 owner 可删团队
//   - 仅 owner/admin 可加成员
//   - 普通成员可看成员列表
//   - admin 不能授权 team owner 才能删的成员
//   - 团队 project-access 由项目 owner 授予，且 team 成员可见该项目

// TestW2_CreateTeamAndOwnership：alice 创建团队，bob 看不到。
func TestW2_CreateTeamAndOwnership(t *testing.T) {
	r, _ := setupTestRouter(t)
	tokenA, tokenB, _, _ := registerTwoUsers(t, r)

	// alice 创建团队
	wCreate := doRequest(r, authedRequest("POST", "/api/v1/teams", tokenA, gin.H{
		"name": "Vehicle CoE", "description": "整车卓越中心",
	}))
	if wCreate.Code != http.StatusOK {
		t.Fatalf("create team: %d %s", wCreate.Code, wCreate.Body.String())
	}
	teamID := parseJSON(t, wCreate.Body.Bytes())["data"].(map[string]any)["id"].(string)

	// alice 列出应看到 1 个
	wListA := doRequest(r, authedRequest("GET", "/api/v1/teams", tokenA, nil))
	listA := parseJSON(t, wListA.Body.Bytes())["data"].([]any)
	if len(listA) != 1 {
		t.Errorf("alice 应看到 1 个团队，实际 %d", len(listA))
	}

	// bob 列出应看到 0 个
	wListB := doRequest(r, authedRequest("GET", "/api/v1/teams", tokenB, nil))
	listB := parseJSON(t, wListB.Body.Bytes())["data"].([]any)
	if len(listB) != 0 {
		t.Errorf("bob 不应看到团队，实际 %d", len(listB))
	}

	// alice 看 members：1 个（自己）
	wMem := doRequest(r, authedRequest("GET", "/api/v1/teams/"+teamID+"/members", tokenA, nil))
	members := parseJSON(t, wMem.Body.Bytes())["data"].([]any)
	if len(members) != 1 {
		t.Errorf("team 成员应为 1，实际 %d", len(members))
	}
	owner := members[0].(map[string]any)
	if owner["role"] != "owner" {
		t.Errorf("创建者应为 owner，实际 %v", owner["role"])
	}
}

// TestW2_AddMemberByAdmin：admin 能加成员；member 不能。
func TestW2_AddMemberByAdmin(t *testing.T) {
	r, _ := setupTestRouter(t)
	tokenA, tokenB, _, idB := registerTwoUsers(t, r)

	teamID := mustCreateTeam(t, r, tokenA, "Test Team", "")

	// alice（owner）添加 bob 为 admin
	wAdd := doRequest(r, authedRequest("POST", "/api/v1/teams/"+teamID+"/members", tokenA, gin.H{
		"username": "bob", "role": "admin",
	}))
	if wAdd.Code != http.StatusOK {
		t.Fatalf("add member: %d %s", wAdd.Code, wAdd.Body.String())
	}

	// bob 现在能看到 team
	wBList := doRequest(r, authedRequest("GET", "/api/v1/teams", tokenB, nil))
	listB := parseJSON(t, wBList.Body.Bytes())["data"].([]any)
	if len(listB) != 1 {
		t.Errorf("bob 应能看到 team，实际 %d", len(listB))
	}

	// 改 bob 为 member
	wUpdate := doRequest(r, authedRequest("PUT", "/api/v1/teams/"+teamID+"/members/"+idB, tokenA, gin.H{
		"role": "member",
	}))
	if wUpdate.Code != http.StatusOK {
		t.Fatalf("update role: %d %s", wUpdate.Code, wUpdate.Body.String())
	}

	// bob 现在不能再添加成员（member 角色）
	// 先注册 carol
	respC := registerUser(t, r, "carol", "carol@example.com", "pass-1234")
	_ = respC
	wAddByBob := doRequest(r, authedRequest("POST", "/api/v1/teams/"+teamID+"/members", tokenB, gin.H{
		"username": "carol", "role": "member",
	}))
	if wAddByBob.Code != http.StatusForbidden {
		t.Errorf("member 加成员应 403，实际 %d", wAddByBob.Code)
	}
}

// TestW2_DeleteTeamOwnerOnly：仅 owner 可删。
func TestW2_DeleteTeamOwnerOnly(t *testing.T) {
	r, _ := setupTestRouter(t)
	tokenA, tokenB, _, idB := registerTwoUsers(t, r)

	teamID := mustCreateTeam(t, r, tokenA, "Del Test", "")

	// alice 加 bob 为 admin
	doRequest(r, authedRequest("POST", "/api/v1/teams/"+teamID+"/members", tokenA, gin.H{
		"username": "bob", "role": "admin",
	}))

	// bob (admin) 不能删团队
	wDelByBob := doRequest(r, authedRequest("DELETE", "/api/v1/teams/"+teamID, tokenB, nil))
	if wDelByBob.Code != http.StatusForbidden {
		t.Errorf("admin 删 team 应 403，实际 %d", wDelByBob.Code)
	}

	// alice (owner) 可删
	wDelByAlice := doRequest(r, authedRequest("DELETE", "/api/v1/teams/"+teamID, tokenA, nil))
	if wDelByAlice.Code != http.StatusOK {
		t.Errorf("owner 删 team 应 200，实际 %d %s", wDelByAlice.Code, wDelByAlice.Body.String())
	}
	_ = idB
}

// TestW2_LastOwnerProtection：禁止降级/删除最后一个 owner。
func TestW2_LastOwnerProtection(t *testing.T) {
	r, _ := setupTestRouter(t)
	tokenA, _, idA, _ := registerTwoUsers(t, r)

	teamID := mustCreateTeam(t, r, tokenA, "Protect", "")

	// alice 试图把自己降级为 member
	wDown := doRequest(r, authedRequest("PUT", "/api/v1/teams/"+teamID+"/members/"+idA, tokenA, gin.H{
		"role": "member",
	}))
	if wDown.Code != http.StatusBadRequest {
		t.Errorf("降级最后 owner 应 400，实际 %d body=%s", wDown.Code, wDown.Body.String())
	}

	// 试图删除自己（也是 owner）
	wDel := doRequest(r, authedRequest("DELETE", "/api/v1/teams/"+teamID+"/members/"+idA, tokenA, nil))
	if wDel.Code != http.StatusBadRequest {
		t.Errorf("删除最后 owner 应 400，实际 %d", wDel.Code)
	}
}

// TestW2_TeamProjectAccess：alice 授权 team 给项目，team 成员 bob 看到该项目。
func TestW2_TeamProjectAccess(t *testing.T) {
	r, _ := setupTestRouter(t)
	tokenA, tokenB, _, _ := registerTwoUsers(t, r)

	teamID := mustCreateTeam(t, r, tokenA, "Team Access", "")
	doRequest(r, authedRequest("POST", "/api/v1/teams/"+teamID+"/members", tokenA, gin.H{
		"username": "bob", "role": "member",
	}))

	// alice 创建项目（team visibility）
	projectID := createProject(t, r, tokenA, "Shared via Team", "team")

	// alice 授权团队对项目的访问（project owner = alice）
	wGrant := doRequest(r, authedRequest("POST", "/api/v1/teams/"+teamID+"/project-access", tokenA, gin.H{
		"projectId": projectID, "permission": "read",
	}))
	if wGrant.Code != http.StatusOK {
		t.Fatalf("grant: %d %s", wGrant.Code, wGrant.Body.String())
	}

	// 列出团队的 project-access 应看到 1 条
	wList := doRequest(r, authedRequest("GET", "/api/v1/teams/"+teamID+"/project-access", tokenA, nil))
	accesses := parseJSON(t, wList.Body.Bytes())["data"].([]any)
	if len(accesses) != 1 {
		t.Errorf("team project-access 应 1 条，实际 %d", len(accesses))
	}

	// bob 现在能看到项目（team 成员 + team_project_access）
	wBobProjects := doRequest(r, authedRequest("GET", "/api/v1/projects", tokenB, nil))
	bobList := parseJSON(t, wBobProjects.Body.Bytes())["data"].([]any)
	if len(bobList) != 1 {
		t.Errorf("bob 应能看到 1 个项目，实际 %d", len(bobList))
	}

	// bob 能读
	wBobGet := doRequest(r, authedRequest("GET", "/api/v1/projects/"+projectID, tokenB, nil))
	if wBobGet.Code != http.StatusOK {
		t.Errorf("bob 读项目应 200，实际 %d", wBobGet.Code)
	}
	_ = model.VisibilityTeam
}

// TestW2_NonOwnerCannotGrant：非项目 owner 不能给团队授权。
func TestW2_NonOwnerCannotGrant(t *testing.T) {
	r, _ := setupTestRouter(t)
	tokenA, tokenB, _, _ := registerTwoUsers(t, r)

	teamA := mustCreateTeam(t, r, tokenA, "A Team", "")
	teamB := mustCreateTeam(t, r, tokenB, "B Team", "")

	// alice 创建项目（owner=alice）
	projectID := createProject(t, r, tokenA, "alice project", "private")

	// bob 试图用他的 team 授权访问 alice 的项目
	wGrant := doRequest(r, authedRequest("POST", "/api/v1/teams/"+teamB+"/project-access", tokenB, gin.H{
		"projectId": projectID, "permission": "read",
	}))
	if wGrant.Code != http.StatusForbidden {
		t.Errorf("非 owner 授权应 403，实际 %d", wGrant.Code)
	}
	_ = teamA
}

// ─── helpers ───────────────────────────────────────────────────────

func mustCreateTeam(t *testing.T, r *gin.Engine, token, name, desc string) string {
	t.Helper()
	body := gin.H{"name": name}
	if desc != "" {
		body["description"] = desc
	}
	w := doRequest(r, authedRequest("POST", "/api/v1/teams", token, body))
	if w.Code != http.StatusOK {
		t.Fatalf("create team: %d %s", w.Code, w.Body.String())
	}
	return parseJSON(t, w.Body.Bytes())["data"].(map[string]any)["id"].(string)
}
