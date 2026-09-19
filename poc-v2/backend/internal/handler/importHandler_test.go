package handler

import (
	"bytes"
	"encoding/json"
	"encoding/xml"
	"io"
	"mime/multipart"
	"net/http"
	"strings"
	"testing"

	"github.com/gin-gonic/gin"
)

// TestConvertPapyrusBasic：最简 Papyrus 模型 → SysML v2。
//
// 输入：一个含一个 Package 的 Model，包内一个 Class。
// 期望输出：含 package 嵌套与 part def 的有效 SysML v2 文本。
//
// 注意：Type 字段在 XML 解析剥掉前缀后是 "Package"/"Class" 等。
func TestConvertPapyrusBasic(t *testing.T) {
	in := PapyrusModel{
		Name: "Vehicle",
		Packages: []PapyrusPackage{
			{
				Type: "Package",
				Name: "Powertrain",
				Elements: []PapyrusElement{
					{Type: "Class", Name: "Engine", ID: "_Engine"},
				},
			},
		},
	}
	out := convertPapyrusToSysMLv2(in)

	for _, want := range []string{
		"package Vehicle",
		"package Powertrain",
		"part def Engine",
	} {
		if !strings.Contains(out, want) {
			t.Errorf("Papyrus 转换结果缺 %q：\n%s", want, out)
		}
	}
}

// TestConvertPapyrusSanitizesNames：name 含空格 / 横线应被替换为下划线。
func TestConvertPapyrusSanitizesNames(t *testing.T) {
	in := PapyrusModel{
		Name: "Top Level",
		Packages: []PapyrusPackage{{
			Type:     "Package",
			Name:     "sub-system",
			Elements: []PapyrusElement{{Type: "Port", Name: "fuel in"}},
		}},
	}
	out := convertPapyrusToSysMLv2(in)
	for _, want := range []string{
		"package Top_Level",
		"package sub_system",
		"port fuel_in",
	} {
		if !strings.Contains(out, want) {
			t.Errorf("Sanitize 失败，缺 %q：\n%s", want, out)
		}
	}
	// 不应再含空格
	if strings.Contains(out, "Top Level") {
		t.Errorf("原空格名未清理：%s", out)
	}
}

// TestConvertPapyrusTopLevelClass：包类型为 Class（不是 Package），
// 应生成顶层 part def，而不是嵌套包。
func TestConvertPapyrusTopLevelClass(t *testing.T) {
	in := PapyrusModel{
		Name: "Root",
		Packages: []PapyrusPackage{
			{Type: "Class", Name: "TopClass"},
		},
	}
	out := convertPapyrusToSysMLv2(in)
	if !strings.Contains(out, "part def TopClass") {
		t.Errorf("Top-level Class 应转 part def：\n%s", out)
	}
}

// TestConvertPapyrusEmptyModel：空 model 应输出最小可解析的 package。
func TestConvertPapyrusEmptyModel(t *testing.T) {
	out := convertPapyrusToSysMLv2(PapyrusModel{Name: "Empty"})
	if !strings.Contains(out, "package Empty") {
		t.Errorf("空 model 输出缺 package Empty：%s", out)
	}
	if !strings.HasSuffix(out, "}\n") {
		t.Errorf("空 model 输出应以 } 结尾：%s", out)
	}
}

// TestConvertCapellaBasic：Capella JSON → SysML v2。
//
// 关键：所有元素（part def / port / attribute）都在 package 顶层，
// 缩进必须一致 2 空格（之前 bug 是 port/attribute 用 4 空格）。
func TestConvertCapellaBasic(t *testing.T) {
	in := CapellaModel{
		Name: "CapellaRoot",
		Elements: []CapellaElement{
			{Type: "Component", Name: "Sensor", ID: "_1"},
			{Type: "Port", Name: "p1", ID: "_2"},
			{Type: "Property", Name: "mass", ID: "_3"},
		},
	}
	out := convertCapellaToSysMLv2(in)

	for _, want := range []string{
		"package CapellaRoot",
		"part def Sensor",
		"port p1",
		"attribute mass : String",
	} {
		if !strings.Contains(out, want) {
			t.Errorf("Capella 转换结果缺 %q：\n%s", want, out)
		}
	}
	// 缩进检查：port 和 attribute 必须和 part def 同级（2 空格）
	if strings.Contains(out, "    port ") {
		t.Errorf("port 缩进错误（应为 2 空格）：%s", out)
	}
	if strings.Contains(out, "    attribute ") {
		t.Errorf("attribute 缩进错误（应为 2 空格）：%s", out)
	}
}

// TestConvertCapellaEmptyModel：Capella 空 model 边界。
func TestConvertCapellaEmptyModel(t *testing.T) {
	out := convertCapellaToSysMLv2(CapellaModel{Name: "EmptyCap"})
	if !strings.HasPrefix(out, "package EmptyCap") {
		t.Errorf("空 Capella 输出格式错：%s", out)
	}
}

// ─── E2E: multipart upload 走完整链路 ────────────────────────────────────

// TestImportPapyrusEndToEnd：multipart 上传 → handler 解析 → 创建 Model。
func TestImportPapyrusEndToEnd(t *testing.T) {
	r, repo := setupTestRouter(t)
	tok, _, _, _ := registerTwoUsers(t, r)
	projectID := createProject(t, r, tok, "PapyrusImportProj", "private")

	// 构造 multipart body
	papyrusXML := `<?xml version="1.0" encoding="UTF-8"?>
<uml:Model xmi:version="2.1" xmlns:uml="http://www.eclipse.org/uml2/3.0.0/UML" xmi:id="_Model" name="ImportedSysML">
  <packagedElement xmi:type="uml:Package" xmi:id="_Pkg1" name="Components">
    <packagedElement xmi:type="uml:Class" xmi:id="_C1" name="Sensor"/>
    <packagedElement xmi:type="uml:Port" xmi:id="_P1" name="dataOut"/>
    <packagedElement xmi:type="uml:Property" xmi:id="_Pr1" name="serial"/>
  </packagedElement>
</uml:Model>`

	body := &bytes.Buffer{}
	w := multipart.NewWriter(body)
	_ = w.WriteField("projectId", projectID)
	fw, _ := w.CreateFormFile("file", "sample.xml")
	_, _ = io.WriteString(fw, papyrusXML)
	_ = w.Close()

	req := authedRequest("POST", "/api/v1/import/papyrus", tok, nil)
	req.Body = io.NopCloser(body)
	req.Header.Set("Content-Type", w.FormDataContentType())
	req.ContentLength = int64(body.Len())

	resp := doRequest(r, req)
	if resp.Code != http.StatusOK {
		t.Fatalf("import/papyrus status=%d body=%s", resp.Code, resp.Body.String())
	}
	t.Logf("import response: %s", resp.Body.String())
	var body2 struct {
		Data struct {
			Model struct {
				ID      string `json:"id"`
				Name    string `json:"name"`
				Content string `json:"content"`
			} `json:"model"`
			Source  string `json:"source"`
			Message string `json:"message"`
		} `json:"data"`
	}
	if err := json.Unmarshal(resp.Body.Bytes(), &body2); err != nil {
		t.Fatalf("json unmarshal: %v", err)
	}
	if body2.Data.Source != "papyrus" {
		t.Errorf("source 应 papyrus，实际 %q", body2.Data.Source)
	}
	if body2.Data.Model.Name != "sample" {
		t.Errorf("model.name 应 sample，实际 %q", body2.Data.Model.Name)
	}
	for _, want := range []string{
		"package ImportedSysML",
		"package Components",
		"part def Sensor",
		"port dataOut : String",
		"attribute serial",
	} {
		if !strings.Contains(body2.Data.Model.Content, want) {
			t.Errorf("导入后 SysML v2 内容缺 %q：\n%s", want, body2.Data.Model.Content)
		}
	}

	// 确认 Model 真的写入了数据库
	stored, err := repo.GetModel(req.Context(), body2.Data.Model.ID)
	if err != nil {
		t.Fatalf("GetModel: %v", err)
	}
	if stored.Content != body2.Data.Model.Content {
		t.Errorf("DB 内容与响应不一致")
	}
}

// TestImportCapellaEndToEnd：Capella JSON 端到端。
func TestImportCapellaEndToEnd(t *testing.T) {
	r, _ := setupTestRouter(t)
	tok, _, _, _ := registerTwoUsers(t, r)
	projectID := createProject(t, r, tok, "CapellaImportProj", "private")

	capellaJSON := `{
  "name": "CapellaImported",
  "elements": [
    {"type": "Component", "id": "_C1", "name": "ComputeBoard"},
    {"type": "Port",      "id": "_P1", "name": "ioBus"},
    {"type": "Attribute", "id": "_A1", "name": "cpuLoad"}
  ]
}`

	body := &bytes.Buffer{}
	w := multipart.NewWriter(body)
	_ = w.WriteField("projectId", projectID)
	fw, _ := w.CreateFormFile("file", "sample.json")
	_, _ = io.WriteString(fw, capellaJSON)
	_ = w.Close()

	req := authedRequest("POST", "/api/v1/import/capella", tok, nil)
	req.Body = io.NopCloser(body)
	req.Header.Set("Content-Type", w.FormDataContentType())
	req.ContentLength = int64(body.Len())

	resp := doRequest(r, req)
	if resp.Code != http.StatusOK {
		t.Fatalf("import/capella status=%d body=%s", resp.Code, resp.Body.String())
	}
	var body2 struct {
		Data struct {
			Model struct {
				Name    string `json:"name"`
				Content string `json:"content"`
			} `json:"model"`
			Source string `json:"source"`
		} `json:"data"`
	}
	if err := json.Unmarshal(resp.Body.Bytes(), &body2); err != nil {
		t.Fatalf("json: %v", err)
	}
	for _, want := range []string{
		"package CapellaImported",
		"part def ComputeBoard",
		"port ioBus : String",
		"attribute cpuLoad",
	} {
		if !strings.Contains(body2.Data.Model.Content, want) {
			t.Errorf("Capella 导入 SysML 内容缺 %q：\n%s", want, body2.Data.Model.Content)
		}
	}
}

// TestImportPapyrusMissingProjectId：缺 projectId → 400。
func TestImportPapyrusMissingProjectId(t *testing.T) {
	r, _ := setupTestRouter(t)
	tok, _, _, _ := registerTwoUsers(t, r)

	body := &bytes.Buffer{}
	w := multipart.NewWriter(body)
	fw, _ := w.CreateFormFile("file", "x.xml")
	_, _ = io.WriteString(fw, "<uml:Model/>")
	_ = w.Close()

	req := authedRequest("POST", "/api/v1/import/papyrus", tok, nil)
	req.Body = io.NopCloser(body)
	req.Header.Set("Content-Type", w.FormDataContentType())
	req.ContentLength = int64(body.Len())

	resp := doRequest(r, req)
	if resp.Code != http.StatusBadRequest {
		t.Errorf("缺 projectId 应 400，实际 %d", resp.Code)
	}
}

// TestImportPapyrusBadXML：上传非 XML 内容 → 400 + 解析错误信息。
func TestImportPapyrusBadXML(t *testing.T) {
	r, _ := setupTestRouter(t)
	tok, _, _, _ := registerTwoUsers(t, r)
	projectID := createProject(t, r, tok, "BadXMLProj", "private")

	body := &bytes.Buffer{}
	w := multipart.NewWriter(body)
	_ = w.WriteField("projectId", projectID)
	fw, _ := w.CreateFormFile("file", "broken.xml")
	_, _ = io.WriteString(fw, "<<< not xml >>>")
	_ = w.Close()

	req := authedRequest("POST", "/api/v1/import/papyrus", tok, nil)
	req.Body = io.NopCloser(body)
	req.Header.Set("Content-Type", w.FormDataContentType())
	req.ContentLength = int64(body.Len())

	resp := doRequest(r, req)
	if resp.Code != http.StatusBadRequest {
		t.Errorf("坏 XML 应 400，实际 %d (%s)", resp.Code, resp.Body.String())
	}
}

// TestStripAndUnmarshalPapyrus：strip + xml.Unmarshal 端到端验证。
func TestStripAndUnmarshalPapyrus(t *testing.T) {
	src := `<?xml version="1.0" encoding="UTF-8"?>
<uml:Model xmi:version="2.1" xmlns:uml="http://www.eclipse.org/uml2/3.0.0/UML" xmi:id="_Model" name="ImportedSysML">
  <packagedElement xmi:type="uml:Package" xmi:id="_Pkg1" name="Components">
    <packagedElement xmi:type="uml:Class" xmi:id="_C1" name="Sensor"/>
    <packagedElement xmi:type="uml:Port" xmi:id="_P1" name="dataOut"/>
    <packagedElement xmi:type="uml:Property" xmi:id="_Pr1" name="serial"/>
  </packagedElement>
</uml:Model>`
	stripped := stripXMLNamespacePrefixes([]byte(src))
	t.Logf("stripped:\n%s", string(stripped))
	var p PapyrusModel
	if err := xml.Unmarshal(stripped, &p); err != nil {
		t.Fatalf("unmarshal: %v", err)
	}
	t.Logf("Model.Name=%q, Packages=%d", p.Name, len(p.Packages))
	if p.Name != "ImportedSysML" {
		t.Errorf("model name 应 ImportedSysML，实际 %q", p.Name)
	}
	if len(p.Packages) != 1 {
		t.Fatalf("packages 应 1，实际 %d", len(p.Packages))
	}
	if p.Packages[0].Name != "Components" {
		t.Errorf("package name 应 Components，实际 %q", p.Packages[0].Name)
	}
	if len(p.Packages[0].Elements) != 3 {
		t.Errorf("elements 应 3，实际 %d", len(p.Packages[0].Elements))
	}
}

// TestStripXMLNamespacePrefixes：直接验证 strip 函数自身。
func TestStripXMLNamespacePrefixes(t *testing.T) {
	in := `<?xml version="1.0"?>
<uml:Model xmlns:uml="http://www.eclipse.org/uml2/3.0.0/UML"
          xmlns:xmi="http://www.omg.org/XMI" xmi:version="2.1" name="X">
  <packagedElement xmi:type="uml:Package" name="P"/>
</uml:Model>`
	out := string(stripXMLNamespacePrefixes([]byte(in)))
	for _, want := range []string{
		`<Model `, // root 没 xmlns 前缀
		`name="X"`,
		`<packagedElement type="Package"`, // type 前缀剥了
	} {
		if !strings.Contains(out, want) {
			t.Errorf("strip 缺 %q：%s", want, out)
		}
	}
	if strings.Contains(out, "xmlns") {
		t.Errorf("strip 应删除 xmlns 声明：%s", out)
	}
}

// TestSanitizeName：name 清理工具函数的边界。
//
// 实际行为：每个空格和每个横线都被替换为下划线，因此
// "mixed _-_ name" → "mixed_____name"（4 个替换）。
func TestSanitizeName(t *testing.T) {
	cases := map[string]string{
		"":               "unnamed",
		"plain":          "plain",
		"with space":     "with_space",
		"kebab-case":     "kebab_case",
		"mixed _-_ name": "mixed_____name", // 4 个替换
	}
	for in, want := range cases {
		if got := sanitizeName(in); got != want {
			t.Errorf("sanitizeName(%q) = %q, want %q", in, got, want)
		}
	}
}

// 防止 gin 模式在导入时被覆盖
var _ = gin.SetMode
