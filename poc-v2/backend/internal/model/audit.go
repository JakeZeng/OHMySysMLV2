// Package model — M4.5 审计日志。
//
// 每条审计记录代表一次 mutating 操作（创建 / 更新 / 删除 / 分享 / 授权）。
//   - actor:  执行操作的用户 ID
//   - action: 动作类型（create / update / delete / share / grant / revoke / link_create / link_revoke）
//   - target_type: 目标类型（project / model / share / link / team / member / project_access）
//   - target_id: 目标 ID
//   - metadata: JSON 字段，存动作相关上下文（permission、team_id、expires_in_hours 等）
package model

import "time"

// AuditAction 常见动作。
const (
	AuditActionCreate     = "create"
	AuditActionUpdate     = "update"
	AuditActionDelete     = "delete"
	AuditActionShare      = "share"       // 直分享 project_shares
	AuditActionUnshare    = "unshare"     // 撤销直分享
	AuditActionLinkCreate = "link_create" // 创建分享链接
	AuditActionLinkRevoke = "link_revoke" // 撤销分享链接
	AuditActionTeamCreate = "team_create"
	AuditActionMemberAdd  = "member_add"
	AuditActionMemberRole = "member_role"
	AuditActionMemberDel  = "member_del"
	AuditActionGrant      = "grant" // 团队 project-access
	AuditActionRevoke     = "revoke"
)

// AuditTargetType 目标类型。
const (
	AuditTargetProject       = "project"
	AuditTargetModel         = "model"
	AuditTargetShare         = "share"
	AuditTargetLink          = "link"
	AuditTargetTeam          = "team"
	AuditTargetMember        = "member"
	AuditTargetProjectAccess = "project_access"
	AuditTargetUser          = "user"
)

// AuditLog 一条审计日志。
type AuditLog struct {
	ID         string    `json:"id"`
	ActorID    string    `json:"actorId"`
	Action     string    `json:"action"`
	TargetType string    `json:"targetType"`
	TargetID   string    `json:"targetId"`
	Metadata   string    `json:"metadata,omitempty"` // JSON 字符串
	IP         string    `json:"ip,omitempty"`
	UserAgent  string    `json:"userAgent,omitempty"`
	CreatedAt  time.Time `json:"createdAt"`
}