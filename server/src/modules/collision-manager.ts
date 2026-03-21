// =============================================================================
// XTION_TheFool0 — CollisionManager 模块
// Requirements: 3, 4, 5, 8
// =============================================================================

import { roomManager } from './room-manager';
import type { Position, Wall, Doorway } from '../types';
import { doorwayManager } from './doorway-manager';
import { roomMembershipService } from './room-membership-service';

// =============================================================================
// Constants
// =============================================================================

/** Default bot collision box size (pixels) */
const BOT_SIZE = { width: 32, height: 32 };

/** Spatial index grid cell size (pixels) — 128px balances sparse-bot performance */
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

/**
 * AABB overlap check (center-based):
 * Two boxes overlap if:
 *   abs(ax - bx) < (aw/2 + bw/2) AND abs(ay - by) < (ah/2 + bh/2)
 */
function aabbOverlap(
  ax: number, ay: number, aw: number, ah: number,
  bx: number, by: number, bw: number, bh: number,
): boolean {
  return (
    Math.abs(ax - bx) < (aw / 2 + bw / 2) &&
    Math.abs(ay - by) < (ah / 2 + bh / 2)
  );
}

/** Convert a grid cell coordinate to a string key */
function cellKey(col: number, row: number): string {
  return `${col},${row}`;
}

/** Get the grid cell for a given position */
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
   * Spatial index: roomId -> cellKey -> botIds[]
   * Requirements: 8
   */
  private spatialIndex: Map<string, Map<string, string[]>> = new Map();

  /**
   * Collision result cache: cacheKey -> { result, ts }
   * Cache TTL: 100ms. Invalidated per-room when updateSpatialIndex is called.
   * Requirements: 8, 11
   */
  private _collisionCache: Map<string, { result: ValidationResult; ts: number }> = new Map();

  /** Track which cache keys belong to each room for efficient invalidation */
  private _roomCacheKeys: Map<string, Set<string>> = new Map();

  // ---------------------------------------------------------------------------
  // Collision Detection
  // ---------------------------------------------------------------------------

  /**
   * Check if targetPos overlaps with any other bot in the room (excluding the moving bot).
   * Requirements: 3, 5
   */
  checkBotCollision(roomId: string, botId: string, targetPos: Position): boolean {
    const bots = roomManager.getRoomBots(roomId);

    for (const bot of bots) {
      // Skip the moving bot itself
      if (bot.botId === botId) continue;

      // Skip bots without a position
      if (bot.positionX === null || bot.positionY === null) continue;

      if (
        aabbOverlap(
          targetPos.x, targetPos.y, BOT_SIZE.width, BOT_SIZE.height,
          bot.positionX, bot.positionY, BOT_SIZE.width, BOT_SIZE.height,
        )
      ) {
        return true;
      }
    }

    return false;
  }

  /**
   * Check if targetPos overlaps with any wall in the room.
   * Requirements: 4
   */
  checkWallCollision(
    roomId: string,
    targetPos: Position,
    size: { width: number; height: number },
  ): boolean {
    const walls = roomManager.getRoomWalls(roomId);

    for (const wall of walls) {
      // Wall position is top-left corner; convert to center for AABB check
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
   * Check if targetPos overlaps with any wall in the room, excluding doorway areas.
   * If the bot's collision box overlaps a wall but the position is within a doorway,
   * it's not considered a collision (doorway = gap in wall).
   * Requirements: 2.2, 3.2, 5.4, 8.1, 8.3
   */
  checkWallCollisionWithDoorways(
    roomId: string,
    targetPos: Position,
    size: { width: number; height: number },
  ): boolean {
    const walls = roomManager.getRoomWalls(roomId);
    const doorways = doorwayManager.getDoorwaysByRoom(roomId);

    for (const wall of walls) {
      const wallCenterX = wall.x + wall.width / 2;
      const wallCenterY = wall.y + wall.height / 2;

      if (
        aabbOverlap(
          targetPos.x, targetPos.y, size.width, size.height,
          wallCenterX, wallCenterY, wall.width, wall.height,
        )
      ) {
        // Check if this collision is within a doorway (doorway = no collision)
        if (!this._isPositionInDoorway(targetPos.x, targetPos.y, doorways)) {
          return true;
        }
      }
    }

    return false;
  }

  /**
   * Validate cross-room movement: checks doorway connection exists and target room has capacity.
   * Requirements: 8.2, 8.5
   */
  validateCrossRoomMovement(
    botId: string,
    fromRoomId: string,
    toRoomId: string,
    targetPos: Position,
  ): ValidationResult {
    // Verify doorway connection exists between the two rooms
    if (!roomMembershipService.hasConnection(fromRoomId, toRoomId)) {
      return {
        valid: false,
        error: 'No doorway connection between rooms',
        collisionType: undefined,
      };
    }

    // Verify target room has capacity
    if (!roomManager.canJoinRoom(toRoomId)) {
      return {
        valid: false,
        error: 'Target room is at capacity',
        collisionType: undefined,
      };
    }

    return { valid: true };
  }

  /**
   * Validate a movement: combines bot and wall collision checks.
   * Uses a 100ms result cache keyed by roomId:botId:x,y.
   * Requirements: 3, 4, 5
   */
  validateMovement(roomId: string, botId: string, targetPos: Position): ValidationResult {
    const cacheKey = `${roomId}:${botId}:${targetPos.x},${targetPos.y}`;
    const now = Date.now();
    const cached = this._collisionCache.get(cacheKey);
    if (cached && now - cached.ts < 100) {
      return cached.result;
    }

    // Check bot collision first
    if (this.checkBotCollision(roomId, botId, targetPos)) {
      const collidedBotId = this._findCollidingBot(roomId, botId, targetPos);
      const result: ValidationResult = {
        valid: false,
        error: 'Movement blocked: collision with another bot',
        collisionType: 'bot',
        collidedWith: collidedBotId ?? undefined,
      };
      this._setCacheEntry(roomId, cacheKey, result, now);
      return result;
    }

    // Check wall collision
    if (this.checkWallCollision(roomId, targetPos, BOT_SIZE)) {
      const collidedWallId = this._findCollidingWall(roomId, targetPos, BOT_SIZE);
      const result: ValidationResult = {
        valid: false,
        error: 'Movement blocked: collision with wall',
        collisionType: 'wall',
        collidedWith: collidedWallId ?? undefined,
      };
      this._setCacheEntry(roomId, cacheKey, result, now);
      return result;
    }

    const result: ValidationResult = { valid: true };
    this._setCacheEntry(roomId, cacheKey, result, now);
    return result;
  }

  // ---------------------------------------------------------------------------
  // Spatial Index
  // ---------------------------------------------------------------------------

  /**
   * Rebuild the grid index for a room from current bot positions.
   * Also clears the collision cache for this room so stale results are evicted.
   * Requirements: 8
   */
  updateSpatialIndex(roomId: string): void {
    // Invalidate cached results for this room
    this._clearRoomCache(roomId);

    const grid: Map<string, string[]> = new Map();
    const bots = roomManager.getRoomBots(roomId);

    for (const bot of bots) {
      if (bot.positionX === null || bot.positionY === null) continue;

      const { col, row } = posToCell(bot.positionX, bot.positionY);
      const key = cellKey(col, row);

      const cell = grid.get(key);
      if (cell) {
        cell.push(bot.botId);
      } else {
        grid.set(key, [bot.botId]);
      }
    }

    this.spatialIndex.set(roomId, grid);
  }

  /**
   * Query bots within radius using the spatial index.
   * Fetches bots once and builds a Map for O(1) lookup — avoids O(n²) per-candidate scan.
   * Requirements: 8
   */
  getNearbyBots(roomId: string, position: Position, radius: number): string[] {
    const grid = this.spatialIndex.get(roomId);
    if (!grid) return [];

    // Determine the range of cells to check
    const minCol = Math.floor((position.x - radius) / GRID_CELL_SIZE);
    const maxCol = Math.floor((position.x + radius) / GRID_CELL_SIZE);
    const minRow = Math.floor((position.y - radius) / GRID_CELL_SIZE);
    const maxRow = Math.floor((position.y + radius) / GRID_CELL_SIZE);

    // Fetch bots once and build a Map for O(1) lookup
    const bots = roomManager.getRoomBots(roomId);
    const botMap = new Map(bots.map((b) => [b.botId, b]));

    const result: string[] = [];
    const radiusSq = radius * radius;

    for (let col = minCol; col <= maxCol; col++) {
      for (let row = minRow; row <= maxRow; row++) {
        const botIds = grid.get(cellKey(col, row));
        if (!botIds) continue;

        for (const botId of botIds) {
          const bot = botMap.get(botId);
          if (!bot || bot.positionX === null || bot.positionY === null) continue;

          const dx = bot.positionX - position.x;
          const dy = bot.positionY - position.y;
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

  /**
   * Returns detailed collision info for a given movement.
   * Requirements: 3, 4, 5
   */
  getCollisionInfo(roomId: string, botId: string, targetPos: Position): CollisionInfo {
    // Fetch bots once and reuse for both collision check and position lookup
    const bots = roomManager.getRoomBots(roomId);

    // Check bot collision
    for (const bot of bots) {
      if (bot.botId === botId) continue;
      if (bot.positionX === null || bot.positionY === null) continue;

      if (
        aabbOverlap(
          targetPos.x, targetPos.y, BOT_SIZE.width, BOT_SIZE.height,
          bot.positionX, bot.positionY, BOT_SIZE.width, BOT_SIZE.height,
        )
      ) {
        return {
          hasCollision: true,
          type: 'bot',
          position: { x: bot.positionX, y: bot.positionY },
          targetId: bot.botId,
        };
      }
    }

    // Check wall collision
    const collidedWall = this._findCollidingWallObject(roomId, targetPos, BOT_SIZE);
    if (collidedWall !== null) {
      return {
        hasCollision: true,
        type: 'wall',
        position: { x: collidedWall.x, y: collidedWall.y },
        targetId: collidedWall.id,
      };
    }

    return { hasCollision: false };
  }

  // ---------------------------------------------------------------------------
  // Private Helpers
  // ---------------------------------------------------------------------------

  /**
   * Store a cache entry and track it by room for efficient invalidation.
   */
  private _setCacheEntry(roomId: string, cacheKey: string, result: ValidationResult, ts: number): void {
    this._collisionCache.set(cacheKey, { result, ts });
    let keys = this._roomCacheKeys.get(roomId);
    if (!keys) {
      keys = new Set();
      this._roomCacheKeys.set(roomId, keys);
    }
    keys.add(cacheKey);
  }

  /**
   * Remove all cache entries for a room using the tracked key set (O(k) where k = keys for this room).
   * Called when a room's spatial index is updated (i.e., a bot moved).
   */
  private _clearRoomCache(roomId: string): void {
    const keys = this._roomCacheKeys.get(roomId);
    if (!keys) return;
    for (const key of keys) {
      this._collisionCache.delete(key);
    }
    keys.clear();
  }

  /** Find the first bot that collides with targetPos (excluding the moving bot). */
  private _findCollidingBot(
    roomId: string,
    botId: string,
    targetPos: Position,
  ): string | null {
    const bots = roomManager.getRoomBots(roomId);

    for (const bot of bots) {
      if (bot.botId === botId) continue;
      if (bot.positionX === null || bot.positionY === null) continue;

      if (
        aabbOverlap(
          targetPos.x, targetPos.y, BOT_SIZE.width, BOT_SIZE.height,
          bot.positionX, bot.positionY, BOT_SIZE.width, BOT_SIZE.height,
        )
      ) {
        return bot.botId;
      }
    }

    return null;
  }

  /** Find the first wall that collides with targetPos. */
  private _findCollidingWall(
    roomId: string,
    targetPos: Position,
    size: { width: number; height: number },
  ): string | null {
    const wall = this._findCollidingWallObject(roomId, targetPos, size);
    return wall ? wall.id : null;
  }

  /** Find the first wall object that collides with targetPos. */
  private _findCollidingWallObject(
    roomId: string,
    targetPos: Position,
    size: { width: number; height: number },
  ): Wall | null {
    const walls = roomManager.getRoomWalls(roomId);

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

  /**
   * Check if a position is within any doorway area (center-based AABB).
   */
  private _isPositionInDoorway(x: number, y: number, doorways: Doorway[]): boolean {
    for (const dw of doorways) {
      const halfW = dw.width / 2;
      const halfH = dw.height / 2;
      if (
        x >= dw.x - halfW && x <= dw.x + halfW &&
        y >= dw.y - halfH && y <= dw.y + halfH
      ) {
        return true;
      }
    }
    return false;
  }
}

// =============================================================================
// Singleton Export
// =============================================================================

export const collisionManager = new CollisionManager();
