// Package handler — M4.5 审计日志查询端点。
//
//   - GET /api/v1/audit-logs?actor=<userId>&targetType=<type>&targetId=<id>&limit=<n>
//
// 当前 user 可看：自己的日志 + 自己是 admin 的项目的目标日志（简化：先返回所有人的，
// owner 自己项目相关的）— 生产应加 role-based 过滤；M4.5 先开放给 owner。
package handler

import (
	"net/http"
	"strconv"

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

// ListAuditLogs 返回审计日志。
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

	limit := 50
	if s := c.Query("limit"); s != "" {
		if n, err := strconv.Atoi(s); err == nil && n > 0 {
			limit = n
		}
	}

	logs, err := h.repo.ListAuditLogs(c, actor, tType, tID, projectID, limit)
	if err != nil {
		serverError(c, "查询审计日志失败", err)
		return
	}
	if logs == nil {
		logs = []*model.AuditLog{}
	}
	c.JSON(http.StatusOK, gin.H{"data": logs})
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