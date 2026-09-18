// SysML v2 MBSE 后端服务。
// 当前版本：M3（AI 增强 + 元模型 + 模板 + 安全加固）。
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
	"github.com/sysmlv2/mbse-backend/internal/metamodel"
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
	teamH := handler.NewTeamHandler(repo)
	shareH := handler.NewShareHandler(repo)
	userH := handler.NewUserHandler(repo)
	auditH := handler.NewAuditHandler(repo)

	// 初始化元模型 registry（M3 W1：mock schema，dev 阶段够用；M5 替换为 ptc-25-04-30 官方）
	metaReg, err := metamodel.NewMockRegistry()
	if err != nil {
		log.Printf("⚠ 元模型 registry 初始化失败: %v（metamodel endpoint 将不可用）", err)
	}
	metaH := handler.NewMetaHandler(metaReg)

	// 初始化 AI handler（M3 W1：Provider interface + fallback chain）
	aiH := handler.NewAIHandler()

	if os.Getenv("GIN_MODE") == "" {
		gin.SetMode(gin.ReleaseMode)
	}
	r := gin.New()
	r.Use(gin.Recovery())

	// M3 安全加固（m3-security-checklist.md §A01-A05）：
	//   - 1 MB 请求体大小限制（OWASP A03）
	//   - CORS 白名单化（OWASP A05；移除 * 通配）
	//   - CSRF token（OWASP A01）
	//   - IP 限流（OWASP A04）
	r.Use(middleware.BodySizeLimit(1 << 20))
	r.Use(middleware.CORS(middleware.DefaultCORSConfig()))

	// 限流器：60 req/min/IP（写操作更严：可加 rate limit per route）
	rateLimiter := middleware.NewRateLimiter(60, time.Minute)
	r.Use(middleware.RateLimit(rateLimiter))

	r.Use(requestLogger())

	// CSRF 仅作用于 mutating 方法（GET/OPTIONS 不影响）。
	// 严格模式通过 CSRF_STRICT=true 切换（生产推荐；dev 默认兼容）。
	csrfCfg := middleware.DefaultCSRFConfig()
	if os.Getenv("CSRF_STRICT") == "true" {
		csrfCfg = middleware.StrictCSRFConfig()
		log.Println("CSRF: STRICT 模式启用 — 受保护 API 需 X-CSRF-Token header")
	}
	r.Use(middleware.CSRF(csrfCfg))

	// 健康检查
	r.GET("/health", h.Health)

	// API v1
	v1 := r.Group("/api/v1")
	{
		// Auth（公开路由：CSRF 已在 SkipPaths 中跳过）
		v1.POST("/auth/register", h.Register)
		v1.POST("/auth/login", h.Login)
		// M4.5 增量：/auth/me — 当前登录用户信息（含 isAdmin）
		v1.GET("/auth/me", middleware.AuthRequired(), h.Me)

		// 受保护路由（需要 JWT 认证）
		projects := v1.Group("/projects")
		projects.Use(middleware.AuthRequired())
		{
			projects.GET("", h.ListProjects)
			projects.POST("", h.CreateProject)
			projects.GET("/:id", h.GetProject)
			projects.PUT("/:id", h.UpdateProject)
			projects.DELETE("/:id", h.DeleteProject)

			projects.GET("/:id/models", h.ListModelsByProject)
			projects.POST("/:id/models", h.CreateModelInProject)
			projects.GET("/:id/models/:modelId", h.GetModel)
			projects.PUT("/:id/models/:modelId", h.UpdateModel)
			projects.DELETE("/:id/models/:modelId", h.DeleteModel)
			// M4.5 增量：模型版本历史（project-scoped）
			projects.GET("/:id/models/:modelId/versions", h.ListModelVersions)

			// M4 W3：项目级分享（owner 才能管）
			projects.POST("/:id/shares", shareH.AddShare)
			projects.GET("/:id/shares", shareH.ListShares)
			projects.DELETE("/:id/shares/:userId", shareH.RemoveShare)

			projects.POST("/:id/links", shareH.CreateLink)
			projects.GET("/:id/links", shareH.ListLinks)
			projects.DELETE("/:id/links/:linkId", shareH.RevokeLink)
			// M4.5 增量：链接轮换
			projects.POST("/:id/links/:linkId/rotate", shareH.RotateLink)
		}

		models := v1.Group("/models")
		models.Use(middleware.AuthRequired())
		{
			// M4.5 增量：跨项目模型搜索（放在 /:id 之前避免路由冲突）
			models.GET("/search", h.SearchModels)
			models.GET("", h.ListModels)
			models.POST("", h.CreateModel)
			models.GET("/:id", h.GetModel)
			models.PUT("/:id", h.UpdateModel)
			models.DELETE("/:id", h.DeleteModel)
			// M4.5 增量：模型版本历史
			models.GET("/:id/versions", h.ListModelVersions)
		}

		// AI endpoints（受保护）
		aiGroup := v1.Group("/ai")
		aiGroup.Use(middleware.AuthRequired())
		{
			// M2 兼容：语法检查
			aiGroup.POST("/check", aiH.CheckSyntax)
			aiGroup.POST("/check/stream", aiH.CheckSyntaxStream)
			// M3 新增：NL → SysML v2 生成
			aiGroup.POST("/generate", aiH.Generate)
			aiGroup.POST("/generate/stream", aiH.GenerateStream)
		}

		// M3 新增：元模型查询（受保护，避免暴露 schema）
		metaGroup := v1.Group("/metamodel")
		metaGroup.Use(middleware.AuthRequired())
		{
			metaGroup.GET("/elements", metaH.ListElements)
			metaGroup.GET("/elements/:qname", metaH.GetElement)
			metaGroup.GET("/subtypes/:qname", metaH.SubTypes)
			metaGroup.GET("/edges/:qname", metaH.Edges)
			metaGroup.GET("/search", metaH.Search)
		}

		// M3 新增：行业模板（公开浏览，仅元数据；Content 需要时按需 GET）
		v1.GET("/templates", h.ListTemplates)
		v1.GET("/templates/:id", h.GetTemplate)

		// M4 W3：公开端点（不走 AuthRequired；用独立限流器更严）
		sharedLimiter := middleware.NewRateLimiter(20, time.Minute)
		shared := v1.Group("/shared")
		shared.Use(middleware.RateLimit(sharedLimiter))
		{
			shared.GET("/:token", shareH.GetSharedProject)
		}

		// M4 W2：团队 + 成员 + 项目授权（受保护）
		teams := v1.Group("/teams")
		teams.Use(middleware.AuthRequired())
		{
			teams.POST("", teamH.CreateTeam)
			teams.GET("", teamH.ListTeams)
			teams.GET("/:id", teamH.GetTeam)
			teams.PUT("/:id", teamH.UpdateTeam)
			teams.DELETE("/:id", teamH.DeleteTeam)

			teams.GET("/:id/members", teamH.ListMembers)
			teams.POST("/:id/members", teamH.AddMember)
			teams.PUT("/:id/members/:userId", teamH.UpdateMember)
			teams.DELETE("/:id/members/:userId", teamH.DeleteMember)

			teams.GET("/:id/project-access", teamH.ListProjectAccess)
			teams.POST("/:id/project-access", teamH.GrantProjectAccess)
			teams.DELETE("/:id/project-access/:projectId", teamH.RevokeProjectAccess)
		}

		// M4 W3 补充：用户搜索（受保护），用于分享/邀请场景解析 username → userId
		usersGroup := v1.Group("/users")
		usersGroup.Use(middleware.AuthRequired())
		{
			usersGroup.GET("/search", userH.SearchUsers)
		}

		// M4.5 补充：审计日志查询（受保护）
		auditGroup := v1.Group("/audit-logs")
		auditGroup.Use(middleware.AuthRequired())
		{
			auditGroup.GET("", auditH.ListAuditLogs)
			// M4.5 增量：CSV 导出（M5+ 候选落地）
			auditGroup.GET("/export", auditH.ExportAuditLogs)
			// M4.5 增量：归档清理（M5+ 候选落地）— 删除 ≥ N 天前的日志
			auditGroup.DELETE("/archive", auditH.ArchiveAuditLogs)
		}

		// M5：Profile 导出/导入（受保护）
		profilesGroup := v1.Group("/profiles")
		profilesGroup.Use(middleware.AuthRequired())
		{
			profilesGroup.POST("/export", h.ExportProfile)
			profilesGroup.POST("/import", h.ImportProfile)
		}

		// M6：Webhook 事件通知（受保护）
		webhooksGroup := v1.Group("/webhooks")
		webhooksGroup.Use(middleware.AuthRequired())
		{
			webhooksGroup.POST("", h.CreateWebhook)
			webhooksGroup.GET("", h.ListWebhooks)
			webhooksGroup.DELETE("/:id", h.DeleteWebhook)
			webhooksGroup.POST("/:id/test", h.TestWebhook)
		}

		// M6：API Key 管理（受保护）
		apiKeysGroup := v1.Group("/api-keys")
		apiKeysGroup.Use(middleware.AuthRequired())
		{
			apiKeysGroup.POST("", h.CreateAPIKey)
			apiKeysGroup.GET("", h.ListAPIKeys)
			apiKeysGroup.DELETE("/:id", h.DeleteAPIKey)
		}

		// M6：外部模型导入（受保护）
		importGroup := v1.Group("/import")
		importGroup.Use(middleware.AuthRequired())
		{
			importGroup.POST("/papyrus", h.ImportPapyrus)
			importGroup.POST("/capella", h.ImportCapella)
		}

		// M7：设计文档生成（受保护）
		reportsGroup := v1.Group("/reports")
		reportsGroup.Use(middleware.AuthRequired())
		{
			reportsGroup.POST("/generate", h.GenerateReport)
		}

		// M7：插件系统（受保护）
		pluginsGroup := v1.Group("/plugins")
		pluginsGroup.Use(middleware.AuthRequired())
		{
			pluginsGroup.POST("", h.CreatePlugin)
			pluginsGroup.GET("", h.ListPlugins)
			pluginsGroup.DELETE("/:id", h.DeletePlugin)
			pluginsGroup.POST("/:id/toggle", h.TogglePlugin)
		}

		// M8：订阅管理（受保护）
		subGroup := v1.Group("/subscription")
		subGroup.Use(middleware.AuthRequired())
		{
			subGroup.GET("/plans", h.GetPlans)
			subGroup.GET("", h.GetSubscription)
			subGroup.POST("/upgrade", h.UpgradeSubscription)
		}

		// 模型评论（受保护）
		modelsGroup := v1.Group("/models")
		modelsGroup.Use(middleware.AuthRequired())
		{
			modelsGroup.POST("/:id/comments", h.AddComment)
			modelsGroup.GET("/:id/comments", h.ListComments)
			modelsGroup.DELETE("/:id/comments/:commentId", h.DeleteComment)
			modelsGroup.PUT("/:id/comments/:commentId/resolve", h.ResolveComment)
		}
	}

	srv := &http.Server{
		Addr:              ":" + port,
		Handler:           r,
		ReadHeaderTimeout: 5 * time.Second,
	}

	go func() {
		log.Printf("SysML v2 MBSE Backend 启动在 :%s (db=%s)", port, dbPath)
		if metaReg != nil {
			log.Printf("  · 元模型: %d 元素已加载 (source=%s)", metaReg.Count(), metaReg.Source())
		}
		if aiH != nil {
			log.Printf("  · AI: fallback chain 已配置")
		}
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

func requestLogger() gin.HandlerFunc {
	return func(c *gin.Context) {
		start := time.Now()
		c.Next()
		log.Printf("%s %s -> %d (%s)", c.Request.Method, c.Request.URL.Path, c.Writer.Status(), time.Since(start))
	}
}