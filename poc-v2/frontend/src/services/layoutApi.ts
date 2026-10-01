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

export type LayoutEntityKind = 'package' | 'view';

export interface LayoutPayload {
  nodes: Record<string, NodePosition>;
}

export const layoutApi = {
  async fetch(kind: LayoutEntityKind, id: string): Promise<LayoutPayload> {
    const api = getApi();
    const { data } = await api.get<LayoutPayload>(`/layouts/${kind}/${id}`);
    return data ?? { nodes: {} };
  },

  /** fire-and-forget 保存；失败静默（呈现辅助不值得打扰用户） */
  async save(kind: LayoutEntityKind, id: string, nodes: Record<string, NodePosition>): Promise<void> {
    const api = getApi();
    try {
      await api.put(`/layouts/${kind}/${id}`, { nodes });
    } catch {
      /* 离线 / 权限降级：localStorage 缓存兜底 */
    }
  },
};
