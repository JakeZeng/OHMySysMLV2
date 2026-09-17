// Package handler — 授权层（M4 W1）。
//
// 后端第一次引入资源级授权。当前所有项目 / 模型端点对任何登录用户开放
// （M3 行为），M4 改造后：
//
//   - Project owner：永久 admin
//   - Team member of granted team：通过 team_project_access 获得权限
//   - Direct project_shares：直接被分享的用户获得权限
//   - 公开项目（visibility='public'）+ 匿名 share_link：持有 token 即可读
//
// 设计要点：
//   - 不引入 service 层（项目现有约定：handler ↔ repository 直连）
//   - Permission 用数值枚举，"至少 N" 语义便于"write >= read"判断
//   - 所有 helper 在失败时通过 gin's c.JSON 直接返回，由调用者 return
//
// 跨 phase 状态：本文件已就位但尚未被 handler.go 端点调用（W1 末尾接入）。
package handler

import (
	"crypto/sha256"
	"database/sql"
	"encoding/hex"
	"errors"
	"net/http"
	"time"

	"github.com/gin-gonic/gin"

	"github.com/sysmlv2/mbse-backend/internal/model"
	"github.com/sysmlv2/mbse-backend/internal/repository"
)

// Permission 数值越大权限越高（write >= read，admin >= write）。
type Permission int

const (
	PermRead  Permission = 1
	PermWrite Permission = 2
	PermAdmin Permission = 3
)

// permLevel 把数据库存的字符串权限转成数值。
func permLevel(s string) Permission {
	switch s {
	case "admin":
		return PermAdmin
	case "write":
		return PermWrite
	case "read":
		return PermRead
	default:
		return Permission(0)
	}
}

// isAtLeast 检查 held 是否 >= required。
func isAtLeast(held, required Permission) bool { return held >= required }

// ─── 用户维度：项目权限计算 ──────────────────────────────────────────────

// userHeldPermission 计算 userID 对 project 持有的最高权限。
// 顺序：owner > direct share > team share > 0
// 项目 owner 永远是 admin（无需在 project_shares / team_project_access 中）。
func userHeldPermission(repo *repository.SQLiteRepository, userID, projectID string) (Permission, error) {
	// 1. owner 判定
	var ownerID string
	err := repo.DB().QueryRow(`SELECT owner_id FROM projects WHERE id = ?`, projectID).Scan(&ownerID)
	if errors.Is(err, sql.ErrNoRows) {
		return 0, repository.ErrNotFound
	}
	if err != nil {
		return 0, err
	}
	if ownerID == userID {
		return PermAdmin, nil
	}

	var held Permission

	// 2. 直接分享
	var direct string
	err = repo.DB().QueryRow(
		`SELECT permission FROM project_shares WHERE project_id = ? AND user_id = ?`,
		projectID, userID,
	).Scan(&direct)
	switch {
	case err == nil:
		if p := permLevel(direct); p > held {
			held = p
		}
	case errors.Is(err, sql.ErrNoRows):
		// 无直分享，继续
	default:
		return 0, err
	}

	// 3. 团队分享：用户所在的任何团队对该项目有权限
	rows, err := repo.DB().Query(
		`SELECT tpa.permission FROM team_project_access tpa
         JOIN team_members tm ON tm.team_id = tpa.team_id
         WHERE tpa.project_id = ? AND tm.user_id = ?`,
		projectID, userID,
	)
	if err != nil {
		return 0, err
	}
	defer rows.Close()
	for rows.Next() {
		var p string
		if err := rows.Scan(&p); err != nil {
			return 0, err
		}
		if v := permLevel(p); v > held {
			held = v
		}
	}
	if err := rows.Err(); err != nil {
		return 0, err
	}
	return held, nil
}

// hasProjectAccess 检查当前请求用户对 projectID 是否至少有 required 权限。
// 失败时返回 (false, httpStatus, err)；httpStatus 为 0 表示自行用 badRequest 写响应。
func hasProjectAccess(c *gin.Context, repo *repository.SQLiteRepository, projectID string, required Permission) (bool, int, error) {
	userID := c.GetString("user_id")
	if userID == "" {
		// 公开路由（未登录）只能 read
		if required != PermRead {
			notFound(c, "项目不存在") // 不区分"未登录"和"无权限"，避免信息泄露
			return false, http.StatusNotFound, nil
		}
		// 检查 visibility='public'
		var visibility string
		err := repo.DB().QueryRow(`SELECT visibility FROM projects WHERE id = ?`, projectID).Scan(&visibility)
		if errors.Is(err, sql.ErrNoRows) {
			notFound(c, "项目不存在")
			return false, http.StatusNotFound, nil
		}
		if err != nil {
			return false, 0, err
		}
		if visibility != model.VisibilityPublic {
			notFound(c, "项目不存在")
			return false, http.StatusNotFound, nil
		}
		return true, 0, nil
	}

	held, err := userHeldPermission(repo, userID, projectID)
	if errors.Is(err, repository.ErrNotFound) {
		notFound(c, "项目不存在")
		return false, http.StatusNotFound, nil
	}
	if err != nil {
		return false, 0, err
	}
	if !isAtLeast(held, required) {
		// 403：登录但权限不足；为避免泄露项目存在性，对 missing project 一律返回 404
		c.JSON(http.StatusForbidden, gin.H{"error": gin.H{
			"code": "E_FORBIDDEN", "message": "无权限访问该项目",
		}})
		return false, http.StatusForbidden, nil
	}
	return true, 0, nil
}

// loadAccessibleProject 加载项目并验证权限，返回 (project, heldPermission)。
// 已通过权限检查则返回 held；调用方可据此做"仅 admin 能做"的细分（如下/移权）。
func loadAccessibleProject(c *gin.Context, repo *repository.SQLiteRepository, projectID string, required Permission) (*model.Project, Permission, error) {
	p, err := repo.GetProject(c.Request.Context(), projectID)
	if errors.Is(err, repository.ErrNotFound) {
		notFound(c, "项目不存在")
		return nil, 0, nil
	}
	if err != nil {
		serverError(c, "加载项目失败", err)
		return nil, 0, nil
	}
	ok, status, err := hasProjectAccess(c, repo, projectID, required)
	if err != nil {
		serverError(c, "权限检查失败", err)
		return nil, 0, nil
	}
	if !ok {
		if status == http.StatusForbidden {
			_ = status // 已写响应
		}
		return nil, 0, nil
	}
	// 取当前用户对该项目的实际持有权限（用于响应里给前端做 UI 提示）
	held := PermAdmin // 兜底；通过权限检查说明至少 held >= required
	if uid := c.GetString("user_id"); uid != "" {
		if h, herr := userHeldPermission(repo, uid, projectID); herr == nil {
			held = h
		}
	}
	return p, held, nil
}

// loadAccessibleModel 通过 modelID 加载 model，再加载其 project 并验证权限。
// 返回 (model, project, heldPermission)。
func loadAccessibleModel(c *gin.Context, repo *repository.SQLiteRepository, modelID string, required Permission) (*model.Model, *model.Project, Permission, error) {
	m, err := repo.GetModel(c.Request.Context(), modelID)
	if errors.Is(err, repository.ErrNotFound) {
		notFound(c, "模型不存在")
		return nil, nil, 0, nil
	}
	if err != nil {
		serverError(c, "加载模型失败", err)
		return nil, nil, 0, nil
	}
	p, held, lerr := loadAccessibleProject(c, repo, m.ProjectID, required)
	if lerr != nil {
		return nil, nil, 0, lerr
	}
	if p == nil {
		return nil, nil, 0, nil
	}
	return m, p, held, nil
}

// ─── 团队维度辅助 ─────────────────────────────────────────────────────────

// resolveTeamMemberRole 查询 userID 在 teamID 中的角色。
// 返回 ("", false, nil) 表示不是成员。
// 返回 (ErrNotFound) 表示 team 不存在。
func resolveTeamMemberRole(repo *repository.SQLiteRepository, userID, teamID string) (string, bool, error) {
	var role string
	err := repo.DB().QueryRow(
		`SELECT role FROM team_members WHERE team_id = ? AND user_id = ?`,
		teamID, userID,
	).Scan(&role)
	if errors.Is(err, sql.ErrNoRows) {
		// 区分"team 不存在"和"user 不是 member"
		var exists int
		if e := repo.DB().QueryRow(`SELECT 1 FROM teams WHERE id = ?`, teamID).Scan(&exists); e != nil {
			if errors.Is(e, sql.ErrNoRows) {
				return "", false, repository.ErrNotFound
			}
			return "", false, e
		}
		return "", false, nil
	}
	if err != nil {
		return "", false, err
	}
	return role, true, nil
}

// ─── Share Link 辅助 ─────────────────────────────────────────────────────

// hashToken 返回 token 的 SHA-256 十六进制摘要（用于存储 + 查找）。
// 在 share_links 表存 token_hash 而不是明文 token。
func hashToken(token string) string {
	sum := sha256.Sum256([]byte(token))
	return hex.EncodeToString(sum[:])
}

// AnonymousAccessResult 是 /shared/:token 公开端点的解析结果。
type AnonymousAccessResult struct {
	LinkID     string // 用于统计 view_count
	ProjectID  string
	Permission Permission
}

// resolveShareToken 通过明文 token 查找有效链接，返回（projectID, permission）。
// 任何失效情况（不存在/已撤销/已过期）一律返回 ErrNotFound，调用方统一 404。
func resolveShareToken(repo *repository.SQLiteRepository, token string) (AnonymousAccessResult, error) {
	if token == "" {
		return AnonymousAccessResult{}, repository.ErrNotFound
	}
	var (
		linkID    string
		projectID string
		permStr   string
		expiresAt sql.NullTime
		revokedAt sql.NullTime
	)
	err := repo.DB().QueryRow(
		`SELECT id, project_id, permission, expires_at, revoked_at
         FROM share_links WHERE token_hash = ?`,
		hashToken(token),
	).Scan(&linkID, &projectID, &permStr, &expiresAt, &revokedAt)
	if errors.Is(err, sql.ErrNoRows) {
		return AnonymousAccessResult{}, repository.ErrNotFound
	}
	if err != nil {
		return AnonymousAccessResult{}, err
	}
	if revokedAt.Valid {
		return AnonymousAccessResult{}, repository.ErrNotFound
	}
	if expiresAt.Valid && expiresAt.Time.Before(time.Now().UTC()) {
		return AnonymousAccessResult{}, repository.ErrNotFound
	}
	return AnonymousAccessResult{
		LinkID:     linkID,
		ProjectID:  projectID,
		Permission: permLevel(permStr),
	}, nil
}