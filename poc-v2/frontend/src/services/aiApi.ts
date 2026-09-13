/**
 * AI 语法检查 API 客户端（M2）
 *
 * 支持：
 *   - 非流式检查（POST /ai/check）
 *   - 流式检查（POST /ai/check/stream）—— SSE
 */

import { getApi } from './api';

export interface AIIssue {
  line: number;
  column: number;
  severity: 'error' | 'warning';
  code: string;
  message: string;
}

export interface AICheckResult {
  issues: AIIssue[];
  raw: string;
}

/**
 * 非流式 AI 语法检查。
 */
export async function checkSyntax(content: string): Promise<AICheckResult> {
  const api = getApi();
  const { data } = await api.post<AICheckResult>('/ai/check', { content });
  return data;
}

export interface StreamCallbacks {
  onChunk?: (chunk: string) => void;
  onDone?: (issues: AIIssue[]) => void;
  onError?: (error: string) => void;
}

/**
 * 流式 AI 语法检查（SSE）。
 * 返回一个 AbortController，调用 abort() 可取消请求。
 */
export function checkSyntaxStream(
  content: string,
  callbacks: StreamCallbacks,
  signal?: AbortSignal
): AbortController {
  const controller = new AbortController();
  const combinedSignal = signal
    ? combineSignals(signal, controller.signal)
    : controller.signal;

  const api = getApi();
  const baseURL = (api.defaults?.baseURL ?? '').replace(/\/+$/, '');
  const token = localStorage.getItem('token');

  fetch(`${baseURL}/ai/check/stream`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify({ content }),
    signal: combinedSignal,
  })
    .then(async (resp) => {
      if (!resp.ok) {
        const errText = await resp.text();
        callbacks.onError?.(`AI 服务返回 ${resp.status}: ${errText}`);
        return;
      }

      const reader = resp.body?.getReader();
      if (!reader) {
        callbacks.onError?.('无法读取流式响应');
        return;
      }

      const decoder = new TextDecoder();
      let buffer = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() ?? '';

        for (const line of lines) {
          if (!line.startsWith('data: ')) continue;
          const data = line.slice(6).trim();
          if (!data) continue;

          try {
            const parsed = JSON.parse(data) as
              | { type: 'chunk'; content: string }
              | { type: 'done'; issues: AIIssue[] }
              | { type: 'error'; message: string };

            switch (parsed.type) {
              case 'chunk':
                callbacks.onChunk?.(parsed.content);
                break;
              case 'done':
                callbacks.onDone?.(parsed.issues ?? []);
                return;
              case 'error':
                callbacks.onError?.(parsed.message);
                return;
            }
          } catch {
            // skip malformed JSON
          }
        }
      }
    })
    .catch((err) => {
      if ((err as Error).name !== 'AbortError') {
        callbacks.onError?.((err as Error).message);
      }
    });

  return controller;
}

/** Combine two AbortSignals — fires when either fires. */
function combineSignals(s1: AbortSignal, s2: AbortSignal): AbortSignal {
  const controller = new AbortController();
  const onAbort = () => controller.abort();
  if (s1.aborted || s2.aborted) {
    controller.abort();
    return controller.signal;
  }
  s1.addEventListener('abort', onAbort, { once: true });
  s2.addEventListener('abort', onAbort, { once: true });
  return controller.signal;
}
