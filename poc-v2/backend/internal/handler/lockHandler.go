// 编辑锁 handler (M13)
//
// 路由：
//   POST   /api/v1/locks/:kind/:id?ttl=N          尝试获取 / 续期锁
//   GET    /api/v1/locks/:kind/:id                读取锁状态
//   DELETE /api/v1/locks/:kind/:id                释放锁（owner 或 admin）
//
// 路由参数：
//   :kind = "package" | "view" | "model"
//   :id   = 实体 ID
//
// 设计要点：
//   - advisory lock：不强制阻止 PUT；他人仍可保存（会触发版本冲突）
//   - TTL 默认 60s；前端心跳 30s 续期一次；过期自动失效
//   - 锁过期 → 下个 POST 可接管；admin 始终可 ForceRelease
//   - 通过 hub 广播 lock_changed / lock_released 给 SSE 订阅者

package handler

import (
	"context"
	"errors"
	"net/http"
	"time"

	"github.com/gin-gonic/gin"

	"github.com/sysmlv2/mbse-backend/internal/hub"
	"github.com/sysmlv2/mbse-backend/internal/model"
	"github.com/sysmlv2/mbse-backend/internal/repository"
)

// LockResponse 锁状态响应。
type LockResponse struct {
	Scope       string    `json:"scope"`
	Owner       *Owner    `json:"owner,omitempty"` // nil = 无锁
	AcquiredAt  time.Time `json:"acquiredAt,omitempty"`
	ExpiresAt   time.Time `json:"expiresAt,omitempty"`
	BaseVersion int       `json:"baseVersion,omitempty"`
}

type Owner struct {
	UserID   string `json:"userId"`
	Username string `json:"username"`
}

// AcquireLockRequest 获取/续期锁请求。
type AcquireLockRequest struct {
	BaseVersion int  `json:"baseVersion"` // 调用方当前持有的实体版本
	TTLSeconds  int  `json:"ttlSeconds"`  // 可选；默认 model.LockTTLSeconds
	Heartbeat   bool `json:"heartbeat"`   // true = 仅续期（仅 owner 成功）
}

// ─── Handler 方法 ─────────────────────────────────────────────────

// AcquireOrHeartbeatLock 处理 POST /locks/:kind/:id
//
// - heartbeat=false：尝试获取（接管过期锁 / 拒绝活跃他人锁）
// - heartbeat=true：仅续期（仅 owner 成功）
func (h *Handler) AcquireOrHeartbeatLock(c *gin.Context) {
	kind := c.Param("kind")
	id := c.Param("id")
	scope := model.MakeScope(kind, id)
	if kind != model.ScopeKindPackage && kind != model.ScopeKindView && kind != model.ScopeKindModel {
		badRequest(c, "kind 必须是 package/view/model", nil)
		return
	}

	var req AcquireLockRequest
	_ = c.ShouldBindJSON(&req) // body 可选
	if req.TTLSeconds <= 0 {
		req.TTLSeconds = model.LockTTLSeconds
	}

	userID := c.GetString("user_id")
	user, err := h.repo.GetUserByID(c, userID)
	username := userID
	if err == nil && user != nil {
		username = user.Username
	}

	now := time.Now().UTC()
	expires := now.Add(time.Duration(req.TTLSeconds) * time.Second)

	lock := &model.EditLock{
		Scope:       scope,
		OwnerID:     userID,
		Username:    username,
		AcquiredAt:  now,
		ExpiresAt:   expires,
		BaseVersion: req.BaseVersion,
	}

	if req.Heartbeat {
		// 仅续期
		if err := h.repo.HeartbeatLock(c, scope, userID, req.TTLSeconds); err != nil {
			if errors.Is(err, repository.ErrLockHeldByOther) {
				c.JSON(http.StatusConflict, gin.H{"error": gin.H{
					"code":    "E_LOCK_NOT_OWNED",
					"message": "锁不属于当前用户或已过期",
				}})
				return
			}
			serverError(c, "续期锁失败", err)
			return
		}
		// 续期成功 → 返回新状态
		h.respondLock(c, scope)
		h.broadcastLockChanged(scope)
		return
	}

	// 获取 / 接管
	if err := h.repo.TryAcquireLock(c, lock); err != nil {
		if errors.Is(err, repository.ErrLockHeldByOther) {
			// 返回当前持有者信息
			cur, ok, _ := h.repo.GetLock(c, scope)
			if !ok {
				// 极小竞态：刚被释放
				notFound(c, "锁已被释放")
				return
			}
			c.JSON(http.StatusConflict, gin.H{"error": gin.H{
				"code":    "E_LOCK_HELD",
				"message": "锁已被其他用户持有",
				"details": gin.H{
					"owner":      gin.H{"userId": cur.OwnerID, "username": cur.Username},
					"expiresAt":  cur.ExpiresAt,
					"baseVersion": cur.BaseVersion,
				},
			}})
			return
		}
		serverError(c, "获取锁失败", err)
		return
	}

	// 广播
	h.broadcastLockChanged(scope)
	h.respondLock(c, scope)
}

// GetLock 读取锁状态。
func (h *Handler) GetLock(c *gin.Context) {
	kind := c.Param("kind")
	id := c.Param("id")
	scope := model.MakeScope(kind, id)
	h.respondLock(c, scope)
}

// ReleaseLock 释放锁（owner 或 admin）。
func (h *Handler) ReleaseLock(c *gin.Context) {
	kind := c.Param("kind")
	id := c.Param("id")
	scope := model.MakeScope(kind, id)
	userID := c.GetString("user_id")

	// 判断 admin
	user, _ := h.repo.GetUserByID(c, userID)
	isAdmin := user != nil && user.IsAdmin

	ok := false
	if isAdmin {
		ok, _ = h.repo.ForceReleaseLock(c, scope)
	} else {
		ok, _ = h.repo.ReleaseLock(c, scope, userID)
	}
	if !ok {
		notFound(c, "锁不存在或无权释放")
		return
	}
	if h.hub != nil {
		uname := userID
		if user != nil {
			uname = user.Username
		}
		h.hub.Publish(scope, hub.Event{
			Type: "lock_released",
			Data: gin.H{
				"scope": scope,
				"by":    gin.H{"userId": userID, "username": uname},
			},
		})
	}
	c.JSON(http.StatusOK, gin.H{"data": gin.H{"released": true}})
}

// ─── 内部辅助 ────────────────────────────────────────────────────

func (h *Handler) respondLock(c *gin.Context, scope string) {
	cur, ok, err := h.repo.GetLock(c, scope)
	if err != nil {
		serverError(c, "查询锁状态失败", err)
		return
	}
	if !ok {
		c.JSON(http.StatusOK, gin.H{"data": LockResponse{Scope: scope}})
		return
	}
	c.JSON(http.StatusOK, gin.H{"data": LockResponse{
		Scope: scope,
		Owner: &Owner{UserID: cur.OwnerID, Username: cur.Username},
		AcquiredAt: cur.AcquiredAt,
		ExpiresAt: cur.ExpiresAt,
		BaseVersion: cur.BaseVersion,
	}})
}

func (h *Handler) broadcastLockChanged(scope string) {
	if h.hub == nil {
		return
	}
	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
	defer cancel()
	cur, ok, _ := h.repo.GetLock(ctx, scope)
	if !ok {
		return
	}
	h.hub.Publish(scope, hub.Event{
		Type: "lock_changed",
		Data: gin.H{
			"scope": scope,
			"owner": gin.H{"userId": cur.OwnerID, "username": cur.Username},
			"expiresAt": cur.ExpiresAt,
			"baseVersion": cur.BaseVersion,
		},
	})
}
