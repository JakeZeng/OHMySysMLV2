package main

import (
	"log"
	"net/http"
	"os"

	"github.com/gin-gonic/gin"
)

// ─── 启动入口 ────────────────────────────────────────────────────────────

func main() {
	port := os.Getenv("PORT")
	if port == "" {
		port = "8080"
	}

	r := gin.Default()

	// CORS 中间件
	r.Use(func(c *gin.Context) {
		c.Writer.Header().Set("Access-Control-Allow-Origin", "*")
		c.Writer.Header().Set("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS")
		c.Writer.Header().Set("Access-Control-Allow-Headers", "Content-Type, Authorization")
		if c.Request.Method == "OPTIONS" {
			c.AbortWithStatus(http.StatusNoContent)
			return
		}
		c.Next()
	})

	// 健康检查
	r.GET("/health", func(c *gin.Context) {
		c.JSON(http.StatusOK, gin.H{"status": "ok"})
	})

	// ─── 模型 CRUD ────────────────────────────────────────────────────────

	// 创建模型
	r.POST("/api/models", createModel)

	// 获取所有模型
	r.GET("/api/models", listModels)

	// 获取单个模型
	r.GET("/api/models/:id", getModel)

	// 更新模型
	r.PUT("/api/models/:id", updateModel)

	// 删除模型
	r.DELETE("/api/models/:id", deleteModel)

	// ─── 解析与验证 ────────────────────────────────────────────────────────

	// 文本 → JSON 转换
	r.POST("/api/parse", parseText)

	// JSON Schema 验证
	r.POST("/api/validate", validateSchema)

	log.Printf("SysML v2 POC Backend 启动在 :%s", port)
	if err := r.Run(":" + port); err != nil {
		log.Fatal(err)
	}
}

// ─── 数据模型 ─────────────────────────────────────────────────────────────

type Model struct {
	ID      string                 `json:"id"`
	Name    string                `json:"name"`
	Content string                `json:"content"` // SysML 文本内容
	JSON    map[string]interface{} `json:"json"`    // 解析后的 JSON 表示
}

type ParseRequest struct {
	Source string `json:"source" binding:"required"`
}

type ParseResponse struct {
	Elements []Element `json:"elements"`
	JSON     any      `json:"json"`
	Errors   []any    `json:"errors"`
}

type Element struct {
	ID       string `json:"id"`
	Kind     string `json:"kind"`
	Name     string `json:"name"`
	Raw      string `json:"raw"`
	Line     int    `json:"lineNumber"`
}

type ValidateRequest struct {
	JSON  any  `json:"json" binding:"required"`
	Draft bool `json:"draft"` // 是否使用 OMG 正式 Schema
}

type ValidateResponse struct {
	Valid   bool     `json:"valid"`
	Errors  []string `json:"errors,omitempty"`
	Message string   `json:"message,omitempty"`
}

// ─── 模型 CRUD Handlers ───────────────────────────────────────────────────

func createModel(c *gin.Context) {
	var input Model
	if err := c.ShouldBindJSON(&input); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	// TODO: 存储到 PostgreSQL
	c.JSON(http.StatusCreated, gin.H{
		"id":      input.ID,
		"name":    input.Name,
		"message": "Model created (POC stub)",
	})
}

func listModels(c *gin.Context) {
	// TODO: 从 PostgreSQL 查询
	c.JSON(http.StatusOK, gin.H{
		"models": []any{},
		"total":  0,
	})
}

func getModel(c *gin.Context) {
	id := c.Param("id")
	// TODO: 从 PostgreSQL 查询
	c.JSON(http.StatusOK, gin.H{
		"id":    id,
		"name":  "sample",
		"content": "package Sample { }",
	})
}

func updateModel(c *gin.Context) {
	id := c.Param("id")
	var input Model
	if err := c.ShouldBindJSON(&input); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	// TODO: 更新 PostgreSQL
	c.JSON(http.StatusOK, gin.H{
		"id":      id,
		"message": "Model updated (POC stub)",
	})
}

func deleteModel(c *gin.Context) {
	id := c.Param("id")
	// TODO: 从 PostgreSQL 删除
	c.JSON(http.StatusOK, gin.H{
		"id":      id,
		"message": "Model deleted (POC stub)",
	})
}

// ─── 解析 Handler ────────────────────────────────────────────────────────

func parseText(c *gin.Context) {
	var req ParseRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	// TODO: Phase 2 替换为 WASM 调用的 Eclipse Xtext 解析器
	// 目前返回占位结果
	response := ParseResponse{
		Elements: []Element{
			{
				ID:   "e1",
				Kind: "package",
				Name: "MySystem",
				Raw:  "package MySystem { }",
				Line: 1,
			},
		},
		JSON: map[string]any{
			"package": "MySystem",
			"elements": []any{},
		},
		Errors: []any{},
	}

	c.JSON(http.StatusOK, response)
}

// ─── Schema 验证 Handler ─────────────────────────────────────────────────

func validateSchema(c *gin.Context) {
	var req ValidateRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	// TODO: 使用 OMG ptc/25-04-32 JSON Schema 验证
	response := ValidateResponse{
		Valid:   true,
		Message: "Validation passed (POC stub)",
	}

	c.JSON(http.StatusOK, response)
}
