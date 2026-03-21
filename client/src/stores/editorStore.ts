/**
 * editorStore — Map editor state management (Zustand)
 * Requirements: 6, 7
 */

import { create } from 'zustand';
import type { Wall, SpawnPoint } from './roomStore';
import type { Doorway } from './doorwayStore';

export interface EditorState {
  editingRoomId: string | null;
  selectedTool: 'select' | 'wall' | 'spawn' | 'boundary' | 'doorway';
  selectedObjectId: string | null;
  walls: Wall[];
  spawnPoints: SpawnPoint[];
  doorways: Doorway[];
  isDirty: boolean;
  validationErrors: string[];

  startEditing(roomId: string, initialWalls?: Wall[], initialSpawnPoints?: SpawnPoint[], initialDoorways?: Doorway[]): void;
  stopEditing(): void;

  addWall(wall: Wall): void;
  removeWall(wallId: string): void;
  updateWall(wallId: string, updates: Partial<Wall>): void;

  addSpawnPoint(point: SpawnPoint): void;
  removeSpawnPoint(pointId: string): void;

  addDoorway(doorway: Doorway): void;
  removeDoorway(doorwayId: string): void;
  updateDoorway(doorwayId: string, updates: Partial<Doorway>): void;

  setSelectedTool(tool: 'select' | 'wall' | 'spawn' | 'boundary' | 'doorway'): void;
  setSelectedObject(id: string | null): void;

  validateConfiguration(): { valid: boolean; errors: string[] };
  saveConfiguration(
    apiBaseUrl: string,
    authToken: string
  ): Promise<{ success: boolean; version?: number; errors?: string[] }>;
}

export const useEditorStore = create<EditorState>((set, get) => ({
  editingRoomId: null,
  selectedTool: 'select',
  selectedObjectId: null,
  walls: [],
  spawnPoints: [],
  doorways: [],
  isDirty: false,
  validationErrors: [],

  startEditing: (roomId, initialWalls = [], initialSpawnPoints = [], initialDoorways = []) =>
    set({
      editingRoomId: roomId,
      walls: initialWalls,
      spawnPoints: initialSpawnPoints,
      doorways: initialDoorways,
      isDirty: false,
      validationErrors: [],
      selectedObjectId: null,
      selectedTool: 'select',
    }),

  stopEditing: () =>
    set({
      editingRoomId: null,
      walls: [],
      spawnPoints: [],
      doorways: [],
      isDirty: false,
      validationErrors: [],
      selectedObjectId: null,
      selectedTool: 'select',
    }),

  addWall: (wall) =>
    set((state) => ({
      walls: [...state.walls, wall],
      isDirty: true,
    })),

  removeWall: (wallId) =>
    set((state) => ({
      walls: state.walls.filter((w) => w.id !== wallId),
      isDirty: true,
    })),

  updateWall: (wallId, updates) =>
    set((state) => ({
      walls: state.walls.map((w) => (w.id === wallId ? { ...w, ...updates } : w)),
      isDirty: true,
    })),

  addSpawnPoint: (point) =>
    set((state) => ({
      spawnPoints: [...state.spawnPoints, point],
      isDirty: true,
    })),

  removeSpawnPoint: (pointId) =>
    set((state) => ({
      spawnPoints: state.spawnPoints.filter((p) => p.id !== pointId),
      isDirty: true,
    })),

  addDoorway: (doorway) =>
    set((state) => ({
      doorways: [...state.doorways, doorway],
      isDirty: true,
    })),

  removeDoorway: (doorwayId) =>
    set((state) => ({
      doorways: state.doorways.filter((d) => d.id !== doorwayId),
      isDirty: true,
    })),

  updateDoorway: (doorwayId, updates) =>
    set((state) => ({
      doorways: state.doorways.map((d) => (d.id === doorwayId ? { ...d, ...updates } : d)),
      isDirty: true,
    })),

  setSelectedTool: (tool) => set({ selectedTool: tool }),

  setSelectedObject: (id) => set({ selectedObjectId: id }),

  validateConfiguration: () => {
    const { walls, spawnPoints } = get();
    const errors: string[] = [];

    for (const wall of walls) {
      if (wall.width <= 0) {
        errors.push(`Wall ${wall.id}: width must be positive (got ${wall.width})`);
      }
      if (wall.height <= 0) {
        errors.push(`Wall ${wall.id}: height must be positive (got ${wall.height})`);
      }
    }

    for (const point of spawnPoints) {
      if (typeof point.x !== 'number' || !isFinite(point.x)) {
        errors.push(`SpawnPoint ${point.id}: x must be a valid number`);
      }
      if (typeof point.y !== 'number' || !isFinite(point.y)) {
        errors.push(`SpawnPoint ${point.id}: y must be a valid number`);
      }
    }

    const valid = errors.length === 0;
    set({ validationErrors: errors });
    return { valid, errors };
  },

  saveConfiguration: async (apiBaseUrl, authToken) => {
    const { editingRoomId, walls, spawnPoints, validateConfiguration } = get();

    if (!editingRoomId) {
      return { success: false, errors: ['No room is currently being edited'] };
    }

    const { valid, errors } = validateConfiguration();
    if (!valid) {
      return { success: false, errors };
    }

    try {
      const response = await fetch(
        `${apiBaseUrl}/api/map-editor/rooms/${editingRoomId}/config`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${authToken}`,
          },
          body: JSON.stringify({ walls, spawnPoints }),
        }
      );

      if (!response.ok) {
        const body = (await response.json().catch(() => ({}))) as { error?: string };
        return { success: false, errors: [body.error ?? `HTTP ${response.status}`] };
      }

      const data = (await response.json()) as { version?: number };
      set({ isDirty: false });
      return { success: true, version: data.version };
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Network error';
      return { success: false, errors: [message] };
    }
  },
}));
