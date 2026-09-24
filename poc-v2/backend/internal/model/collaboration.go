// Package model — M13 多人协同数据模型。
//
//   - Presence：在线状态（DB 持久化）
//   - EditLock：advisory lock with TTL
//   - Comment：评论（DB 持久化，scope 通用化）
//
// "scope" 字段统一编码："package:<id>" | "view:<id>" | "model:<id>"（兼容旧 Model 实体）。
// 前端可据此路由消息；后端用它做 channel key（SSE pub/sub）。
package model

import "time"

// ScopeKind scope 类型枚举。
const (
	ScopeKindPackage = "package"
	ScopeKindView    = "view"
	ScopeKindModel   = "model" // 兼容 M11 旧 Model 实体（M12 后基本不用）
)

// MakeScope 构造 scope 字符串。
func MakeScope(kind, id string) string { return kind + ":" + id }

// ParseScope 拆分 scope 为 (kind, id)；非法返 ("", "")。
func ParseScope(scope string) (kind, id string) {
	for i := 0; i < len(scope); i++ {
		if scope[i] == ':' {
			return scope[:i], scope[i+1:]
		}
	}
	return "", ""
}

// Presence 用户在线状态。
//
// 通过 POST /presence/heartbeat 周期性刷新（TTL=30s）。
// last_seen 超过 30s 视为离线；通过懒清理（读时清）+ 后台 ticker（每 30s 全表扫）兜底。
type Presence struct {
	Scope        string    `json:"scope"`
	UserID       string    `json:"userId"`
	Username     string    `json:"username"`
	Color        string    `json:"color"` // 分配的颜色标识
	CursorLine   *int      `json:"cursorLine,omitempty"`
	CursorCol    *int      `json:"cursorCol,omitempty"`
	SelStartLine *int      `json:"selStartLine,omitempty"`
	SelStartCol  *int      `json:"selStartCol,omitempty"`
	SelEndLine   *int      `json:"selEndLine,omitempty"`
	SelEndCol    *int      `json:"selEndCol,omitempty"`
	ContentHash  string    `json:"contentHash"` // 客户端周期性 hash 上报（"别人正在编辑"判定）
	LastSeen     time.Time `json:"lastSeen"`
}

// EditLock 软锁（advisory）。
//
// 不强制阻止他人 PUT（仍可保存，但会触发版本冲突）；仅作"协作提示"。
// TTL 60s，每次心跳续期；过期自动失效。
type EditLock struct {
	Scope       string    `json:"scope"`
	OwnerID     string    `json:"ownerId"`
	Username    string    `json:"username"`
	AcquiredAt  time.Time `json:"acquiredAt"`
	ExpiresAt   time.Time `json:"expiresAt"`
	BaseVersion int       `json:"baseVersion"` // 锁建立时实体的版本号
}

// LockTTLSeconds 默认锁 TTL（秒）。前端心跳 30s，TTL 给到 60s 留 1 个心跳周期冗余。
const LockTTLSeconds = 60

// Comment 评论。
//
// 升级到 scope 通用化（之前 modelId）；保持 elementId/line 元素级定位。
type Comment struct {
	ID        string    `json:"id"`
	Scope     string    `json:"scope"`
	UserID    string    `json:"userId"`
	Username  string    `json:"username"`
	ElementID string    `json:"elementId,omitempty"`
	Line      int       `json:"line,omitempty"`
	Content   string    `json:"content"`
	Resolved  bool      `json:"resolved"`
	CreatedAt time.Time `json:"createdAt"`
	UpdatedAt time.Time `json:"updatedAt"`
}
