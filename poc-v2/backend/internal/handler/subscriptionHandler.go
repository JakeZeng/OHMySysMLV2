// M8: 订阅管理 handler
//
// SaaS 订阅模式：Free / Pro / Enterprise
//
// GET  /api/v1/subscription/plans  — 获取可用计划
// GET  /api/v1/subscription        — 获取当前订阅
// POST /api/v1/subscription/upgrade — 升级订阅

package handler

import (
	"net/http"
	"time"

	"github.com/gin-gonic/gin"
)

// ─── 订阅数据模型 ─────────────────────────────────────────────────

// Plan 订阅计划
type Plan struct {
	ID          string   `json:"id"`
	Name        string   `json:"name"`
	Price       float64  `json:"price"`      // 月价格（美元）
	Currency    string   `json:"currency"`
	Interval    string   `json:"interval"`    // "month" or "year"
	Features    []string `json:"features"`
	MaxProjects int      `json:"maxProjects"` // -1 = unlimited
	MaxModels   int      `json:"maxModels"`   // -1 = unlimited
	MaxMembers  int      `json:"maxMembers"`  // -1 = unlimited
	MaxStorage  string   `json:"maxStorage"`  // "100MB", "10GB", "unlimited"
}

// Subscription 用户订阅
type Subscription struct {
	ID        string    `json:"id"`
	UserID    string    `json:"userId"`
	PlanID    string    `json:"planId"`
	Status    string    `json:"status"` // "active", "cancelled", "expired"
	StartDate time.Time `json:"startDate"`
	EndDate   time.Time `json:"endDate"`
}

// 预定义计划
var plans = []Plan{
	{
		ID:          "free",
		Name:        "Free",
		Price:       0,
		Currency:    "USD",
		Interval:    "month",
		MaxProjects: 3,
		MaxModels:   10,
		MaxMembers:  1,
		MaxStorage:  "100MB",
		Features: []string{
			"基础建模（Part/Port/Connect）",
			"文本编辑器 + 语法高亮",
			"3 个行业模板",
			"JSON 导入/导出",
		},
	},
	{
		ID:          "pro",
		Name:        "Pro",
		Price:       29,
		Currency:    "USD",
		Interval:    "month",
		MaxProjects: 20,
		MaxModels:   100,
		MaxMembers:  5,
		MaxStorage:  "10GB",
		Features: []string{
			"所有 Free 功能",
			"行为建模（状态机/活动图）",
			"需求视图 + 追溯",
			"约束块 + 参数视图",
			"AI 辅助建模",
			"模板市场",
			"版本历史",
			"团队协作（最多 5 人）",
			"API 访问",
			"Webhook 通知",
		},
	},
	{
		ID:          "enterprise",
		Name:        "Enterprise",
		Price:       99,
		Currency:    "USD",
		Interval:    "month",
		MaxProjects: -1,
		MaxModels:   -1,
		MaxMembers:  -1,
		MaxStorage:  "unlimited",
		Features: []string{
			"所有 Pro 功能",
			"无限项目/模型/成员",
			"插件系统",
			"自定义模板",
			"SSO/LDAP 集成",
			"优先支持",
			"SLA 保证 99.9%",
			"私有部署选项",
		},
	},
}

// 用户订阅存储（M8 简化版）
var subscriptions = make(map[string]*Subscription)

// ─── Handler 方法 ─────────────────────────────────────────────────

// GetPlans 获取可用计划
func (h *Handler) GetPlans(c *gin.Context) {
	c.JSON(http.StatusOK, gin.H{"data": plans})
}

// GetSubscription 获取当前订阅
func (h *Handler) GetSubscription(c *gin.Context) {
	userID := c.GetString("user_id")

	sub, ok := subscriptions[userID]
	if !ok {
		// 默认 Free 计划
		sub = &Subscription{
			ID:        "sub_default_" + userID,
			UserID:    userID,
			PlanID:    "free",
			Status:    "active",
			StartDate: time.Now(),
			EndDate:   time.Now().AddDate(100, 0, 0), // 永不过期
		}
	}

	// 找到对应计划
	var plan *Plan
	for i := range plans {
		if plans[i].ID == sub.PlanID {
			plan = &plans[i]
			break
		}
	}

	c.JSON(http.StatusOK, gin.H{
		"data": gin.H{
			"subscription": sub,
			"plan":         plan,
		},
	})
}

// UpgradeRequest 升级请求
type UpgradeRequest struct {
	PlanID string `json:"planId" binding:"required"`
}

// UpgradeSubscription 升级订阅
func (h *Handler) UpgradeSubscription(c *gin.Context) {
	var req UpgradeRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	// 验证计划存在
	var plan *Plan
	for i := range plans {
		if plans[i].ID == req.PlanID {
			plan = &plans[i]
			break
		}
	}
	if plan == nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "未知计划"})
		return
	}

	userID := c.GetString("user_id")
	sub := &Subscription{
		ID:        "sub_" + userID,
		UserID:    userID,
		PlanID:    req.PlanID,
		Status:    "active",
		StartDate: time.Now(),
		EndDate:   time.Now().AddDate(0, 1, 0), // 1 个月
	}
	subscriptions[userID] = sub

	c.JSON(http.StatusOK, gin.H{
		"data": gin.H{
			"subscription": sub,
			"plan":         plan,
			"message":      "订阅已升级",
		},
	})
}
