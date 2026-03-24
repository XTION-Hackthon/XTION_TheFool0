// =============================================================================
// XTION_TheFool0 — 性能验收基准测试
// Feature: zone-obstacle-system
// Task: 11.2 性能验收
// **Validates: Requirements 8**
// =============================================================================

import { describe, it, expect, beforeEach, vi } from 'vitest';

// ---------------------------------------------------------------------------
// In-memory SQLite setup — mock db before importing managers
// ---------------------------------------------------------------------------

const { memDb } = vi.hoisted(() => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const Database = require('better-sqlite3') as { default: typeof import('better-sqlite3') } | typeof import('better-sqlite3');
  const Db = (typeof (Database as { default?: unknown }).default === 'function' ? (Database as { default: typeof import('better-sqlite3') }).default : Database) as typeof import('better-sqlite3');
  const memDb = new Db(':memory:');
  memDb.pragma('foreign_keys = ON');
  return { memDb };
});

memDb.exec(`
  CREATE TABLE IF NOT EXISTS zones (
    id TEXT PRIMARY KEY, name TEXT NOT NULL,
    x1 REAL NOT NULL, y1 REAL NOT NULL, x2 REAL NOT NULL, y2 REAL NOT NULL,
    zone_type_id TEXT NOT NULL,
    fill_color TEXT NOT NULL DEFAULT '#cccccc',
    border_color TEXT NOT NULL DEFAULT '#999999',
    opacity REAL NOT NULL DEFAULT 0.5
  );
  CREATE TABLE IF NOT EXISTS walls (
    id TEXT PRIMARY KEY, zone_id TEXT NOT NULL, x REAL NOT NULL,
    y REAL NOT NULL, width REAL NOT NULL, height REAL NOT NULL,
    rotation REAL DEFAULT 0, created_at TIMESTAMP,
    FOREIGN KEY (zone_id) REFERENCES zones(id)
  );
  CREATE TABLE IF NOT EXISTS obstacles (
    id TEXT PRIMARY KEY, zone_id TEXT NOT NULL, x REAL NOT NULL,
    y REAL NOT NULL, width REAL NOT NULL, height REAL NOT NULL,
    rotation REAL DEFAULT 0, type TEXT NOT NULL DEFAULT 'static', created_at TIMESTAMP,
    FOREIGN KEY (zone_id) REFERENCES zones(id)
  );
  CREATE TABLE IF NOT EXISTS spawn_points (
    id TEXT PRIMARY KEY, zone_id TEXT NOT NULL, x REAL NOT NULL,
    y REAL NOT NULL, is_available BOOLEAN DEFAULT 1, created_at TIMESTAMP,
    FOREIGN KEY (zone_id) REFERENCES zones(id)
  );
  CREATE TABLE IF NOT EXISTS contestants (
    id TEXT PRIMARY KEY, key_id TEXT NOT NULL, name TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'offline',
    position_x REAL NOT NULL DEFAULT 0, position_y REAL NOT NULL DEFAULT 0,
    current_zone_id TEXT, energy REAL NOT NULL DEFAULT 100,
    installed_skills TEXT NOT NULL DEFAULT '[]', attributes TEXT NOT NULL DEFAULT '{}'
  );
`);

vi.mock('../../db', () => ({ db: memDb }));

// Import managers after mocking
import { collisionManager } from '../../modules/collision-manager';

// =============================================================================
// Helpers
// =============================================================================

const ZONE_ID = 'perf-zone';
const NOW = new Date().toISOString();

function clearAll(): void {
  memDb.exec('DELETE FROM contestants; DELETE FROM obstacles; DELETE FROM walls; DELETE FROM spawn_points; DELETE FROM zones;');
}

function createTestZone(id: string = ZONE_ID): void {
  memDb.prepare(`
    INSERT INTO zones (id, name, x1, y1, x2, y2, zone_type_id)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(id, 'PerfTestZone', 0, 0, 2000, 2000, 'zt-social');
}

function addBot(zoneId: string, botId: string, x: number, y: number): void {
  memDb.prepare(`
    INSERT OR REPLACE INTO contestants (id, key_id, name, status, position_x, position_y, current_zone_id)
    VALUES (?, ?, ?, 'online', ?, ?, ?)
  `).run(botId, botId, botId, x, y, zoneId);
}

function addWall(zoneId: string, x: number, y: number, w: number, h: number): void {
  memDb.prepare(`
    INSERT INTO walls (id, zone_id, x, y, width, height, rotation, created_at)
    VALUES (?, ?, ?, ?, ?, ?, 0, ?)
  `).run(crypto.randomUUID(), zoneId, x, y, w, h, NOW);
}

function addObstacle(zoneId: string, x: number, y: number, w: number, h: number): void {
  memDb.prepare(`
    INSERT INTO obstacles (id, zone_id, x, y, width, height, rotation, type, created_at)
    VALUES (?, ?, ?, ?, ?, ?, 0, 'static', ?)
  `).run(crypto.randomUUID(), zoneId, x, y, w, h, NOW);
}

/**
 * Measure execution time of a function in milliseconds (high-resolution).
 * Runs the function `iterations` times and returns the average.
 */
function measureMs(fn: () => void, iterations = 1): number {
  const start = performance.now();
  for (let i = 0; i < iterations; i++) {
    fn();
  }
  const elapsed = performance.now() - start;
  return elapsed / iterations;
}

// =============================================================================
// Performance Benchmark Tests
// =============================================================================

describe('性能验收基准测试 (Task 11.2)', () => {
  beforeEach(() => {
    clearAll();
  });

  // -------------------------------------------------------------------------
  // Benchmark 1: 碰撞检测延迟 < 10ms（100个bot）
  // -------------------------------------------------------------------------

  describe('碰撞检测延迟 < 10ms（100个bot）', () => {
    it('validateMovement with 100 bots should complete in < 10ms', () => {
      createTestZone();

      // Place 100 bots spread across the zone in a 10x10 grid (spacing 100px)
      const botRows: Array<{ botId: string; x: number; y: number }> = [];
      for (let i = 0; i < 100; i++) {
        const x = (i % 10) * 100 + 50;
        const y = Math.floor(i / 10) * 100 + 50;
        addBot(ZONE_ID, `bot-${i}`, x, y);
        botRows.push({ botId: `bot-${i}`, x, y });
      }

      // Add some walls for realistic scenario
      for (let i = 0; i < 10; i++) {
        addWall(ZONE_ID, i * 200, 950, 150, 20);
      }

      // Update spatial index
      collisionManager.updateSpatialIndex(ZONE_ID, botRows);

      // Measure: validate movement for a bot to a free position
      const avgMs = measureMs(() => {
        collisionManager.validateMovement(ZONE_ID, 'bot-0', { x: 1500, y: 1500 });
      }, 50);

      console.log(`[Perf] validateMovement (100 bots): ${avgMs.toFixed(3)}ms avg`);
      expect(avgMs).toBeLessThan(10);
    });

    it('checkBotCollision with 100 bots should complete in < 10ms', () => {
      createTestZone();

      const botRows: Array<{ botId: string; x: number; y: number }> = [];
      for (let i = 0; i < 100; i++) {
        const x = (i % 10) * 100 + 50;
        const y = Math.floor(i / 10) * 100 + 50;
        addBot(ZONE_ID, `bot-${i}`, x, y);
        botRows.push({ botId: `bot-${i}`, x, y });
      }

      collisionManager.updateSpatialIndex(ZONE_ID, botRows);

      const avgMs = measureMs(() => {
        collisionManager.checkBotCollision(ZONE_ID, 'bot-0', { x: 750, y: 750 });
      }, 50);

      console.log(`[Perf] checkBotCollision (100 bots): ${avgMs.toFixed(3)}ms avg`);
      expect(avgMs).toBeLessThan(10);
    });

    it('getNearbyBots with 100 bots should complete in < 10ms', () => {
      createTestZone();

      const botRows: Array<{ botId: string; x: number; y: number }> = [];
      for (let i = 0; i < 100; i++) {
        const x = (i % 10) * 100 + 50;
        const y = Math.floor(i / 10) * 100 + 50;
        addBot(ZONE_ID, `bot-${i}`, x, y);
        botRows.push({ botId: `bot-${i}`, x, y });
      }

      collisionManager.updateSpatialIndex(ZONE_ID, botRows);

      const avgMs = measureMs(() => {
        collisionManager.getNearbyBots(ZONE_ID, { x: 500, y: 500 }, 200, botRows);
      }, 50);

      console.log(`[Perf] getNearbyBots (100 bots, radius=200): ${avgMs.toFixed(3)}ms avg`);
      expect(avgMs).toBeLessThan(10);
    });

    it('updateSpatialIndex with 100 bots should complete in < 10ms', () => {
      createTestZone();

      const botRows: Array<{ botId: string; x: number; y: number }> = [];
      for (let i = 0; i < 100; i++) {
        const x = (i % 10) * 100 + 50;
        const y = Math.floor(i / 10) * 100 + 50;
        addBot(ZONE_ID, `bot-${i}`, x, y);
        botRows.push({ botId: `bot-${i}`, x, y });
      }

      const avgMs = measureMs(() => {
        collisionManager.updateSpatialIndex(ZONE_ID, botRows);
      }, 20);

      console.log(`[Perf] updateSpatialIndex (100 bots): ${avgMs.toFixed(3)}ms avg`);
      expect(avgMs).toBeLessThan(10);
    });
  });

  // -------------------------------------------------------------------------
  // Benchmark 2: 障碍物碰撞检测延迟 < 5ms
  // -------------------------------------------------------------------------

  describe('障碍物碰撞检测延迟 < 5ms', () => {
    it('checkObstacleCollision with 20 obstacles should complete in < 5ms', () => {
      createTestZone();

      // Add 20 obstacles
      for (let i = 0; i < 20; i++) {
        addObstacle(ZONE_ID, (i % 5) * 400 + 100, Math.floor(i / 5) * 400 + 100, 40, 40);
      }

      const avgMs = measureMs(() => {
        collisionManager.checkObstacleCollision(ZONE_ID, { x: 750, y: 750 }, { width: 20, height: 20 });
      }, 50);

      console.log(`[Perf] checkObstacleCollision (20 obstacles): ${avgMs.toFixed(3)}ms avg`);
      expect(avgMs).toBeLessThan(5);
    });
  });

  // -------------------------------------------------------------------------
  // Benchmark 3: 完整 validateMovement（含 obstacle）延迟 < 10ms
  // -------------------------------------------------------------------------

  describe('完整 validateMovement（含 obstacle）延迟 < 10ms', () => {
    it('validateMovement with 50 bots + 20 obstacles should complete in < 10ms', () => {
      createTestZone();

      const botRows: Array<{ botId: string; x: number; y: number }> = [];
      for (let i = 0; i < 50; i++) {
        const x = (i % 10) * 100 + 50;
        const y = Math.floor(i / 10) * 100 + 50;
        addBot(ZONE_ID, `bot-${i}`, x, y);
        botRows.push({ botId: `bot-${i}`, x, y });
      }

      for (let i = 0; i < 20; i++) {
        addObstacle(ZONE_ID, (i % 5) * 400 + 200, Math.floor(i / 5) * 400 + 200, 40, 40);
      }

      collisionManager.updateSpatialIndex(ZONE_ID, botRows);

      const avgMs = measureMs(() => {
        collisionManager.validateMovement(ZONE_ID, 'bot-0', { x: 1500, y: 1500 });
      }, 50);

      console.log(`[Perf] validateMovement (50 bots + 20 obstacles): ${avgMs.toFixed(3)}ms avg`);
      expect(avgMs).toBeLessThan(10);
    });
  });
});
