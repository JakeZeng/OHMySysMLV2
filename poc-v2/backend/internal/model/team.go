// Package model — M4 W2/W3 团队与分享模型。
package model

import "time"

// TeamRole 成员在团队中的角色。
const (
	TeamRoleOwner  = "owner"
	TeamRoleAdmin  = "admin"
	TeamRoleMember = "member"
)

// Permission 资源级权限（read/write/admin）。
// 数值越大权限越高。
const (
	PermReadValue  = 1
	PermWriteValue = 2
	PermAdminValue = 3
)

// Team 表示一个团队。
type Team struct {
	ID          string    `json:"id"`
	Name        string    `json:"name"`
	Description string    `json:"description"`
	CreatedAt   time.Time `json:"createdAt"`
	UpdatedAt   time.Time `json:"updatedAt"`
	// 派生字段（不在 DB 中持久化）：当前用户在此团队的角色（如果有）
	MyRole string `json:"myRole,omitempty"`
	// 成员数量（可选，列表时填充）
	MemberCount int `json:"memberCount,omitempty"`
}

// TeamMember 团队-用户关系 + 角色。
type TeamMember struct {
	TeamID   string    `json:"teamId"`
	UserID   string    `json:"userId"`
	Username string    `json:"username,omitempty"`
	Email    string    `json:"email,omitempty"`
	Role     string    `json:"role"`
	JoinedAt time.Time `json:"joinedAt"`
}

// TeamProjectAccess 团队对项目的授权。
type TeamProjectAccess struct {
	TeamID     string    `json:"teamId"`
	ProjectID  string    `json:"projectId"`
	Permission string    `json:"permission"`
	GrantedBy  string    `json:"grantedBy"`
	GrantedAt  time.Time `json:"grantedAt"`
	// 派生字段：项目名 + 可见性（JOIN projects 表填充，便于前端展示）。
	ProjectName       string `json:"projectName,omitempty"`
	ProjectVisibility string `json:"projectVisibility,omitempty"`
}

// IsValidRole 判断字符串是否为合法角色。
func IsValidRole(r string) bool {
	switch r {
	case TeamRoleOwner, TeamRoleAdmin, TeamRoleMember:
		return true
	}
	return false
}

// IsValidPermission 判断字符串是否为合法权限。
func IsValidPermission(p string) bool {
	switch p {
	case "read", "write", "admin":
		return true
	}
	return false
}

// RoleCanAdmin 判断角色是否有 admin 权限（owner/admin 可以管理团队成员/项目授权）。
func RoleCanAdmin(role string) bool {
	return role == TeamRoleOwner || role == TeamRoleAdmin
}
