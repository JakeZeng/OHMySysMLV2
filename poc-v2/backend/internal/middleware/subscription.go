// M8: 订阅功能门控中间件
//
// 根据用户的订阅等级限制功能访问。
// Pro/Enterprise 功能：行为建模、需求视图、API 访问、Webhook、插件
// Enterprise 专属：SSO/LDAP、私有部署、无限资源

package middleware

import (
	"net/http"

	"github.com/gin-gonic/gin"
)

// FeatureGate 功能门控配置
type FeatureGate struct {
	// AllowedPlans 允许访问此功能的计划 ID 列表
	AllowedPlans []string
	// FeatureName 功能名称（用于错误消息）
	FeatureName string
}

// Predefined feature gates
var (
	// ProFeatures 需要 Pro 或更高计划的功能
	ProFeatures = FeatureGate{
		AllowedPlans: []string{"pro", "enterprise"},
		FeatureName: "Pro 功能",
	}

	// EnterpriseFeatures 需要 Enterprise 计划的功能
	EnterpriseFeatures = FeatureGate{
		AllowedPlans: []string{"enterprise"},
		FeatureName: "Enterprise 功能",
	}
)

// RequirePlan 检查用户订阅是否满足功能要求
// 通过 X-User-Plan header 或 JWT claims 获取用户计划
func RequirePlan(gate FeatureGate) gin.HandlerFunc {
	return func(c *gin.Context) {
		// 从 header 获取用户计划（由 API Gateway 或 auth 中间件设置）
		userPlan := c.GetHeader("X-User-Plan")
		if userPlan == "" {
			// 默认 Free 计划
			userPlan = "free"
		}

		// 检查是否在允许列表中
		allowed := false
		for _, plan := range gate.AllowedPlans {
			if plan == userPlan {
				allowed = true
				break
			}
		}

		if !allowed {
			c.AbortWithStatusJSON(http.StatusForbidden, gin.H{
				"error":      "需要升级订阅",
				"feature":    gate.FeatureName,
				"currentPlan": userPlan,
				"requiredPlans": gate.AllowedPlans,
				"upgradeUrl": "/subscription",
			})
			return
		}

		c.Next()
	}
}

// GetEffectivePlan 获取用户的有效计划（简化版）
// 生产环境应从数据库或 JWT claims 获取
func GetEffectivePlan(c *gin.Context) string {
	plan := c.GetHeader("X-User-Plan")
	if plan == "" {
		return "free"
	}
	return plan
}
