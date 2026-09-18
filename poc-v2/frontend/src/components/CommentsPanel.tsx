/**
 * 模型评论面板
 *
 * 显示模型上的评论，支持添加/删除/标记已解决
 */

import * as React from 'react';
import { MessageSquare, Send, Trash2, Check, Loader2 } from 'lucide-react';
import { useToast } from './ui/Toast';
import { relativeTime } from '../lib/relativeTime';
import axios from 'axios';

const api = axios.create({ baseURL: '/api/v1', withCredentials: true });

interface Comment {
  id: string;
  modelId: string;
  userId: string;
  username: string;
  elementId?: string;
  line?: number;
  content: string;
  resolved: boolean;
  createdAt: string;
  updatedAt: string;
}

interface CommentsPanelProps {
  modelId: string;
  onCommentClick?: (comment: Comment) => void;
}

export const CommentsPanel: React.FC<CommentsPanelProps> = ({ modelId, onCommentClick }) => {
  const { showToast } = useToast();

  const [comments, setComments] = React.useState<Comment[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [newComment, setNewComment] = React.useState('');
  const [submitting, setSubmitting] = React.useState(false);

  // 加载评论
  const loadComments = React.useCallback(async () => {
    try {
      const { data } = await api.get<{ data: Comment[] }>(`/models/${modelId}/comments`);
      setComments(data.data ?? []);
    } catch {
      // silent
    } finally {
      setLoading(false);
    }
  }, [modelId]);

  React.useEffect(() => {
    void loadComments();
  }, [loadComments]);

  // 添加评论
  const handleSubmit = async () => {
    if (!newComment.trim()) return;
    setSubmitting(true);
    try {
      await api.post(`/models/${modelId}/comments`, {
        content: newComment.trim(),
      });
      setNewComment('');
      void loadComments();
    } catch (e: any) {
      showToast({ title: '添加失败', variant: 'error' });
    } finally {
      setSubmitting(false);
    }
  };

  // 删除评论
  const handleDelete = async (commentId: string) => {
    try {
      await api.delete(`/models/${modelId}/comments/${commentId}`);
      void loadComments();
    } catch {
      showToast({ title: '删除失败', variant: 'error' });
    }
  };

  // 标记已解决
  const handleResolve = async (commentId: string) => {
    try {
      await api.put(`/models/${modelId}/comments/${commentId}/resolve`);
      void loadComments();
    } catch {
      showToast({ title: '操作失败', variant: 'error' });
    }
  };

  return (
    <div className="flex h-full flex-col">
      {/* 标题 */}
      <div className="flex items-center gap-2 border-b border-gray-200 px-3 py-2">
        <MessageSquare className="h-4 w-4 text-gray-500" />
        <h3 className="text-sm font-medium text-gray-900">评论</h3>
        <span className="text-xs text-gray-400">({comments.length})</span>
      </div>

      {/* 评论列表 */}
      <div className="flex-1 overflow-auto p-3">
        {loading ? (
          <div className="flex h-24 items-center justify-center">
            <Loader2 className="h-5 w-5 animate-spin text-gray-400" />
          </div>
        ) : comments.length === 0 ? (
          <div className="flex h-24 flex-col items-center justify-center text-gray-400">
            <MessageSquare className="mb-1 h-6 w-6" />
            <p className="text-xs">暂无评论</p>
          </div>
        ) : (
          <div className="space-y-3">
            {comments.map((c) => (
              <div
                key={c.id}
                className={`rounded-lg border p-3 ${
                  c.resolved
                    ? 'border-green-200 bg-green-50'
                    : 'border-gray-200 bg-white'
                }`}
                onClick={() => onCommentClick?.(c)}
              >
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-medium text-gray-900">
                      {c.username}
                    </span>
                    {c.line && (
                      <span className="rounded bg-gray-100 px-1.5 py-0.5 text-[10px] text-gray-500">
                        行 {c.line}
                      </span>
                    )}
                    {c.resolved && (
                      <span className="rounded bg-green-100 px-1.5 py-0.5 text-[10px] text-green-600">
                        已解决
                      </span>
                    )}
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
                      void handleResolve(c.id);
                    }}
                    className="rounded px-1.5 py-0.5 text-[10px] text-gray-500 hover:bg-gray-100"
                    title={c.resolved ? '标记未解决' : '标记已解决'}
                  >
                    <Check className="h-3 w-3" />
                  </button>
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      void handleDelete(c.id);
                    }}
                    className="rounded px-1.5 py-0.5 text-[10px] text-red-400 hover:bg-red-50"
                    title="删除"
                  >
                    <Trash2 className="h-3 w-3" />
                  </button>
                </div>
              </div>
            ))}
          </div>
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
            className="flex-1 rounded-md border border-gray-300 px-3 py-1.5 text-xs focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
          />
          <button
            onClick={() => void handleSubmit()}
            disabled={submitting || !newComment.trim()}
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
