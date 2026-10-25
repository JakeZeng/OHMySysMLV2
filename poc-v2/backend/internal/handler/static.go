// Package handler — 前端静态资源服务（M18）。
//
// 目的：安装包（Windows / Linux / macOS）解压后只带一个后端二进制 + web/ 目录，
// 由 Go 服务直接托管前端 SPA，不再依赖 Vite dev server。
//
// 行为：
//   - 命中真实文件 → 直接返回（带 ETag / Last-Modified）
//   - 未命中且不是 /api 路径 → 回退到 index.html（SPA 前端路由）
//   - 未命中且是 /api 路径 → 404 JSON
package handler

import (
	"net/http"
	"os"
	"path/filepath"
	"strings"

	"github.com/gin-gonic/gin"
)

// NewStaticHandler 返回 SPA 静态资源 handler。
//
// webDir 为空或目录不存在时，返回一个只对 /api 返回 404 JSON 的 handler
// （开发模式下前端由 Vite 托管，后端不介入）。
func NewStaticHandler(webDir string) gin.HandlerFunc {
	absDir, err := filepath.Abs(webDir)
	if err != nil || webDir == "" {
		absDir = ""
	}
	if absDir != "" {
		if st, statErr := os.Stat(absDir); statErr != nil || !st.IsDir() {
			absDir = ""
		}
	}

	return func(c *gin.Context) {
		if strings.HasPrefix(c.Request.URL.Path, "/api/") {
			c.JSON(http.StatusNotFound, gin.H{"error": gin.H{
				"code":    "NOT_FOUND",
				"message": "接口不存在",
			}})
			return
		}
		if absDir == "" {
			c.String(http.StatusNotFound, "静态资源目录未配置（WEB_DIR）")
			return
		}

		reqPath := c.Request.URL.Path
		if strings.Contains(reqPath, "..") { // 目录穿越防护
			c.Status(http.StatusBadRequest)
			return
		}

		filePath := filepath.Join(absDir, filepath.FromSlash(strings.TrimPrefix(reqPath, "/")))
		if st, statErr := os.Stat(filePath); statErr == nil && !st.IsDir() {
			c.File(filePath)
			return
		}

		// SPA 回退
		index := filepath.Join(absDir, "index.html")
		if _, statErr := os.Stat(index); statErr == nil {
			c.File(index)
			return
		}
		c.String(http.StatusNotFound, "前端资源不存在")
	}
}
