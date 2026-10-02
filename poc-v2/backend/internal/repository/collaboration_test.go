package repository

import (
	"context"
	"path/filepath"
	"testing"
	"time"

	"github.com/google/uuid"

	"github.com/sysmlv2/mbse-backend/internal/model"
)

func newCollabTestRepo(t *testing.T) (*SQLiteRepository, string) {
	t.Helper()
	dir := t.TempDir()
	path := filepath.Join(dir, "test.db")
	repo, err := New(path)
	if err != nil {
		t.Fatalf("create repo: %v", err)
	}
	t.Cleanup(func() { _ = repo.Close() })
	return repo, path
}

// createTestUser 创建测试用户（绕过 FK 约束）。
func createTestUser(t *testing.T, repo *SQLiteRepository, id, username string) {
	t.Helper()
	_, err := repo.db.ExecContext(context.Background(),
		`INSERT INTO users (id, username, email, password_hash) VALUES (?, ?, ?, 'x')`,
		id, username, id+"@test")
	if err != nil {
		t.Fatalf("create user: %v", err)
	}
}

// ─── Presence ─────────────────────────────────────────────────────

func TestPresence_UpsertAndList(t *testing.T) {
	repo, _ := newCollabTestRepo(t)
	createTestUser(t, repo, "u1", "alice")
	ctx := context.Background()

	p := &model.Presence{Scope: "package:pkg1", UserID: "u1", Username: "alice", Color: "#fff", ContentHash: "abc"}
	if err := repo.UpsertPresence(ctx, p); err != nil {
		t.Fatalf("upsert: %v", err)
	}

	list, err := repo.ListPresence(ctx, "package:pkg1", "", 30)
	if err != nil {
		t.Fatalf("list: %v", err)
	}
	if len(list) != 1 || list[0].UserID != "u1" {
		t.Errorf("list 结果错误: %+v", list)
	}

	// 排除自己
	list2, _ := repo.ListPresence(ctx, "package:pkg1", "u1", 30)
	if len(list2) != 0 {
		t.Errorf("exclude self 失败：%+v", list2)
	}
}

func TestPresence_LazyCleanup(t *testing.T) {
	repo, _ := newCollabTestRepo(t)
	createTestUser(t, repo, "u_old", "old")
	ctx := context.Background()

	// 手动插入一条 60s 前的 presence
	_, err := repo.db.ExecContext(ctx,
		`INSERT INTO presence (scope, user_id, username, color, last_seen) VALUES (?, ?, ?, ?, datetime('now', '-60 seconds'))`,
		"package:p", "u_old", "old", "#000")
	if err != nil {
		t.Fatalf("insert old: %v", err)
	}

	// ttl=30s 应清掉
	list, _ := repo.ListPresence(ctx, "package:p", "", 30)
	if len(list) != 0 {
		t.Errorf("过期记录应被清理，got %d", len(list))
	}
}

func TestPresence_PruneStale(t *testing.T) {
	repo, _ := newCollabTestRepo(t)
	createTestUser(t, repo, "u", "n")
	createTestUser(t, repo, "u2", "n2")
	ctx := context.Background()
	repo.db.ExecContext(ctx,
		`INSERT INTO presence (scope, user_id, username) VALUES ('s', 'u', 'n')`)
	repo.db.ExecContext(ctx,
		`INSERT INTO presence (scope, user_id, username, last_seen) VALUES ('s', 'u2', 'n2', datetime('now', '-60 seconds'))`)

	n, err := repo.PruneStalePresence(ctx, 30)
	if err != nil {
		t.Fatalf("prune: %v", err)
	}
	if n != 1 {
		t.Errorf("期望清理 1 条，got %d", n)
	}
}

// ─── Edit Locks ────────────────────────────────────────────────────

func TestEditLock_Acquire(t *testing.T) {
	repo, _ := newCollabTestRepo(t)
	createTestUser(t, repo, "u1", "alice")
	createTestUser(t, repo, "u2", "bob")
	ctx := context.Background()

	lock := &model.EditLock{
		Scope: "package:p1", OwnerID: "u1", Username: "alice",
		ExpiresAt: time.Now().Add(time.Minute), BaseVersion: 1,
	}
	if err := repo.TryAcquireLock(ctx, lock); err != nil {
		t.Fatalf("acquire: %v", err)
	}

	// 同人再次 acquire → 应成功（续期）
	if err := repo.TryAcquireLock(ctx, lock); err != nil {
		t.Errorf("同用户再次 acquire 应成功：%v", err)
	}

	// 他人 acquire → 应失败
	other := &model.EditLock{
		Scope: "package:p1", OwnerID: "u2", Username: "bob",
		ExpiresAt: time.Now().Add(time.Minute),
	}
	if err := repo.TryAcquireLock(ctx, other); err != ErrLockHeldByOther {
		t.Errorf("他人 acquire 应返 ErrLockHeldByOther，got %v", err)
	}
}

func TestEditLock_TakeoverExpired(t *testing.T) {
	repo, _ := newCollabTestRepo(t)
	createTestUser(t, repo, "u1", "a")
	createTestUser(t, repo, "u2", "b")
	ctx := context.Background()

	// 手动插入过期锁
	repo.db.ExecContext(ctx,
		`INSERT INTO edit_locks (scope, owner_id, username, expires_at, base_version) VALUES ('p', 'u1', 'a', datetime('now', '-1 seconds'), 1)`)

	// u2 应可接管
	newLock := &model.EditLock{
		Scope: "p", OwnerID: "u2", Username: "b",
		ExpiresAt: time.Now().Add(time.Minute),
	}
	if err := repo.TryAcquireLock(ctx, newLock); err != nil {
		t.Errorf("接管过期锁应成功：%v", err)
	}
}

func TestEditLock_Heartbeat(t *testing.T) {
	repo, _ := newCollabTestRepo(t)
	createTestUser(t, repo, "u1", "a")
	createTestUser(t, repo, "u2", "b")
	ctx := context.Background()

	lock := &model.EditLock{Scope: "p", OwnerID: "u1", Username: "a", ExpiresAt: time.Now().Add(time.Minute)}
	_ = repo.TryAcquireLock(ctx, lock)

	if err := repo.HeartbeatLock(ctx, "p", "u1", 60); err != nil {
		t.Errorf("owner 心跳应成功：%v", err)
	}
	if err := repo.HeartbeatLock(ctx, "p", "u2", 60); err != ErrLockHeldByOther {
		t.Errorf("非 owner 心跳应失败，got %v", err)
	}
}

func TestEditLock_Release(t *testing.T) {
	repo, _ := newCollabTestRepo(t)
	createTestUser(t, repo, "u1", "a")
	createTestUser(t, repo, "u2", "b")
	ctx := context.Background()

	lock := &model.EditLock{Scope: "p", OwnerID: "u1", Username: "a", ExpiresAt: time.Now().Add(time.Minute)}
	_ = repo.TryAcquireLock(ctx, lock)

	// 他人释放 → false
	ok, _ := repo.ReleaseLock(ctx, "p", "u2")
	if ok {
		t.Errorf("非 owner 不应能释放")
	}
	// owner 释放 → true
	ok, _ = repo.ReleaseLock(ctx, "p", "u1")
	if !ok {
		t.Errorf("owner 应能释放")
	}

	// 已释放，无锁
	_, exists, _ := repo.GetLock(ctx, "p")
	if exists {
		t.Errorf("释放后不应存在锁")
	}
}

func TestEditLock_ForceRelease(t *testing.T) {
	repo, _ := newCollabTestRepo(t)
	createTestUser(t, repo, "u1", "a")
	ctx := context.Background()

	lock := &model.EditLock{Scope: "p", OwnerID: "u1", Username: "a", ExpiresAt: time.Now().Add(time.Minute)}
	_ = repo.TryAcquireLock(ctx, lock)

	ok, _ := repo.ForceReleaseLock(ctx, "p")
	if !ok {
		t.Errorf("admin 强制释放应成功")
	}
}

// ─── M17 切片 G1（F5/Q28-A）：view-owned / view-exposed scope 类型 ──────────────

// 验证 F5 invariant：「view-owned」scope 走与 package/view 一致的获取 + 心跳 + 释放路径。
// scope 字符串用 model.ScopeKindViewOwned 常量构造,确保前后端 ScopeKind 字符串镜像一致。
func TestEditLock_ViewOwned_Scope(t *testing.T) {
	repo, _ := newCollabTestRepo(t)
	createTestUser(t, repo, "u1", "alice")
	createTestUser(t, repo, "u2", "bob")
	ctx := context.Background()

	scope := model.MakeScope(model.ScopeKindViewOwned, "view_x")
	lock := &model.EditLock{
		Scope: scope, OwnerID: "u1", Username: "alice",
		ExpiresAt: time.Now().Add(time.Minute), BaseVersion: 1,
	}

	// 1) alice 获取 view-owned 锁
	if err := repo.TryAcquireLock(ctx, lock); err != nil {
		t.Fatalf("view-owned 锁获取应成功：%v", err)
	}

	// 2) bob 重复获取应被拒(release 已存在)
	if err := repo.TryAcquireLock(ctx, &model.EditLock{
		Scope: scope, OwnerID: "u2", Username: "bob",
		ExpiresAt: time.Now().Add(time.Minute),
	}); err != ErrLockHeldByOther {
		t.Errorf("view-owned 已被锁,bob 接管应失败：got %v", err)
	}

	// 3) alice 心跳应成功
	if err := repo.HeartbeatLock(ctx, scope, "u1", 60); err != nil {
		t.Errorf("view-owned owner 心跳应成功：%v", err)
	}

	// 4) bob 心跳应失败
	if err := repo.HeartbeatLock(ctx, scope, "u2", 60); err != ErrLockHeldByOther {
		t.Errorf("view-owned 非 owner 心跳应失败：got %v", err)
	}

	// 5) release 测 owner 并验证取回 kind=id 与 ScopeKindViewOwned 镜像一致
	ok, _ := repo.ReleaseLock(ctx, scope, "u1")
	if !ok {
		t.Errorf("view-owned owner 释放应成功")
	}
	if got, _ := model.ParseScope(scope); got != model.ScopeKindViewOwned {
		t.Errorf("view-owned kind 解码失真：got %q", got)
	}
}

// 验证 F5 invariant：「view-exposed」scope 同样支持获取 + 心跳 + 释放(referenced 不锁,Q25-C 不在范围)。
func TestEditLock_ViewExposed_Scope(t *testing.T) {
	repo, _ := newCollabTestRepo(t)
	createTestUser(t, repo, "u1", "alice")
	createTestUser(t, repo, "u2", "bob")
	ctx := context.Background()

	scope := model.MakeScope(model.ScopeKindViewExposed, "view_y")
	lock := &model.EditLock{
		Scope: scope, OwnerID: "u1", Username: "alice",
		ExpiresAt: time.Now().Add(time.Minute), BaseVersion: 1,
	}

	// 1) 获取应成功
	if err := repo.TryAcquireLock(ctx, lock); err != nil {
		t.Fatalf("view-exposed 锁获取应成功：%v", err)
	}

	// 2) 同一 scope 不同用户再获取应被拒
	if err := repo.TryAcquireLock(ctx, &model.EditLock{
		Scope: scope, OwnerID: "u2", Username: "bob",
		ExpiresAt: time.Now().Add(time.Minute),
	}); err != ErrLockHeldByOther {
		t.Errorf("view-exposed 已被锁,bob 接管应失败：got %v", err)
	}

	// 3) 同一用户不同 view-exposed scope 各自独立(避免粒度串扰)
	otherScope := model.MakeScope(model.ScopeKindViewExposed, "view_z")
	if err := repo.TryAcquireLock(ctx, &model.EditLock{
		Scope: otherScope, OwnerID: "u1", Username: "alice",
		ExpiresAt: time.Now().Add(time.Minute),
	}); err != nil {
		t.Errorf("view-exposed 不同 viewId 应各自独立：got %v", err)
	}

	// 4) 心跳和释放流程
	if err := repo.HeartbeatLock(ctx, scope, "u1", 60); err != nil {
		t.Errorf("view-exposed owner 心跳应成功：%v", err)
	}
	if got, _ := model.ParseScope(scope); got != model.ScopeKindViewExposed {
		t.Errorf("view-exposed kind 解码失真：got %q", got)
	}
}

// ─── Comments ──────────────────────────────────────────────────────

func TestComments_AddListDelete(t *testing.T) {
	repo, _ := newCollabTestRepo(t)
	createTestUser(t, repo, "u1", "alice")
	ctx := context.Background()

	c := &model.Comment{
		ID:    "cmt_" + uuid.NewString()[:8],
		Scope: "package:p1", UserID: "u1", Username: "alice",
		ElementID: "el1", Line: 5, Content: "hello",
		CreatedAt: time.Now(), UpdatedAt: time.Now(),
	}
	if err := repo.AddComment(ctx, c); err != nil {
		t.Fatalf("add: %v", err)
	}

	list, _ := repo.ListComments(ctx, "package:p1")
	if len(list) != 1 {
		t.Fatalf("list size = %d", len(list))
	}
	if list[0].Content != "hello" {
		t.Errorf("content 不对：%s", list[0].Content)
	}

	// 删除（仅作者）
	ok, _ := repo.DeleteComment(ctx, "package:p1", c.ID, "u1")
	if !ok {
		t.Errorf("作者删除应成功")
	}
	list, _ = repo.ListComments(ctx, "package:p1")
	if len(list) != 0 {
		t.Errorf("删除后应为空，got %d", len(list))
	}
}

func TestComments_DeleteByNonAuthor(t *testing.T) {
	repo, _ := newCollabTestRepo(t)
	createTestUser(t, repo, "u1", "a")
	createTestUser(t, repo, "u2", "b")
	ctx := context.Background()

	c := &model.Comment{ID: "cmt_test", Scope: "s", UserID: "u1", Username: "a", Content: "x", CreatedAt: time.Now(), UpdatedAt: time.Now()}
	_ = repo.AddComment(ctx, c)

	ok, _ := repo.DeleteComment(ctx, "s", "cmt_test", "u2")
	if ok {
		t.Errorf("非作者不应能删除")
	}
}

func TestComments_ToggleResolved(t *testing.T) {
	repo, _ := newCollabTestRepo(t)
	createTestUser(t, repo, "u1", "a")
	ctx := context.Background()

	c := &model.Comment{ID: "cmt_x", Scope: "s", UserID: "u1", Username: "a", Content: "x", CreatedAt: time.Now(), UpdatedAt: time.Now()}
	_ = repo.AddComment(ctx, c)

	updated, err := repo.ToggleCommentResolved(ctx, "s", "cmt_x")
	if err != nil {
		t.Fatalf("toggle: %v", err)
	}
	if !updated.Resolved {
		t.Errorf("toggle 后应 resolved=true")
	}

	updated2, _ := repo.ToggleCommentResolved(ctx, "s", "cmt_x")
	if updated2.Resolved {
		t.Errorf("再次 toggle 应 resolved=false")
	}
}
