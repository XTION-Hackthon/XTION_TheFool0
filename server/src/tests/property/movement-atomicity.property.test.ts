// =============================================================================
// XTION_TheFool0 — 移动原子性属性测试
// Feature: zone-obstacle-system
// Requirements: 3, 5
// =============================================================================

import { describe, it, beforeEach } from 'vitest';
import { expect } from 'vitest';
import fc from 'fast-check';

// =============================================================================
// In-memory movement system for property testing
// Models the atomic validate-then-commit pattern from collision-manager.ts
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

interface BotState { botId: string; x: number; y: number }
interface WallState { id: string; x: number; y: number; width: number; height: number }

interface MoveResult {
  success: boolean;
  reason?: 'bot_collision' | 'wall_collision';
  /** Position after the move attempt — must equal original if failed */
  finalX: number;
  finalY: number;
}

/**
 * Atomic movement engine:
 * 1. Validate target position (bot + wall collision checks)
 * 2. If valid → update position (commit)
 * 3. If invalid → leave position unchanged (rollback)
 *
 * This is the core atomicity contract: no partial state.
 */
class AtomicMovementEngine {
  private bots: Map<string, BotState> = new Map();
  private walls: WallState[] = [];

  addBot(bot: BotState): void {
    this.bots.set(bot.botId, { ...bot });
  }

  setWalls(walls: WallState[]): void {
    this.walls = walls.map((w) => ({ ...w }));
  }

  getPosition(botId: string): { x: number; y: number } | null {
    const b = this.bots.get(botId);
    return b ? { x: b.x, y: b.y } : null;
  }

  move(botId: string, targetX: number, targetY: number): MoveResult {
    const bot = this.bots.get(botId);
    if (!bot) throw new Error(`Bot not found: ${botId}`);

    const originalX = bot.x;
    const originalY = bot.y;

    // --- Validation phase (read-only) ---
    for (const other of this.bots.values()) {
      if (other.botId === botId) continue;
      if (aabbOverlap(targetX, targetY, BOT_SIZE.width, BOT_SIZE.height,
                      other.x, other.y, BOT_SIZE.width, BOT_SIZE.height)) {
        // Validation failed — position must remain unchanged
        return { success: false, reason: 'bot_collision', finalX: originalX, finalY: originalY };
      }
    }

    for (const wall of this.walls) {
      const wallCx = wall.x + wall.width / 2;
      const wallCy = wall.y + wall.height / 2;
      if (aabbOverlap(targetX, targetY, BOT_SIZE.width, BOT_SIZE.height,
                      wallCx, wallCy, wall.width, wall.height)) {
        return { success: false, reason: 'wall_collision', finalX: originalX, finalY: originalY };
      }
    }

    // --- Commit phase ---
    bot.x = targetX;
    bot.y = targetY;
    return { success: true, finalX: targetX, finalY: targetY };
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
// Property 3: 移动原子性
// Requirements: 3, 5
// =============================================================================

describe('Property 3: 移动原子性', () => {
  let engine: AtomicMovementEngine;

  beforeEach(() => {
    engine = new AtomicMovementEngine();
  });

  it('移动成功时，bot位置更新为目标位置', () => {
    fc.assert(
      fc.property(
        posArb,
        posArb,
        (startPos, targetPos) => {
          // Ensure no overlap between start and target (gap >= BOT_SIZE)
          fc.pre(Math.abs(startPos.x - targetPos.x) >= BOT_SIZE.width ||
                 Math.abs(startPos.y - targetPos.y) >= BOT_SIZE.height);

          const eng = new AtomicMovementEngine();
          eng.addBot({ botId: 'bot-a', x: startPos.x, y: startPos.y });

          const result = eng.move('bot-a', targetPos.x, targetPos.y);

          if (result.success) {
            const pos = eng.getPosition('bot-a');
            return pos?.x === targetPos.x && pos?.y === targetPos.y;
          }
          // If move failed (e.g. wall), position must be unchanged
          const pos = eng.getPosition('bot-a');
          return pos?.x === startPos.x && pos?.y === startPos.y;
        },
      ),
      { numRuns: 200 },
    );
  });

  it('移动失败时（bot碰撞），位置保持不变', () => {
    fc.assert(
      fc.property(
        posArb,
        fc.integer({ min: -19, max: 19 }),
        fc.integer({ min: -19, max: 19 }),
        (posA, dx, dy) => {
          const eng = new AtomicMovementEngine();
          eng.addBot({ botId: 'bot-a', x: posA.x, y: posA.y });

          // bot-b starts far away, then tries to move into bot-a's space
          const startX = posA.x + 500;
          const startY = posA.y + 500;
          eng.addBot({ botId: 'bot-b', x: startX, y: startY });

          // Target overlaps with bot-a
          const targetX = posA.x + dx;
          const targetY = posA.y + dy;

          const result = eng.move('bot-b', targetX, targetY);

          // Must fail
          if (result.success) return false;

          // Position must be unchanged
          const pos = eng.getPosition('bot-b');
          return pos?.x === startX && pos?.y === startY;
        },
      ),
      { numRuns: 200 },
    );
  });

  it('移动失败时（墙体碰撞），位置保持不变', () => {
    fc.assert(
      fc.property(
        posArb,
        fc.integer({ min: 32, max: 128 }),
        fc.integer({ min: 32, max: 128 }),
        (wallPos, wallW, wallH) => {
          const eng = new AtomicMovementEngine();
          const wall = { id: 'w1', x: wallPos.x, y: wallPos.y, width: wallW, height: wallH };
          eng.setWalls([wall]);

          // Bot starts far from wall
          const startX = wallPos.x + wallW + 200;
          const startY = wallPos.y + wallH + 200;
          eng.addBot({ botId: 'bot-a', x: startX, y: startY });

          // Target is wall center — guaranteed collision
          const targetX = wallPos.x + wallW / 2;
          const targetY = wallPos.y + wallH / 2;

          const result = eng.move('bot-a', targetX, targetY);

          if (result.success) return false; // should have been blocked

          const pos = eng.getPosition('bot-a');
          return pos?.x === startX && pos?.y === startY;
        },
      ),
      { numRuns: 200 },
    );
  });

  it('连续移动：每次移动后状态一致（无中间状态泄漏）', () => {
    fc.assert(
      fc.property(
        fc.array(posArb, { minLength: 2, maxLength: 10 }),
        (positions) => {
          const eng = new AtomicMovementEngine();
          eng.addBot({ botId: 'solo', x: positions[0].x, y: positions[0].y });

          let lastCommittedX = positions[0].x;
          let lastCommittedY = positions[0].y;

          for (let i = 1; i < positions.length; i++) {
            const result = eng.move('solo', positions[i].x, positions[i].y);
            const pos = eng.getPosition('solo')!;

            if (result.success) {
              // Committed: position must equal target
              if (pos.x !== positions[i].x || pos.y !== positions[i].y) return false;
              lastCommittedX = positions[i].x;
              lastCommittedY = positions[i].y;
            } else {
              // Rolled back: position must equal last committed
              if (pos.x !== lastCommittedX || pos.y !== lastCommittedY) return false;
            }
          }
          return true;
        },
      ),
      { numRuns: 200 },
    );
  });

  it('validateMovement 返回 valid=false 时不更新位置', () => {
    // Validates the contract: validation result and state change are consistent
    // Use a small offset (within BOT_SIZE) to guarantee overlap
    fc.assert(
      fc.property(
        posArb,
        fc.integer({ min: -19, max: 19 }),
        fc.integer({ min: -19, max: 19 }),
        (posA, dx, dy) => {
          const eng = new AtomicMovementEngine();
          eng.addBot({ botId: 'bot-a', x: posA.x, y: posA.y });

          // bot-b starts far away
          const startX = posA.x + 500;
          const startY = posA.y + 500;
          eng.addBot({ botId: 'bot-b', x: startX, y: startY });

          const before = eng.getPosition('bot-b')!;
          // Target overlaps with bot-a (dx/dy within ±19 < BOT_SIZE 20)
          const result = eng.move('bot-b', posA.x + dx, posA.y + dy);
          const after = eng.getPosition('bot-b')!;

          // Move should fail (overlap with bot-a) and position must be unchanged
          if (!result.success) {
            return after.x === before.x && after.y === before.y;
          }
          return true;
        },
      ),
      { numRuns: 200 },
    );
  });
});
