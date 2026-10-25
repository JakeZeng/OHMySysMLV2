/**
 * 模型评论面板（M9）
 *
 * 显示 scope 下的评论，支持添加 / 删除 / 标记已解决。
 *
 * M19.x 改造说明（把「孤儿组件」接进 UI）：
 *   1. 原实现打的是 `/models/:modelId/comments`（老路由），而后端在 M13 已把
 *      评论泛化成 scope（package:/view:/model:）—— 见
 *      backend/cmd/server/main.go:399-405。M12 之后前端编辑的是包 / 视图，
 *      老路由匹配不到当前实体，评论永远读不出来。现在统一走
 *      services/commentsApi.ts 的 scope 版本接口。
 *   2. 后端评论变化会通过 SSE 广播（commentHandler.go 里的 hub.Publish，
 *      事件类型 comment_added / comment_resolved / comment_removed），
 *      前端 useCollabStream 已把它转成 window 事件 'collab:comments-changed'
 *      （hooks/useCollabStream.ts:105-111）—— 这里监听它自动刷新列表。
 */

import * as React from 'react';
import { MessageSquare, Send, Trash2, Check, Loader2 } from 'lucide-react';
import { useToast } from './ui/Toast';
import { relativeTime } from '../lib/relativeTime';
import { commentsApi, type ModelComment } from '../services/commentsApi';

export interface CommentsPanelProps {
  /**
   * 评论所属作用域：'package:<id>' | 'view:<id>' | 'model:<id>'。
   *
   * 格式见 lib/collab/types.ts 的 makeScope()。
   */
  scope: string;
  /** 点击某条评论时的回调（可跳到对应元素 / 行） */
  onCommentClick?: (comment: ModelComment) => void;
}

/**
 * 纯展示层：评论列表。
 *
 * 单独拆出来是为了**能脱离数据获取单独渲染测试**（本仓前端没有 jsdom /
 * @testing-library，见 frontend/package.json —— 不能引入新依赖，
 * 所以用 react-dom/server 做静态渲染断言）。
 */
export const CommentList: React.FC<{
  comments: ModelComment[];
  onCommentClick?: (comment: ModelComment) => void;
  onResolve: (commentId: string) => void;
  onDelete: (commentId: string) => void;
}> = ({ comments, onCommentClick, onResolve, onDelete }) => {
  if (comments.length === 0) {
    return (
      <div
        className="flex h-24 flex-col items-center justify-center text-gray-400"
        data-testid="comments-empty"
      >
        <MessageSquare className="mb-1 h-6 w-6" />
        <p className="text-xs">暂无评论</p>
      </div>
    );
  }

  return (
    <div className="space-y-3" data-testid="comments-list">
      {comments.map((c) => (
        <div
          key={c.id}
          className={`rounded-lg border p-3 ${
            c.resolved
              ? 'border-green-200 bg-green-50'
              : 'border-gray-200 bg-white'
          }`}
          data-testid="comment-item"
          data-comment-id={c.id}
          onClick={() => onCommentClick?.(c)}
        >
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <span className="text-xs font-medium text-gray-900">{c.username}</span>
              {c.line ? (
                <span className="rounded bg-gray-100 px-1.5 py-0.5 text-[10px] text-gray-500">
                  行 {c.line}
                </span>
              ) : null}
              {c.resolved ? (
                <span className="rounded bg-green-100 px-1.5 py-0.5 text-[10px] text-green-600">
                  已解决
                </span>
              ) : null}
            </div>
            <span className="text-[11px] text-gray-400">
              {relativeTime(c.createdAt)}
            </span>
          </div>
          <p className="mt-1.5 text-xs text-gray-700">{c.content}</p>
          <div className="mt-2 flex gap-1">
            <button
              onClick={(e) => {
                e.stopPropagation();
                onResolve(c.id);
              }}
              className="rounded px-1.5 py-0.5 text-[10px] text-gray-500 hover:bg-gray-100"
              title={c.resolved ? '标记未解决' : '标记已解决'}
              data-testid="comment-resolve"
            >
              <Check className="h-3 w-3" />
            </button>
            <button
              onClick={(e) => {
                e.stopPropagation();
                onDelete(c.id);
              }}
              className="rounded px-1.5 py-0.5 text-[10px] text-red-400 hover:bg-red-50"
              title="删除"
              data-testid="comment-delete"
            >
              <Trash2 className="h-3 w-3" />
            </button>
          </div>
        </div>
      ))}
    </div>
  );
};

export const CommentsPanel: React.FC<CommentsPanelProps> = ({
  scope,
  onCommentClick,
}) => {
  const { showToast } = useToast();

  const [comments, setComments] = React.useState<ModelComment[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [newComment, setNewComment] = React.useState('');
  const [submitting, setSubmitting] = React.useState(false);

  // 加载评论
  const loadComments = React.useCallback(async () => {
    if (!scope) return;
    try {
      const list = await commentsApi.list(scope);
      setComments(list);
    } catch {
      // 静默失败：面板不该把整页打挂（权限不足 / 后端未起都属正常）
      setComments([]);
    } finally {
      setLoading(false);
    }
  }, [scope]);

  React.useEffect(() => {
    void loadComments();
  }, [loadComments]);

  // SSE 推送：别的用户新增 / 解决 / 删除评论时自动刷新
  React.useEffect(() => {
    const onChanged = (e: Event) => {
      const detail = (e as CustomEvent<{ scope?: string }>).detail;
      // 只关心当前 scope 的事件（同一个页面可能开着多个 scope 的订阅）
      if (detail?.scope && detail.scope !== scope) return;
      void loadComments();
    };
    window.addEventListener('collab:comments-changed', onChanged);
    return () => window.removeEventListener('collab:comments-changed', onChanged);
  }, [scope, loadComments]);

  // 添加评论
  const handleSubmit = async () => {
    if (!newComment.trim()) return;
    setSubmitting(true);
    try {
      await commentsApi.add(scope, newComment.trim());
      setNewComment('');
      void loadComments();
    } catch {
      showToast({ title: '添加失败', variant: 'error' });
    } finally {
      setSubmitting(false);
    }
  };

  // 删除评论
  const handleDelete = async (commentId: string) => {
    try {
      await commentsApi.remove(scope, commentId);
      void loadComments();
    } catch {
      showToast({ title: '删除失败', variant: 'error' });
    }
  };

  // 标记已解决 / 未解决
  const handleResolve = async (commentId: string) => {
    try {
      await commentsApi.toggleResolved(scope, commentId);
      void loadComments();
    } catch {
      showToast({ title: '操作失败', variant: 'error' });
    }
  };

  return (
    <div className="flex h-full flex-col" data-testid="comments-panel" data-scope={scope}>
      {/* 标题 */}
      <div className="flex items-center gap-2 border-b border-gray-200 px-3 py-2">
        <MessageSquare className="h-4 w-4 text-gray-500" />
        <h3 className="text-sm font-medium text-gray-900">评论</h3>
        <span className="text-xs text-gray-400" data-testid="comments-count">
          ({comments.length})
        </span>
      </div>

      {/* 评论列表 */}
      <div className="flex-1 overflow-auto p-3">
        {loading ? (
          <div className="flex h-24 items-center justify-center">
            <Loader2 className="h-5 w-5 animate-spin text-gray-400" />
          </div>
        ) : (
          <CommentList
            comments={comments}
            onCommentClick={onCommentClick}
            onResolve={(id) => void handleResolve(id)}
            onDelete={(id) => void handleDelete(id)}
          />
        )}
      </div>

      {/* 输入框 */}
      <div className="border-t border-gray-200 p-3">
        <div className="flex gap-2">
          <input
            type="text"
            value={newComment}
            onChange={(e) => setNewComment(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                void handleSubmit();
              }
            }}
            placeholder="添加评论..."
            data-testid="comment-input"
            className="flex-1 rounded-md border border-gray-300 px-3 py-1.5 text-xs focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
          />
          <button
            onClick={() => void handleSubmit()}
            disabled={submitting || !newComment.trim()}
            data-testid="comment-submit"
            className="rounded-md bg-blue-600 px-2.5 py-1.5 text-white transition hover:bg-blue-700 disabled:opacity-50"
          >
            {submitting ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <Send className="h-3.5 w-3.5" />
            )}
          </button>
        </div>
      </div>
    </div>
  );
};
