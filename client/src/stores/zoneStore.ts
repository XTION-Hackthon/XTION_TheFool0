/**
 * zoneStore — Zone-level state: current zone, walls, obstacles
 * Requirements: 7.4, 7.5, 7.6
 */

import { create } from 'zustand';
import type { Wall, Obstacle } from './collisionStore';

export interface ZoneState {
  currentZoneId: string | null;
  walls: Wall[];
  obstacles: Obstacle[];
  setCurrentZoneId: (zoneId: string) => void;
  setWalls: (walls: Wall[]) => void;
  setObstacles: (obstacles: Obstacle[]) => void;
}

export const useZoneStore = create<ZoneState>((set) => ({
  currentZoneId: null,
  walls: [],
  obstacles: [],
  setCurrentZoneId: (zoneId) => set({ currentZoneId: zoneId }),
  setWalls: (walls) => set({ walls }),
  setObstacles: (obstacles) => set({ obstacles }),
}));
