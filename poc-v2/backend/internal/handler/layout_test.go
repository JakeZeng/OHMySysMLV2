package handler

import (
	"math"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/gin-gonic/gin"
)

// M16 P5/Q10：画布布局后端持久化 —— 独立表 + 独立 endpoint，
// 不 bump version、不触发协同冲突。

// 布局测试里的公共脚手架：注册用户 + 建工程
func setupLayoutTest(t *testing.T, projectName string) (*gin.Engine, string, string) {
	t.Helper()
	r, _ := setupTestRouter(t)
	resp := registerUser(t, r, projectName+"-owner", projectName+"@example.com", "pass123456")
	authHeader := "Bearer " + authToken(t, resp)
	body := jsonBody(gin.H{"name": projectName})
	req := httptest.NewRequest(http.MethodPost, "/api/v1/projects", body)
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Authorization", authHeader)
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)
	if w.Code != http.StatusOK {
		t.Fatalf("create project: status = %d, body = %s", w.Code, w.Body.String())
	}
	projectID := parseJSON(t, w.Body.Bytes())["data"].(map[string]any)["id"].(string)
	return r, authHeader, projectID
}

func createLayoutPkg(t *testing.T, r *gin.Engine, authHeader, projectID, name, content string) string {
	t.Helper()
	body := jsonBody(gin.H{"name": name, "content": content})
	req := httptest.NewRequest(http.MethodPost, "/api/v1/projects/"+projectID+"/packages", body)
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Authorization", authHeader)
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)
	if w.Code != http.StatusOK {
		t.Fatalf("create package: status = %d, body = %s", w.Code, w.Body.String())
	}
	return parseJSON(t, w.Body.Bytes())["data"].(map[string]any)["id"].(string)
}

func TestLayout_SaveAndGet(t *testing.T) {
	r, authHeader, projectID := setupLayoutTest(t, "LayoutProject")
	pkgID := createLayoutPkg(t, r, authHeader, projectID, "LayoutPkg", "package LayoutPkg {\n  part def A;\n}")

	// 1) 保存布局
	body := jsonBody(gin.H{
		"nodes": map[string]any{
			"pd:1": map[string]float64{"x": 120.5, "y": -30},
			"pd:2": map[string]float64{"x": 0, "y": 0},
		},
	})
	req := httptest.NewRequest(http.MethodPut, "/api/v1/layouts/package/"+pkgID, body)
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Authorization", authHeader)
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)
	if w.Code != http.StatusOK {
		t.Fatalf("save layout: status = %d, body = %s", w.Code, w.Body.String())
	}

	// 2) 读回
	req = httptest.NewRequest(http.MethodGet, "/api/v1/layouts/package/"+pkgID, nil)
	req.Header.Set("Authorization", authHeader)
	w = httptest.NewRecorder()
	r.ServeHTTP(w, req)
	if w.Code != http.StatusOK {
		t.Fatalf("get layout: status = %d, body = %s", w.Code, w.Body.String())
	}
	data := parseJSON(t, w.Body.Bytes())["data"].(map[string]any)
	nodes, ok := data["nodes"].(map[string]any)
	if !ok || len(nodes) != 2 {
		t.Fatalf("nodes = %v, want 2 项", data["nodes"])
	}
	n1 := nodes["pd:1"].(map[string]any)
	if n1["x"].(float64) != 120.5 || n1["y"].(float64) != -30 {
		t.Errorf("pd:1 = %v, want {120.5, -30}", n1)
	}

	// 3) 包内容 / version 不被布局保存影响（layout 是呈现辅助）
	req = httptest.NewRequest(http.MethodGet, "/api/v1/packages/"+pkgID, nil)
	req.Header.Set("Authorization", authHeader)
	w = httptest.NewRecorder()
	r.ServeHTTP(w, req)
	if w.Code != http.StatusOK {
		t.Fatalf("get package: status = %d", w.Code)
	}
	pkg := parseJSON(t, w.Body.Bytes())["data"].(map[string]any)
	if v, _ := pkg["version"].(float64); v != 1 {
		t.Errorf("package version = %v, want 1（布局保存不得 bump version）", pkg["version"])
	}
}

func TestLayout_ViewKind(t *testing.T) {
	r, authHeader, projectID := setupLayoutTest(t, "LayoutViewProject")

	body := jsonBody(gin.H{"name": "ExposeView", "content": "view ExposeView { }"})
	req := httptest.NewRequest(http.MethodPost, "/api/v1/projects/"+projectID+"/views", body)
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Authorization", authHeader)
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)
	if w.Code != http.StatusOK {
		t.Fatalf("create view: status = %d, body = %s", w.Code, w.Body.String())
	}
	viewID := parseJSON(t, w.Body.Bytes())["data"].(map[string]any)["id"].(string)

	body2 := jsonBody(gin.H{"nodes": map[string]any{"pd:x": map[string]float64{"x": 1, "y": 2}}})
	req = httptest.NewRequest(http.MethodPut, "/api/v1/layouts/view/"+viewID, body2)
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Authorization", authHeader)
	w = httptest.NewRecorder()
	r.ServeHTTP(w, req)
	if w.Code != http.StatusOK {
		t.Fatalf("save view layout: status = %d, body = %s", w.Code, w.Body.String())
	}

	req = httptest.NewRequest(http.MethodGet, "/api/v1/layouts/view/"+viewID, nil)
	req.Header.Set("Authorization", authHeader)
	w = httptest.NewRecorder()
	r.ServeHTTP(w, req)
	nodes := parseJSON(t, w.Body.Bytes())["data"].(map[string]any)["nodes"].(map[string]any)
	if len(nodes) != 1 {
		t.Fatalf("view nodes = %v, want 1 项", nodes)
	}
}

func TestLayout_RejectsUnknownKind(t *testing.T) {
	r, authHeader, _ := setupLayoutTest(t, "LayoutBadKind")
	req := httptest.NewRequest(http.MethodGet, "/api/v1/layouts/unknown/abc", nil)
	req.Header.Set("Authorization", authHeader)
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)
	if w.Code != http.StatusBadRequest {
		t.Errorf("status = %d, want 400", w.Code)
	}
}

func TestLayout_AnonymousDenied(t *testing.T) {
	r, _, _ := setupLayoutTest(t, "LayoutAnon")
	req := httptest.NewRequest(http.MethodGet, "/api/v1/layouts/package/whatever", nil)
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)
	if w.Code != http.StatusUnauthorized {
		t.Errorf("anonymous: status = %d, want 401", w.Code)
	}
}

// ─── M17：端口锚点（attach）随布局往返 ─────────────────────────────────

// 存 → 取，锚点必须原样回来。坐标只能表达「在哪」，锚点表达「贴哪条边的哪个位置」。
func TestLayout_AttachRoundTrip(t *testing.T) {
	r, authHeader, projectID := setupLayoutTest(t, "LayoutAttach")
	pkgID := createLayoutPkg(t, r, authHeader, projectID, "AttachPkg", "package AttachPkg {\n  part def A;\n}")

	body := jsonBody(gin.H{
		"nodes": map[string]any{
			// 端口：带锚点
			"port:V::Car::powerOut": map[string]any{
				"x": 120, "y": 40,
				"attach": map[string]any{"side": "top", "ratio": 0.375},
			},
			// 普通元素：不该凭空长出锚点
			"partDef:V::Car": map[string]any{"x": 10, "y": 20},
		},
	})
	req := httptest.NewRequest(http.MethodPut, "/api/v1/layouts/package/"+pkgID, body)
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Authorization", authHeader)
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)
	if w.Code != http.StatusOK {
		t.Fatalf("save: status = %d, body = %s", w.Code, w.Body.String())
	}

	req = httptest.NewRequest(http.MethodGet, "/api/v1/layouts/package/"+pkgID, nil)
	req.Header.Set("Authorization", authHeader)
	w = httptest.NewRecorder()
	r.ServeHTTP(w, req)
	nodes := parseJSON(t, w.Body.Bytes())["data"].(map[string]any)["nodes"].(map[string]any)

	att, ok := nodes["port:V::Car::powerOut"].(map[string]any)["attach"].(map[string]any)
	if !ok {
		t.Fatalf("端口节点的 attach 丢了：%v", nodes["port:V::Car::powerOut"])
	}
	if att["side"] != "top" || att["ratio"].(float64) != 0.375 {
		t.Errorf("attach = %v, want {top, 0.375}", att)
	}
	if _, has := nodes["partDef:V::Car"].(map[string]any)["attach"]; has {
		t.Errorf("普通元素不该带 attach：%v", nodes["partDef:V::Car"])
	}
}

// 老数据（无 attach 字段）必须照常读回，不能因为多了个字段就整批丢弃。
func TestLayout_AttachOptionalForLegacyData(t *testing.T) {
	r, authHeader, projectID := setupLayoutTest(t, "LayoutLegacy")
	pkgID := createLayoutPkg(t, r, authHeader, projectID, "LegacyPkg", "package LegacyPkg {\n  part def A;\n}")

	body := jsonBody(gin.H{"nodes": map[string]any{
		"pd:1": map[string]float64{"x": 7, "y": 8},
	}})
	req := httptest.NewRequest(http.MethodPut, "/api/v1/layouts/package/"+pkgID, body)
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Authorization", authHeader)
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)

	req = httptest.NewRequest(http.MethodGet, "/api/v1/layouts/package/"+pkgID, nil)
	req.Header.Set("Authorization", authHeader)
	w = httptest.NewRecorder()
	r.ServeHTTP(w, req)
	nodes := parseJSON(t, w.Body.Bytes())["data"].(map[string]any)["nodes"].(map[string]any)
	n1, ok := nodes["pd:1"].(map[string]any)
	if !ok || n1["x"].(float64) != 7 || n1["y"].(float64) != 8 {
		t.Errorf("无 attach 的老条目读不回来：%v", nodes)
	}
}

// attach 来自不可信客户端：非法 side 丢掉整个锚点，ratio 夹进 [0,1]。
// —— 宁可比对坐标更保守，因为它错了顶多回落吸附；错了会画在框外面。
func TestLayout_AttachSanitized(t *testing.T) {
	r, authHeader, projectID := setupLayoutTest(t, "LayoutSanitize")
	pkgID := createLayoutPkg(t, r, authHeader, projectID, "SanitizePkg", "package SanitizePkg {\n  part def A;\n}")

	body := jsonBody(gin.H{
		"nodes": map[string]any{
			// side 不在枚举里 → 整个锚点丢弃
			"bad1": map[string]any{"x": 1, "y": 2,
				"attach": map[string]any{"side": "'; DROP TABLE layouts; --", "ratio": 0.5}},
			// ratio 越界 → 夹取
			"hi": map[string]any{"x": 1, "y": 2,
				"attach": map[string]any{"side": "right", "ratio": 42}},
			"lo": map[string]any{"x": 1, "y": 2,
				"attach": map[string]any{"side": "right", "ratio": -7}},
			// 合法值原样保留
			"ok": map[string]any{"x": 1, "y": 2,
				"attach": map[string]any{"side": "left", "ratio": 0.25}},
		},
	})
	req := httptest.NewRequest(http.MethodPut, "/api/v1/layouts/package/"+pkgID, body)
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Authorization", authHeader)
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)
	if w.Code != http.StatusOK {
		t.Fatalf("save: status = %d", w.Code)
	}

	req = httptest.NewRequest(http.MethodGet, "/api/v1/layouts/package/"+pkgID, nil)
	req.Header.Set("Authorization", authHeader)
	w = httptest.NewRecorder()
	r.ServeHTTP(w, req)
	nodes := parseJSON(t, w.Body.Bytes())["data"].(map[string]any)["nodes"].(map[string]any)

	if _, has := nodes["bad1"].(map[string]any)["attach"]; has {
		t.Errorf("非法 side 的锚点应被丢弃：%v", nodes["bad1"])
	}
	if r := nodes["hi"].(map[string]any)["attach"].(map[string]any)["ratio"].(float64); r != 1 {
		t.Errorf("ratio 上越界应夹到 1，实际 %v", r)
	}
	if r := nodes["lo"].(map[string]any)["attach"].(map[string]any)["ratio"].(float64); r != 0 {
		t.Errorf("ratio 下越界应夹到 0，实际 %v", r)
	}
	okAtt := nodes["ok"].(map[string]any)["attach"].(map[string]any)
	if okAtt["side"] != "left" || okAtt["ratio"].(float64) != 0.25 {
		t.Errorf("合法锚点被改动了：%v", okAtt)
	}
}

// ─── M17 S5：边锚点（任意点连线）与新旧存储格式兼容 ────────────────────

// 边锚点存 → 取，必须两端原样回来。
//
// 边锚点与节点坐标是**两张不同的表**：键分别是 conn:A->B 和 partDef:X，
// 混在一张 map 里迟早出现同名键互相覆盖。
func TestLayout_EdgeAnchorsRoundTrip(t *testing.T) {
	r, authHeader, projectID := setupLayoutTest(t, "LayoutEdges")
	pkgID := createLayoutPkg(t, r, authHeader, projectID, "EdgesPkg", "package EdgesPkg {\n  part def A;\n}")

	body := jsonBody(gin.H{
		"nodes": map[string]any{
			"partDef:V::Car": map[string]float64{"x": 10, "y": 20},
		},
		"edges": map[string]any{
			"conn:V::Car->V::Engine": map[string]any{
				"source": map[string]any{"side": "bottom", "ratio": 0.25},
				"target": map[string]any{"side": "top", "ratio": 0.75},
			},
		},
	})
	req := httptest.NewRequest(http.MethodPut, "/api/v1/layouts/package/"+pkgID, body)
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Authorization", authHeader)
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)
	if w.Code != http.StatusOK {
		t.Fatalf("save: status = %d, body = %s", w.Code, w.Body.String())
	}

	req = httptest.NewRequest(http.MethodGet, "/api/v1/layouts/package/"+pkgID, nil)
	req.Header.Set("Authorization", authHeader)
	w = httptest.NewRecorder()
	r.ServeHTTP(w, req)
	data := parseJSON(t, w.Body.Bytes())["data"].(map[string]any)

	edges, ok := data["edges"].(map[string]any)
	if !ok {
		t.Fatalf("edges 缺失或不是对象：%v", data)
	}
	ent, ok := edges["conn:V::Car->V::Engine"].(map[string]any)
	if !ok {
		t.Fatalf("边锚点条目丢了：%v", edges)
	}
	src := ent["source"].(map[string]any)
	tgt := ent["target"].(map[string]any)
	if src["side"] != "bottom" || src["ratio"].(float64) != 0.25 {
		t.Errorf("source = %v, want {bottom, 0.25}", src)
	}
	if tgt["side"] != "top" || tgt["ratio"].(float64) != 0.75 {
		t.Errorf("target = %v, want {top, 0.75}", tgt)
	}
	// 节点坐标不能被边锚点挤掉
	if nodes, ok := data["nodes"].(map[string]any); !ok || nodes["partDef:V::Car"] == nil {
		t.Errorf("nodes = %v, want 含 partDef:V::Car", data["nodes"])
	}
}

// 没存过布局时，GET 必须返回两个非 nil 的空对象。
//
// 前端 layoutStore.mergeServerScope / mergeServerEdgeScope 会直接遍历返回的
// map；返回 null 会让 `Object.entries(null)` 抛错，白屏。
func TestLayout_GetMissingReturnsEmptyObjects(t *testing.T) {
	r, authHeader, projectID := setupLayoutTest(t, "LayoutMissing")
	pkgID := createLayoutPkg(t, r, authHeader, projectID, "MissingPkg", "package MissingPkg {\n  part def A;\n}")

	req := httptest.NewRequest(http.MethodGet, "/api/v1/layouts/package/"+pkgID, nil)
	req.Header.Set("Authorization", authHeader)
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)
	if w.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200", w.Code)
	}
	data := parseJSON(t, w.Body.Bytes())["data"].(map[string]any)
	nodes, ok := data["nodes"].(map[string]any)
	if !ok || nodes == nil || len(nodes) != 0 {
		t.Errorf("nodes = %#v, want 空对象", data["nodes"])
	}
	edges, ok := data["edges"].(map[string]any)
	if !ok || edges == nil || len(edges) != 0 {
		t.Errorf("edges = %#v, want 空对象", data["edges"])
	}
}

func TestNormalizeLayoutEdgeAnchors(t *testing.T) {
	ok := func(side string, ratio float64) *LayoutAnchor {
		return &LayoutAnchor{Side: side, Ratio: ratio}
	}
	cases := []struct {
		name     string
		in       LayoutEdgeAnchors
		wantOK   bool
		wantSide [2]string
		wantRat  [2]float64
	}{
		{"合法两端原样保留",
			LayoutEdgeAnchors{Source: ok("bottom", 0.25), Target: ok("top", 0.75)},
			true, [2]string{"bottom", "top"}, [2]float64{0.25, 0.75}},
		{"缺 target → 整条丢弃",
			LayoutEdgeAnchors{Source: ok("left", 0.5)},
			false, [2]string{}, [2]float64{}},
		{"缺 source → 整条丢弃",
			LayoutEdgeAnchors{Target: ok("left", 0.5)},
			false, [2]string{}, [2]float64{}},
		{"两端都缺 → 整条丢弃",
			LayoutEdgeAnchors{},
			false, [2]string{}, [2]float64{}},
		{"source.side 非法 → 整条丢弃（不能只丢一端，留半条）",
			LayoutEdgeAnchors{Source: ok("diagonal", 0.5), Target: ok("top", 0.75)},
			false, [2]string{}, [2]float64{}},
		{"target.side 非法 → 整条丢弃",
			LayoutEdgeAnchors{Source: ok("bottom", 0.25), Target: ok("", 0.5)},
			false, [2]string{}, [2]float64{}},
		{"ratio 越界夹取（两端都夹）",
			LayoutEdgeAnchors{Source: ok("left", 42), Target: ok("right", -7)},
			true, [2]string{"left", "right"}, [2]float64{1, 0}},
		{"NaN ratio → 0.5",
			LayoutEdgeAnchors{Source: ok("left", math.NaN()), Target: ok("right", 0.5)},
			true, [2]string{"left", "right"}, [2]float64{0.5, 0.5}},
		{"Inf ratio → 1",
			LayoutEdgeAnchors{Source: ok("left", math.Inf(1)), Target: ok("right", 0.5)},
			true, [2]string{"left", "right"}, [2]float64{1, 0.5}},
	}
	for _, c := range cases {
		got, gotOK := normalizeLayoutEdgeAnchors(c.in)
		if gotOK != c.wantOK {
			t.Errorf("%s: ok = %v, want %v", c.name, gotOK, c.wantOK)
			continue
		}
		if !c.wantOK {
			if got.Source != nil || got.Target != nil {
				t.Errorf("%s: 丢弃时应返回空结构，实际 %+v", c.name, got)
			}
			continue
		}
		if got.Source.Side != c.wantSide[0] || got.Target.Side != c.wantSide[1] {
			t.Errorf("%s: side = {%v, %v}, want {%v, %v}",
				c.name, got.Source.Side, got.Target.Side, c.wantSide[0], c.wantSide[1])
		}
		if got.Source.Ratio != c.wantRat[0] || got.Target.Ratio != c.wantRat[1] {
			t.Errorf("%s: ratio = {%v, %v}, want {%v, %v}",
				c.name, got.Source.Ratio, got.Target.Ratio, c.wantRat[0], c.wantRat[1])
		}
	}
}

// decodeStoredLayout 必须同时吃下两种历史格式。
//
// S5 之前库里存的是裸节点表 `{"pd:partDef_1":{"x":1,"y":2}}`，之后是
// `{"nodes":{...},"edges":{...}}`。这里最危险的一点是 Go 会静默忽略未知字段：
// 拿老格式去 unmarshal 到 storedLayout 是**成功**的，只是 Nodes 为 nil。
// 所以判别必须看顶层键，否则每次上线后所有人的节点坐标都会被读成空。
func TestDecodeStoredLayout(t *testing.T) {
	t.Run("新格式", func(t *testing.T) {
		raw := `{"nodes":{"pd:1":{"x":1,"y":2}},"edges":{"conn:a->b":{"source":{"side":"top","ratio":0.25},"target":{"side":"bottom","ratio":0.75}}}}`
		got := decodeStoredLayout(raw)
		if len(got.Nodes) != 1 || got.Nodes["pd:1"].X != 1 {
			t.Errorf("nodes = %+v, want pd:1{x:1}", got.Nodes)
		}
		if len(got.Edges) != 1 {
			t.Fatalf("edges = %+v, want 1 项", got.Edges)
		}
		if got.Edges["conn:a->b"].Source.Side != "top" {
			t.Errorf("source = %+v", got.Edges["conn:a->b"].Source)
		}
	})

	t.Run("新格式但没有 edges 段", func(t *testing.T) {
		got := decodeStoredLayout(`{"nodes":{"pd:1":{"x":3,"y":4}}}`)
		if len(got.Nodes) != 1 || got.Nodes["pd:1"].Y != 4 {
			t.Errorf("nodes = %+v, want pd:1{y:4}", got.Nodes)
		}
		if len(got.Edges) != 0 {
			t.Errorf("edges = %+v, want 空", got.Edges)
		}
	})

	t.Run("老格式（裸节点表）坐标必须保住", func(t *testing.T) {
		got := decodeStoredLayout(`{"pd:partDef_1":{"x":10,"y":20},"pd:partDef_2":{"x":0,"y":0}}`)
		if len(got.Nodes) != 2 {
			t.Fatalf("nodes = %+v, want 2 项", got.Nodes)
		}
		if p := got.Nodes["pd:partDef_1"]; p.X != 10 || p.Y != 20 {
			t.Errorf("pd:partDef_1 = %+v, want {10,20}", p)
		}
	})

	t.Run("类型不匹配的新格式 → 整条丢弃，不返回半真半假的条目", func(t *testing.T) {
		// Go 遇到类型错误会继续解，返回「解出来的一半 + 剩下的零值」。
		// 那批零值节点会让所有图元叠在原点，看起来像程序坏了 —— 比整张图
		// 回落自动布局糟得多。
		got := decodeStoredLayout(`{"nodes":{"pd:1":42}}`)
		if len(got.Nodes) != 0 {
			t.Errorf("nodes = %+v, want 空（宁可回落自动布局也不能给零值坐标）", got.Nodes)
		}
	})

	t.Run("空串 / 非法 JSON → 空结构，不 panic", func(t *testing.T) {
		for _, raw := range []string{"", "not-json", "[]", "null"} {
			got := decodeStoredLayout(raw)
			if got.Nodes != nil || got.Edges != nil {
				t.Errorf("decodeStoredLayout(%q) = %+v, want 零值", raw, got)
			}
		}
	})
}

func TestNormalizeLayoutPosition(t *testing.T) {
	cases := []struct {
		name string
		in   LayoutPosition
		want LayoutPosition
	}{
		{"无锚点原样保留", LayoutPosition{X: 1, Y: 2}, LayoutPosition{X: 1, Y: 2}},
		{"合法锚点原样保留",
			LayoutPosition{X: 0, Y: 0, Attach: &LayoutAnchor{Side: "top", Ratio: 0.5}},
			LayoutPosition{X: 0, Y: 0, Attach: &LayoutAnchor{Side: "top", Ratio: 0.5}}},
		{"非法 side 丢锚点",
			LayoutPosition{Attach: &LayoutAnchor{Side: "middle", Ratio: 0.5}},
			LayoutPosition{}},
		{"空 side 丢锚点",
			LayoutPosition{Attach: &LayoutAnchor{Side: "", Ratio: 0.5}},
			LayoutPosition{}},
		{"ratio 夹到上界",
			LayoutPosition{Attach: &LayoutAnchor{Side: "right", Ratio: 3}},
			LayoutPosition{Attach: &LayoutAnchor{Side: "right", Ratio: 1}}},
		{"ratio 夹到下界",
			LayoutPosition{Attach: &LayoutAnchor{Side: "right", Ratio: -3}},
			LayoutPosition{Attach: &LayoutAnchor{Side: "right", Ratio: 0}}},
		{"NaN ratio → 0.5",
			LayoutPosition{Attach: &LayoutAnchor{Side: "right", Ratio: math.NaN()}},
			LayoutPosition{Attach: &LayoutAnchor{Side: "right", Ratio: 0.5}}},
		{"+Inf ratio → 1",
			LayoutPosition{Attach: &LayoutAnchor{Side: "right", Ratio: math.Inf(1)}},
			LayoutPosition{Attach: &LayoutAnchor{Side: "right", Ratio: 1}}},
		{"NaN 坐标归零（否则前端整张画布空白）",
			LayoutPosition{X: math.NaN(), Y: math.Inf(1)},
			LayoutPosition{X: 0, Y: 0}},
	}
	for _, c := range cases {
		got := normalizeLayoutPosition(c.in)
		if got.X != c.want.X || got.Y != c.want.Y {
			t.Errorf("%s: 坐标 = {%v, %v}, want {%v, %v}", c.name, got.X, got.Y, c.want.X, c.want.Y)
			continue
		}
		switch {
		case c.want.Attach == nil && got.Attach != nil:
			t.Errorf("%s: 锚点应被丢弃，实际 %v", c.name, *got.Attach)
		case c.want.Attach != nil && got.Attach == nil:
			t.Errorf("%s: 锚点丢了", c.name)
		case c.want.Attach != nil:
			if got.Attach.Side != c.want.Attach.Side || got.Attach.Ratio != c.want.Attach.Ratio {
				t.Errorf("%s: 锚点 = %v, want %v", c.name, *got.Attach, *c.want.Attach)
			}
		}
	}
}
