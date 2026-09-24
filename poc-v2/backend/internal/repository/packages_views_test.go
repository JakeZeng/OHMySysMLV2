package repository

import (
	"context"
	"strings"
	"testing"
	"time"

	"github.com/sysmlv2/mbse-backend/internal/model"
)

// seedProject 为 tests 准备一个标准 project（含 owner 用户）。
// 幂等：同一 repo 多次调用只插入一次 owner。
func seedProject(t *testing.T, repo *SQLiteRepository, projectID string) {
	t.Helper()
	ctx := context.Background()
	now := time.Now().UTC()
	// 仅当用户不存在时插入（避免 UNIQUE 冲突）
	if existing, _ := repo.GetUserByUsername(ctx, "alice"); existing == nil {
		if err := repo.CreateUser(ctx, &model.User{
			ID:           "u1",
			Username:     "alice",
			Email:        "alice@example.com",
			PasswordHash: "x",
			CreatedAt:    now,
		}); err != nil {
			t.Fatalf("seed user: %v", err)
		}
	}
	if err := repo.CreateProject(ctx, &model.Project{
		ID: projectID, Name: "Test Project", OwnerID: "u1",
		Visibility: model.VisibilityPrivate,
		CreatedAt:  now, UpdatedAt: now,
	}); err != nil {
		t.Fatalf("seed project: %v", err)
	}
}

// ─── Packages ─────────────────────────────────────────────────────────

func TestPackageCRUD(t *testing.T) {
	repo := newTestRepo(t)
	ctx := context.Background()
	seedProject(t, repo, "proj-1")
	now := time.Now().UTC()

	t.Run("Create", func(t *testing.T) {
		p := &model.Package{
			ID: "pkg-1", ProjectID: "proj-1", Name: "结构包",
			Description: "测试包",
			Content:     "package Pkg1 { part def Vehicle { } }",
			Metadata:    map[string]string{"author": "alice"},
			Version:     1,
			CreatedAt:   now, UpdatedAt: now,
		}
		if err := repo.CreatePackage(ctx, p); err != nil {
			t.Fatalf("CreatePackage: %v", err)
		}
	})

	t.Run("Get", func(t *testing.T) {
		got, err := repo.GetPackage(ctx, "pkg-1")
		if err != nil {
			t.Fatalf("GetPackage: %v", err)
		}
		if got.Name != "结构包" {
			t.Errorf("Name = %q, want %q", got.Name, "结构包")
		}
		if got.Content != "package Pkg1 { part def Vehicle { } }" {
			t.Errorf("Content mismatch")
		}
		if got.Metadata["author"] != "alice" {
			t.Errorf("Metadata[author] = %q, want %q", got.Metadata["author"], "alice")
		}
		if got.Version != 1 {
			t.Errorf("Version = %d, want 1", got.Version)
		}
	})

	t.Run("Get_NotFound", func(t *testing.T) {
		_, err := repo.GetPackage(ctx, "nonexistent")
		if err != ErrNotFound {
			t.Errorf("err = %v, want ErrNotFound", err)
		}
	})

	t.Run("List", func(t *testing.T) {
		p2 := &model.Package{
			ID: "pkg-2", ProjectID: "proj-1", Name: "行为包",
			Content:   "package Pkg2 { action def Drive; }",
			Version:   1,
			CreatedAt: now, UpdatedAt: now,
		}
		if err := repo.CreatePackage(ctx, p2); err != nil {
			t.Fatalf("CreatePackage pkg-2: %v", err)
		}
		list, err := repo.ListPackagesByProject(ctx, "proj-1")
		if err != nil {
			t.Fatalf("ListPackagesByProject: %v", err)
		}
		if len(list) != 2 {
			t.Errorf("len = %d, want 2", len(list))
		}
		// Summary 不应含 content
		for _, s := range list {
			if s == nil {
				continue
			}
			// PackageSummary 结构体本来就没 Content 字段，这里做存在性检查即可
		}
	})

	t.Run("Update", func(t *testing.T) {
		p, err := repo.GetPackage(ctx, "pkg-1")
		if err != nil {
			t.Fatalf("GetPackage: %v", err)
		}
		p.Content = "package Pkg1 { part def Vehicle; part def Wheel; }"
		p.Description = "updated"
		if err := repo.UpdatePackage(ctx, p); err != nil {
			t.Fatalf("UpdatePackage: %v", err)
		}
		got, _ := repo.GetPackage(ctx, "pkg-1")
		if got.Version != 2 {
			t.Errorf("Version = %d, want 2", got.Version)
		}
		if got.Description != "updated" {
			t.Errorf("Description = %q, want %q", got.Description, "updated")
		}
	})

	t.Run("Update_VersionConflict", func(t *testing.T) {
		// 用旧 version（=1，已被前一个 subtest 升级为 2）触发冲突
		old := &model.Package{
			ID: "pkg-1", ProjectID: "proj-1", Name: "should fail",
			Content: "x", Version: 1,
			CreatedAt: now, UpdatedAt: now,
		}
		err := repo.UpdatePackage(ctx, old)
		if err != ErrVersionConflict {
			t.Errorf("err = %v, want ErrVersionConflict", err)
		}
	})

	t.Run("Delete", func(t *testing.T) {
		if err := repo.DeletePackage(ctx, "pkg-2"); err != nil {
			t.Fatalf("DeletePackage: %v", err)
		}
		_, err := repo.GetPackage(ctx, "pkg-2")
		if err != ErrNotFound {
			t.Errorf("after delete: err = %v, want ErrNotFound", err)
		}
	})

	t.Run("Delete_NotFound", func(t *testing.T) {
		err := repo.DeletePackage(ctx, "nonexistent")
		if err != ErrNotFound {
			t.Errorf("err = %v, want ErrNotFound", err)
		}
	})
}

func TestPackageNesting(t *testing.T) {
	repo := newTestRepo(t)
	ctx := context.Background()
	seedProject(t, repo, "proj-1")
	now := time.Now().UTC()

	// 顶层包
	parent := &model.Package{
		ID: "pkg-parent", ProjectID: "proj-1", Name: "Pkg1",
		Content: "package Pkg1 {}", Version: 1,
		CreatedAt: now, UpdatedAt: now,
	}
	if err := repo.CreatePackage(ctx, parent); err != nil {
		t.Fatalf("CreatePackage parent: %v", err)
	}
	// 子包
	child := &model.Package{
		ID: "pkg-child", ProjectID: "proj-1", ParentPackageID: "pkg-parent",
		Name: "SubPkg", Content: "package Pkg1::SubPkg {}", Version: 1,
		CreatedAt: now, UpdatedAt: now,
	}
	if err := repo.CreatePackage(ctx, child); err != nil {
		t.Fatalf("CreatePackage child: %v", err)
	}

	// 读取子包验证 parentPackageID
	got, err := repo.GetPackage(ctx, "pkg-child")
	if err != nil {
		t.Fatalf("GetPackage child: %v", err)
	}
	if got.ParentPackageID != "pkg-parent" {
		t.Errorf("ParentPackageID = %q, want %q", got.ParentPackageID, "pkg-parent")
	}

	// 删父包 → 子包因 ON DELETE CASCADE 也被删除
	if err := repo.DeletePackage(ctx, "pkg-parent"); err != nil {
		t.Fatalf("DeletePackage parent: %v", err)
	}
	_, err = repo.GetPackage(ctx, "pkg-child")
	if err != ErrNotFound {
		t.Errorf("child after parent delete: err = %v, want ErrNotFound", err)
	}
}

func TestPackageUniqueName(t *testing.T) {
	repo := newTestRepo(t)
	ctx := context.Background()
	seedProject(t, repo, "proj-1")
	now := time.Now().UTC()

	first := &model.Package{
		ID: "pkg-1", ProjectID: "proj-1", Name: "Same",
		Content: "x", Version: 1,
		CreatedAt: now, UpdatedAt: now,
	}
	if err := repo.CreatePackage(ctx, first); err != nil {
		t.Fatalf("CreatePackage first: %v", err)
	}
	dup := &model.Package{
		ID: "pkg-2", ProjectID: "proj-1", Name: "Same", // 同名
		Content: "y", Version: 1,
		CreatedAt: now, UpdatedAt: now,
	}
	err := repo.CreatePackage(ctx, dup)
	if err == nil {
		t.Fatalf("expected UNIQUE violation, got nil")
	}
	if !strings.Contains(err.Error(), "UNIQUE constraint failed") {
		t.Errorf("err = %v, want UNIQUE violation", err)
	}

	// 不同 project 可以同名
	seedProject(t, repo, "proj-2")
	crossProj := &model.Package{
		ID: "pkg-3", ProjectID: "proj-2", Name: "Same",
		Content: "z", Version: 1,
		CreatedAt: now, UpdatedAt: now,
	}
	if err := repo.CreatePackage(ctx, crossProj); err != nil {
		t.Errorf("cross-project same name should succeed, got: %v", err)
	}

	// 同一 project 不同 parent 也可以同名
	otherParent := &model.Package{
		ID: "pkg-4", ProjectID: "proj-1", Name: "Other",
		Content: "a", Version: 1,
		CreatedAt: now, UpdatedAt: now,
	}
	if err := repo.CreatePackage(ctx, otherParent); err != nil {
		t.Fatalf("CreatePackage otherParent: %v", err)
	}
	sameNameOtherParent := &model.Package{
		ID: "pkg-5", ProjectID: "proj-1", ParentPackageID: "pkg-4",
		Name: "Same", Content: "b", Version: 1,
		CreatedAt: now, UpdatedAt: now,
	}
	if err := repo.CreatePackage(ctx, sameNameOtherParent); err != nil {
		t.Errorf("same name under different parent should succeed, got: %v", err)
	}
}

// ─── Views ────────────────────────────────────────────────────────────

func TestViewCRUD(t *testing.T) {
	repo := newTestRepo(t)
	ctx := context.Background()
	seedProject(t, repo, "proj-1")
	now := time.Now().UTC()

	t.Run("Create", func(t *testing.T) {
		v := &model.View{
			ID: "view-1", ProjectID: "proj-1", Name: "结构视图",
			Description:       "顶层结构视图",
			Content:           "view StructuralView { expose Pkg1::Vehicle; }",
			ColorTag:          "#3b82f6",
			RenderingCategory: "structure",
			ExposedElements: []model.ExposedElement{
				{QualifiedName: "Pkg1::Vehicle", Kind: "PartDef"},
			},
			Version: 1, CreatedAt: now, UpdatedAt: now,
		}
		if err := repo.CreateView(ctx, v); err != nil {
			t.Fatalf("CreateView: %v", err)
		}
	})

	t.Run("Get", func(t *testing.T) {
		got, err := repo.GetView(ctx, "view-1")
		if err != nil {
			t.Fatalf("GetView: %v", err)
		}
		if got.Name != "结构视图" {
			t.Errorf("Name = %q, want %q", got.Name, "结构视图")
		}
		if got.ColorTag != "#3b82f6" {
			t.Errorf("ColorTag = %q, want %q", got.ColorTag, "#3b82f6")
		}
		if len(got.ExposedElements) != 1 {
			t.Fatalf("ExposedElements len = %d, want 1", len(got.ExposedElements))
		}
		if got.ExposedElements[0].QualifiedName != "Pkg1::Vehicle" {
			t.Errorf("ExposedElements[0].QualifiedName = %q, want %q",
				got.ExposedElements[0].QualifiedName, "Pkg1::Vehicle")
		}
	})

	t.Run("Get_NotFound", func(t *testing.T) {
		_, err := repo.GetView(ctx, "nonexistent")
		if err != ErrNotFound {
			t.Errorf("err = %v, want ErrNotFound", err)
		}
	})

	t.Run("List", func(t *testing.T) {
		v2 := &model.View{
			ID: "view-2", ProjectID: "proj-1", Name: "行为视图",
			Content: "view BehaviorView {}",
			Version: 1, CreatedAt: now, UpdatedAt: now,
		}
		if err := repo.CreateView(ctx, v2); err != nil {
			t.Fatalf("CreateView view-2: %v", err)
		}
		list, err := repo.ListViewsByProject(ctx, "proj-1")
		if err != nil {
			t.Fatalf("ListViewsByProject: %v", err)
		}
		if len(list) != 2 {
			t.Errorf("len = %d, want 2", len(list))
		}
	})

	t.Run("Update_RecomputeExposedElements", func(t *testing.T) {
		v, err := repo.GetView(ctx, "view-1")
		if err != nil {
			t.Fatalf("GetView: %v", err)
		}
		v.Content = `view V { expose Pkg1::Vehicle; expose Pkg1::Wheel; }`
		// M15：parseFn 返回完整五元组（resolved/unresolved/renderKind/filter/inner）
		parse := func(content string) ([]model.ExposedElement, []model.ExposedElement, model.RenderKind, []string, []model.InnerElement) {
			return []model.ExposedElement{
				{QualifiedName: "Pkg1::Vehicle", Kind: "PartDef"},
				{QualifiedName: "Pkg1::Wheel", Kind: "PartDef"},
			}, nil, model.RenderKindInterconnection, nil, nil
		}
		if err := repo.UpdateView(ctx, v, parse); err != nil {
			t.Fatalf("UpdateView: %v", err)
		}
		got, _ := repo.GetView(ctx, "view-1")
		if got.Version != 2 {
			t.Errorf("Version = %d, want 2", got.Version)
		}
		if len(got.ExposedElements) != 2 {
			t.Errorf("ExposedElements len = %d, want 2", len(got.ExposedElements))
		}
	})

	t.Run("Update_VersionConflict", func(t *testing.T) {
		old := &model.View{
			ID: "view-1", ProjectID: "proj-1", Name: "stale",
			Content: "x", Version: 1,
			CreatedAt: now, UpdatedAt: now,
		}
		err := repo.UpdateView(ctx, old, nil)
		if err != ErrVersionConflict {
			t.Errorf("err = %v, want ErrVersionConflict", err)
		}
	})

	t.Run("Delete", func(t *testing.T) {
		if err := repo.DeleteView(ctx, "view-2"); err != nil {
			t.Fatalf("DeleteView: %v", err)
		}
		_, err := repo.GetView(ctx, "view-2")
		if err != ErrNotFound {
			t.Errorf("after delete: err = %v, want ErrNotFound", err)
		}
	})

	t.Run("Delete_NotFound", func(t *testing.T) {
		err := repo.DeleteView(ctx, "nonexistent")
		if err != ErrNotFound {
			t.Errorf("err = %v, want ErrNotFound", err)
		}
	})
}

func TestViewExposedElementsParse(t *testing.T) {
	repo := newTestRepo(t)
	ctx := context.Background()
	seedProject(t, repo, "proj-1")
	now := time.Now().UTC()

	// 含多 expose 语句
	v := &model.View{
		ID: "view-multi", ProjectID: "proj-1", Name: "Multi",
		Content: `view Multi {
    expose Pkg1::Vehicle;
    expose Pkg1::Wheel;
    expose Pkg2::Engine;
}`,
		ExposedElements: []model.ExposedElement{
			{QualifiedName: "Pkg1::Vehicle", Kind: "PartDef"},
			{QualifiedName: "Pkg1::Wheel", Kind: "PartDef"},
			{QualifiedName: "Pkg2::Engine", Kind: "PartDef"},
		},
		Version: 1, CreatedAt: now, UpdatedAt: now,
	}
	if err := repo.CreateView(ctx, v); err != nil {
		t.Fatalf("CreateView: %v", err)
	}
	got, err := repo.GetView(ctx, "view-multi")
	if err != nil {
		t.Fatalf("GetView: %v", err)
	}
	if len(got.ExposedElements) != 3 {
		t.Errorf("ExposedElements len = %d, want 3", len(got.ExposedElements))
	}

	// 空 content + 空 exposedElements → nil
	v2 := &model.View{
		ID: "view-empty", ProjectID: "proj-1", Name: "Empty",
		Content: "", Version: 1, CreatedAt: now, UpdatedAt: now,
	}
	if err := repo.CreateView(ctx, v2); err != nil {
		t.Fatalf("CreateView empty: %v", err)
	}
	got2, _ := repo.GetView(ctx, "view-empty")
	if got2.ExposedElements != nil && len(got2.ExposedElements) != 0 {
		t.Errorf("empty view should have no exposed elements, got %d", len(got2.ExposedElements))
	}
}

// ─── Counts (M12 增量) ─────────────────────────────────────────────────

func TestRepo_CountsIncludesPackagesAndViews(t *testing.T) {
	repo := newTestRepo(t)
	ctx := context.Background()
	seedProject(t, repo, "proj-1")
	now := time.Now().UTC()

	if err := repo.CreatePackage(ctx, &model.Package{
		ID: "p1", ProjectID: "proj-1", Name: "P1", Version: 1,
		CreatedAt: now, UpdatedAt: now,
	}); err != nil {
		t.Fatalf("seed package: %v", err)
	}
	if err := repo.CreateView(ctx, &model.View{
		ID: "v1", ProjectID: "proj-1", Name: "V1", Version: 1,
		CreatedAt: now, UpdatedAt: now,
	}); err != nil {
		t.Fatalf("seed view: %v", err)
	}

	counts := repo.Counts(ctx)
	if counts["packages"] != 1 {
		t.Errorf("packages count = %d, want 1", counts["packages"])
	}
	if counts["views"] != 1 {
		t.Errorf("views count = %d, want 1", counts["views"])
	}
}
