/**
 * collisionStore — Collision detection state management (Zustand)
 * Requirements: 3, 4, 5, 8
 */

import { create } from 'zustand';
import type { Bot, Wall } from './roomStore';

export interface CollisionBox {
  botId: string;
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface CollisionEvent {
  type: 'bot-bot' | 'bot-wall';
  botId: string;
  targetId?: string;
  position: { x: number; y: number };
  timestamp: number;
}

export interface SpatialGrid {
  cellSize: number;
  cells: Record<string, string[]>; // cellKey -> botIds
}

const DEFAULT_BOT_SIZE = { width: 32, height: 32 };
const GRID_CELL_SIZE = 64;
const MAX_COLLISION_EVENTS = 100;

/** Compute the grid cell key for a given world position */
function getCellKey(x: number, y: number, cellSize: number): string {
  const cx = Math.floor(x / cellSize);
  const cy = Math.floor(y / cellSize);
  return `${cx},${cy}`;
}

/** AABB overlap check — centers at (ax,ay) and (bx,by) with half-extents */
function aabbOverlap(
  ax: number, ay: number, aw: number, ah: number,
  bx: number, by: number, bw: number, bh: number,
): boolean {
  return Math.abs(ax - bx) < (aw / 2 + bw / 2) && Math.abs(ay - by) < (ah / 2 + bh / 2);
}

export interface CollisionState {
  collisions: CollisionEvent[];
  spatialGrids: Record<string, SpatialGrid>; // roomId -> grid

  checkCollision(
    roomId: string,
    position: { x: number; y: number },
    size: { width: number; height: number },
    excludeBotId: string | undefined,
    walls: Wall[],
    bots: Bot[],
  ): CollisionEvent | null;

  updateSpatialIndex(roomId: string, bots: Bot[]): void;

  getNearbyBots(
    roomId: string,
    position: { x: number; y: number },
    radius: number,
  ): string[];

  getWallsInArea(
    walls: Wall[],
    bounds: { x1: number; y1: number; x2: number; y2: number },
  ): Wall[];

  addCollisionEvent(event: CollisionEvent): void;
  clearCollisions(): void;
}

export const useCollisionStore = create<CollisionState>((set, get) => ({
  collisions: [],
  spatialGrids: {},

  checkCollision(roomId, position, size, excludeBotId, walls, bots) {
    const { spatialGrids } = get();
    const grid = spatialGrids[roomId];

    // --- Bot-bot collision ---
    const candidateBotIds = new Set<string>();

    if (grid) {
      // Collect candidate cells that overlap the query box
      const halfW = size.width / 2;
      const halfH = size.height / 2;
      const x1 = position.x - halfW;
      const y1 = position.y - halfH;
      const x2 = position.x + halfW;
      const y2 = position.y + halfH;

      const cellX1 = Math.floor(x1 / grid.cellSize);
      const cellY1 = Math.floor(y1 / grid.cellSize);
      const cellX2 = Math.floor(x2 / grid.cellSize);
      const cellY2 = Math.floor(y2 / grid.cellSize);

      for (let cx = cellX1; cx <= cellX2; cx++) {
        for (let cy = cellY1; cy <= cellY2; cy++) {
          const key = `${cx},${cy}`;
          const ids = grid.cells[key];
          if (ids) ids.forEach((id) => candidateBotIds.add(id));
        }
      }
    } else {
      // No grid yet — check all bots
      bots.forEach((b) => candidateBotIds.add(b.id));
    }

    for (const botId of candidateBotIds) {
      if (botId === excludeBotId) continue;
      const bot = bots.find((b) => b.id === botId);
      if (!bot) continue;

      const bw = bot.collisionBox?.width ?? DEFAULT_BOT_SIZE.width;
      const bh = bot.collisionBox?.height ?? DEFAULT_BOT_SIZE.height;

      if (aabbOverlap(position.x, position.y, size.width, size.height, bot.position.x, bot.position.y, bw, bh)) {
        return {
          type: 'bot-bot',
          botId: excludeBotId ?? '',
          targetId: botId,
          position,
          timestamp: Date.now(),
        };
      }
    }

    // --- Bot-wall collision ---
    for (const wall of walls) {
      if (wall.roomId !== roomId) continue;
      // Wall position is top-left corner; convert to center for AABB
      const wallCx = wall.x + wall.width / 2;
      const wallCy = wall.y + wall.height / 2;

      if (aabbOverlap(position.x, position.y, size.width, size.height, wallCx, wallCy, wall.width, wall.height)) {
        return {
          type: 'bot-wall',
          botId: excludeBotId ?? '',
          targetId: wall.id,
          position,
          timestamp: Date.now(),
        };
      }
    }

    return null;
  },

  updateSpatialIndex(roomId, bots) {
    const cells: Record<string, string[]> = {};

    for (const bot of bots) {
      const key = getCellKey(bot.position.x, bot.position.y, GRID_CELL_SIZE);
      if (!cells[key]) cells[key] = [];
      cells[key].push(bot.id);
    }

    set((state) => ({
      spatialGrids: {
        ...state.spatialGrids,
        [roomId]: { cellSize: GRID_CELL_SIZE, cells },
      },
    }));
  },

  getNearbyBots(roomId, position, radius) {
    const { spatialGrids } = get();
    const grid = spatialGrids[roomId];
    if (!grid) return [];

    const cellRadius = Math.ceil(radius / grid.cellSize);
    const centerCx = Math.floor(position.x / grid.cellSize);
    const centerCy = Math.floor(position.y / grid.cellSize);

    const result = new Set<string>();

    for (let cx = centerCx - cellRadius; cx <= centerCx + cellRadius; cx++) {
      for (let cy = centerCy - cellRadius; cy <= centerCy + cellRadius; cy++) {
        const key = `${cx},${cy}`;
        const ids = grid.cells[key];
        if (ids) ids.forEach((id) => result.add(id));
      }
    }

    return Array.from(result);
  },

  getWallsInArea(walls, bounds) {
    return walls.filter((wall) => {
      const wallX2 = wall.x + wall.width;
      const wallY2 = wall.y + wall.height;
      // AABB overlap between wall rect and query bounds
      return wall.x < bounds.x2 && wallX2 > bounds.x1 && wall.y < bounds.y2 && wallY2 > bounds.y1;
    });
  },

  addCollisionEvent(event) {
    set((state) => {
      const next = [event, ...state.collisions];
      return { collisions: next.slice(0, MAX_COLLISION_EVENTS) };
    });
  },

  clearCollisions() {
    set({ collisions: [] });
  },
}));
