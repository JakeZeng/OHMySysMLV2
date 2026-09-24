// 冲突响应辅助 (M13)
//
// buildConflictDetails 把"服务器当前状态"+"客户端 base"+diff hunks 打包成
// ApiError.details 的一部分，让前端可以做三方合并。

package handler

import (
	"time"

	"github.com/gin-gonic/gin"

	"github.com/sysmlv2/mbse-backend/internal/diff"
)

// buildConflictDetails 构造 409 E_VERSION_CONFLICT 的 details。
//
// 参数：
//   - resourceType: "package" / "view"
//   - resourceID:   实体 ID
//   - serverVersion / serverContent / serverUpdatedAt: DB 当前
//   - serverProjectID: 用于构造 "by" 字段（取最近 audit 记录）
//   - baseVersion: 客户端编辑时基于的版本（默认取 serverVersion - 1）
//   - baseContent: 客户端编辑时基于的内容（重要！服务端无法找回，需前端随 PUT 上送）
//
// baseContent 留空时，前端仍能基于 serverContent 做"接受服务器"或"强制覆盖我的"。
func (h *Handler) buildConflictDetails(
	c *gin.Context,
	resourceType, resourceID string,
	serverVersion int,
	serverContent string,
	serverUpdatedAt time.Time,
	_ string, // serverProjectID 暂未使用（保留扩展点）
	baseVersion int,
	baseContent string,
) gin.H {
	// 查找最近一次更新人
	updatedBy := ""
	// ListAuditLogs(ctx, filterActor, filterTargetType, filterTargetID, filterProjectID, limit, offset)
	if logs, err := h.repo.ListAuditLogs(c, "", resourceType, resourceID, "", 1, 0); err == nil && len(logs) > 0 {
		updatedBy = logs[0].ActorID
	}

	// 计算 diff（base → server）。baseContent 为空时退化为空 diff。
	hunks := diff.Lines(baseContent, serverContent)
	if baseContent == "" {
		// 没有 base → 整体作为 insert
		hunks = []diff.Hunk{{
			Type:        "insert",
			ServerStart: 1,
			Lines:       splitServerLines(serverContent),
		}}
	}

	return gin.H{
		"resourceType":    resourceType,
		"resourceId":      resourceID,
		"serverVersion":   serverVersion,
		"serverContent":   serverContent,
		"serverUpdatedAt": serverUpdatedAt.UTC().Format(time.RFC3339Nano),
		"serverUpdatedBy": updatedBy,
		"baseVersion":     baseVersion,
		"baseContent":     baseContent,
		"diffHunks":       hunks,
	}
}

// splitServerLines 辅助（与 diff.splitLines 行为一致；为避免暴露包内 helper 而内联）。
func splitServerLines(s string) []string {
	out := []string{}
	cur := ""
	for _, ch := range s {
		if ch == '\n' {
			out = append(out, cur)
			cur = ""
			continue
		}
		if ch == '\r' {
			continue
		}
		cur += string(ch)
	}
	if cur != "" || len(s) == 0 {
		out = append(out, cur)
	}
	return out
}
