/**
 * M16 P5/Q10：画布布局 API —— 布局随实体（package / view）持久化到后端。
 *
 * 端点（Q10=A）：
 *   - GET /api/v1/layouts/:kind/:id → { nodes: { "<nodeId>": {x, y} } }
 *   - PUT /api/v1/layouts/:kind/:id   body: { nodes }
 *
 * 设计约定：
 *   - layout 是呈现辅助，不 bump version、不触发协同 409
 *   - 保存失败静默（localStorage 缓存仍在，回落 ELK 自动布局）
 */

import { getApi } from './api';
import type { NodePosition } from '../stores/layoutStore';
import type { EdgeAnchors } from '../lib/edgeAnchor';

export type LayoutEntityKind = 'package' | 'view';

export interface LayoutPayload {
  nodes: Record<string, NodePosition>;
  /**
   * M17 S5：边锚点（edge stableKey → 两端锚点）。
   *
   * 可选字段：后端在 S5 之前存的老数据里没有它，fetch 回来是 undefined，
   * 前端按「空表」处理即可。
   */
  edges?: Record<string, EdgeAnchors>;
}

export const layoutApi = {
  async fetch(kind: LayoutEntityKind, id: string): Promise<LayoutPayload> {
    const api = getApi();
    const { data } = await api.get<LayoutPayload>(`/layouts/${kind}/${id}`);
    return data ?? { nodes: {} };
  },

  /** fire-and-forget 保存；失败静默（呈现辅助不值得打扰用户） */
  async save(
    kind: LayoutEntityKind,
    id: string,
    nodes: Record<string, NodePosition>,
    edges?: Record<string, EdgeAnchors>,
  ): Promise<void> {
    const api = getApi();
    try {
      // edges 为空时干脆不下发：让后端那份 layout 里的旧锚点保持不变，
      // 而不是被一个空对象覆盖掉（本地缓存里可能还有别的有效锚点）。
      await api.put(`/layouts/${kind}/${id}`, edges && Object.keys(edges).length > 0 ? { nodes, edges } : { nodes });
    } catch {
      /* 离线 / 权限降级：localStorage 缓存兜底 */
    }
  },
};
