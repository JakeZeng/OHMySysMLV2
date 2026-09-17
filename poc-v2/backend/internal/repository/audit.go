// Package repository — M4.5 审计日志 append-only 写入。
package repository

import (
	"context"
	"time"

	"github.com/sysmlv2/mbse-backend/internal/model"
)

// AppendAuditLog 写入一条审计日志。
//
//   - actorID 可空（公开操作）
//   - metadata 应为 JSON 字符串；可空
func (r *SQLiteRepository) AppendAuditLog(
	ctx context.Context,
	actorID, action, targetType, targetID, metadata, ip, userAgent string,
) error {
	id := newID()
	if metadata == "" {
		metadata = "{}"
	}
	_, err := r.db.ExecContext(ctx,
		`INSERT INTO audit_logs (id, actor_id, action, target_type, target_id, metadata, ip, user_agent, created_at)
		 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
		id, actorID, action, targetType, targetID, metadata, ip, userAgent, time.Now().UTC(),
	)
	return err
}

// ListAuditLogs 列出审计日志（按时间倒序，最多 limit 条，默认 50，上限 200）。
//
//   - filterActor: 可选，按 actor_id 过滤
//   - filterTargetType + filterTargetID: 可选，按目标过滤
func (r *SQLiteRepository) ListAuditLogs(
	ctx context.Context,
	filterActor, filterTargetType, filterTargetID string,
	limit int,
) ([]*model.AuditLog, error) {
	if limit <= 0 || limit > 200 {
		limit = 50
	}
	q := `SELECT id, COALESCE(actor_id, ''), action, target_type, target_id, metadata, ip, user_agent, created_at
	      FROM audit_logs WHERE 1=1`
	args := []any{}
	if filterActor != "" {
		q += ` AND actor_id = ?`
		args = append(args, filterActor)
	}
	if filterTargetType != "" && filterTargetID != "" {
		q += ` AND target_type = ? AND target_id = ?`
		args = append(args, filterTargetType, filterTargetID)
	}
	q += ` ORDER BY created_at DESC LIMIT ?`
	args = append(args, limit)

	rows, err := r.db.QueryContext(ctx, q, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []*model.AuditLog
	for rows.Next() {
		var l model.AuditLog
		if err := rows.Scan(
			&l.ID, &l.ActorID, &l.Action, &l.TargetType, &l.TargetID,
			&l.Metadata, &l.IP, &l.UserAgent, &l.CreatedAt,
		); err != nil {
			return nil, err
		}
		out = append(out, &l)
	}
	return out, rows.Err()
}