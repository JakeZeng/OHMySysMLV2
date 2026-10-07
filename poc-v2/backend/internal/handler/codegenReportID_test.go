// 代码生成 / 设计文档：M12「Package 一等公民」之后的 id 解析回归
//
// ## 背景
//
// M12 把「包」变成一等公民、`models` 拆成 `packages` + `views` 之后，
// 前端 modelStore 的 `modelId` 装的是 **package id**。但
// `GenerateCode` / `GenerateReport` 一直只查 `models` 表，于是
// 「代码生成」和「设计文档生成」对**每个**工程都稳定返回 404「模型不存在」
// —— 功能等于完全不可用，而且此前没有任何测试碰过这条路径
// （本轮 e2e 实测：传 package id → 404；传真 model id → 200）。
//
// 这组用例钉住两件事：
//   1. `extractPartDefs` 必须剥掉 `part def X;` 的分号
//      （否则生成出 `vehicle;.py` / `class Vehicle;` 这种语法非法的产物）
//   2. 两个端点对 package id 与 model id 都要能取到源码，取不到才是 404

package handler

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/gin-gonic/gin"
)

// ─── extractPartDefs：声明尾部必须剥干净 ──────────────────────────

func TestExtractPartDefs_StripsDeclarationTail(t *testing.T) {
	cases := []struct {
		name string
		src  string
		want []string
	}{
		{
			name: "无体声明要剥分号",
			src:  "package P {\n  part def Vehicle;\n}",
			want: []string{"Vehicle"},
		},
		{
			name: "块体声明要剥花括号",
			src:  "package P {\n  part def Vehicle {\n    attribute mass : Real;\n  }\n}",
			want: []string{"Vehicle"},
		},
		{
			name: "两者混排",
			src:  "package P {\n  part def A;\n  part def B {\n    attribute x : Real;\n  }\n  part def C;\n}",
			want: []string{"A", "B", "C"},
		},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			defs := extractPartDefs(tc.src)
			if len(defs) != len(tc.want) {
				t.Fatalf("defs 数量 = %d, 期望 %d (%v)", len(defs), len(tc.want), defs)
			}
			for i, w := range tc.want {
				if defs[i].Name != w {
					t.Errorf("defs[%d].Name = %q, 期望 %q", i, defs[i].Name, w)
				}
			}
		})
	}
}

// 生成产物里不允许出现分号（文件名和 class 名都不行）
func TestGeneratePython_NoSemicolonLeak(t *testing.T) {
	files := generatePython(extractPartDefs("package P {\n  part def Vehicle;\n}"))
	sawFile := false
	for _, f := range files {
		if strings.Contains(f.Name, ";") {
			t.Errorf("生成文件名含分号：%q", f.Name)
		}
		if strings.Contains(f.Content, "class Vehicle;") {
			t.Errorf("生成的 class 名带分号（语法非法）：%s", f.Content)
		}
		if strings.Contains(f.Name, "vehicle") {
			sawFile = true
		}
	}
	if !sawFile {
		t.Errorf("没有生成 vehicle 相关文件：%+v", files)
	}
}

// ─── 端点级：package id 也必须能用 ────────────────────────────────

func TestCodegenAndReport_AcceptPackageID(t *testing.T) {
	r, _ := setupTestRouter(t)
	resp := registerUser(t, r, "cgpkger", "cgpkger@example.com", "pass123456")
	authHeader := "Bearer " + authToken(t, resp)

	// 建工程
	body := jsonBody(gin.H{"name": "CodegenProject"})
	req := httptest.NewRequest(http.MethodPost, "/api/v1/projects", body)
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Authorization", authHeader)
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)
	projectID := parseJSON(t, w.Body.Bytes())["data"].(map[string]any)["id"].(string)

	// 建一个**包**（M12 之后前端传的就是这个 id）
	body = jsonBody(gin.H{
		"name":    "VehicleModel",
		"content": "package VehicleModel {\n  part def Vehicle;\n}",
	})
	req = httptest.NewRequest(http.MethodPost, "/api/v1/projects/"+projectID+"/packages", body)
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Authorization", authHeader)
	w = httptest.NewRecorder()
	r.ServeHTTP(w, req)
	if w.Code != http.StatusOK {
		t.Fatalf("建包失败 status=%d body=%s", w.Code, w.Body.String())
	}
	packageID := parseJSON(t, w.Body.Bytes())["data"].(map[string]any)["id"].(string)

	t.Run("codegen/generate 用 package id", func(t *testing.T) {
		body := jsonBody(gin.H{"modelId": packageID, "language": "python"})
		req := httptest.NewRequest(http.MethodPost, "/api/v1/codegen/generate", body)
		req.Header.Set("Content-Type", "application/json")
		req.Header.Set("Authorization", authHeader)
		w := httptest.NewRecorder()
		r.ServeHTTP(w, req)
		if w.Code != http.StatusOK {
			t.Fatalf("status = %d, 期望 200（body=%s）", w.Code, w.Body.String())
		}
		files, _ := parseJSON(t, w.Body.Bytes())["data"].(map[string]any)["files"].([]any)
		if len(files) == 0 {
			t.Fatal("files 为空")
		}
		sawVehicle := false
		for _, raw := range files {
			f := raw.(map[string]any)
			name := f["name"].(string)
			if strings.Contains(name, ";") {
				t.Errorf("文件名含分号：%q", name)
			}
			if strings.Contains(f["content"].(string), "Vehicle") {
				sawVehicle = true
			}
		}
		if !sawVehicle {
			t.Errorf("没有由包内容生成的文件：%v", files)
		}
	})

	t.Run("reports/generate 用 package id", func(t *testing.T) {
		body := jsonBody(gin.H{
			"projectId": projectID,
			"modelId":   packageID,
			"format":    "md",
		})
		req := httptest.NewRequest(http.MethodPost, "/api/v1/reports/generate", body)
		req.Header.Set("Content-Type", "application/json")
		req.Header.Set("Authorization", authHeader)
		w := httptest.NewRecorder()
		r.ServeHTTP(w, req)
		if w.Code != http.StatusOK {
			t.Fatalf("status = %d, 期望 200（body=%s）", w.Code, w.Body.String())
		}
		data := parseJSON(t, w.Body.Bytes())["data"].(map[string]any)
		if content := data["content"].(string); !strings.Contains(content, "VehicleModel") {
			t.Errorf("报告正文没有包含模型内容：%q", content)
		}
	})

	t.Run("两个 id 都取不到时才 404", func(t *testing.T) {
		for _, path := range []string{"/api/v1/codegen/generate", "/api/v1/reports/generate"} {
			payload := gin.H{"modelId": "ghost-id", "language": "python", "projectId": projectID}
			req := httptest.NewRequest(http.MethodPost, path, jsonBody(payload))
			req.Header.Set("Content-Type", "application/json")
			req.Header.Set("Authorization", authHeader)
			w := httptest.NewRecorder()
			r.ServeHTTP(w, req)
			if w.Code != http.StatusNotFound {
				t.Errorf("%s status = %d, 期望 404", path, w.Code)
			}
		}
	})
}
