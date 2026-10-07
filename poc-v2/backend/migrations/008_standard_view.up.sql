-- 008_standard_view.up.sql — M19：标准视图类型（OMG §9.2.20）
--
-- 与 initSchema() (internal/repository/repository.go) 同步。
-- 运行时不会自动应用 —— 修改请两边同步。
--
-- 背景：§9.2.20 只有 8 个标准视图定义（GeneralView / InterconnectionView /
-- ActionFlowView / StateTransitionView / SequenceView / GeometryView /
-- GridView / BrowserView）。用户视图通过**特化**声明自己属于哪一种：
--
--     view def VehicleFlow :> StandardViewDefinitions::ActionFlowView {
--         render asInterconnectionDiagram;
--     }
--
-- 这个「是哪一种」决定 UI 挂哪套工具箱、树上显示什么徽章 —— 必须在列表接口里
-- 就能拿到，而列表接口按设计**不返回 content**（见 viewSummarySelectColumns）。
-- 因此按本文件既有的「写入时算好落库」模式加两列（与 render_kind 同一套路）：
--
--   - standard_view   — 命中的标准视图名（空串 = 自定义视图 / 未特化）
--   - rendering_kind  — 官方 4 个标准 rendering 的类别（textual/graphical/tabular）
--   - specializes_ref / rendering_ref — 用户原文引用，属性窗如实显示用
--
-- ⚠️ 与 render_kind 的区别（极易混淆）：render_kind 是**本工具的渲染器路由**
-- （按 rendering 名字猜，认不出回落 interconnection），standard_view 是**规范里的
-- 视图类型**（由特化关系决定）。两者正交：GeneralView 也能 render 成表格。
--
-- 存量数据回填：这两列由 content 推导，但 SQL 无法解析 SysML，故默认留空。
-- 旧视图下次保存时自动补齐；在此之前 UI 按「自定义视图类型」呈现（工具箱退化为
-- 通用集合，不假装是标准视图）。

ALTER TABLE views ADD COLUMN standard_view TEXT NOT NULL DEFAULT '';
ALTER TABLE views ADD COLUMN rendering_kind TEXT NOT NULL DEFAULT '';
ALTER TABLE views ADD COLUMN specializes_ref TEXT NOT NULL DEFAULT '';
ALTER TABLE views ADD COLUMN rendering_ref TEXT NOT NULL DEFAULT '';

CREATE INDEX IF NOT EXISTS idx_views_standard_view ON views(standard_view);