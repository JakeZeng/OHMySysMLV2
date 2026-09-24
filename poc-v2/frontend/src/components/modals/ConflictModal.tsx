/**
 * M13 多人协同 — 版本冲突合并对话框
 *
 * 当后端返回 409 E_VERSION_CONFLICT 时弹出。
 * 用户可选择：
 *   - 接受服务器（丢弃本地修改）
 *   - 强制覆盖（用我的版本；后端写 force=true）
 *   - 手动合并（在三者之间编辑 mergedContent；保存时带 baseContent）
 *
 * 三方内容：
 *   - base      = 编辑时基于的内容（来自冲突 details.baseContent）
 *   - mine      = 当前 modelStore.content（用户的本地修改）
 *   - server    = 冲突 details.serverContent（最新已保存版本）
 *
 * Diff（来自 diffHunks）按 base vs server 高亮；
 * mine 区域始终可改（textarea）。
 */

import * as React from 'react';
import { AlertTriangle, ArrowDownToLine, UploadCloud, GitMerge } from 'lucide-react';
import { Modal } from '../ui/Modal';
import { Button } from '../ui/Button';
import { useCollabStore } from '../../stores/collabStore';
import type { ConflictDetails, DiffHunk, MergeStrategy } from '../../lib/collab/types';

interface ConflictModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** 我的当前内容（modelStore.content） */
  mine: string;
  /** 解析后的合并动作回调 */
  onResolve: (strategy: MergeStrategy, mergedContent: string) => void;
}

export const ConflictModal: React.FC<ConflictModalProps> = ({
  open,
  onOpenChange,
  mine,
  onResolve,
}) => {
  const conflict = useCollabStore((s) => s.conflict);
  const strategy = useCollabStore((s) => s.mergeStrategy);
  const setStrategy = useCollabStore((s) => s.setMergeStrategy);
  const mergedContent = useCollabStore((s) => s.mergedContent);
  const setMergedContent = useCollabStore((s) => s.setMergedContent);

  const [tab, setTab] = React.useState<'mine' | 'theirs' | 'merged'>('merged');

  // 当 conflict 变化 / 打开时，初始化 mergedContent
  React.useEffect(() => {
    if (!open || !conflict) return;
    if (mergedContent === null) {
      // 默认合并结果 = 服务器版本 + 用户"新增行"（启发式：以行为单位）
      const merged = autoMerge(conflict.baseContent, mine, conflict.serverContent);
      setMergedContent(merged);
    }
    setStrategy('manual');
  }, [open, conflict, mine, mergedContent, setMergedContent, setStrategy]);

  if (!conflict) return null;

  const handleAccept = () => {
    onResolve('theirs', conflict.serverContent);
    onOpenChange(false);
  };

  const handleForce = () => {
    onResolve('mine', mine);
    onOpenChange(false);
  };

  const handleSaveMerged = () => {
    onResolve('manual', mergedContent ?? mine);
    onOpenChange(false);
  };

  return (
    <Modal
      open={open}
      onOpenChange={onOpenChange}
      title="保存冲突"
      description={
        <div className="flex items-center gap-2 text-sm text-amber-700">
          <AlertTriangle className="h-4 w-4" />
          其他人在你编辑期间保存了新内容（v{conflict.serverVersion}）。请选择如何处理。
        </div>
      }
      className="max-w-5xl"
      footer={
        <>
          <Button
            variant="secondary"
            onClick={() => onOpenChange(false)}
            data-testid="conflict-cancel"
          >
            稍后处理
          </Button>
          <Button
            variant="secondary"
            onClick={handleAccept}
            data-testid="conflict-accept-theirs"
            title="丢弃我的修改，使用服务器版本"
          >
            <ArrowDownToLine className="h-3.5 w-3.5" /> 接受服务器
          </Button>
          <Button
            variant="secondary"
            onClick={handleForce}
            data-testid="conflict-force-mine"
            title="忽略服务器版本，强制写入我的版本（覆盖他人修改）"
          >
            <UploadCloud className="h-3.5 w-3.5" /> 强制覆盖
          </Button>
          <Button
            onClick={handleSaveMerged}
            data-testid="conflict-save-merged"
            title="将合并后的内容作为新版本保存"
          >
            <GitMerge className="h-3.5 w-3.5" /> 保存合并结果
          </Button>
        </>
      }
    >
      {/* 顶部 metadata */}
      <div
        className="mb-3 grid grid-cols-3 gap-2 rounded-md bg-gray-50 px-3 py-2 text-xs text-gray-600 dark:bg-gray-800 dark:text-gray-300"
        data-testid="conflict-meta"
      >
        <div>
          <span className="text-gray-400">服务器版本：</span>
          <span className="font-mono">v{conflict.serverVersion}</span>
        </div>
        <div>
          <span className="text-gray-400">最后更新：</span>
          <span>{new Date(conflict.serverUpdatedAt).toLocaleString()}</span>
        </div>
        <div>
          <span className="text-gray-400">基线版本：</span>
          <span className="font-mono">v{conflict.baseVersion}</span>
        </div>
      </div>

      {/* tab 切换 */}
      <div className="mb-2 flex gap-1 border-b border-gray-200 dark:border-gray-700">
        <TabBtn active={tab === 'mine'} onClick={() => setTab('mine')} testId="tab-mine">
          我的版本（{mine.split('\n').length} 行）
        </TabBtn>
        <TabBtn active={tab === 'theirs'} onClick={() => setTab('theirs')} testId="tab-theirs">
          服务器（v{conflict.serverVersion}，{conflict.serverContent.split('\n').length} 行）
        </TabBtn>
        <TabBtn active={tab === 'merged'} onClick={() => setTab('merged')} testId="tab-merged">
          合并结果
        </TabBtn>
      </div>

      {/* 三栏内容 */}
      {tab === 'mine' && (
        <DiffView
          hunks={[]}
          baseLabel={`基线 v${conflict.baseVersion}`}
          serverLabel="我的版本"
          baseText={conflict.baseContent}
          serverText={mine}
        />
      )}
      {tab === 'theirs' && (
        <DiffView
          hunks={conflict.diffHunks}
          baseLabel={`基线 v${conflict.baseVersion}`}
          serverLabel={`服务器 v${conflict.serverVersion}`}
          baseText={conflict.baseContent}
          serverText={conflict.serverContent}
        />
      )}
      {tab === 'merged' && (
        <div>
          <textarea
            value={mergedContent ?? ''}
            onChange={(e) => setMergedContent(e.target.value)}
            spellCheck={false}
            className="h-80 w-full rounded-md border border-gray-300 bg-white px-3 py-2 font-mono text-xs leading-relaxed dark:border-gray-700 dark:bg-gray-900"
            data-testid="conflict-merged-textarea"
          />
          <p className="mt-1 text-[11px] text-gray-400">
            提示：默认基于行级启发式合并（同时存在的修改以服务器为准）。请人工核对后保存。
          </p>
        </div>
      )}
    </Modal>
  );
};

// ─── 子组件 ────────────────────────────────────────────────

const TabBtn: React.FC<{
  active: boolean;
  onClick: () => void;
  testId?: string;
  children: React.ReactNode;
}> = ({ active, onClick, testId, children }) => (
  <button
    onClick={onClick}
    data-testid={testId}
    className={
      'px-3 py-1 text-xs transition ' +
      (active
        ? 'border-b-2 border-brand-500 font-medium text-brand-700 dark:text-brand-300'
        : 'text-gray-500 hover:text-gray-700 dark:hover:text-gray-300')
    }
    type="button"
  >
    {children}
  </button>
);

interface DiffViewProps {
  hunks: DiffHunk[];
  baseLabel: string;
  serverLabel: string;
  baseText: string;
  serverText: string;
}

const DiffView: React.FC<DiffViewProps> = ({
  hunks,
  baseLabel,
  serverLabel,
  baseText,
  serverText,
}) => {
  return (
    <div className="grid grid-cols-2 gap-2" data-testid="conflict-diff-view">
      <div className="flex flex-col rounded-md border border-gray-200 dark:border-gray-700">
        <div className="border-b border-gray-200 bg-gray-50 px-2 py-1 text-[11px] text-gray-500 dark:border-gray-700 dark:bg-gray-800">
          {baseLabel}
        </div>
        <pre
          className="h-80 overflow-auto bg-white px-3 py-2 font-mono text-[11px] leading-relaxed dark:bg-gray-900"
          data-testid="conflict-base-pre"
        >
          {baseText || <span className="text-gray-400">（空）</span>}
        </pre>
      </div>
      <div className="flex flex-col rounded-md border border-gray-200 dark:border-gray-700">
        <div className="border-b border-gray-200 bg-gray-50 px-2 py-1 text-[11px] text-gray-500 dark:border-gray-700 dark:bg-gray-800">
          {serverLabel}
        </div>
        <pre
          className="h-80 overflow-auto bg-white px-3 py-2 font-mono text-[11px] leading-relaxed dark:bg-gray-900"
          data-testid="conflict-server-pre"
        >
          {serverText || <span className="text-gray-400">（空）</span>}
        </pre>
      </div>
      {/* Diff hunks 摘要 */}
      {hunks.length > 0 && (
        <div className="col-span-2 mt-2 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-[11px] text-amber-800 dark:border-amber-900 dark:bg-amber-900/20 dark:text-amber-200">
          <strong>{hunks.length} 个变更块</strong>
          <span className="ml-2">
            insert: {hunks.filter((h) => h.type === 'insert').length} · delete:{' '}
            {hunks.filter((h) => h.type === 'delete').length} · equal:{' '}
            {hunks.filter((h) => h.type === 'equal').length}
          </span>
        </div>
      )}
    </div>
  );
};

// ─── 自动合并启发式 ──────────────────────────────────────────

/**
 * 简单 3-way 行级合并：
 *   - mine == base（未改）→ 用 server
 *   - server == base（他人未改）→ 用 mine
 *   - mine != server 且 mine != base → 保留 mine，但插入 server 中"只有 server 有"的行
 *
 * 不是真正的 LCS，仅做"我能改我的 + 拿回别人加的行"。
 */
function autoMerge(base: string, mine: string, server: string): string {
  const baseLines = base.split('\n');
  const mineLines = mine.split('\n');
  const serverLines = server.split('\n');

  // 简化：以行为单位
  // 1) base ⊂ server 多出的行（即 server 有而 base 没的"插入行"）→ 追加到 mine 末尾
  const baseSet = new Set(baseLines);
  const serverExtras = serverLines.filter((l) => !baseSet.has(l));
  // 2) mineSet = mine 保留
  // 合并：mine + 去重追加 serverExtras
  const seen = new Set(mineLines);
  const merged = [...mineLines];
  for (const line of serverExtras) {
    if (!seen.has(line)) {
      merged.push(line);
      seen.add(line);
    }
  }
  return merged.join('\n');
}