# SysML v2 MBSE 建模软件 - 工作空间

> 浏览器端（BS）基于 SysML v2 的 MBSE 系统建模软件
> 差异化方向：轻量协作 + 开放互操作 + AI 增强 + 元模型驱动

## 📂 文件清单

### 核心设计文档

| 文件 | 说明 | 飞书版本 |
|------|------|----------|
| `prd_sysmlv2.md` | PRD 产品需求文档 v0.2 | [Q3dndGQODownyexU2LBc3BaYnoh](https://mcngebz48hm1.feishu.cn/docx/Q3dndGQODownyexU2LBc3BaYnoh) |
| `arch_sysmlv2.md` | 详细架构设计 v0.1 | [SUqgd5EPYotrLIxmQupc27E3nwV](https://mcngebz48hm1.feishu.cn/docx/SUqgd5EPYotrLIxmQupc27E3nwV) |
| `poc_tech_validation.md` | 技术原型 POC 验证 | [KhpJdUBe1oPyUCxVSSzcaQFwnBg](https://mcngebz48hm1.feishu.cn/docx/KhpJdUBe1oPyUCxVSSzcaQFwnBg) |
| `db_design.md` | 数据库设计 | [RhJQdIEYVoPsT6xO6kqcoFt2nRh](https://mcngebz48hm1.feishu.cn/docx/RhJQdIEYVoPsT6xO6kqcoFt2nRh) |
| `api_design.md` | API 接口设计 | [TRukdfRqLoolGSxmxRxcGwCrned](https://mcngebz48hm1.feishu.cn/docx/TRukdfRqLoolGSxmxRxcGwCrned) |
| `ui_ux_design.md` | UI/UX 设计 | [Trpsd2dRfoTaYkx752HcLPjhnwh](https://mcngebz48hm1.feishu.cn/docx/Trpsd2dRfoTaYkx752HcLPjhnwh) |
| `metamodel_design.md` | 元模型详细设计 | [RR5FdZ6PkoJcBDxchgdcAcOin99](https://mcngebz48hm1.feishu.cn/docx/RR5FdZ6PkoJcBDxchgdcAcOin99) |
| `tech_review_report.md` | 技术方案复审报告（4.4/10） | [QADsdqxjZomgb6xpv68cfiZfnmg](https://mcngebz48hm1.feishu.cn/docx/QADsdqxjZomgb6xpv68cfiZfnmg) |

### POC 代码示例

| 路径 | 说明 |
|------|------|
| `poc/monaco-sysml.ts` | Monaco Editor SysML Monarch tokenizer |
| `poc/sysml-schema.ts` | JSON Schema 类型 + 文本→JSON 转换器 |
| `poc/ReactFlowNodes.tsx` | React Flow 6 种 SysML 节点组件 |
| `poc/scaffold/backend/` | Go 后端脚手架（注意：POC 是空壳，需返工） |
| `poc/scaffold/frontend/` | React 前端脚手架 |

## 🚨 复审结论（重点关注）

**总分 4.4/10 — 不可直接启动，需重大返工**

### P0 致命问题（1-2 周内）
1. POC 是空壳：解析器返回假数据，validateSchema 永远 true
2. 解析器是行级正则：不能处理嵌套/跨行/作用域
3. 文本→图形数据流断链：modelToFlow 未被调用
4. 无团队配置：12 月 8 里程碑拍脑袋
5. 后端语言未决：Go / Rust 选项符号未去

### P1 重要返工（M1 前）
- 架构改 Monolith（去掉 MongoDB、MinIO）
- 元模型回归 ptc/25-04-32 规范
- 时间线 ×1.5-2 倍

详见 `tech_review_report.md`

## 🔗 飞书文件夹

[MBSE 项目空间](https://mcngebz48hm1.feishu.cn/drive/folder/GSstfkufIlGgu7d3ZTEcPwGun8e)

## 📅 项目时间线

- **2026-01**：PRD + 架构设计 + 详细设计（当前阶段）
- **待定**：POC 返工、M1-M8 里程碑（需根据复审调整）

## 🛠️ 技术栈

- **前端**：React 18 + TypeScript + Monaco Editor + React Flow + Zustand
- **后端**：Go 1.21+（待最终决定）+ Gin + gRPC
- **存储**：PostgreSQL 16 (JSONB) + Redis 7
- **AI**：LLM API（待定）
