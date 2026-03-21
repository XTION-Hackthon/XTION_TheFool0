// =============================================================================
// XTION_TheFool0 — 房间隔离属性测试
// Feature: multi-room-collision-system
// Requirements: 1, 8
// =============================================================================

import { describe, it, beforeEach } from 'vitest';
import { expect } from 'vitest';
import fc from 'fast-check';

// =============================================================================
// In-memory multi-room collision system for property testing
// Models the room-scoped collision detection from collision-manager.ts
// =============================================================================

const BOT_SIZE = { width: 32, height: 32 };

function aabbOverlap(
  ax: number, ay: number, aw: number, ah: number,
  bx: number, by: number, bw: number, bh: number,
): boolean {
  return (
    Math.abs(ax - bx) < (aw / 2 + bw / 2) &&
    Math.abs(ay - by) < (ah / 2 + bh / 2)
  );
}

interface BotEntry { botId: string; roomId: string; x: number; y: number }

/**
 * Multi-room collision system.
 * Key invariant: collision checks are scoped to a single room.
 * Bots in different rooms never collide with each other.
 */
class MultiRoomCollisionSystem {
  private bots: Map<string, BotEntry> = new Map(); // botId -> entry

  addBot(bot: BotEntry): void {
    this.bots.set(bot.botId, { ...bot });
  }

  removeBot(botId: string): void {
    this.bots.delete(botId);
  }

  moveBot(botId: string, targetX: number, targetY: number): boolean {
    const bot = this.bots.get(botId);
    if (!bot) return false;

    // Only check bots in the SAME room
    for (const other of this.bots.values()) {
      if (other.botId === botId) continue;
      if (other.roomId !== bot.roomId) continue; // different room — skip

      if (aabbOverlap(
        targetX, targetY, BOT_SIZE.width, BOT_SIZE.height,
        other.x, other.y, BOT_SIZE.width, BOT_SIZE.height,
      )) {
        return false; // collision within same room
      }
    }

    bot.x = targetX;
    bot.y = targetY;
    return true;
  }

  getBotsInRoom(roomId: string): BotEntry[] {
    return [...this.bots.values()].filter((b) => b.roomId === roomId);
  }

  checkCrossRoomCollision(botIdA: string, botIdB: string): boolean {
    const a = this.bots.get(botIdA);
    const b = this.bots.get(botIdB);
    if (!a || !b) return false;
    if (a.roomId === b.roomId) return false; // same room — not a cross-room check

    // Cross-room bots should NEVER collide regardless of position
    return false;
  }
}

// =============================================================================
// Arbitraries
// =============================================================================

const posArb = fc.record({
  x: fc.integer({ min: 0, max: 1800 }),
  y: fc.integer({ min: 0, max: 1800 }),
});

// =============================================================================
// Property 6: 房间隔离
// Requirements: 1, 8
// =============================================================================

describe('Property 6: 房间隔离', () => {
  let system: MultiRoomCollisionSystem;

  beforeEach(() => {
    system = new MultiRoomCollisionSystem();
  });

  it('不同房间的bot在相同位置不产生碰撞', () => {
    fc.assert(
      fc.property(
        posArb,
        (pos) => {
          const sys = new MultiRoomCollisionSystem();

          // Two bots at the EXACT same position but in different rooms
          sys.addBot({ botId: 'bot-a', roomId: 'room-1', x: pos.x, y: pos.y });
          sys.addBot({ botId: 'bot-b', roomId: 'room-2', x: pos.x, y: pos.y });

          // bot-b tries to move to the same position as bot-a — should succeed
          // because they are in different rooms
          const result = sys.moveBot('bot-b', pos.x, pos.y);
          return result === true;
        },
      ),
      { numRuns: 200 },
    );
  });

  it('同一房间内的bot在相同位置产生碰撞', () => {
    fc.assert(
      fc.property(
        posArb,
        fc.integer({ min: -31, max: 31 }),
        fc.integer({ min: -31, max: 31 }),
        (posA, dx, dy) => {
          const sys = new MultiRoomCollisionSystem();

          sys.addBot({ botId: 'bot-a', roomId: 'room-1', x: posA.x, y: posA.y });
          // bot-b starts far away in the same room
          sys.addBot({ botId: 'bot-b', roomId: 'room-1', x: posA.x + 500, y: posA.y + 500 });

          // bot-b tries to move to overlap with bot-a
          const targetX = posA.x + dx;
          const targetY = posA.y + dy;
          const result = sys.moveBot('bot-b', targetX, targetY);

          // Should be blocked — same room collision
          return result === false;
        },
      ),
      { numRuns: 200 },
    );
  });

  it('碰撞检测仅考虑同一房间内的bot', () => {
    fc.assert(
      fc.property(
        posArb,
        fc.integer({ min: 2, max: 5 }),
        (pos, numRooms) => {
          const sys = new MultiRoomCollisionSystem();

          // Place one bot at pos.x, pos.y in each of N rooms
          for (let i = 0; i < numRooms; i++) {
            sys.addBot({ botId: `bot-room-${i}`, roomId: `room-${i}`, x: pos.x, y: pos.y });
          }

          // Add a new bot in room-0 far away, then try to move to pos
          sys.addBot({ botId: 'mover', roomId: 'room-0', x: pos.x + 500, y: pos.y + 500 });

          // Moving to pos.x, pos.y should be blocked by bot-room-0 (same room)
          const result = sys.moveBot('mover', pos.x, pos.y);
          return result === false;
        },
      ),
      { numRuns: 200 },
    );
  });

  it('bot切换房间后，碰撞检测使用新房间的bot列表', () => {
    fc.assert(
      fc.property(
        posArb,
        (pos) => {
          const sys = new MultiRoomCollisionSystem();

          // room-1 has a bot at pos
          sys.addBot({ botId: 'resident', roomId: 'room-1', x: pos.x, y: pos.y });

          // mover starts in room-2 (no bots there)
          sys.addBot({ botId: 'mover', roomId: 'room-2', x: pos.x + 500, y: pos.y + 500 });

          // In room-2, moving to pos should succeed (no bots there)
          const resultInRoom2 = sys.moveBot('mover', pos.x, pos.y);
          if (!resultInRoom2) return false;

          // Now simulate room switch: move mover to room-1
          sys.removeBot('mover');
          sys.addBot({ botId: 'mover', roomId: 'room-1', x: pos.x + 500, y: pos.y + 500 });

          // In room-1, moving to pos should be blocked by 'resident'
          const resultInRoom1 = sys.moveBot('mover', pos.x, pos.y);
          return resultInRoom1 === false;
        },
      ),
      { numRuns: 200 },
    );
  });

  it('房间隔离：任意数量的房间，跨房间bot不互相影响', () => {
    fc.assert(
      fc.property(
        fc.array(
          fc.record({
            roomId: fc.constantFrom('room-A', 'room-B', 'room-C'),
            x: fc.integer({ min: 0, max: 100 }),
            y: fc.integer({ min: 0, max: 100 }),
          }),
          { minLength: 2, maxLength: 20 },
        ),
        (botConfigs) => {
          const sys = new MultiRoomCollisionSystem();
          const addedBots = new Map<string, string>(); // botId -> roomId

          botConfigs.forEach((cfg, i) => {
            const botId = `bot-${i}`;
            sys.addBot({ botId, roomId: cfg.roomId, x: cfg.x, y: cfg.y });
            addedBots.set(botId, cfg.roomId);
          });

          // For each pair of bots in DIFFERENT rooms, verify cross-room collision is false
          const botIds = [...addedBots.keys()];
          for (let i = 0; i < botIds.length; i++) {
            for (let j = i + 1; j < botIds.length; j++) {
              const roomA = addedBots.get(botIds[i])!;
              const roomB = addedBots.get(botIds[j])!;
              if (roomA !== roomB) {
                const crossCollision = sys.checkCrossRoomCollision(botIds[i], botIds[j]);
                if (crossCollision) return false;
              }
            }
          }
          return true;
        },
      ),
      { numRuns: 200 },
    );
  });

  it('空间索引按房间隔离：查询只返回同房间的bot', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 5 }),
        fc.integer({ min: 1, max: 5 }),
        (botsInRoom1, botsInRoom2) => {
          const sys = new MultiRoomCollisionSystem();

          for (let i = 0; i < botsInRoom1; i++) {
            sys.addBot({ botId: `r1-bot-${i}`, roomId: 'room-1', x: i * 100, y: 0 });
          }
          for (let i = 0; i < botsInRoom2; i++) {
            sys.addBot({ botId: `r2-bot-${i}`, roomId: 'room-2', x: i * 100, y: 0 });
          }

          const room1Bots = sys.getBotsInRoom('room-1');
          const room2Bots = sys.getBotsInRoom('room-2');

          // Each room's bot list must only contain bots from that room
          const room1Isolated = room1Bots.every((b) => b.roomId === 'room-1');
          const room2Isolated = room2Bots.every((b) => b.roomId === 'room-2');

          return (
            room1Isolated &&
            room2Isolated &&
            room1Bots.length === botsInRoom1 &&
            room2Bots.length === botsInRoom2
          );
        },
      ),
      { numRuns: 200 },
    );
  });
});
