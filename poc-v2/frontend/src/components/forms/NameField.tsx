/**
 * M18.1：属性窗统一的「名称」编辑器。
 *
 * ## 为什么要抽出来
 *
 * 改名前，右栏有两套完全不同的改名交互：
 *   - `ElementFormPanel`（画布选中 / 树选中且画布有节点）→ **常驻输入框**，
 *     边打字边 debounce 150ms 自动写回；
 *   - `ElementInfoPanel`（树选中但画布没节点，如 attributeUsage）→ **铅笔 →
 *     输入 → ✓ 确认**。
 *
 * 同一个元素，从树上点还是从画布点，改法不一样 —— 这正是要消除的割裂。
 * 现在两边共用本组件：**常驻输入框 + debounce 自动写回 + Enter 立即提交 +
 * Esc 撤销 + 失败行内报错并回弹**。
 *
 * ## 失败必须回弹，不能让草稿留在框里
 *
 * 改名前 `ElementFormPanel` 的写入是「无脑 setContent」，而 `renameNode` 对非法
 * 标识符（`1bad` / `has-dash`）是**抛异常**的 —— 抛在 debounce 的 setTimeout
 * 回调里，组件根本接不住。用户看到的就是：框里显示 `1bad`，模型纹丝不动，
 * 也没有任何提示。所以本组件要求 `onCommit` 自己吞掉异常并回 `{ ok:false,
 * reason }`，由本组件负责报错 + 把草稿弹回原值。
 *
 * 顺带修掉一个真实缺陷：原先 `applyFieldEdit` 抛异常时无人接，浏览器控制台
 * 会出现 uncaught error。现在走 `onCommit` 的返回值，不会再逃逸。
 */

import * as React from 'react';
import { AlertTriangle } from 'lucide-react';

/** SysML 标识符规则（与 textEdit.renameNode 的校验保持一致） */
const IDENT_RE = /^[A-Za-z_][\w]*$/;

/** 失焦/停止输入多久后写回（与 ElementFormPanel 改动前的 debounce 一致） */
export const NAME_COMMIT_DEBOUNCE_MS = 150;

export type NameCommitResult =
  | void
  | { ok: boolean; reason?: string }
  | Promise<{ ok: boolean; reason?: string }>;

export interface NameFieldProps {
  /** 已提交的名字（来自 model / AST） */
  value: string;
  /** 提交一次改名。失败必须返回 `{ ok:false, reason }`，不要抛异常。 */
  onCommit: (next: string) => NameCommitResult;
  disabled?: boolean;
  /** 行内标签（默认「名称」）。传 null 表示不渲染 label（信息卡的 dt 已有）。 */
  label?: React.ReactNode | null;
  /** 输入框 testid；默认 `form-field-name`（ElementFormPanel 的双击聚焦依赖它） */
  testId?: string;
  /** 是否展示必填星号 */
  required?: boolean;
}

export const NameField: React.FC<NameFieldProps> = ({
  value,
  onCommit,
  disabled = false,
  label = '名称',
  testId = 'form-field-name',
  required = false,
}) => {
  const [draft, setDraft] = React.useState(value);
  const [error, setError] = React.useState<string | null>(null);
  const timerRef = React.useRef<ReturnType<typeof setTimeout> | null>(null);
  const inputRef = React.useRef<HTMLInputElement | null>(null);
  // 异步提交时锁住：避免 slow 请求期间用户又敲了几个字，结果被旧提交覆盖
  const committingRef = React.useRef(false);

  const clearTimer = () => {
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = null;
  };

  // 已提交的名字变了（切换元素 / 上游改了模型）→ 草稿跟随，并清掉旧错误
  React.useEffect(() => {
    setDraft(value);
    setError(null);
  }, [value]);

  React.useEffect(() => clearTimer, []);

  const commit = React.useCallback(
    async (raw: string) => {
      clearTimer();
      if (committingRef.current) return;
      const next = raw.trim();
      if (!next || next === value) {
        setDraft(value);
        setError(null);
        return;
      }
      // 本地先拦一道：避免把必然失败的输入发给上层，也避免定时器里抛异常
      if (!IDENT_RE.test(next)) {
        setError('不是合法的 SysML 标识符（字母/数字/下划线，且不以数字开头）');
        setDraft(value);
        return;
      }
      committingRef.current = true;
      try {
        const r = await onCommit(next);
        if (r && !r.ok) {
          setError(r.reason ?? '改名失败');
          setDraft(value); // 回弹：框里不能留着没生效的名字
          return;
        }
        setError(null);
      } catch (e) {
        // onCommit 契约是「不抛」，真抛了也不能让输入框停在这个假状态
        setError((e as Error).message ?? '改名失败');
        setDraft(value);
      } finally {
        committingRef.current = false;
      }
    },
    [onCommit, value],
  );

  const handleChange = (next: string) => {
    setDraft(next);
    if (error) setError(null);
    clearTimer();
    timerRef.current = setTimeout(() => void commit(next), NAME_COMMIT_DEBOUNCE_MS);
  };

  return (
    <div>
      {label !== null && (
        <label className="block text-[10px] font-medium text-gray-500">
          {label} {required && <span className="text-red-500">*</span>}
        </label>
      )}
      <input
        ref={inputRef}
        value={draft}
        onChange={(e) => handleChange(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault();
            void commit(draft);
          } else if (e.key === 'Escape') {
            clearTimer();
            setDraft(value);
            setError(null);
            inputRef.current?.blur();
          }
        }}
        onBlur={() => {
          // 失焦立即提交，不等 debounce —— 用户切走时不该丢掉最后一次输入
          clearTimer();
          void commit(draft);
        }}
        disabled={disabled}
        aria-invalid={!!error}
        data-testid={testId}
        data-name-field="1"
        className="mt-1 h-7 w-full rounded border border-gray-300 bg-white px-2 font-mono text-xs focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500 disabled:bg-gray-100 dark:border-gray-600 dark:bg-gray-800 dark:disabled:bg-gray-700"
      />
      {error && (
        <div
          className="mt-0.5 flex items-start gap-1 text-[10px] text-red-600 dark:text-red-400"
          data-testid={`${testId}-error`}
          role="alert"
        >
          <AlertTriangle className="mt-0.5 h-2.5 w-2.5 shrink-0" />
          <span>{error}</span>
        </div>
      )}
    </div>
  );
};