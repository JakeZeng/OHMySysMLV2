package handler

import (
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/gin-gonic/gin"
)

// M19 第七轮：expose 作用域**归一** —— 后端只保留一套解析实现。
//
// 背景：expose 作用域此前在 Go 侧有**两套**实现：
//   1. internal/parser/viewBody.go —— 正则抽 expose 子句 + 按包链 resolve；
//   2. internal/parser/viewBody_filter.go —— 逐行词法扫描工程包内容建索引
//      + expr 求值 filter（**已删除**）。
//
// 两套对同一段文本会给出不同结论 → 树上徽章「⚠ 未解析」与画布上明明有
// 元素，自相矛盾。而权威实现是前端的 TS PEG（views/scope.ts）。
//
// 现在的契约：
//   - 客户端送了 `exposedElements` → **原样存储**（后端不再解析）；
//   - 客户端没送（老客户端 / 脚本调用）→ 用后端**唯一**的解析结果；
//   - 两种路径产出的结构完全一致（同一个 model.ExposedElement）。
func TestViewExposeScope_SingleImplementation(t *testing.T) {
	r, _ := setupTestRouter(t)
	resp := registerUser(t, r, "scopeuser", "scopeuser@example.com", "pass123456")
	token := authToken(t, resp)
	authHeader := "Bearer " + token

	// 建工程 + 目标包（包里真的定义了 Vehicle）
	body := jsonBody(gin.H{"name": "ScopeProject"})
	req := httptest.NewRequest(http.MethodPost, "/api/v1/projects", body)
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Authorization", authHeader)
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)
	projectID := parseJSON(t, w.Body.Bytes())["data"].(map[string]any)["id"].(string)

	body = jsonBody(gin.H{
		"name":    "Pkg1",
		"content": "package Pkg1 { part def Vehicle; }",
	})
	req = httptest.NewRequest(http.MethodPost, "/api/v1/projects/"+projectID+"/packages", body)
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Authorization", authHeader)
	w = httptest.NewRecorder()
	r.ServeHTTP(w, req)
	if w.Code != http.StatusOK {
		t.Fatalf("setup Pkg1 failed: status = %d, body = %s", w.Code, w.Body.String())
	}

	t.Run("客户端没送作用域 → 用后端唯一的解析结果", func(t *testing.T) {
		body := jsonBody(gin.H{
			"name":    "V_Fallback",
			"content": "view V { expose Pkg1::Vehicle; }",
		})
		req := httptest.NewRequest(http.MethodPost, "/api/v1/projects/"+projectID+"/views", body)
		req.Header.Set("Content-Type", "application/json")
		req.Header.Set("Authorization", authHeader)
		w := httptest.NewRecorder()
		r.ServeHTTP(w, req)
		if w.Code != http.StatusOK {
			t.Fatalf("status = %d, body = %s", w.Code, w.Body.String())
		}
		data := parseJSON(t, w.Body.Bytes())["data"].(map[string]any)
		exposed, _ := data["exposedElements"].([]any)
		if len(exposed) != 1 {
			t.Fatalf("exposedElements len = %d, want 1 (%v)", len(exposed), exposed)
		}
		if got := exposed[0].(map[string]any)["qualifiedName"]; got != "Pkg1::Vehicle" {
			t.Errorf("qualifiedName = %v, want Pkg1::Vehicle", got)
		}
	})

	t.Run("客户端送了作用域 → 原样存储（后端不再解析）", func(t *testing.T) {
		// 内容里写的是 `Pkg1::Ghost`（后端解析必然 unresolved），
		// 但客户端送来的是权威清单 → 存下来的必须是客户端给的那份。
		body := jsonBody(gin.H{
			"name":    "V_ClientScope",
			"content": "view V { expose Pkg1::Ghost; }",
			"exposedElements": []gin.H{
				{"qualifiedName": "Pkg1::Vehicle", "kind": "PartDef"},
			},
			"exposedElementsUnresolved": []gin.H{},
		})
		req := httptest.NewRequest(http.MethodPost, "/api/v1/projects/"+projectID+"/views", body)
		req.Header.Set("Content-Type", "application/json")
		req.Header.Set("Authorization", authHeader)
		w := httptest.NewRecorder()
		r.ServeHTTP(w, req)
		if w.Code != http.StatusOK {
			t.Fatalf("status = %d, body = %s", w.Code, w.Body.String())
		}
		data := parseJSON(t, w.Body.Bytes())["data"].(map[string]any)
		exposed, _ := data["exposedElements"].([]any)
		if len(exposed) != 1 {
			t.Fatalf("exposedElements len = %d, want 1 (%v)", len(exposed), exposed)
		}
		if got := exposed[0].(map[string]any)["qualifiedName"]; got != "Pkg1::Vehicle" {
			t.Errorf("qualifiedName = %v, want Pkg1::Vehicle（客户端权威值）", got)
		}
	})
}
