// Package handler — M4 W2 团队 CRUD + 成员管理 + 项目授权。
package handler

import (
	"errors"
	"net/http"

	"github.com/gin-gonic/gin"

	"github.com/sysmlv2/mbse-backend/internal/model"
	"github.com/sysmlv2/mbse-backend/internal/repository"
)

// TeamHandler 处理 /api/v1/teams/* 路由组。
type TeamHandler struct {
	repo *repository.SQLiteRepository
}

// NewTeamHandler 构造 TeamHandler。
func NewTeamHandler(repo *repository.SQLiteRepository) *TeamHandler {
	return &TeamHandler{repo: repo}
}

// ─── Teams ────────────────────────────────────────────────────────────

type createTeamReq struct {
	Name        string `json:"name" binding:"required,min=1,max=100"`
	Description string `json:"description"`
}

func (h *TeamHandler) CreateTeam(c *gin.Context) {
	userID := c.GetString("user_id")
	var req createTeamReq
	if err := c.ShouldBindJSON(&req); err != nil {
		badRequest(c, "请求参数无效", err.Error())
		return
	}
	t, err := h.repo.CreateTeam(c, userID, req.Name, req.Description)
	if err != nil {
		serverError(c, "创建团队失败", err)
		return
	}
	writeAudit(c, h.repo, model.AuditActionTeamCreate, model.AuditTargetTeam, t.ID,
		`{"name":"`+escapeJSON(req.Name)+`"}`)
	c.JSON(http.StatusOK, gin.H{"data": t})
}

func (h *TeamHandler) ListTeams(c *gin.Context) {
	userID := c.GetString("user_id")
	teams, err := h.repo.ListTeamsForUser(c, userID)
	if err != nil {
		serverError(c, "列出团队失败", err)
		return
	}
	if teams == nil {
		teams = []*model.Team{}
	}
	c.JSON(http.StatusOK, gin.H{"data": teams})
}

// requireTeamMember 校验当前用户是 team 成员；不是则 abort 并返回 403/404。
func (h *TeamHandler) requireTeamMember(c *gin.Context, teamID string) (*model.TeamMember, bool) {
	userID := c.GetString("user_id")
	m, err := h.repo.GetTeamMember(c, teamID, userID)
	if err != nil {
		if errors.Is(err, repository.ErrNotFound) {
			// 区分团队不存在 vs 无权限：统一 404 避免泄露
			c.JSON(http.StatusNotFound, gin.H{"error": gin.H{
				"code": "E_NOT_FOUND", "message": "团队不存在或无权限",
			}})
			return nil, false
		}
		serverError(c, "查询成员失败", err)
		return nil, false
	}
	return m, true
}

// requireTeamAdmin 校验当前用户是 owner/admin。
func (h *TeamHandler) requireTeamAdmin(c *gin.Context, teamID string) (*model.TeamMember, bool) {
	m, ok := h.requireTeamMember(c, teamID)
	if !ok {
		return nil, false
	}
	if !model.RoleCanAdmin(m.Role) {
		c.JSON(http.StatusForbidden, gin.H{"error": gin.H{
			"code": "E_FORBIDDEN", "message": "需要 owner 或 admin 权限",
		}})
		return nil, false
	}
	return m, true
}

func (h *TeamHandler) GetTeam(c *gin.Context) {
	teamID := c.Param("id")
	if _, ok := h.requireTeamMember(c, teamID); !ok {
		return
	}
	t, err := h.repo.GetTeam(c, teamID)
	if err != nil {
		if errors.Is(err, repository.ErrNotFound) {
			notFound(c, "团队不存在")
			return
		}
		serverError(c, "查询团队失败", err)
		return
	}
	// 填充当前用户角色 + 成员数
	if m, _ := h.repo.GetTeamMember(c, teamID, c.GetString("user_id")); m != nil {
		t.MyRole = m.Role
	}
	if list, _ := h.repo.ListTeamMembers(c, teamID); list != nil {
		t.MemberCount = len(list)
	}
	c.JSON(http.StatusOK, gin.H{"data": t})
}

type updateTeamReq struct {
	Name        string `json:"name" binding:"required,min=1,max=100"`
	Description string `json:"description"`
}

func (h *TeamHandler) UpdateTeam(c *gin.Context) {
	teamID := c.Param("id")
	if _, ok := h.requireTeamAdmin(c, teamID); !ok {
		return
	}
	var req updateTeamReq
	if err := c.ShouldBindJSON(&req); err != nil {
		badRequest(c, "请求参数无效", err.Error())
		return
	}
	if err := h.repo.UpdateTeam(c, teamID, req.Name, req.Description); err != nil {
		if errors.Is(err, repository.ErrNotFound) {
			notFound(c, "团队不存在")
			return
		}
		serverError(c, "更新团队失败", err)
		return
	}
	t, _ := h.repo.GetTeam(c, teamID)
	c.JSON(http.StatusOK, gin.H{"data": t})
}

func (h *TeamHandler) DeleteTeam(c *gin.Context) {
	teamID := c.Param("id")
	userID := c.GetString("user_id")
	// 删除仅 owner 可做
	m, err := h.repo.GetTeamMember(c, teamID, userID)
	if err != nil || m == nil {
		c.JSON(http.StatusNotFound, gin.H{"error": gin.H{
			"code": "E_NOT_FOUND", "message": "团队不存在或无权限",
		}})
		return
	}
	if m.Role != model.TeamRoleOwner {
		c.JSON(http.StatusForbidden, gin.H{"error": gin.H{
			"code": "E_FORBIDDEN", "message": "仅 team owner 可删除团队",
		}})
		return
	}
	if err := h.repo.DeleteTeam(c, teamID); err != nil {
		if errors.Is(err, repository.ErrNotFound) {
			notFound(c, "团队不存在")
			return
		}
		serverError(c, "删除团队失败", err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"data": nil})
}

// ─── Members ──────────────────────────────────────────────────────────

func (h *TeamHandler) ListMembers(c *gin.Context) {
	teamID := c.Param("id")
	if _, ok := h.requireTeamMember(c, teamID); !ok {
		return
	}
	members, err := h.repo.ListTeamMembers(c, teamID)
	if err != nil {
		serverError(c, "列出成员失败", err)
		return
	}
	if members == nil {
		members = []*model.TeamMember{}
	}
	c.JSON(http.StatusOK, gin.H{"data": members})
}

type addMemberReq struct {
	Username string `json:"username" binding:"required,min=1,max=100"`
	Role     string `json:"role" binding:"required,oneof=admin member"`
}

func (h *TeamHandler) AddMember(c *gin.Context) {
	teamID := c.Param("id")
	if _, ok := h.requireTeamAdmin(c, teamID); !ok {
		return
	}
	var req addMemberReq
	if err := c.ShouldBindJSON(&req); err != nil {
		badRequest(c, "请求参数无效", err.Error())
		return
	}
	user, err := h.repo.GetUserByUsername(c, req.Username)
	if err != nil || user == nil {
		c.JSON(http.StatusNotFound, gin.H{"error": gin.H{
			"code": "E_NOT_FOUND", "message": "用户不存在",
		}})
		return
	}
	if err := h.repo.AddTeamMember(c, teamID, user.ID, req.Role); err != nil {
		serverError(c, "添加成员失败", err)
		return
	}
	writeAudit(c, h.repo, model.AuditActionMemberAdd, model.AuditTargetMember, teamID+"/"+user.ID,
		`{"role":"`+req.Role+`","username":"`+escapeJSON(req.Username)+`"}`)
	m, _ := h.repo.GetTeamMember(c, teamID, user.ID)
	c.JSON(http.StatusOK, gin.H{"data": m})
}

type updateMemberReq struct {
	Role string `json:"role" binding:"required,oneof=owner admin member"`
}

func (h *TeamHandler) UpdateMember(c *gin.Context) {
	teamID := c.Param("id")
	userID := c.Param("userId")
	if _, ok := h.requireTeamAdmin(c, teamID); !ok {
		return
	}
	var req updateMemberReq
	if err := c.ShouldBindJSON(&req); err != nil {
		badRequest(c, "请求参数无效", err.Error())
		return
	}
	if err := h.repo.UpdateTeamMemberRole(c, teamID, userID, req.Role); err != nil {
		if errors.Is(err, repository.ErrNotFound) {
			notFound(c, "成员不存在")
			return
		}
		badRequest(c, err.Error(), nil)
		return
	}
	writeAudit(c, h.repo, model.AuditActionMemberRole, model.AuditTargetMember, teamID+"/"+userID,
		`{"new_role":"`+req.Role+`"}`)
	m, _ := h.repo.GetTeamMember(c, teamID, userID)
	c.JSON(http.StatusOK, gin.H{"data": m})
}

// DeleteMember：team admin 可移除任何成员；成员可移除自己（退出团队）。
func (h *TeamHandler) DeleteMember(c *gin.Context) {
	teamID := c.Param("id")
	targetUserID := c.Param("userId")
	currentUserID := c.GetString("user_id")

	if targetUserID == currentUserID {
		// 自己退出：仍要求当前用户是成员
		if _, ok := h.requireTeamMember(c, teamID); !ok {
			return
		}
	} else {
		if _, ok := h.requireTeamAdmin(c, teamID); !ok {
			return
		}
	}

	if err := h.repo.RemoveTeamMember(c, teamID, targetUserID); err != nil {
		if errors.Is(err, repository.ErrNotFound) {
			notFound(c, "成员不存在")
			return
		}
		badRequest(c, err.Error(), nil)
		return
	}
	writeAudit(c, h.repo, model.AuditActionMemberDel, model.AuditTargetMember, teamID+"/"+targetUserID, "")
	c.JSON(http.StatusOK, gin.H{"data": nil})
}

// ─── Team Project Access ─────────────────────────────────────────────

type grantTeamAccessReq struct {
	ProjectID  string `json:"projectId" binding:"required"`
	Permission string `json:"permission" binding:"required,oneof=read write admin"`
}

func (h *TeamHandler) GrantProjectAccess(c *gin.Context) {
	teamID := c.Param("id")
	currentUserID := c.GetString("user_id")
	if _, ok := h.requireTeamAdmin(c, teamID); !ok {
		return
	}
	var req grantTeamAccessReq
	if err := c.ShouldBindJSON(&req); err != nil {
		badRequest(c, "请求参数无效", err.Error())
		return
	}
	// 校验：授权方必须是 project owner（不能让 team admin 把自己没权限的项目授权出去）
	project, err := h.repo.GetProject(c, req.ProjectID)
	if err != nil || project == nil {
		notFound(c, "项目不存在")
		return
	}
	if project.OwnerID != currentUserID {
		c.JSON(http.StatusForbidden, gin.H{"error": gin.H{
			"code": "E_FORBIDDEN", "message": "仅项目 owner 可授权团队访问",
		}})
		return
	}
	if err := h.repo.GrantTeamProjectAccess(c, teamID, req.ProjectID, req.Permission, currentUserID); err != nil {
		serverError(c, "授权失败", err)
		return
	}
	writeAudit(c, h.repo, model.AuditActionGrant, model.AuditTargetProjectAccess,
		teamID+"/"+req.ProjectID,
		`{"permission":"`+req.Permission+`"}`)
	c.JSON(http.StatusOK, gin.H{"data": gin.H{
		"teamId":     teamID,
		"projectId":  req.ProjectID,
		"permission": req.Permission,
	}})
}

func (h *TeamHandler) ListProjectAccess(c *gin.Context) {
	teamID := c.Param("id")
	if _, ok := h.requireTeamMember(c, teamID); !ok {
		return
	}
	accesses, err := h.repo.ListTeamProjectAccess(c, teamID)
	if err != nil {
		serverError(c, "列出项目授权失败", err)
		return
	}
	if accesses == nil {
		accesses = []*model.TeamProjectAccess{}
	}
	c.JSON(http.StatusOK, gin.H{"data": accesses})
}

func (h *TeamHandler) RevokeProjectAccess(c *gin.Context) {
	teamID := c.Param("id")
	projectID := c.Param("projectId")
	currentUserID := c.GetString("user_id")
	if _, ok := h.requireTeamAdmin(c, teamID); !ok {
		return
	}
	// 项目 owner 才能撤销
	project, err := h.repo.GetProject(c, projectID)
	if err != nil || project == nil {
		notFound(c, "项目不存在")
		return
	}
	if project.OwnerID != currentUserID {
		c.JSON(http.StatusForbidden, gin.H{"error": gin.H{
			"code": "E_FORBIDDEN", "message": "仅项目 owner 可撤销团队访问",
		}})
		return
	}
	if err := h.repo.RevokeTeamProjectAccess(c, teamID, projectID); err != nil {
		if errors.Is(err, repository.ErrNotFound) {
			notFound(c, "授权不存在")
			return
		}
		serverError(c, "撤销失败", err)
		return
	}
	writeAudit(c, h.repo, model.AuditActionRevoke, model.AuditTargetProjectAccess,
		teamID+"/"+projectID, "")
	c.JSON(http.StatusOK, gin.H{"data": nil})
}
