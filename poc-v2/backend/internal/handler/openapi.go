// Package handler — OpenAPI 3.1 specification endpoints.
//
// GET /openapi.yaml      返回 YAML 文本（text/yaml）
// GET /openapi.json      把 YAML 转成 JSON 后返回（application/json）
//
// 规范文件随二进制嵌入（embed.FS），确保部署后无需额外文件。
// 这样 Swagger UI / 代码生成器 / 客户端 SDK 都能直接消费。
package handler

import (
	_ "embed"
	"net/http"

	"github.com/gin-gonic/gin"
	"gopkg.in/yaml.v3"
)

//go:embed openapi.yaml
var openAPISpecYAML []byte

// OpenAPISpecYAML 返回 OpenAPI 3.1 规范的 YAML 字节，供 main.go 在
// 启动时 sanity-check 加载，或外部 SDK 生成工具使用。
func OpenAPISpecYAML() []byte { return openAPISpecYAML }

// GetOpenAPIYAML GET /openapi.yaml — 直接返回嵌入的 YAML。
func (h *Handler) GetOpenAPIYAML(c *gin.Context) {
	c.Data(http.StatusOK, "application/yaml; charset=utf-8", openAPISpecYAML)
}

// GetOpenAPIJSON GET /openapi.json — 把 YAML 转成 JSON 返回。
//
// 实现策略：
//   1. yaml.Unmarshal 成 interface{}
//   2. 用 encoding/json.Marshal 输出
//   3. 失败回 500（理论上不会，spec 自身是受控的）
func (h *Handler) GetOpenAPIJSON(c *gin.Context) {
	var v any
	if err := yaml.Unmarshal(openAPISpecYAML, &v); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": gin.H{
			"code": "E_INTERNAL", "message": "OpenAPI spec 解析失败",
			"details": err.Error(),
		}})
		return
	}
	c.JSON(http.StatusOK, v)
}
