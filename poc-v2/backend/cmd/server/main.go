// SysML v2 MBSE 后端服务（M1 极简版）。
package main

import (
	"context"
	"errors"
	"log"
	"net/http"
	"os"
	"os/signal"
	"syscall"
	"time"

	"github.com/gin-gonic/gin"

	"github.com/sysmlv2/mbse-backend/internal/handler"
	"github.com/sysmlv2/mbse-backend/internal/middleware"
	"github.com/sysmlv2/mbse-backend/internal/repository"
)

func main() {
	port := os.Getenv("PORT")
	if port == "" {
		port = "8080"
	}

	dbPath := os.Getenv("DB_PATH")
	if dbPath == "" {
		dbPath = "./sysmlv2.db"
	}

	repo, err := repository.New(dbPath)
	if err != nil {
		log.Fatalf("初始化数据库失败 (path=%s): %v", dbPath, err)
	}
	defer repo.Close()

	h := handler.New(repo)

	if os.Getenv("GIN_MODE") == "" {
		gin.SetMode(gin.ReleaseMode)
	}
	r := gin.New()
	r.Use(gin.Recovery())
	r.Use(corsMiddleware())
	r.Use(requestLogger())

	// 健康检查
	r.GET("/health", h.Health)

	// API v1
	v1 := r.Group("/api/v1")
	{
		// Auth（公开路由）
		v1.POST("/auth/register", h.Register)
		v1.POST("/auth/login", h.Login)

		// 受保护路由（需要 JWT 认证）
		projects := v1.Group("/projects")
		projects.Use(middleware.AuthRequired())
		{
			projects.GET("", h.ListProjects)
			projects.POST("", h.CreateProject)
			projects.GET("/:id", h.GetProject)
			projects.PUT("/:id", h.UpdateProject)
			projects.DELETE("/:id", h.DeleteProject)

			// Models（嵌套路由，关联到项目）
			projects.GET("/:id/models", h.ListModelsByProject)
			projects.POST("/:id/models", h.CreateModelInProject)
			projects.GET("/:id/models/:modelId", h.GetModel)
			projects.PUT("/:id/models/:modelId", h.UpdateModel)
			projects.DELETE("/:id/models/:modelId", h.DeleteModel)
		}

		// Models（旧版平坦路由，保留兼容，也需认证）
		models := v1.Group("/models")
		models.Use(middleware.AuthRequired())
		{
			models.GET("", h.ListModels)
			models.POST("", h.CreateModel)
			models.GET("/:id", h.GetModel)
			models.PUT("/:id", h.UpdateModel)
			models.DELETE("/:id", h.DeleteModel)
		}
	}

	srv := &http.Server{
		Addr:              ":" + port,
		Handler:           r,
		ReadHeaderTimeout: 5 * time.Second,
	}

	go func() {
		log.Printf("SysML v2 MBSE Backend 启动在 :%s (db=%s)", port, dbPath)
		if err := srv.ListenAndServe(); err != nil && !errors.Is(err, http.ErrServerClosed) {
			log.Fatalf("HTTP 服务异常退出: %v", err)
		}
	}()

	// 优雅关闭
	quit := make(chan os.Signal, 1)
	signal.Notify(quit, syscall.SIGINT, syscall.SIGTERM)
	<-quit
	log.Println("收到关闭信号，开始优雅退出...")

	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	if err := srv.Shutdown(ctx); err != nil {
		log.Printf("HTTP 服务关闭失败: %v", err)
	}
	log.Println("服务已退出")
}

func corsMiddleware() gin.HandlerFunc {
	return func(c *gin.Context) {
		c.Writer.Header().Set("Access-Control-Allow-Origin", "*")
		c.Writer.Header().Set("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS")
		c.Writer.Header().Set("Access-Control-Allow-Headers", "Content-Type, Authorization")
		if c.Request.Method == "OPTIONS" {
			c.AbortWithStatus(http.StatusNoContent)
			return
		}
		c.Next()
	}
}

func requestLogger() gin.HandlerFunc {
	return func(c *gin.Context) {
		start := time.Now()
		c.Next()
		log.Printf("%s %s -> %d (%s)", c.Request.Method, c.Request.URL.Path, c.Writer.Status(), time.Since(start))
	}
}
