/**
 * CollisionSystem — Client-side AABB collision detection with Grid-based spatial index
 * Requirements: 3, 4, 5, 8
 */

import { Bot, Wall } from '../stores/roomStore';
import { Doorway } from '../stores/doorwayStore';

export interface CollisionResult {
  hasCollision: boolean;
  type?: 'bot' | 'wall';
  targetId?: string;
  targetPosition?: { x: number; y: number };
}

export class CollisionSystem {
  private static readonly BOT_SIZE = { width: 32, height: 32 };
  private static readonly GRID_CELL_SIZE = 128;

  // Spatial grid: cellKey -> botIds
  private grid: Map<string, string[]> = new Map();

  /**
   * Build spatial index from bots.
   * Each bot is mapped to the grid cell containing its center.
   */
  buildIndex(bots: Bot[]): void {
    this.grid.clear();
    for (const bot of bots) {
      const key = this._cellKey(bot.position.x, bot.position.y);
      const cell = this.grid.get(key);
      if (cell) {
        cell.push(bot.id);
      } else {
        this.grid.set(key, [bot.id]);
      }
    }
  }

  /**
   * Check if a position collides with any bot (excluding excludeBotId).
   * Uses the spatial grid to find candidates, then performs AABB check.
   */
  checkBotCollision(
    position: { x: number; y: number },
    bots: Bot[],
    excludeBotId?: string
  ): CollisionResult {
    const candidateIds = this._getCandidateBotIds(position);

    const botMap = new Map(bots.map((b) => [b.id, b]));

    for (const candidateId of candidateIds) {
      if (candidateId === excludeBotId) continue;
      const candidate = botMap.get(candidateId);
      if (!candidate) continue;

      const size = candidate.collisionBox ?? CollisionSystem.BOT_SIZE;
      const mySize = CollisionSystem.BOT_SIZE;

      if (this._aabbOverlap(position, mySize, candidate.position, size)) {
        return {
          hasCollision: true,
          type: 'bot',
          targetId: candidate.id,
          targetPosition: { x: candidate.position.x, y: candidate.position.y },
        };
      }
    }

    return { hasCollision: false };
  }

  /**
   * Check if a position collides with any wall.
   * Wall x/y is the top-left corner; convert to center for AABB.
   */
  checkWallCollision(
    position: { x: number; y: number },
    walls: Wall[]
  ): CollisionResult {
    const mySize = CollisionSystem.BOT_SIZE;

    for (const wall of walls) {
      // Convert wall top-left to center
      const wallCenter = {
        x: wall.x + wall.width / 2,
        y: wall.y + wall.height / 2,
      };
      const wallSize = { width: wall.width, height: wall.height };

      if (this._aabbOverlap(position, mySize, wallCenter, wallSize)) {
        return {
          hasCollision: true,
          type: 'wall',
          targetId: wall.id,
          targetPosition: wallCenter,
        };
      }
    }

    return { hasCollision: false };
  }

  /**
   * Check if a position collides with any wall, excluding doorway areas.
   * If the position is within a doorway, it's not considered a collision.
   * Requirements: 5.2, 5.4
   */
  checkWallCollisionWithDoorways(
    position: { x: number; y: number },
    walls: Wall[],
    doorways: Doorway[]
  ): CollisionResult {
    const mySize = CollisionSystem.BOT_SIZE;

    for (const wall of walls) {
      const wallCenter = {
        x: wall.x + wall.width / 2,
        y: wall.y + wall.height / 2,
      };
      const wallSize = { width: wall.width, height: wall.height };

      if (this._aabbOverlap(position, mySize, wallCenter, wallSize)) {
        // Check if this position is within a doorway (doorway = no collision)
        if (!this._isPositionInDoorway(position.x, position.y, doorways)) {
          return {
            hasCollision: true,
            type: 'wall',
            targetId: wall.id,
            targetPosition: wallCenter,
          };
        }
      }
    }

    return { hasCollision: false };
  }

  /**
   * Combined check: bot collision first, then wall collision.
   */
  validateMove(
    position: { x: number; y: number },
    bots: Bot[],
    walls: Wall[],
    excludeBotId?: string
  ): CollisionResult {
    const botResult = this.checkBotCollision(position, bots, excludeBotId);
    if (botResult.hasCollision) return botResult;

    return this.checkWallCollision(position, walls);
  }

  /**
   * Get bots within radius using spatial index.
   * Computes the cell range covered by the circle, collects candidates,
   * then filters by actual Euclidean distance.
   */
  getNearbyBots(
    position: { x: number; y: number },
    radius: number,
    bots: Bot[]
  ): Bot[] {
    const cellSize = CollisionSystem.GRID_CELL_SIZE;
    const minCellX = Math.floor((position.x - radius) / cellSize);
    const maxCellX = Math.floor((position.x + radius) / cellSize);
    const minCellY = Math.floor((position.y - radius) / cellSize);
    const maxCellY = Math.floor((position.y + radius) / cellSize);

    const candidateIds = new Set<string>();
    for (let cx = minCellX; cx <= maxCellX; cx++) {
      for (let cy = minCellY; cy <= maxCellY; cy++) {
        const cell = this.grid.get(`${cx},${cy}`);
        if (cell) {
          for (const id of cell) candidateIds.add(id);
        }
      }
    }

    const botMap = new Map(bots.map((b) => [b.id, b]));
    const result: Bot[] = [];

    for (const id of candidateIds) {
      const bot = botMap.get(id);
      if (!bot) continue;
      const dx = bot.position.x - position.x;
      const dy = bot.position.y - position.y;
      if (dx * dx + dy * dy <= radius * radius) {
        result.push(bot);
      }
    }

    return result;
  }

  // ── Private helpers ──────────────────────────────────────────────────────

  private _cellKey(x: number, y: number): string {
    const cellSize = CollisionSystem.GRID_CELL_SIZE;
    return `${Math.floor(x / cellSize)},${Math.floor(y / cellSize)}`;
  }

  /**
   * Collect bot IDs from the grid cells that overlap the bot's bounding box
   * centered at `position`.
   */
  private _getCandidateBotIds(position: { x: number; y: number }): string[] {
    const cellSize = CollisionSystem.GRID_CELL_SIZE;
    const half = CollisionSystem.BOT_SIZE.width / 2; // 16

    const minCellX = Math.floor((position.x - half) / cellSize);
    const maxCellX = Math.floor((position.x + half) / cellSize);
    const minCellY = Math.floor((position.y - half) / cellSize);
    const maxCellY = Math.floor((position.y + half) / cellSize);

    const ids: string[] = [];
    for (let cx = minCellX; cx <= maxCellX; cx++) {
      for (let cy = minCellY; cy <= maxCellY; cy++) {
        const cell = this.grid.get(`${cx},${cy}`);
        if (cell) ids.push(...cell);
      }
    }
    return ids;
  }

  /**
   * AABB overlap test using center positions.
   * Returns true when the two rectangles intersect.
   */
  private _aabbOverlap(
    aCenter: { x: number; y: number },
    aSize: { width: number; height: number },
    bCenter: { x: number; y: number },
    bSize: { width: number; height: number }
  ): boolean {
    return (
      Math.abs(aCenter.x - bCenter.x) < aSize.width / 2 + bSize.width / 2 &&
      Math.abs(aCenter.y - bCenter.y) < aSize.height / 2 + bSize.height / 2
    );
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

export const collisionSystem = new CollisionSystem();
