/**
 * gameStore — World state (Map, Zones, Contestants, Positions)
 * Requirements: 6 (前端状态管理)
 */

import { create } from 'zustand';
import type { GameMap, Zone, Contestant, Position } from '../../../server/src/types/index';

export interface SpeechBubble {
  content: string;
  expireAt: number; // timestamp ms
}

export interface GameState {
  // Connection state
  connected: boolean;
  authenticated: boolean;

  // World data
  map: GameMap | null;
  zones: Map<string, Zone>;
  contestants: Map<string, Contestant>;

  // Speech bubbles: contestantId → bubble
  speechBubbles: Map<string, SpeechBubble>;

  // Multi-room state
  currentRoomId: string | null;
  roomIds: string[];

  // Actions
  setConnected: (connected: boolean) => void;
  setAuthenticated: (authenticated: boolean) => void;
  setSpeechBubble: (contestantId: string, content: string, durationMs?: number) => void;
  clearSpeechBubble: (contestantId: string) => void;

  // Room actions
  setCurrentRoomId: (roomId: string | null) => void;
  addRoomId: (roomId: string) => void;
  removeRoomId: (roomId: string) => void;
  switchRoom: (roomId: string) => void;

  // world.state — initialize full world state
  initWorldState: (payload: {
    map: GameMap;
    zones: Zone[];
    contestants: Contestant[];
    selfId?: string;
  }) => void;

  // contestant.join
  addContestant: (contestant: Contestant) => void;

  // contestant.leave
  removeContestant: (contestantId: string) => void;

  // contestant.move
  updateContestantPosition: (contestantId: string, position: Position, zoneId: string | null) => void;

  // contestant.status
  updateContestantStatus: (contestantId: string, status: Contestant['status']) => void;

  // vote.update
  updateVotes: (contestantId: string, likes: number, dislikes: number) => void;

  // energy.update
  updateEnergy: (contestantId: string, energy: number) => void;

  // zone.rule.update — zones are refreshed
  updateZone: (zone: Zone) => void;

  reset: () => void;
}

const initialState = {
  connected: false,
  authenticated: false,
  map: null,
  zones: new Map<string, Zone>(),
  contestants: new Map<string, Contestant>(),
  speechBubbles: new Map<string, SpeechBubble>(),
  currentRoomId: null as string | null,
  roomIds: [] as string[],
};

export const useGameStore = create<GameState>((set) => ({
  ...initialState,

  setConnected: (connected) => set({ connected }),
  setAuthenticated: (authenticated) => set({ authenticated }),

  setCurrentRoomId: (roomId) => set({ currentRoomId: roomId }),

  addRoomId: (roomId) =>
    set((state) => {
      if (state.roomIds.includes(roomId)) return {};
      return { roomIds: [...state.roomIds, roomId] };
    }),

  removeRoomId: (roomId) =>
    set((state) => ({
      roomIds: state.roomIds.filter((id) => id !== roomId),
    })),

  switchRoom: (roomId) =>
    set((state) => {
      const roomIds = state.roomIds.includes(roomId)
        ? state.roomIds
        : [...state.roomIds, roomId];
      return { currentRoomId: roomId, roomIds };
    }),

  setSpeechBubble: (contestantId, content, durationMs = 6000) =>
    set((state) => {
      const next = new Map(state.speechBubbles);
      next.set(contestantId, { content, expireAt: Date.now() + durationMs });
      return { speechBubbles: next };
    }),

  clearSpeechBubble: (contestantId) =>
    set((state) => {
      const next = new Map(state.speechBubbles);
      next.delete(contestantId);
      return { speechBubbles: next };
    }),

  initWorldState: ({ map, zones, contestants }) =>
    set({
      map,
      zones: new Map(zones.map((z) => [z.id, z])),
      // Deduplicate contestants by ID (in case server sends duplicates)
      contestants: new Map(contestants.map((c) => [c.id, c])),
      authenticated: true,
    }),

  addContestant: (contestant) =>
    set((state) => {
      const next = new Map(state.contestants);
      next.set(contestant.id, contestant);
      return { contestants: next };
    }),

  removeContestant: (contestantId) =>
    set((state) => {
      const next = new Map(state.contestants);
      const existing = next.get(contestantId);
      if (existing) {
        next.set(contestantId, { ...existing, status: 'offline' });
      }
      return { contestants: next };
    }),

  updateContestantPosition: (contestantId, position, zoneId) =>
    set((state) => {
      const existing = state.contestants.get(contestantId);
      if (!existing) return {};
      const next = new Map(state.contestants);
      next.set(contestantId, { ...existing, position, currentZoneId: zoneId });
      return { contestants: next };
    }),

  updateContestantStatus: (contestantId, status) =>
    set((state) => {
      const existing = state.contestants.get(contestantId);
      if (!existing) return {};
      const next = new Map(state.contestants);
      next.set(contestantId, { ...existing, status });
      return { contestants: next };
    }),

  updateVotes: (_contestantId, _likes, _dislikes) => {
    // votes are stored in uiStore / displayed in AttributePanel; no-op here
  },

  updateEnergy: (contestantId, energy) =>
    set((state) => {
      const existing = state.contestants.get(contestantId);
      if (!existing) return {};
      const next = new Map(state.contestants);
      next.set(contestantId, { ...existing, energy });
      return { contestants: next };
    }),

  updateZone: (zone) =>
    set((state) => {
      const next = new Map(state.zones);
      next.set(zone.id, zone);
      return { zones: next };
    }),

  reset: () => set(initialState),
}));
