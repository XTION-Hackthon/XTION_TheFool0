// =============================================================================
// XTION_TheFool0 — 碰撞检测完整性属性测试
// Feature: zone-obstacle-system, Property 1: 服务端碰撞验证使用 zoneId
// Requirements: 3, 4, 5
// =============================================================================

import { describe, it, beforeEach } from 'vitest';
import { expect } from 'vitest';
import fc from 'fast-check';

// =============================================================================
// In-memory test helpers — mirror the real AABB logic without DB coupling
// =============================================================================

const BOT_SIZE = { width: 20, height: 20 };

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
// =============================================================================

interface BotEntry { botId: string; x: number; y: number }
interface WallEntry { id: string; x: number; y: number; width: number; height: number }
interface ObstacleEntry { id: string; x: number; y: number; width: number; height: number }

class InMemoryCollisionManager {
  private bots: Map<string, BotEntry[]> = new Map();       // zoneId -> bots
  private walls: Map<string, WallEntry[]> = new Map();     // zoneId -> walls
  private obstacles: Map<string, ObstacleEntry[]> = new Map(); // zoneId -> obstacles

  setBots(zoneId: string, bots: BotEntry[]): void {
    this.bots.set(zoneId, bots);
  }

  setWalls(zoneId: string, walls: WallEntry[]): void {
    this.walls.set(zoneId, walls);
  }

  setObstacles(zoneId: string, obstacles: ObstacleEntry[]): void {
    this.obstacles.set(zoneId, obstacles);
  }

  checkBotCollision(zoneId: string, movingBotId: string, targetX: number, targetY: number): boolean {
    const zoneBots = this.bots.get(zoneId) ?? [];
    for (const bot of zoneBots) {
      if (bot.botId === movingBotId) continue;
      if (aabbOverlap(targetX, targetY, BOT_SIZE.width, BOT_SIZE.height,
                      bot.x, bot.y, BOT_SIZE.width, BOT_SIZE.height)) {
        return true;
      }
    }
    return false;
  }

  checkWallCollision(zoneId: string, targetX: number, targetY: number): boolean {
    const zoneWalls = this.walls.get(zoneId) ?? [];
    for (const wall of zoneWalls) {
      const wallCx = wall.x + wall.width / 2;
      const wallCy = wall.y + wall.height / 2;
      if (aabbOverlap(targetX, targetY, BOT_SIZE.width, BOT_SIZE.height,
                      wallCx, wallCy, wall.width, wall.height)) {
        return true;
      }
    }
    return false;
  }

  checkObstacleCollision(zoneId: string, targetX: number, targetY: number): boolean {
    const zoneObstacles = this.obstacles.get(zoneId) ?? [];
    for (const obs of zoneObstacles) {
      const obsCx = obs.x + obs.width / 2;
      const obsCy = obs.y + obs.height / 2;
      if (aabbOverlap(targetX, targetY, BOT_SIZE.width, BOT_SIZE.height,
                      obsCx, obsCy, obs.width, obs.height)) {
        return true;
      }
    }
    return false;
  }

  validateMovement(zoneId: string, botId: string, targetX: number, targetY: number): { valid: boolean } {
    if (this.checkBotCollision(zoneId, botId, targetX, targetY)) return { valid: false };
    if (this.checkWallCollision(zoneId, targetX, targetY)) return { valid: false };
    if (this.checkObstacleCollision(zoneId, targetX, targetY)) return { valid: false };
    return { valid: true };
  }
}

// =============================================================================
// Arbitraries
// =============================================================================

const posArb = fc.record({
  x: fc.integer({ min: 0, max: 2000 }),
  y: fc.integer({ min: 0, max: 2000 }),
});

const wallArb = fc.record({
  id: fc.uuid(),
  x: fc.integer({ min: 0, max: 1900 }),
  y: fc.integer({ min: 0, max: 1900 }),
  width: fc.integer({ min: 8, max: 128 }),
  height: fc.integer({ min: 8, max: 128 }),
});

const obstacleArb = fc.record({
  id: fc.uuid(),
  x: fc.integer({ min: 0, max: 1900 }),
  y: fc.integer({ min: 0, max: 1900 }),
  width: fc.integer({ min: 8, max: 64 }),
  height: fc.integer({ min: 8, max: 64 }),
});

// =============================================================================
// Property 1: 服务端碰撞验证使用 zoneId
// Feature: zone-obstacle-system, Property 1
// Requirements: 3.1, 3.2, 3.3
// =============================================================================

describe('Property 1: 服务端碰撞验证使用 zoneId', () => {
  let cm: InMemoryCollisionManager;

  beforeEach(() => {
    cm = new InMemoryCollisionManager();
  });

  it('当目标位置与 Obstacle 重叠时，validateMovement 返回 valid: false', () => {
    // Feature: zone-obstacle-system, Property 1: 服务端碰撞验证使用 zoneId
    fc.assert(
      fc.property(
        obstacleArb,
        (obs) => {
          const zoneId = 'zone-main-hall';
          cm.setObstacles(zoneId, [obs]);
          cm.setBots(zoneId, []);
          cm.setWalls(zoneId, []);

          // Place bot center at obstacle center — guaranteed overlap
          const obsCx = obs.x + obs.width / 2;
          const obsCy = obs.y + obs.height / 2;

          const result = cm.validateMovement(zoneId, 'bot-1', obsCx, obsCy);
          return result.valid === false;
        },
      ),
      { numRuns: 100 },
    );
  });

  it('当目标位置与任何碰撞体均不重叠时，validateMovement 返回 valid: true', () => {
    // Feature: zone-obstacle-system, Property 1: 服务端碰撞验证使用 zoneId
    fc.assert(
      fc.property(
        posArb,
        (pos) => {
          const zoneId = 'zone-clear';
          cm.setObstacles(zoneId, []);
          cm.setBots(zoneId, []);
          cm.setWalls(zoneId, []);

          const result = cm.validateMovement(zoneId, 'bot-1', pos.x, pos.y);
          return result.valid === true;
        },
      ),
      { numRuns: 100 },
    );
  });

  it('不同 zoneId 的碰撞体不影响其他 zone 的检测', () => {
    // Feature: zone-obstacle-system, Property 1: 服务端碰撞验证使用 zoneId
    fc.assert(
      fc.property(
        obstacleArb,
        (obs) => {
          const zoneA = 'zone-a';
          const zoneB = 'zone-b';
          cm.setObstacles(zoneA, [obs]);
          cm.setObstacles(zoneB, []);
          cm.setBots(zoneA, []);
          cm.setBots(zoneB, []);
          cm.setWalls(zoneA, []);
          cm.setWalls(zoneB, []);

          // Same position in zone-b should not collide (no obstacles there)
          const obsCx = obs.x + obs.width / 2;
          const obsCy = obs.y + obs.height / 2;

          const result = cm.validateMovement(zoneB, 'bot-1', obsCx, obsCy);
          return result.valid === true;
        },
      ),
      { numRuns: 100 },
    );
  });
});

// =============================================================================
// Property 2: Bot-Bot 碰撞检测完整性
// Requirements: 3, 5
// =============================================================================

describe('Property 2: Bot-Bot 碰撞检测完整性', () => {
  let cm: InMemoryCollisionManager;

  beforeEach(() => {
    cm = new InMemoryCollisionManager();
  });

  it('当两个bot的碰撞箱重叠时，系统必须检测到碰撞', () => {
    fc.assert(
      fc.property(
        posArb,
        fc.integer({ min: -19, max: 19 }),
        fc.integer({ min: -19, max: 19 }),
        (posA, dx, dy) => {
          const zoneId = 'zone-1';
          const botA: BotEntry = { botId: 'bot-a', x: posA.x, y: posA.y };
          const botB: BotEntry = { botId: 'bot-b', x: posA.x + dx, y: posA.y + dy };

          cm.setBots(zoneId, [botA, botB]);

          const detected = cm.checkBotCollision(zoneId, 'bot-b', botB.x, botB.y);
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
        fc.integer({ min: 21, max: 500 }),
        (posA, gap) => {
          const zoneId = 'zone-2';
          const botA: BotEntry = { botId: 'bot-a', x: posA.x, y: posA.y };
          const botB: BotEntry = { botId: 'bot-b', x: posA.x + gap, y: posA.y };

          cm.setBots(zoneId, [botA, botB]);

          const detected = cm.checkBotCollision(zoneId, 'bot-b', botB.x, botB.y);
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
          const zoneId = 'zone-3';
          const bot: BotEntry = { botId: 'solo-bot', x: pos.x, y: pos.y };
          cm.setBots(zoneId, [bot]);

          const detected = cm.checkBotCollision(zoneId, 'solo-bot', pos.x, pos.y);
          return detected === false;
        },
      ),
      { numRuns: 100 },
    );
  });
});

// =============================================================================
// Property 3: 墙体碰撞检测完整性
// Requirements: 4
// =============================================================================

describe('Property 3: 墙体碰撞检测完整性', () => {
  let cm: InMemoryCollisionManager;

  beforeEach(() => {
    cm = new InMemoryCollisionManager();
  });

  it('当bot碰撞箱与墙体重叠时，系统必须检测到碰撞', () => {
    fc.assert(
      fc.property(
        wallArb,
        (wall) => {
          const zoneId = 'zone-wall-1';
          cm.setWalls(zoneId, [wall]);

          const wallCx = wall.x + wall.width / 2;
          const wallCy = wall.y + wall.height / 2;

          const detected = cm.checkWallCollision(zoneId, wallCx, wallCy);
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
          const zoneId = 'zone-wall-2';
          cm.setWalls(zoneId, [wall]);

          const clearX = wall.x + wall.width + BOT_SIZE.width + 10;
          const clearY = wall.y + wall.height / 2;

          const detected = cm.checkWallCollision(zoneId, clearX, clearY);
          return detected === false;
        },
      ),
      { numRuns: 200 },
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
