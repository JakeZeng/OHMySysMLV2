# M3 元模型浏览器 UI 规范 — M3 W3 输入

> **作者**：Mavis
> **日期**：2026-09-14
> **状态**：设计稿，待 M3 W3 D13 实施前 review
> **目标**：让团队 / 用户在 UI 上浏览 SysML v2 全部元素类型 + 文档
> **基于**：`m3-metamodel-loader-design.md`（后端 API 已就位）、`poc-v2/frontend`（现有 Radix UI + Tailwind）

---

## 0. TL;DR

把 M3 W1 D3-4 的 5 个 metamodel HTTP endpoint 包装成前端组件：

```
侧栏：元模型浏览器
├─ 树形列表（按 Kind 分组：Classifier / Feature / Relationship / ...）
├─ 搜索框（顶部）
├─ 详情面板（点击元素后展开）
└─ 集成位置：Monaco 编辑器右侧栏（与 AI 按钮并列）
```

**关键设计**：
1. 复用现有 Radix UI（已有依赖）
2. 不引入新组件库
3. 状态管理：TanStack Query（已有依赖）
4. 第 1 版只做"树形 + 详情 + 搜索"，不做对比 / 关系图（M5 候选）

---

## 1. 背景与动机

### 1.1 M3 用户场景

| 用户 | 用元模型做什么 |
|------|---------------|
| SysML v2 初学者 | 查"有哪些元素类型可用" |
| 高级用户 | 查"Block 的所有属性"快速写代码 |
| AI prompt 工程 | 查"AI 能生成什么类型"约束 prompt |
| 模板作者 | 查"模板应该用哪些类型" |
| 教学场景 | 让学生浏览整个 SysML v2 元模型 |

### 1.2 不做什么（M3 第 1 版）

- ❌ **关系图可视化**（D3.js force layout）—— M5 候选
- ❌ **SysON/Cameo 互转的元模型 diff** —— M6
- ❌ **用户自定义 Profile 编辑**（加载到元模型）—— M5
- ❌ **元模型版本切换**（v1 / v2 / 提案） —— M5+
- ❌ **元模型搜索高级功能**（正则 / 全文 / fuzzy）—— M5

---

## 2. 架构

### 2.1 组件树

```tsx
<App>
  <EditorPage>
    <MonacoEditor />          // 现有
    <SidePanel>               // 现有右侧栏
      <ExistingTabs />
      <NewTab name="Metamodel">
        <MetamodelBrowser />  // 新增
      </NewTab>
    </SidePanel>
    <DiagramCanvas />         // 现有 React Flow
  </EditorPage>
</App>
```

### 2.2 数据流

```
MetamodelBrowser
    │
    ├── useMetamodelElements()  → fetch('/api/v1/metamodel/elements')
    ├── useMetamodelElement(qname) → fetch('/api/v1/metamodel/elements/:qname')
    ├── useMetamodelSearch(query) → fetch('/api/v1/metamodel/search?q=...')
    │
    └── 状态：selectedQname（当前选中元素）
```

### 2.3 文件结构

```
poc-v2/frontend/src/
├── metamodel/
│   ├── types.generated.ts    // TS 类型（从 backend 自动生成或手写）
│   ├── useMetamodel.ts        // TanStack Query hooks
│   ├── MetamodelBrowser.tsx   // 主组件
│   ├── MetamodelTree.tsx      // 树形列表
│   ├── MetamodelDetail.tsx    // 详情面板
│   ├── MetamodelSearch.tsx    // 搜索框
│   └── __tests__/             // Vitest 单测
└── pages/
    └── EditorPage.tsx         // 集成新 tab
```

---

## 3. 组件详细设计

### 3.1 MetamodelBrowser（主容器）

```tsx
// MetamodelBrowser.tsx
interface MetamodelBrowserProps {
  // 无 props：从后端 API 拉数据
}

export function MetamodelBrowser() {
  const [selectedQname, setSelectedQname] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  
  return (
    <div className="metamodel-browser flex h-full">
      {/* 左：搜索 + 树形 */}
      <div className="w-1/3 border-r overflow-y-auto">
        <MetamodelSearch onSearch={setSearchQuery} />
        <MetamodelTree
          searchQuery={searchQuery}
          selectedQname={selectedQname}
          onSelect={setSelectedQname}
        />
      </div>
      
      {/* 右：详情面板 */}
      <div className="flex-1 overflow-y-auto">
        {selectedQname ? (
          <MetamodelDetail qname={selectedQname} />
        ) : (
          <EmptyState message="选择左侧元素查看详情" />
        )}
      </div>
    </div>
  );
}
```

### 3.2 MetamodelTree（树形列表）

```tsx
// MetamodelTree.tsx
import { useMetamodelElements } from '../useMetamodel';

export function MetamodelTree({ searchQuery, selectedQname, onSelect }: Props) {
  const { data, isLoading } = useMetamodelElements();
  
  if (isLoading) return <Spinner />;
  if (!data) return <ErrorState />;
  
  // 按 Kind 分组
  const grouped = groupByKind(data.elements);
  
  return (
    <Accordion type="multiple" defaultValue={['classifier', 'feature']}>
      {Object.entries(grouped).map(([kind, elements]) => (
        <AccordionItem key={kind} value={kind}>
          <AccordionTrigger>
            {kind} ({elements.length})
          </AccordionTrigger>
          <AccordionContent>
            {elements
              .filter(e => !searchQuery || e.name.toLowerCase().includes(searchQuery.toLowerCase()))
              .map(e => (
                <TreeNode
                  key={e.qname}
                  element={e}
                  isSelected={e.qname === selectedQname}
                  onClick={() => onSelect(e.qname)}
                />
              ))}
          </AccordionContent>
        </AccordionItem>
      ))}
    </Accordion>
  );
}
```

### 3.3 MetamodelDetail（详情面板）

```tsx
// MetamodelDetail.tsx
import { useMetamodelElement } from '../useMetamodel';

export function MetamodelDetail({ qname }: { qname: string }) {
  const { data, isLoading } = useMetamodelElement(qname);
  
  if (isLoading) return <Spinner />;
  if (!data) return <ErrorState />;
  
  return (
    <div className="p-4">
      {/* 标题 */}
      <h2 className="text-2xl font-bold">{data.name}</h2>
      <div className="text-sm text-gray-500">{data.qname}</div>
      <Badge>{data.kind}</Badge>
      {data.super_type && <Badge variant="outline">extends {data.super_type}</Badge>}
      
      {/* 文档 */}
      {data.documentation && (
        <p className="mt-2 text-gray-700">{data.documentation}</p>
      )}
      
      {/* 属性表 */}
      <h3 className="mt-4 font-semibold">Properties</h3>
      {data.properties.length > 0 ? (
        <table className="w-full mt-2">
          <thead>
            <tr><th>Name</th><th>Type</th><th>Mult</th><th>Required</th></tr>
          </thead>
          <tbody>
            {data.properties.map(p => (
              <tr key={p.name}>
                <td className="font-mono">{p.name}</td>
                <td className="font-mono text-blue-600">{p.type}</td>
                <td className="font-mono">{p.multiplicity}</td>
                <td>{p.required ? '✓' : ''}</td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : (
        <div className="text-gray-500 text-sm">No properties</div>
      )}
      
      {/* 子类 */}
      {data.sub_types.length > 0 && (
        <>
          <h3 className="mt-4 font-semibold">Sub-types</h3>
          <ul>
            {data.sub_types.map(st => <li key={st}>{st}</li>)}
          </ul>
        </>
      )}
    </div>
  );
}
```

### 3.4 MetamodelSearch（搜索框）

```tsx
// MetamodelSearch.tsx
import { useState, useEffect } from 'react';
import { useDebounce } from '@/lib/hooks';  // M3 加：debounce hook

export function MetamodelSearch({ onSearch }: { onSearch: (q: string) => void }) {
  const [value, setValue] = useState('');
  const debounced = useDebounce(value, 300);
  
  useEffect(() => {
    onSearch(debounced);
  }, [debounced, onSearch]);
  
  return (
    <div className="p-2">
      <Input
        type="search"
        placeholder="搜索元素（不区分大小写）"
        value={value}
        onChange={(e) => setValue(e.target.value)}
      />
    </div>
  );
}
```

### 3.5 useMetamodel（TanStack Query hooks）

```typescript
// useMetamodel.ts
import { useQuery } from '@tanstack/react-query';

export interface MetaElementSummary {
  qname: string;
  name: string;
  namespace: string;
  kind: string;
  super_type?: string;
}

export interface MetaElement extends MetaElementSummary {
  sub_types: string[];
  properties: Array<{
    name: string;
    type: string;
    multiplicity: string;
    documentation?: string;
    required: boolean;
  }>;
  documentation?: string;
}

export function useMetamodelElements() {
  return useQuery({
    queryKey: ['metamodel', 'elements'],
    queryFn: async () => {
      const r = await fetch('/api/v1/metamodel/elements');
      if (!r.ok) throw new Error('Failed to fetch elements');
      return r.json() as Promise<{ elements: MetaElementSummary[]; count: number }>;
    },
    staleTime: 5 * 60 * 1000,  // 元模型不常变，5 分钟缓存
  });
}

export function useMetamodelElement(qname: string) {
  return useQuery({
    queryKey: ['metamodel', 'element', qname],
    queryFn: async () => {
      const r = await fetch(`/api/v1/metamodel/elements/${encodeURIComponent(qname)}`);
      if (!r.ok) throw new Error('Failed to fetch element');
      return r.json() as Promise<MetaElement>;
    },
    enabled: !!qname,
    staleTime: 5 * 60 * 1000,
  });
}

export function useMetamodelSearch(query: string) {
  return useQuery({
    queryKey: ['metamodel', 'search', query],
    queryFn: async () => {
      const r = await fetch(`/api/v1/metamodel/search?q=${encodeURIComponent(query)}`);
      if (!r.ok) throw new Error('Failed to search');
      return r.json() as Promise<{ results: MetaElementSummary[]; count: number }>;
    },
    enabled: query.length >= 1,
    staleTime: 30 * 1000,  // 搜索结果 30 秒缓存
  });
}
```

---

## 4. UI 选型（基于现有依赖）

### 4.1 已有依赖（不需新增）

- `@radix-ui/react-accordion` — 树形分组
- `@radix-ui/react-collapsible` — 子类折叠
- `@radix-ui/react-tabs` — 集成到右侧栏
- `@radix-ui/react-tooltip` — 属性悬停说明
- `@tanstack/react-query` — 数据获取
- `clsx` / `tailwind-merge` — 样式
- `lucide-react` — 图标（Search、ChevronDown、FileText 等）

### 4.2 不引入新依赖

- ❌ `react-window`（虚拟滚动，元素 < 100 不需要）
- ❌ `fuse.js`（fuzzy 搜索，substring 搜索够用）
- ❌ `react-arborist`（树形组件，Radix Accordion + 自定义就够）

---

## 5. 集成位置

### 5.1 现有右侧栏

```tsx
// EditorPage.tsx（修改）
<SidePanel>
  <Tabs defaultValue="errors">
    <TabsList>
      <TabsTrigger value="errors">错误</TabsTrigger>
      <TabsTrigger value="ai">AI 助手</TabsTrigger>
      <TabsTrigger value="metamodel">元模型</TabsTrigger>  {/* 新增 */}
    </TabsList>
    <TabsContent value="errors">...</TabsContent>
    <TabsContent value="ai">...</TabsContent>
    <TabsContent value="metamodel">                  {/* 新增 */}
      <MetamodelBrowser />
    </TabsContent>
  </Tabs>
</SidePanel>
```

### 5.2 元数据入口（M3 末）

在主菜单加一个"元模型参考"独立页面（不进编辑器）：
- 路由 `/metamodel`
- 全屏展示 MetamodelBrowser
- 适合"我想查元模型但没在编辑模型"场景

---

## 6. 响应式 + 可访问性

### 6.1 响应式

- 桌面：双栏（树 + 详情）
- 平板：双栏但宽度自适应
- 移动：单栏，点击元素后切换到详情（用 Radix Dialog）

### 6.2 可访问性

- 所有可点击元素用 `<button>`（不是 div）
- 键盘导航：↑↓ 切换元素，Enter 打开详情，Esc 关闭对话框
- ARIA labels：搜索框、树形节点、详情面板

---

## 7. W3 实施步骤

### Day 1 (W3 D13)：

| 任务 | 验收 | 工时 |
|------|------|------|
| **U1**: types.generated.ts（手写 + 注释 auto-gen） | TypeScript 编译通过 | 0.3d |
| **U2**: useMetamodel hooks（3 个） | Vitest 单测覆盖 3 个 hook | 0.5d |
| **U3**: MetamodelBrowser 主组件 + 空状态 | dev 跑通 | 0.3d |
| **U4**: MetamodelTree 树形列表 | 单测覆盖分组 + 搜索过滤 | 0.5d |
| **U5**: MetamodelDetail 详情面板 | 单测覆盖属性表 + 子类列表 | 0.5d |

**W3 D13 总工时**: 2.1d

### Day 2 (W3 D14)：

| 任务 | 验收 | 工时 |
|------|------|------|
| **U6**: MetamodelSearch 搜索框（debounce） | 搜索响应 < 200ms | 0.3d |
| **U7**: EditorPage 集成新 tab | dev 跑通 | 0.3d |
| **U8**: 元模型参考独立页（/metamodel） | 路由可访问 | 0.3d |
| **U9**: Playwright E2E 覆盖 5 个流程 | E2E 全绿 | 0.5d |
| **U10**: 响应式 + 键盘导航 | 移动端可用 | 0.3d |

**W3 D14 总工时**: 1.7d

**W3 元模型 UI 总工时**: 3.8d（在 76 人天 5%）

---

## 8. 测试策略

### 8.1 单元测试（Vitest）

| 测试 | 覆盖 |
|------|------|
| `useMetamodelElements.test` | mock fetch + 验证 cache |
| `MetamodelTree.test` | 分组 + 搜索过滤 + 选中高亮 |
| `MetamodelDetail.test` | 属性表 + 子类 + 空状态 |
| `MetamodelSearch.test` | debounce 300ms |

### 8.2 E2E 测试（Playwright）

```typescript
// e2e/metamodel-browser.spec.ts
test('user can browse metamodel and see element details', async ({ page }) => {
  await page.goto('/editor');
  await page.click('text=元模型');
  await page.click('text=Classifier');
  await page.click('text=Block');
  await expect(page.locator('h2')).toContainText('Block');
  await expect(page.locator('text=Properties')).toBeVisible();
});

test('user can search metamodel elements', async ({ page }) => {
  await page.goto('/editor');
  await page.click('text=元模型');
  await page.fill('input[type=search]', 'Feature');
  await expect(page.locator('text=Feature')).toBeVisible();
  await expect(page.locator('text=Block')).not.toBeVisible(); // 过滤
});
```

---

## 9. 风险与缓解

| 风险 | 概率 | 影响 | 缓解 |
|------|------|------|------|
| 元模型响应太大（5MB schema → 几百个元素） | 低 | 前端卡顿 | 5 分钟 staleTime + 5MB 后端压缩 |
| 搜索慢（substring 匹配 100+ 元素） | 低 | UX 差 | debounce 300ms + 限制搜索 ≥ 1 字符 |
| 与 Monaco 右侧栏已有 tab 冲突 | 中 | 布局错乱 | 测试 3 个 tab 切换；必要时加折叠按钮 |
| 元模型浏览器占用太多屏幕空间 | 中 | 用户不想用 | 折叠到顶部 icon，hover 展开 |
| 移动端体验差 | 中 | 平板 / 手机用户 | 响应式 + Dialog 模式 |

---

## 10. 不在 M3 范围（明确划线）

- ❌ **元模型版本切换**（v1 / v2 / 提案）—— M5+
- ❌ **关系图可视化**（D3 force layout）—— M5
- ❌ **元模型对比**（不同版本 diff）—— M6+
- ❌ **用户自定义 stereotype** —— M5
- ❌ **元模型全文搜索**（仅限 M3 substring）—— M5

---

## 11. 验收 Checklist（M3 W3 D14 末）

- [ ] types.generated.ts 编译通过
- [ ] 3 个 useMetamodel hook + 单测
- [ ] MetamodelBrowser / Tree / Detail / Search 4 个组件 + 单测
- [ ] EditorPage 集成新 tab
- [ ] /metamodel 独立路由可访问
- [ ] Playwright E2E 5 个流程全绿
- [ ] 响应式：桌面 + 平板 + 移动可用
- [ ] 键盘导航：↑↓/Enter/Esc 可用
- [ ] ARIA labels 完整
- [ ] `npm test` 仍 109/109 + 新增元模型 UI 单测
- [ ] `npm run build` 通过
- [ ] M3 D28 验收：元模型覆盖 ≥ 60%（按本 UI 实际可用元素统计）

---

## 12. 配套文档

- [ ] `m3-metamodel-ux-research.md`（W3 末，用户调研 + 改进建议）
- [ ] `m5-metamodel-relationship-graph.md`（M5 关系图设计）

---

## 13. 变更历史

| 版本 | 日期 | 作者 | 变更 |
|------|------|------|------|
| v0.1 | 2026-09-14 | Mavis | 初稿，基于 m3-metamodel-loader-design.md + 现有前端依赖 |

---

> **下一步**：M3 W3 D13 启动后，先做 U1（types）+ U2（hooks）+ U3（主组件）+ U4（树形），D14 做详情 + 搜索 + 集成 + E2E。
