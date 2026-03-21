// =============================================================================
// XTION_TheFool0 — 出生点无碰撞属性测试
// Feature: multi-room-collision-system
// Requirements: 11
// =============================================================================

import { describe, it, beforeEach } from 'vitest';
import { expect } from 'vitest';
import fc from 'fast-check';

// =============================================================================
// In-memory spawn point allocator for property testing
// Models the allocation logic from room-manager.ts
// =============================================================================

const BOT_COLLISION_THRESHOLD = 32; // pixels — same as BOT_SIZE.width/height

interface SpawnPoint { id: string; x: number; y: number }
interface BotPosition { botId: string; x: number; y: number }

/**
 * Check if a candidate spawn point collides with any existing bot.
 * Uses the same threshold as room-manager.ts allocateSpawnPoint.
 */
function spawnCollidesWithBot(candidate: SpawnPoint, bots: BotPosition[]): boolean {
  return bots.some(
    (bot) =>
      Math.abs(bot.x - candidate.x) < BOT_COLLISION_THRESHOLD &&
      Math.abs(bot.y - candidate.y) < BOT_COLLISION_THRESHOLD,
  );
}

/**
 * Allocate a spawn point: randomly pick from available points,
 * check for bot collision, retry up to MAX_ATTEMPTS times.
 * Returns null if no collision-free point found.
 */
function allocateSpawnPoint(
  spawnPoints: SpawnPoint[],
  existingBots: BotPosition[],
  maxAttempts = 3,
): SpawnPoint | null {
  if (spawnPoints.length === 0) return null;

  const available = [...spawnPoints];

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    if (available.length === 0) break;

    const idx = Math.floor(Math.random() * available.length);
    const candidate = available[idx];

    if (!spawnCollidesWithBot(candidate, existingBots)) {
      return candidate;
    }

    available.splice(idx, 1);
  }

  // Fallback: return first remaining if any
  return available.length > 0 ? available[0] : null;
}

// =============================================================================
// Arbitraries
// =============================================================================

/** A spawn point at a grid-aligned position */
const spawnPointArb = fc.record({
  id: fc.uuid(),
  x: fc.integer({ min: 0, max: 1900 }).map((v) => Math.floor(v / 64) * 64),
  y: fc.integer({ min: 0, max: 1900 }).map((v) => Math.floor(v / 64) * 64),
});

/** A bot position */
const botPosArb = fc.record({
  botId: fc.uuid(),
  x: fc.integer({ min: 0, max: 1900 }),
  y: fc.integer({ min: 0, max: 1900 }),
});

// =============================================================================
// Property 5: 出生点无碰撞
// Requirements: 11
// =============================================================================

describe('Property 5: 出生点无碰撞', () => {
  it('当存在无碰撞的出生点时，分配结果不与现有bot碰撞', () => {
    fc.assert(
      fc.property(
        // At least one spawn point that is guaranteed collision-free
        fc.record({
          safeSpawn: fc.record({
            id: fc.uuid(),
            x: fc.constant(1500), // far corner
            y: fc.constant(1500),
          }),
          existingBots: fc.array(botPosArb, { minLength: 0, maxLength: 5 }),
        }),
        ({ safeSpawn, existingBots }) => {
          // Ensure the safe spawn is actually collision-free
          const botsAwayFromSafe = existingBots.map((b) => ({
            ...b,
            x: b.x % 100,   // keep bots in 0-100 range, far from 1500
            y: b.y % 100,
          }));

          const result = allocateSpawnPoint([safeSpawn], botsAwayFromSafe);

          if (result === null) return false; // should have found the safe spawn

          return !spawnCollidesWithBot(result, botsAwayFromSafe);
        },
      ),
      { numRuns: 200 },
    );
  });

  it('分配的出生点必须来自预定义的出生点列表', () => {
    fc.assert(
      fc.property(
        fc.array(spawnPointArb, { minLength: 1, maxLength: 10 }),
        fc.array(botPosArb, { minLength: 0, maxLength: 3 }),
        (spawnPoints, bots) => {
          const result = allocateSpawnPoint(spawnPoints, bots);

          if (result === null) return true; // acceptable if all points are blocked

          // Result must be one of the provided spawn points
          return spawnPoints.some((sp) => sp.id === result.id);
        },
      ),
      { numRuns: 200 },
    );
  });

  it('没有出生点时，分配返回null', () => {
    fc.assert(
      fc.property(
        fc.array(botPosArb, { minLength: 0, maxLength: 5 }),
        (bots) => {
          const result = allocateSpawnPoint([], bots);
          return result === null;
        },
      ),
      { numRuns: 100 },
    );
  });

  it('出生点分散时（间距 >= 64px），多个bot可以同时出生而不碰撞', () => {
    fc.assert(
      fc.property(
        // Generate N well-separated spawn points on a grid
        fc.integer({ min: 2, max: 8 }),
        (n) => {
          // Create spawn points on a 64px grid — guaranteed no mutual collision
          const spawnPoints: SpawnPoint[] = Array.from({ length: n }, (_, i) => ({
            id: `sp-${i}`,
            x: i * 64,
            y: 0,
          }));

          const allocatedBots: BotPosition[] = [];

          for (let i = 0; i < n; i++) {
            const result = allocateSpawnPoint(
              spawnPoints.filter((sp) => !allocatedBots.some((b) => b.x === sp.x && b.y === sp.y)),
              allocatedBots,
            );

            if (result === null) return false; // should always find a free point

            // Verify no collision with already-allocated bots
            if (spawnCollidesWithBot(result, allocatedBots)) return false;

            allocatedBots.push({ botId: `bot-${i}`, x: result.x, y: result.y });
          }

          return true;
        },
      ),
      { numRuns: 100 },
    );
  });

  it('所有出生点被占据时，分配可能返回null或降级结果', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 5 }),
        (n) => {
          // Create n spawn points, all occupied by bots at the same positions
          const spawnPoints: SpawnPoint[] = Array.from({ length: n }, (_, i) => ({
            id: `sp-${i}`,
            x: i * 10, // close together — within collision threshold
            y: 0,
          }));

          // Place bots exactly at each spawn point
          const bots: BotPosition[] = spawnPoints.map((sp, i) => ({
            botId: `bot-${i}`,
            x: sp.x,
            y: sp.y,
          }));

          const result = allocateSpawnPoint(spawnPoints, bots, 3);

          // Either null (no free point found) or a point from the list (fallback)
          if (result === null) return true;
          return spawnPoints.some((sp) => sp.id === result.id);
        },
      ),
      { numRuns: 100 },
    );
  });

  it('出生点分配的幂等性：相同输入多次调用，结果均来自合法出生点', () => {
    fc.assert(
      fc.property(
        fc.array(spawnPointArb, { minLength: 1, maxLength: 5 }),
        fc.array(botPosArb, { minLength: 0, maxLength: 2 }),
        (spawnPoints, bots) => {
          // Run allocation 5 times with same inputs
          for (let i = 0; i < 5; i++) {
            const result = allocateSpawnPoint(spawnPoints, bots);
            if (result !== null && !spawnPoints.some((sp) => sp.id === result.id)) {
              return false;
            }
          }
          return true;
        },
      ),
      { numRuns: 100 },
    );
  });
});
