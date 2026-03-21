// =============================================================================
// XTION_TheFool0 — 碰撞检测完整性属性测试
// Feature: multi-room-collision-system
// Requirements: 3, 4, 5
// =============================================================================

import { describe, it, beforeEach } from 'vitest';
import { expect } from 'vitest';
import fc from 'fast-check';
import Database from 'better-sqlite3';

// =============================================================================
// In-memory test helpers — mirror the real AABB logic without DB coupling
// =============================================================================

const BOT_SIZE = { width: 32, height: 32 };

/**
 * Pure AABB overlap check (center-based), mirroring collision-manager.ts.
 * Two boxes overlap when the distance between centers is less than the sum
 * of their half-extents on both axes.
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

// =============================================================================
// Minimal in-memory CollisionManager for property testing
// Decoupled from SQLite so tests are fast and deterministic.
// =============================================================================

interface BotEntry { botId: string; x: number; y: number }
interface WallEntry { id: string; x: number; y: number; width: number; height: number }

class InMemoryCollisionManager {
  private bots: Map<string, BotEntry[]> = new Map();   // roomId -> bots
  private walls: Map<string, WallEntry[]> = new Map(); // roomId -> walls

  setBots(roomId: string, bots: BotEntry[]): void {
    this.bots.set(roomId, bots);
  }

  setWalls(roomId: string, walls: WallEntry[]): void {
    this.walls.set(roomId, walls);
  }

  checkBotCollision(roomId: string, movingBotId: string, targetX: number, targetY: number): boolean {
    const roomBots = this.bots.get(roomId) ?? [];
    for (const bot of roomBots) {
      if (bot.botId === movingBotId) continue;
      if (aabbOverlap(targetX, targetY, BOT_SIZE.width, BOT_SIZE.height,
                      bot.x, bot.y, BOT_SIZE.width, BOT_SIZE.height)) {
        return true;
      }
    }
    return false;
  }

  checkWallCollision(roomId: string, targetX: number, targetY: number): boolean {
    const roomWalls = this.walls.get(roomId) ?? [];
    for (const wall of roomWalls) {
      // Wall position is top-left; convert to center for AABB
      const wallCx = wall.x + wall.width / 2;
      const wallCy = wall.y + wall.height / 2;
      if (aabbOverlap(targetX, targetY, BOT_SIZE.width, BOT_SIZE.height,
                      wallCx, wallCy, wall.width, wall.height)) {
        return true;
      }
    }
    return false;
  }
}

// =============================================================================
// Arbitraries
// =============================================================================

/** A position within a reasonable game-world range */
const posArb = fc.record({
  x: fc.integer({ min: 0, max: 2000 }),
  y: fc.integer({ min: 0, max: 2000 }),
});

/** A wall with positive dimensions */
const wallArb = fc.record({
  id: fc.uuid(),
  x: fc.integer({ min: 0, max: 1900 }),
  y: fc.integer({ min: 0, max: 1900 }),
  width: fc.integer({ min: 8, max: 128 }),
  height: fc.integer({ min: 8, max: 128 }),
});

// =============================================================================
// Property 1: 碰撞检测完整性 — Bot-Bot
// Requirements: 3, 5
// =============================================================================

describe('Property 1: Bot-Bot 碰撞检测完整性', () => {
  let cm: InMemoryCollisionManager;

  beforeEach(() => {
    cm = new InMemoryCollisionManager();
  });

  it('当两个bot的碰撞箱重叠时，系统必须检测到碰撞', () => {
    fc.assert(
      fc.property(
        posArb,
        // offset within overlap zone: strictly less than BOT_SIZE (32px)
        fc.integer({ min: -31, max: 31 }),
        fc.integer({ min: -31, max: 31 }),
        (posA, dx, dy) => {
          const roomId = 'room-1';
          const botA: BotEntry = { botId: 'bot-a', x: posA.x, y: posA.y };
          // botB is placed so its center overlaps botA's center by (dx, dy)
          const botB: BotEntry = { botId: 'bot-b', x: posA.x + dx, y: posA.y + dy };

          cm.setBots(roomId, [botA, botB]);

          // Moving bot-b to its own current position should detect collision with bot-a
          // (since they overlap)
          const detected = cm.checkBotCollision(roomId, 'bot-b', botB.x, botB.y);
          return detected === true;
        },
      ),
      { numRuns: 200 },
    );
  });

  it('当两个bot的碰撞箱不重叠时，系统不应检测到碰撞', () => {
    fc.assert(
      fc.property(
        posArb,
        // offset strictly outside overlap zone: >= BOT_SIZE (32px) in at least one axis
        fc.integer({ min: 33, max: 500 }),
        (posA, gap) => {
          const roomId = 'room-2';
          const botA: BotEntry = { botId: 'bot-a', x: posA.x, y: posA.y };
          // botB is placed gap pixels away on the x-axis — guaranteed no overlap
          const botB: BotEntry = { botId: 'bot-b', x: posA.x + gap, y: posA.y };

          cm.setBots(roomId, [botA, botB]);

          const detected = cm.checkBotCollision(roomId, 'bot-b', botB.x, botB.y);
          return detected === false;
        },
      ),
      { numRuns: 200 },
    );
  });

  it('bot不应与自身碰撞', () => {
    fc.assert(
      fc.property(
        posArb,
        (pos) => {
          const roomId = 'room-3';
          const bot: BotEntry = { botId: 'solo-bot', x: pos.x, y: pos.y };
          cm.setBots(roomId, [bot]);

          // Moving to its own position should NOT be a collision
          const detected = cm.checkBotCollision(roomId, 'solo-bot', pos.x, pos.y);
          return detected === false;
        },
      ),
      { numRuns: 100 },
    );
  });

  it('空房间中不存在bot碰撞', () => {
    fc.assert(
      fc.property(
        posArb,
        (pos) => {
          const roomId = 'empty-room';
          cm.setBots(roomId, []);
          const detected = cm.checkBotCollision(roomId, 'any-bot', pos.x, pos.y);
          return detected === false;
        },
      ),
      { numRuns: 100 },
    );
  });
});

// =============================================================================
// Property 2: 墙体碰撞检测完整性
// Requirements: 4
// =============================================================================

describe('Property 2: 墙体碰撞检测完整性', () => {
  let cm: InMemoryCollisionManager;

  beforeEach(() => {
    cm = new InMemoryCollisionManager();
  });

  it('当bot碰撞箱与墙体重叠时，系统必须检测到碰撞', () => {
    fc.assert(
      fc.property(
        wallArb,
        (wall) => {
          const roomId = 'wall-room-1';
          cm.setWalls(roomId, [wall]);

          // Place bot center exactly at wall center — guaranteed overlap
          const wallCx = wall.x + wall.width / 2;
          const wallCy = wall.y + wall.height / 2;

          const detected = cm.checkWallCollision(roomId, wallCx, wallCy);
          return detected === true;
        },
      ),
      { numRuns: 200 },
    );
  });

  it('当bot碰撞箱与墙体不重叠时，系统不应检测到碰撞', () => {
    fc.assert(
      fc.property(
        wallArb,
        (wall) => {
          const roomId = 'wall-room-2';
          cm.setWalls(roomId, [wall]);

          // Place bot far to the right of the wall — guaranteed no overlap
          const clearX = wall.x + wall.width + BOT_SIZE.width + 10;
          const clearY = wall.y + wall.height / 2;

          const detected = cm.checkWallCollision(roomId, clearX, clearY);
          return detected === false;
        },
      ),
      { numRuns: 200 },
    );
  });

  it('没有墙体的房间不应检测到墙体碰撞', () => {
    fc.assert(
      fc.property(
        posArb,
        (pos) => {
          const roomId = 'no-walls-room';
          cm.setWalls(roomId, []);
          const detected = cm.checkWallCollision(roomId, pos.x, pos.y);
          return detected === false;
        },
      ),
      { numRuns: 100 },
    );
  });

  it('AABB重叠的对称性：若A与B重叠，则B与A也重叠', () => {
    fc.assert(
      fc.property(
        posArb,
        posArb,
        fc.integer({ min: 8, max: 64 }),
        fc.integer({ min: 8, max: 64 }),
        fc.integer({ min: 8, max: 64 }),
        fc.integer({ min: 8, max: 64 }),
        (posA, posB, aw, ah, bw, bh) => {
          const ab = aabbOverlap(posA.x, posA.y, aw, ah, posB.x, posB.y, bw, bh);
          const ba = aabbOverlap(posB.x, posB.y, bw, bh, posA.x, posA.y, aw, ah);
          return ab === ba;
        },
      ),
      { numRuns: 300 },
    );
  });
});
