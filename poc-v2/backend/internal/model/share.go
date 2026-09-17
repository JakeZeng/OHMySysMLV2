// Package model — M4 W3 项目分享模型。
package model

import "time"

// ProjectShare 直接分享给用户的记录（不入 owner）。
type ProjectShare struct {
	ProjectID  string    `json:"projectId"`
	UserID     string    `json:"userId"`
	Username   string    `json:"username,omitempty"`
	Email      string    `json:"email,omitempty"`
	Permission string    `json:"permission"`
	GrantedBy  string    `json:"grantedBy"`
	GrantedAt  time.Time `json:"grantedAt"`
}

// ShareLink 链接分享（不含明文 token，只存 hash）。
type ShareLink struct {
	ID           string     `json:"id"`
	ProjectID    string     `json:"projectId"`
	TokenHash    string     `json:"-"` // 不导出
	Permission   string     `json:"permission"`
	CreatedBy    string     `json:"createdBy"`
	CreatedAt    time.Time  `json:"createdAt"`
	ExpiresAt    *time.Time `json:"expiresAt,omitempty"`
	RevokedAt    *time.Time `json:"revokedAt,omitempty"`
	ViewCount    int        `json:"viewCount"`
	LastViewedAt *time.Time `json:"lastViewedAt,omitempty"`
	MaxViews     *int       `json:"maxViews,omitempty"` // nil = 无限
}

// IsValidLinkPermission 链接只允许 read/write（不允许 admin —— 匿名权限失控风险）。
func IsValidLinkPermission(p string) bool {
	return p == "read" || p == "write"
}
