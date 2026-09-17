/**
 * Team Store — 我所在的团队列表 + 当前团队详情。
 */

import { create } from 'zustand';
import {
  teamApi,
  type Team,
  type TeamMember,
  type TeamProjectAccess,
} from '../services/teamApi';

interface TeamState {
  list: Team[];
  loading: boolean;
  error: string | null;

  currentTeam: Team | null;
  members: TeamMember[];
  projectAccess: TeamProjectAccess[];

  fetch: () => Promise<void>;
  fetchOne: (id: string) => Promise<Team>;
  fetchMembers: (teamId: string) => Promise<void>;
  fetchProjectAccess: (teamId: string) => Promise<void>;
  create: (req: { name: string; description?: string }) => Promise<Team>;
  update: (id: string, req: { name: string; description?: string }) => Promise<Team>;
  remove: (id: string) => Promise<void>;
  clearCurrent: () => void;
}

export const useTeamStore = create<TeamState>((set) => ({
  list: [],
  loading: false,
  error: null,
  currentTeam: null,
  members: [],
  projectAccess: [],

  async fetch() {
    set({ loading: true, error: null });
    try {
      const list = await teamApi.list();
      set({ list, loading: false });
    } catch (e) {
      set({ loading: false, error: (e as Error).message });
      throw e;
    }
  },

  async fetchOne(id) {
    const t = await teamApi.get(id);
    set({ currentTeam: t });
    return t;
  },

  async fetchMembers(teamId) {
    const members = await teamApi.listMembers(teamId);
    set({ members });
  },

  async fetchProjectAccess(teamId) {
    const projectAccess = await teamApi.listProjectAccess(teamId);
    set({ projectAccess });
  },

  async create(req) {
    const t = await teamApi.create(req);
    set((s) => ({ list: [t, ...s.list] }));
    return t;
  },

  async update(id, req) {
    const t = await teamApi.update(id, req);
    set((s) => ({
      list: s.list.map((x) => (x.id === id ? t : x)),
      currentTeam: s.currentTeam?.id === id ? t : s.currentTeam,
    }));
    return t;
  },

  async remove(id) {
    await teamApi.remove(id);
    set((s) => ({
      list: s.list.filter((x) => x.id !== id),
      currentTeam: s.currentTeam?.id === id ? null : s.currentTeam,
    }));
  },

  clearCurrent() {
    set({ currentTeam: null, members: [], projectAccess: [] });
  },
}));
