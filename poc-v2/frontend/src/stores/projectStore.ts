/**
 * Project Store — 项目列表 + CRUD。
 */

import { create } from 'zustand';
import {
  projectApi,
  type CreateProjectRequest,
  type Project,
  type UpdateProjectRequest,
} from '../services/projectApi';

interface ProjectState {
  list: Project[];
  current: Project | null;
  loading: boolean;
  error: string | null;

  fetch: () => Promise<void>;
  fetchOne: (id: string) => Promise<Project>;
  create: (req: CreateProjectRequest) => Promise<Project>;
  update: (id: string, req: UpdateProjectRequest) => Promise<Project>;
  remove: (id: string) => Promise<void>;
  setCurrent: (p: Project | null) => void;
  clear: () => void;
}

export const useProjectStore = create<ProjectState>((set, get) => ({
  list: [],
  current: null,
  loading: false,
  error: null,

  async fetch() {
    set({ loading: true, error: null });
    try {
      const list = await projectApi.list();
      set({ list, loading: false });
    } catch (e) {
      set({ loading: false, error: (e as Error).message });
      throw e;
    }
  },

  async fetchOne(id) {
    set({ loading: true, error: null });
    try {
      const p = await projectApi.get(id);
      set({ current: p, loading: false });
      return p;
    } catch (e) {
      set({ loading: false, error: (e as Error).message });
      throw e;
    }
  },

  async create(req) {
    set({ loading: true, error: null });
    try {
      const p = await projectApi.create(req);
      set((s) => ({ list: [p, ...s.list], loading: false }));
      return p;
    } catch (e) {
      set({ loading: false, error: (e as Error).message });
      throw e;
    }
  },

  async update(id, req) {
    set({ loading: true, error: null });
    try {
      const p = await projectApi.update(id, req);
      set((s) => ({
        list: s.list.map((x) => (x.id === id ? p : x)),
        current: s.current?.id === id ? p : s.current,
        loading: false,
      }));
      return p;
    } catch (e) {
      set({ loading: false, error: (e as Error).message });
      throw e;
    }
  },

  async remove(id) {
    set({ loading: true, error: null });
    try {
      await projectApi.remove(id);
      set((s) => ({
        list: s.list.filter((x) => x.id !== id),
        current: s.current?.id === id ? null : s.current,
        loading: false,
      }));
    } catch (e) {
      set({ loading: false, error: (e as Error).message });
      throw e;
    }
  },

  setCurrent(p) {
    set({ current: p });
  },

  clear() {
    set({ list: [], current: null, error: null });
    void get();
  },
}));
