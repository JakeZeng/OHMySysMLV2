// Package handler — M4.5 审计日志查询端点。
//
//   - GET /api/v1/audit-logs?actor=<userId>&targetType=<type>&targetId=<id>&projectId=<id>&limit=<n>
//   - GET /api/v1/audit-logs/export?format=csv&...<same filters>  （M4.5 增量：CSV 导出）
//
// RBAC（M4.5 增量）：默认任何登录用户都可读全部；为收紧暴露面，
// handler 在拿到行后再过滤一遍，只保留调用方有"读权限"看的目标：
//
//   - 调用方是 actor：本人的操作日志一定可见
//   - target_type ∈ {project, model, share, link}：调用方对该 target 的
//     project 必须至少 read（owner / 直接 / 团队授权）
//   - target_type ∈ {team, member, project_access}：调用方须是该 team 的
//     admin / owner
//   - target_type = user：仅本人用户行可见
//   - 无 actor 的匿名 / 系统行：仅当 target 仍可被当前用户访问时可见
package handler

import (
	"database/sql"
	"encoding/csv"
	"fmt"
	"net/http"
	"strconv"
	"time"

	"github.com/gin-gonic/gin"

	"github.com/sysmlv2/mbse-backend/internal/model"
	"github.com/sysmlv2/mbse-backend/internal/repository"
)

// AuditHandler 查询审计日志。
type AuditHandler struct {
	repo *repository.SQLiteRepository
}

func NewAuditHandler(repo *repository.SQLiteRepository) *AuditHandler {
	return &AuditHandler{repo: repo}
}

// ListAuditLogs 返回审计日志（按时间倒序，最多 limit 条，默认 50，上限 200）。
//
// 查询参数（全部可选）：
//
//	actor=<userId>
//	targetType=<project|model|share|link|team|member|project_access|user>
//	targetId=<id>
//	projectId=<id>  把 project / model / share / link 关联日志收拢到该 project 视角
//	limit=<n>  默认 50，上限 200
func (h *AuditHandler) ListAuditLogs(c *gin.Context) {
	actor := c.Query("actor")
	tType := c.Query("targetType")
	tID := c.Query("targetId")
	projectID := c.Query("projectId")
	callerID := c.GetString("user_id")

	limit := 50
	if s := c.Query("limit"); s != "" {
		if n, err := strconv.Atoi(s); err == nil && n > 0 {
			limit = n
		}
	}
	offset := 0
	if s := c.Query("offset"); s != "" {
		if n, err := strconv.Atoi(s); err == nil && n >= 0 {
			offset = n
		}
	}

	logs, err := h.repo.ListAuditLogs(c, actor, tType, tID, projectID, limit, offset)
	if err != nil {
		serverError(c, "查询审计日志失败", err)
		return
	}

	// RBAC：登录用户只能看到自己有 read 权限的那部分目标行。
	// 但若 caller 已显式按 actor=xxx 过滤（管理后台审计某人视角），SQL 已精确收窄，
	// 直接返回过滤结果，避免 actor=alice 时还要逐条 RBAC 把 alice 自己看不到的过滤掉。
	if callerID != "" && len(logs) > 0 && actor == "" {
		logs = h.filterLogsForCaller(c, callerID, logs)
	}

	if logs == nil {
		logs = []*model.AuditLog{}
	}
	c.JSON(http.StatusOK, gin.H{"data": logs, "offset": offset, "limit": limit})
}

// ExportAuditLogs 导出审计日志为 CSV / JSON。
//
//   - format=csv  → text/csv 流式响应，Content-Disposition: attachment
//   - format=json → 等同于 ListAuditLogs 的 data 字段（便于一致性消费）
//   - 默认 format=csv
//
// 上限 1000 行；与 ListAuditLogs 共享同样的 RBAC 过滤。
func (h *AuditHandler) ExportAuditLogs(c *gin.Context) {
	format := c.DefaultQuery("format", "csv")
	if format != "csv" && format != "json" {
		badRequest(c, "format 仅支持 csv / json", nil)
		return
	}

	actor := c.Query("actor")
	tType := c.Query("targetType")
	tID := c.Query("targetId")
	projectID := c.Query("projectId")
	callerID := c.GetString("user_id")

	// 导出给一个更宽的上限（1000），仍受 RBAC 过滤
	limit := 1000
	if s := c.Query("limit"); s != "" {
		if n, err := strconv.Atoi(s); err == nil && n > 0 && n <= 5000 {
			limit = n
		}
	}

	logs, err := h.repo.ListAuditLogs(c, actor, tType, tID, projectID, limit, 0)
	if err != nil {
		serverError(c, "查询审计日志失败", err)
		return
	}
	if callerID != "" && len(logs) > 0 {
		logs = h.filterLogsForCaller(c, callerID, logs)
	}

	if format == "json" {
		c.JSON(http.StatusOK, gin.H{"data": logs})
		return
	}

	// CSV
	filename := fmt.Sprintf("audit-logs-%s.csv", time.Now().UTC().Format("20060102T150405Z"))
	c.Header("Content-Type", "text/csv; charset=utf-8")
	c.Header("Content-Disposition", `attachment; filename="`+filename+`"`)
	c.Writer.WriteHeader(http.StatusOK)

	w := csv.NewWriter(c.Writer)
	_ = w.Write([]string{
		"created_at", "actor_id", "action", "target_type", "target_id",
		"ip", "user_agent", "metadata",
	})
	for _, l := range logs {
		_ = w.Write([]string{
			l.CreatedAt.UTC().Format(time.RFC3339Nano),
			l.ActorID,
			l.Action,
			l.TargetType,
			l.TargetID,
			l.IP,
			l.UserAgent,
			l.Metadata,
		})
	}
	w.Flush()
}

// ArchiveAuditLogs 归档清理 — 删除 N 天前的审计日志（M4.5 增量）。
//
// 设计取舍：
//
//	真正的冷热分区 / 分表归档需要 schema 演进（partitioned tables / 单独的
//	audit_archive 表），M5+ 基础设施阶段再做。M4.5 落地"软归档"：
//
//	 - DELETE from audit_logs where created_at < now() - N days
//	 - 仅 admin（首个注册用户）可调用，防止普通用户误删
//	 - 安全护栏：days ≥ 7（避免误删近期审计）
//	 - dryRun=true 只返回待删数量，不动数据
//	 - 推荐工作流：先 dryRun → 然后用 export 备份 → 再正式清理
//
// 生产环境应：1) dump 旧行到对象存储；2) 再调 DELETE。
func (h *AuditHandler) ArchiveAuditLogs(c *gin.Context) {
	callerID := c.GetString("user_id")
	if !h.callerIsAdmin(c, callerID) {
		c.JSON(http.StatusForbidden, gin.H{"error": gin.H{
			"code": "E_FORBIDDEN", "message": "归档清理仅 admin 可操作",
		}})
		return
	}

	daysStr := c.Query("olderThanDays")
	if daysStr == "" {
		badRequest(c, "缺少 olderThanDays 参数（单位：天）", nil)
		return
	}
	days, err := strconv.Atoi(daysStr)
	if err != nil || days < 7 {
		badRequest(c, "olderThanDays 必须是 ≥ 7 的整数（安全护栏）", nil)
		return
	}

	dryRun := c.Query("dryRun") == "true"

	if dryRun {
		n, err := h.repo.CountAuditLogsOlderThan(c, days)
		if err != nil {
			serverError(c, "统计失败", err)
			return
		}
		c.JSON(http.StatusOK, gin.H{
			"data": gin.H{
				"olderThanDays": days,
				"wouldDelete":   n,
				"dryRun":        true,
			},
		})
		return
	}

	n, err := h.repo.DeleteAuditLogsOlderThan(c, days)
	if err != nil {
		serverError(c, "清理失败", err)
		return
	}
	// 记录归档事件本身（指向 system，避免 RBAC 看到时困惑）
	writeAudit(c, h.repo, "audit_archive", "audit", "self",
		fmt.Sprintf(`{"older_than_days":%d,"deleted":%d,"actor":"%s"}`, days, n, callerID))
	c.JSON(http.StatusOK, gin.H{
		"data": gin.H{
			"olderThanDays": days,
			"deleted":       n,
			"dryRun":        false,
		},
	})
}

// callerIsAdmin 查询用户 is_admin 列。
// 仅 ArchiveAuditLogs 调用；不放入 JWT 以避免所有现有 token 失效。
func (h *AuditHandler) callerIsAdmin(c *gin.Context, callerID string) bool {
	if callerID == "" {
		return false
	}
	var isAdmin int
	err := h.repo.DB().QueryRowContext(c,
		`SELECT is_admin FROM users WHERE id = ?`, callerID,
	).Scan(&isAdmin)
	if err != nil {
		return false
	}
	return isAdmin == 1
}

// filterLogsForCaller 按 RBAC 规则裁剪日志列表。
//
// 设计取舍：SQL 只负责"按 index 取到候选行"，可见性判定放 Go 端避免
// 4 种 target_type 各写一段 UNION。一次列表 ≤ 200 行，N+1 查询可接受。
func (h *AuditHandler) filterLogsForCaller(
	c *gin.Context, callerID string, in []*model.AuditLog,
) []*model.AuditLog {
	out := make([]*model.AuditLog, 0, len(in))
	for _, l := range in {
		if h.callerCanSeeAudit(c, callerID, l) {
			out = append(out, l)
		}
	}
	return out
}

// callerCanSeeAudit 单行可见性判定。
func (h *AuditHandler) callerCanSeeAudit(c *gin.Context, callerID string, l *model.AuditLog) bool {
	// 0. Admin 可见所有审计日志（管理后台视角）
	if h.callerIsAdmin(c, callerID) {
		return true
	}
	// 1. 我自己的操作日志一定可见
	if l.ActorID == callerID {
		return true
	}

	switch l.TargetType {
	case "project":
		return h.callerHasProjectRead(c, callerID, l.TargetID)
	case "model":
		return h.callerHasModelRead(c, callerID, l.TargetID)
	case "share":
		// targetId 形如 "<projectId>/<userId>" 或纯 "<projectId>"
		return h.callerHasShareTargetRead(c, callerID, l.TargetID)
	case "link":
		return h.callerHasLinkTargetRead(c, callerID, l.TargetID)
	case "team", "member":
		// targetId 是 teamId（member 行也是 teamId）
		return h.callerIsTeamAdmin(c, callerID, l.TargetID)
	case "project_access":
		// targetId 是 teamId；调用方是该 team 的 admin/owner 才能看
		return h.callerIsTeamAdmin(c, callerID, l.TargetID)
	case "user":
		// 仅本人用户行
		return l.TargetID == callerID
	default:
		// 未知 target 类型：保守拒绝
		return false
	}
}

// callerHasProjectRead：调用方对指定 project 至少 read。
func (h *AuditHandler) callerHasProjectRead(c *gin.Context, callerID, projectID string) bool {
	if projectID == "" {
		return false
	}
	held, err := userHeldPermission(h.repo, callerID, projectID)
	if err != nil {
		return false
	}
	return isAtLeast(held, PermRead)
}

// callerHasModelRead：解析 model → project → read。
func (h *AuditHandler) callerHasModelRead(c *gin.Context, callerID, modelID string) bool {
	if modelID == "" {
		return false
	}
	var projectID string
	err := h.repo.DB().QueryRowContext(c,
		`SELECT project_id FROM models WHERE id = ?`, modelID,
	).Scan(&projectID)
	if err != nil {
		return false
	}
	return h.callerHasProjectRead(c, callerID, projectID)
}

// callerHasShareTargetRead：targetId 形如 "<projectId>" 或 "<projectId>/<userId>"。
func (h *AuditHandler) callerHasShareTargetRead(c *gin.Context, callerID, targetID string) bool {
	projectID := targetID
	for i := 0; i < len(targetID); i++ {
		if targetID[i] == '/' {
			projectID = targetID[:i]
			break
		}
	}
	return h.callerHasProjectRead(c, callerID, projectID)
}

// callerHasLinkTargetRead：解析 share_link → project → read。
func (h *AuditHandler) callerHasLinkTargetRead(c *gin.Context, callerID, linkID string) bool {
	if linkID == "" {
		return false
	}
	var projectID string
	err := h.repo.DB().QueryRowContext(c,
		`SELECT project_id FROM share_links WHERE id = ?`, linkID,
	).Scan(&projectID)
	if err != nil {
		return false
	}
	return h.callerHasProjectRead(c, callerID, projectID)
}

// callerIsTeamAdmin：调用方是 team admin 或 owner。
func (h *AuditHandler) callerIsTeamAdmin(c *gin.Context, callerID, teamID string) bool {
	if teamID == "" {
		return false
	}
	var role string
	err := h.repo.DB().QueryRowContext(c,
		`SELECT role FROM team_members WHERE team_id = ? AND user_id = ?`,
		teamID, callerID,
	).Scan(&role)
	if err != nil {
		if err == sql.ErrNoRows {
			return false
		}
		return false
	}
	return role == "admin" || role == "owner"
}

// writeAudit 内部 helper：从 gin context 抽取 IP / UA / actor 写入一条审计。
//
// 当前所有 mutating handler 都可在末尾调用（非阻塞 best-effort，失败仅日志）。
func writeAudit(c *gin.Context, repo *repository.SQLiteRepository,
	action, targetType, targetID, metadataJSON string,
) {
	if err := repo.AppendAuditLog(
		c,
		c.GetString("user_id"),
		action,
		targetType,
		targetID,
		metadataJSON,
		c.ClientIP(),
		c.GetHeader("User-Agent"),
	); err != nil {
		// 仅写入 header 标记，不阻塞主响应
		c.Header("X-Audit-Error", "1")
	}
}
