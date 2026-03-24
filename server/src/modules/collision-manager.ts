// =============================================================================
// XTION_TheFool0 — CollisionManager 模块（Zone 级别）
// Requirements: 3, 4, 5, 8
// =============================================================================

import { worldManager } from './world-manager';
import type { Position, Wall, Obstacle } from '../types';

// =============================================================================
// Constants
// =============================================================================

/** Default bot collision box size (pixels) — matches ghost sprite 20×20 */
const BOT_SIZE = { width: 20, height: 20 };

/** Spatial index grid cell size (pixels) */
const GRID_CELL_SIZE = 128;

// =============================================================================
// Types
// =============================================================================

interface ValidationResult {
  valid: boolean;
  error?: string;
  collisionType?: 'bot' | 'wall';
  collidedWith?: string;
}

interface CollisionInfo {
  hasCollision: boolean;
  type?: 'bot' | 'wall';
  position?: Position;
  targetId?: string;
}

// =============================================================================
// AABB Helpers
// =============================================================================

function aabbOverlap(
  ax: number, ay: number, aw: number, ah: number,
  bx: number, by: number, bw: number, bh: number,
): boolean {
  return (
    Math.abs(ax - bx) < (aw / 2 + bw / 2) &&
    Math.abs(ay - by) < (ah / 2 + bh / 2)
  );
}

function cellKey(col: number, row: number): string {
  return `${col},${row}`;
}

function posToCell(x: number, y: number): { col: number; row: number } {
  return {
    col: Math.floor(x / GRID_CELL_SIZE),
    row: Math.floor(y / GRID_CELL_SIZE),
  };
}

// =============================================================================
// CollisionManager Implementation
// =============================================================================

class CollisionManager {
  /**
   * Spatial index: zoneId -> cellKey -> botIds[]
   */
  private spatialIndex: Map<string, Map<string, string[]>> = new Map();

  /**
   * Collision result cache: cacheKey -> { result, ts }
   * Cache TTL: 100ms.
   */
  private _collisionCache: Map<string, { result: ValidationResult; ts: number }> = new Map();

  /** Track which cache keys belong to each zone for efficient invalidation */
  private _zoneCacheKeys: Map<string, Set<string>> = new Map();

  // ---------------------------------------------------------------------------
  // Collision Detection
  // ---------------------------------------------------------------------------

  /**
   * Check if targetPos overlaps with any bot in the zone (excluding the moving bot).
   * Bot positions are fetched from the contestants table via worldManager.
   */
  checkBotCollision(zoneId: string, botId: string, targetPos: Position): boolean {
    const botIds = worldManager.getContestantsInZone(zoneId);

    for (const candidateId of botIds) {
      if (candidateId === botId) continue;
      let pos: Position;
      try {
        // getPosition is async but we need sync here — use cached position from DB
        const row = (worldManager as unknown as { _getBotPositionSync?: (id: string) => Position | null })
          ._getBotPositionSync?.(candidateId);
        if (!row) continue;
        pos = row;
      } catch {
        continue;
      }

      if (
        aabbOverlap(
          targetPos.x, targetPos.y, BOT_SIZE.width, BOT_SIZE.height,
          pos.x, pos.y, BOT_SIZE.width, BOT_SIZE.height,
        )
      ) {
        return true;
      }
    }

    return false;
  }

  /**
   * Check if targetPos overlaps with any wall in the zone.
   */
  checkWallCollision(
    zoneId: string,
    targetPos: Position,
    size: { width: number; height: number },
  ): boolean {
    const walls = worldManager.getZoneWalls(zoneId);

    for (const wall of walls) {
      const wallCenterX = wall.x + wall.width / 2;
      const wallCenterY = wall.y + wall.height / 2;

      if (
        aabbOverlap(
          targetPos.x, targetPos.y, size.width, size.height,
          wallCenterX, wallCenterY, wall.width, wall.height,
        )
      ) {
        return true;
      }
    }

    return false;
  }

  /**
   * Check if targetPos overlaps with any obstacle in the zone.
   */
  checkObstacleCollision(
    zoneId: string,
    targetPos: Position,
    size: { width: number; height: number },
  ): boolean {
    const obstacles = worldManager.getZoneObstacles(zoneId);

    for (const obs of obstacles) {
      const obsCenterX = obs.x + obs.width / 2;
      const obsCenterY = obs.y + obs.height / 2;

      if (
        aabbOverlap(
          targetPos.x, targetPos.y, size.width, size.height,
          obsCenterX, obsCenterY, obs.width, obs.height,
        )
      ) {
        return true;
      }
    }

    return false;
  }

  /**
   * Validate a movement: bot collision → wall collision → obstacle collision.
   * Uses a 100ms result cache keyed by zoneId:botId:x,y.
   */
  validateMovement(zoneId: string, botId: string, targetPos: Position): ValidationResult {
    const cacheKey = `${zoneId}:${botId}:${targetPos.x},${targetPos.y}`;
    const now = Date.now();
    const cached = this._collisionCache.get(cacheKey);
    if (cached && now - cached.ts < 100) {
      return cached.result;
    }

    // 1. Bot collision
    if (this.checkBotCollision(zoneId, botId, targetPos)) {
      const result: ValidationResult = {
        valid: false,
        error: 'Movement blocked: collision with another bot',
        collisionType: 'bot',
      };
      this._setCacheEntry(zoneId, cacheKey, result, now);
      return result;
    }

    // 2. Wall collision
    if (this.checkWallCollision(zoneId, targetPos, BOT_SIZE)) {
      const collidedWallId = this._findCollidingWall(zoneId, targetPos, BOT_SIZE);
      const result: ValidationResult = {
        valid: false,
        error: 'Movement blocked: collision with wall',
        collisionType: 'wall',
        collidedWith: collidedWallId ?? undefined,
      };
      this._setCacheEntry(zoneId, cacheKey, result, now);
      return result;
    }

    // 3. Obstacle collision
    if (this.checkObstacleCollision(zoneId, targetPos, BOT_SIZE)) {
      const collidedObsId = this._findCollidingObstacle(zoneId, targetPos, BOT_SIZE);
      const result: ValidationResult = {
        valid: false,
        error: 'Movement blocked: collision with obstacle',
        collisionType: 'wall',
        collidedWith: collidedObsId ?? undefined,
      };
      this._setCacheEntry(zoneId, cacheKey, result, now);
      return result;
    }

    const result: ValidationResult = { valid: true };
    this._setCacheEntry(zoneId, cacheKey, result, now);
    return result;
  }

  // ---------------------------------------------------------------------------
  // Spatial Index
  // ---------------------------------------------------------------------------

  /**
   * Rebuild the grid index for a zone from current bot positions.
   */
  updateSpatialIndex(zoneId: string, bots: Array<{ botId: string; x: number; y: number }>): void {
    this._clearZoneCache(zoneId);

    const grid: Map<string, string[]> = new Map();

    for (const bot of bots) {
      const { col, row } = posToCell(bot.x, bot.y);
      const key = cellKey(col, row);
      const cell = grid.get(key);
      if (cell) {
        cell.push(bot.botId);
      } else {
        grid.set(key, [bot.botId]);
      }
    }

    this.spatialIndex.set(zoneId, grid);
  }

  /**
   * Query bots within radius using the spatial index.
   */
  getNearbyBots(
    zoneId: string,
    position: Position,
    radius: number,
    bots: Array<{ botId: string; x: number; y: number }>,
  ): string[] {
    const grid = this.spatialIndex.get(zoneId);
    if (!grid) return [];

    const minCol = Math.floor((position.x - radius) / GRID_CELL_SIZE);
    const maxCol = Math.floor((position.x + radius) / GRID_CELL_SIZE);
    const minRow = Math.floor((position.y - radius) / GRID_CELL_SIZE);
    const maxRow = Math.floor((position.y + radius) / GRID_CELL_SIZE);

    const botMap = new Map(bots.map((b) => [b.botId, b]));
    const result: string[] = [];
    const radiusSq = radius * radius;

    for (let col = minCol; col <= maxCol; col++) {
      for (let row = minRow; row <= maxRow; row++) {
        const botIds = grid.get(cellKey(col, row));
        if (!botIds) continue;

        for (const botId of botIds) {
          const bot = botMap.get(botId);
          if (!bot) continue;

          const dx = bot.x - position.x;
          const dy = bot.y - position.y;
          if (dx * dx + dy * dy <= radiusSq) {
            result.push(botId);
          }
        }
      }
    }

    return result;
  }

  // ---------------------------------------------------------------------------
  // Collision Info
  // ---------------------------------------------------------------------------

  getCollisionInfo(zoneId: string, botId: string, targetPos: Position): CollisionInfo {
    // Check wall collision
    const collidedWall = this._findCollidingWallObject(zoneId, targetPos, BOT_SIZE);
    if (collidedWall !== null) {
      return {
        hasCollision: true,
        type: 'wall',
        position: { x: collidedWall.x, y: collidedWall.y },
        targetId: collidedWall.id,
      };
    }

    // Check obstacle collision
    const collidedObs = this._findCollidingObstacleObject(zoneId, targetPos, BOT_SIZE);
    if (collidedObs !== null) {
      return {
        hasCollision: true,
        type: 'wall',
        position: { x: collidedObs.x, y: collidedObs.y },
        targetId: collidedObs.id,
      };
    }

    return { hasCollision: false };
  }

  // ---------------------------------------------------------------------------
  // Private Helpers
  // ---------------------------------------------------------------------------

  private _setCacheEntry(zoneId: string, cacheKey: string, result: ValidationResult, ts: number): void {
    this._collisionCache.set(cacheKey, { result, ts });
    let keys = this._zoneCacheKeys.get(zoneId);
    if (!keys) {
      keys = new Set();
      this._zoneCacheKeys.set(zoneId, keys);
    }
    keys.add(cacheKey);
  }

  private _clearZoneCache(zoneId: string): void {
    const keys = this._zoneCacheKeys.get(zoneId);
    if (!keys) return;
    for (const key of keys) {
      this._collisionCache.delete(key);
    }
    keys.clear();
  }

  private _findCollidingWall(
    zoneId: string,
    targetPos: Position,
    size: { width: number; height: number },
  ): string | null {
    const wall = this._findCollidingWallObject(zoneId, targetPos, size);
    return wall ? wall.id : null;
  }

  private _findCollidingWallObject(
    zoneId: string,
    targetPos: Position,
    size: { width: number; height: number },
  ): Wall | null {
    const walls = worldManager.getZoneWalls(zoneId);

    for (const wall of walls) {
      const wallCenterX = wall.x + wall.width / 2;
      const wallCenterY = wall.y + wall.height / 2;

      if (
        aabbOverlap(
          targetPos.x, targetPos.y, size.width, size.height,
          wallCenterX, wallCenterY, wall.width, wall.height,
        )
      ) {
        return wall;
      }
    }

    return null;
  }

  private _findCollidingObstacle(
    zoneId: string,
    targetPos: Position,
    size: { width: number; height: number },
  ): string | null {
    const obs = this._findCollidingObstacleObject(zoneId, targetPos, size);
    return obs ? obs.id : null;
  }

  private _findCollidingObstacleObject(
    zoneId: string,
    targetPos: Position,
    size: { width: number; height: number },
  ): Obstacle | null {
    const obstacles = worldManager.getZoneObstacles(zoneId);

    for (const obs of obstacles) {
      const obsCenterX = obs.x + obs.width / 2;
      const obsCenterY = obs.y + obs.height / 2;

      if (
        aabbOverlap(
          targetPos.x, targetPos.y, size.width, size.height,
          obsCenterX, obsCenterY, obs.width, obs.height,
        )
      ) {
        return obs;
      }
    }

    return null;
  }
}

// =============================================================================
// Singleton Export
// =============================================================================

export const collisionManager = new CollisionManager();
