/**
 * roleStore — Zustand store for the current user's RBAC role.
 *
 * Fetches role info from GET /api/auth/me after WebSocket connection succeeds.
 * Requirements: 7.1, 7.2, 7.3, 7.4, 7.5
 */

import { create } from 'zustand';
import { apiClient } from '../services/api-client';

export type Role = 'Admin' | 'Agent_Player' | 'Human_Viewer' | 'Agent_Viewer';

interface RoleState {
  role: Role | null;
  keyId: string | null;
  contestantId: string | null;
  loading: boolean;
  fetchRole: () => Promise<void>;
}

export const useRoleStore = create<RoleState>((set) => ({
  role: null,
  keyId: null,
  contestantId: null,
  loading: false,
  fetchRole: async () => {
    set({ loading: true });
    try {
      const data = await apiClient.get<{ role: Role; keyId: string; contestantId: string | null }>(
        '/api/auth/me',
      );
      set({ role: data.role, keyId: data.keyId, contestantId: data.contestantId });
    } catch {
      // ignore — role stays null, UI will show nothing role-specific
    } finally {
      set({ loading: false });
    }
  },
}));
