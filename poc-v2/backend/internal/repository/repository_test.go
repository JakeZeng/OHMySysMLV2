package repository

import (
	"context"
	"testing"
	"time"

	"github.com/sysmlv2/mbse-backend/internal/model"
)

// newTestRepo creates an in-memory SQLite repository for testing.
func newTestRepo(t *testing.T) *SQLiteRepository {
	t.Helper()
	repo, err := New(":memory:")
	if err != nil {
		t.Fatalf("failed to create test repo: %v", err)
	}
	t.Cleanup(func() { repo.Close() })
	return repo
}

// ─── Users ──────────────────────────────────────────────────────────

func TestCreateAndGetUser(t *testing.T) {
	repo := newTestRepo(t)
	ctx := context.Background()

	u := &model.User{
		ID:           "user-1",
		Username:     "alice",
		Email:        "alice@example.com",
		PasswordHash: "sha256:abcdef",
		CreatedAt:    time.Now().UTC(),
	}
	if err := repo.CreateUser(ctx, u); err != nil {
		t.Fatalf("CreateUser: %v", err)
	}

	t.Run("GetByUsername", func(t *testing.T) {
		got, err := repo.GetUserByUsername(ctx, "alice")
		if err != nil {
			t.Fatalf("GetUserByUsername: %v", err)
		}
		if got.ID != "user-1" {
			t.Errorf("ID = %q, want %q", got.ID, "user-1")
		}
		if got.Username != "alice" {
			t.Errorf("Username = %q, want %q", got.Username, "alice")
		}
		if got.Email != "alice@example.com" {
			t.Errorf("Email = %q, want %q", got.Email, "alice@example.com")
		}
		if got.PasswordHash != "sha256:abcdef" {
			t.Errorf("PasswordHash = %q, want %q", got.PasswordHash, "sha256:abcdef")
		}
	})

	t.Run("GetByEmail", func(t *testing.T) {
		got, err := repo.GetUserByEmail(ctx, "alice@example.com")
		if err != nil {
			t.Fatalf("GetUserByEmail: %v", err)
		}
		if got.Username != "alice" {
			t.Errorf("Username = %q, want %q", got.Username, "alice")
		}
	})

	t.Run("GetByUsername_NotFound", func(t *testing.T) {
		_, err := repo.GetUserByUsername(ctx, "nobody")
		if err == nil {
			t.Error("expected error for non-existent user, got nil")
		}
	})

	t.Run("GetByEmail_NotFound", func(t *testing.T) {
		_, err := repo.GetUserByEmail(ctx, "nobody@example.com")
		if err == nil {
			t.Error("expected error for non-existent email, got nil")
		}
	})
}

func TestDuplicateUser(t *testing.T) {
	repo := newTestRepo(t)
	ctx := context.Background()

	u := &model.User{
		ID: "u1", Username: "bob", Email: "bob@example.com",
		PasswordHash: "hash", CreatedAt: time.Now().UTC(),
	}
	if err := repo.CreateUser(ctx, u); err != nil {
		t.Fatalf("first CreateUser: %v", err)
	}

	t.Run("DuplicateUsername", func(t *testing.T) {
		dup := &model.User{
			ID: "u2", Username: "bob", Email: "other@example.com",
			PasswordHash: "hash", CreatedAt: time.Now().UTC(),
		}
		if err := repo.CreateUser(ctx, dup); err == nil {
			t.Error("expected error for duplicate username, got nil")
		}
	})

	t.Run("DuplicateEmail", func(t *testing.T) {
		dup := &model.User{
			ID: "u3", Username: "charlie", Email: "bob@example.com",
			PasswordHash: "hash", CreatedAt: time.Now().UTC(),
		}
		if err := repo.CreateUser(ctx, dup); err == nil {
			t.Error("expected error for duplicate email, got nil")
		}
	})
}

// ─── Projects ────────────────────────────────────────────────────────

func TestProjectCRUD(t *testing.T) {
	repo := newTestRepo(t)
	ctx := context.Background()
	now := time.Now().UTC()

	// Seed a user so owner_id is valid (no FK constraint, but logical).
	if err := repo.CreateUser(ctx, &model.User{
		ID: "owner-1", Username: "owner", Email: "owner@example.com",
		PasswordHash: "h", CreatedAt: now,
	}); err != nil {
		t.Fatalf("seed user: %v", err)
	}

	t.Run("Create", func(t *testing.T) {
		p := &model.Project{
			ID: "proj-1", Name: "MyProject", Description: "desc",
			OwnerID: "owner-1", CreatedAt: now, UpdatedAt: now,
		}
		if err := repo.CreateProject(ctx, p); err != nil {
			t.Fatalf("CreateProject: %v", err)
		}
	})

	t.Run("Get", func(t *testing.T) {
		got, err := repo.GetProject(ctx, "proj-1")
		if err != nil {
			t.Fatalf("GetProject: %v", err)
		}
		if got.Name != "MyProject" {
			t.Errorf("Name = %q, want %q", got.Name, "MyProject")
		}
		if got.OwnerID != "owner-1" {
			t.Errorf("OwnerID = %q, want %q", got.OwnerID, "owner-1")
		}
	})

	t.Run("Get_NotFound", func(t *testing.T) {
		_, err := repo.GetProject(ctx, "nonexistent")
		if err != ErrNotFound {
			t.Errorf("err = %v, want ErrNotFound", err)
		}
	})

	t.Run("List", func(t *testing.T) {
		// Create a second project.
		p2 := &model.Project{
			ID: "proj-2", Name: "Second", Description: "",
			OwnerID: "owner-1", CreatedAt: now, UpdatedAt: now,
		}
		if err := repo.CreateProject(ctx, p2); err != nil {
			t.Fatalf("CreateProject proj-2: %v", err)
		}

		projects, err := repo.ListProjectsByUser(ctx, "owner-1")
		if err != nil {
			t.Fatalf("ListProjectsByUser: %v", err)
		}
		if len(projects) != 2 {
			t.Errorf("len = %d, want 2", len(projects))
		}
	})

	t.Run("List_Empty", func(t *testing.T) {
		projects, err := repo.ListProjectsByUser(ctx, "nobody")
		if err != nil {
			t.Fatalf("ListProjectsByUser: %v", err)
		}
		if len(projects) != 0 {
			t.Errorf("len = %d, want 0", len(projects))
		}
	})

	t.Run("Update", func(t *testing.T) {
		p, err := repo.GetProject(ctx, "proj-1")
		if err != nil {
			t.Fatalf("GetProject: %v", err)
		}
		p.Name = "UpdatedName"
		p.Description = "updated desc"
		p.UpdatedAt = time.Now().UTC()
		if err := repo.UpdateProject(ctx, p); err != nil {
			t.Fatalf("UpdateProject: %v", err)
		}

		got, err := repo.GetProject(ctx, "proj-1")
		if err != nil {
			t.Fatalf("GetProject after update: %v", err)
		}
		if got.Name != "UpdatedName" {
			t.Errorf("Name = %q, want %q", got.Name, "UpdatedName")
		}
		if got.Description != "updated desc" {
			t.Errorf("Description = %q, want %q", got.Description, "updated desc")
		}
	})

	t.Run("Delete", func(t *testing.T) {
		if err := repo.DeleteProject(ctx, "proj-1"); err != nil {
			t.Fatalf("DeleteProject: %v", err)
		}
		_, err := repo.GetProject(ctx, "proj-1")
		if err != ErrNotFound {
			t.Errorf("GetProject after delete: err = %v, want ErrNotFound", err)
		}
	})

	t.Run("Delete_NotFound", func(t *testing.T) {
		err := repo.DeleteProject(ctx, "nonexistent")
		if err != ErrNotFound {
			t.Errorf("err = %v, want ErrNotFound", err)
		}
	})
}

// ─── Models ──────────────────────────────────────────────────────────

func TestModelCRUD(t *testing.T) {
	repo := newTestRepo(t)
	ctx := context.Background()
	now := time.Now().UTC()

	// Seed project.
	if err := repo.CreateProject(ctx, &model.Project{
		ID: "proj-1", Name: "P", OwnerID: "u1",
		CreatedAt: now, UpdatedAt: now,
	}); err != nil {
		t.Fatalf("seed project: %v", err)
	}

	t.Run("Create", func(t *testing.T) {
		m := &model.Model{
			ID: "mdl-1", ProjectID: "proj-1", Name: "Block1",
			Content: "part def Car;", Version: 1,
			CreatedAt: now, UpdatedAt: now,
		}
		if err := repo.CreateModel(ctx, m); err != nil {
			t.Fatalf("CreateModel: %v", err)
		}
	})

	t.Run("Get", func(t *testing.T) {
		got, err := repo.GetModel(ctx, "mdl-1")
		if err != nil {
			t.Fatalf("GetModel: %v", err)
		}
		if got.Name != "Block1" {
			t.Errorf("Name = %q, want %q", got.Name, "Block1")
		}
		if got.Content != "part def Car;" {
			t.Errorf("Content = %q, want %q", got.Content, "part def Car;")
		}
		if got.Version != 1 {
			t.Errorf("Version = %d, want 1", got.Version)
		}
	})

	t.Run("Get_NotFound", func(t *testing.T) {
		_, err := repo.GetModel(ctx, "nonexistent")
		if err != ErrNotFound {
			t.Errorf("err = %v, want ErrNotFound", err)
		}
	})

	t.Run("List", func(t *testing.T) {
		m2 := &model.Model{
			ID: "mdl-2", ProjectID: "proj-1", Name: "Block2",
			Content: "", Version: 1, CreatedAt: now, UpdatedAt: now,
		}
		if err := repo.CreateModel(ctx, m2); err != nil {
			t.Fatalf("CreateModel mdl-2: %v", err)
		}

		models, err := repo.ListModelsByProject(ctx, "proj-1")
		if err != nil {
			t.Fatalf("ListModelsByProject: %v", err)
		}
		if len(models) != 2 {
			t.Errorf("len = %d, want 2", len(models))
		}
	})

	t.Run("List_Empty", func(t *testing.T) {
		models, err := repo.ListModelsByProject(ctx, "proj-empty")
		if err != nil {
			t.Fatalf("ListModelsByProject: %v", err)
		}
		if len(models) != 0 {
			t.Errorf("len = %d, want 0", len(models))
		}
	})

	t.Run("Update", func(t *testing.T) {
		m, err := repo.GetModel(ctx, "mdl-1")
		if err != nil {
			t.Fatalf("GetModel: %v", err)
		}
		if m.Version != 1 {
			t.Fatalf("pre-condition: Version = %d, want 1", m.Version)
		}
		m.Name = "CarBlock"
		m.Content = "part def Car { };"
		if err := repo.UpdateModel(ctx, m); err != nil {
			t.Fatalf("UpdateModel: %v", err)
		}

		// Verify the update and version bump.
		got, err := repo.GetModel(ctx, "mdl-1")
		if err != nil {
			t.Fatalf("GetModel after update: %v", err)
		}
		if got.Name != "CarBlock" {
			t.Errorf("Name = %q, want %q", got.Name, "CarBlock")
		}
		if got.Version != 2 {
			t.Errorf("Version = %d, want 2", got.Version)
		}
	})

	t.Run("Delete", func(t *testing.T) {
		if err := repo.DeleteModel(ctx, "mdl-1"); err != nil {
			t.Fatalf("DeleteModel: %v", err)
		}
		_, err := repo.GetModel(ctx, "mdl-1")
		if err != ErrNotFound {
			t.Errorf("GetModel after delete: err = %v, want ErrNotFound", err)
		}
	})

	t.Run("Delete_NotFound", func(t *testing.T) {
		err := repo.DeleteModel(ctx, "nonexistent")
		if err != ErrNotFound {
			t.Errorf("err = %v, want ErrNotFound", err)
		}
	})
}

func TestModelVersionConflict(t *testing.T) {
	repo := newTestRepo(t)
	ctx := context.Background()
	now := time.Now().UTC()

	if err := repo.CreateProject(ctx, &model.Project{
		ID: "proj-1", Name: "P", OwnerID: "u1",
		CreatedAt: now, UpdatedAt: now,
	}); err != nil {
		t.Fatalf("seed project: %v", err)
	}

	m := &model.Model{
		ID: "mdl-1", ProjectID: "proj-1", Name: "M",
		Content: "v1", Version: 1, CreatedAt: now, UpdatedAt: now,
	}
	if err := repo.CreateModel(ctx, m); err != nil {
		t.Fatalf("CreateModel: %v", err)
	}

	// First update at version 1 should succeed.
	m.Name = "M-updated"
	m.Content = "v2"
	if err := repo.UpdateModel(ctx, m); err != nil {
		t.Fatalf("first UpdateModel: %v", err)
	}
	if m.Version != 2 {
		t.Fatalf("after first update: Version = %d, want 2", m.Version)
	}

	// Second update at the old version 1 should conflict.
	stale := &model.Model{
		ID: "mdl-1", ProjectID: "proj-1", Name: "M-stale",
		Content: "v-conflict", Version: 1,
	}
	err := repo.UpdateModel(ctx, stale)
	if err != ErrVersionConflict {
		t.Errorf("stale update: err = %v, want ErrVersionConflict", err)
	}

	// Verify the DB still has the first update's values.
	got, err := repo.GetModel(ctx, "mdl-1")
	if err != nil {
		t.Fatalf("GetModel: %v", err)
	}
	if got.Name != "M-updated" {
		t.Errorf("Name = %q, want %q (stale update must not overwrite)", got.Name, "M-updated")
	}
	if got.Version != 2 {
		t.Errorf("Version = %d, want 2", got.Version)
	}
}
