// =============================================================================
// XTION_TheFool0 — 性能验收基准测试
// Feature: multi-room-collision-system
// Task: 11.2 性能验收
// **Validates: Requirements 8**
// =============================================================================

import { describe, it, expect, beforeEach, vi } from 'vitest';

// ---------------------------------------------------------------------------
// In-memory SQLite setup — mock db before importing managers
// ---------------------------------------------------------------------------

const { memDb } = vi.hoisted(() => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const Database = require('better-sqlite3') as typeof import('better-sqlite3').default;
  const memDb = new Database(':memory:');
  memDb.pragma('foreign_keys = ON');
  return { memDb };
});

memDb.exec(`
  CREATE TABLE IF NOT EXISTS rooms (
    id TEXT PRIMARY KEY, name TEXT NOT NULL, type TEXT NOT NULL,
    capacity INTEGER NOT NULL, bounds_x1 REAL, bounds_y1 REAL,
    bounds_x2 REAL, bounds_y2 REAL, created_at TIMESTAMP, updated_at TIMESTAMP
  );
  CREATE TABLE IF NOT EXISTS walls (
    id TEXT PRIMARY KEY, room_id TEXT NOT NULL, x REAL NOT NULL,
    y REAL NOT NULL, width REAL NOT NULL, height REAL NOT NULL,
    rotation REAL DEFAULT 0, created_at TIMESTAMP,
    FOREIGN KEY (room_id) REFERENCES rooms(id)
  );
  CREATE TABLE IF NOT EXISTS spawn_points (
    id TEXT PRIMARY KEY, room_id TEXT NOT NULL, x REAL NOT NULL,
    y REAL NOT NULL, is_available BOOLEAN DEFAULT 1, created_at TIMESTAMP,
    FOREIGN KEY (room_id) REFERENCES rooms(id)
  );
  CREATE TABLE IF NOT EXISTS room_configs (
    id TEXT PRIMARY KEY, room_id TEXT NOT NULL, config_json TEXT NOT NULL,
    version INTEGER NOT NULL, created_at TIMESTAMP,
    FOREIGN KEY (room_id) REFERENCES rooms(id)
  );
  CREATE TABLE IF NOT EXISTS room_bots (
    id TEXT PRIMARY KEY, room_id TEXT NOT NULL, bot_id TEXT NOT NULL,
    position_x REAL, position_y REAL, joined_at TIMESTAMP,
    FOREIGN KEY (room_id) REFERENCES rooms(id)
  );
`);

vi.mock('../../db', () => ({ db: memDb }));

// Import managers after mocking
import { roomManager } from '../../modules/room-manager';
import { collisionManager } from '../../modules/collision-manager';

// =============================================================================
// Helpers
// =============================================================================

const ROOM_ID = 'perf-room';
const NOW = new Date().toISOString();

function clearAll(): void {
  memDb.exec('DELETE FROM room_bots; DELETE FROM spawn_points; DELETE FROM walls; DELETE FROM rooms;');
}

function createTestRoom(id: string = ROOM_ID): void {
  memDb.prepare(`
    INSERT INTO rooms (id, name, type, capacity, bounds_x1, bounds_y1, bounds_x2, bounds_y2, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(id, 'PerfTestRoom', 'MainHall', 999999, 0, 0, 2000, 2000, NOW, NOW);
}

function addBot(roomId: string, botId: string, x: number, y: number): void {
  memDb.prepare(`
    INSERT INTO room_bots (id, room_id, bot_id, position_x, position_y, joined_at)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(crypto.randomUUID(), roomId, botId, x, y, NOW);
}

function addWall(roomId: string, x: number, y: number, w: number, h: number): void {
  memDb.prepare(`
    INSERT INTO walls (id, room_id, x, y, width, height, rotation, created_at)
    VALUES (?, ?, ?, ?, ?, ?, 0, ?)
  `).run(crypto.randomUUID(), roomId, x, y, w, h, NOW);
}

function addSpawnPoint(roomId: string, x: number, y: number): void {
  memDb.prepare(`
    INSERT INTO spawn_points (id, room_id, x, y, is_available, created_at)
    VALUES (?, ?, ?, ?, 1, ?)
  `).run(crypto.randomUUID(), roomId, x, y, NOW);
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
      createTestRoom();

      // Place 100 bots spread across the room in a 10x10 grid (spacing 100px)
      for (let i = 0; i < 100; i++) {
        const x = (i % 10) * 100 + 50;
        const y = Math.floor(i / 10) * 100 + 50;
        addBot(ROOM_ID, `bot-${i}`, x, y);
      }

      // Add some walls for realistic scenario
      for (let i = 0; i < 10; i++) {
        addWall(ROOM_ID, i * 200, 950, 150, 20);
      }

      // Update spatial index
      collisionManager.updateSpatialIndex(ROOM_ID);

      // Measure: validate movement for a bot to a free position
      const avgMs = measureMs(() => {
        collisionManager.validateMovement(ROOM_ID, 'bot-0', { x: 1500, y: 1500 });
      }, 50);

      console.log(`[Perf] validateMovement (100 bots): ${avgMs.toFixed(3)}ms avg`);
      expect(avgMs).toBeLessThan(10);
    });

    it('checkBotCollision with 100 bots should complete in < 10ms', () => {
      createTestRoom();

      for (let i = 0; i < 100; i++) {
        const x = (i % 10) * 100 + 50;
        const y = Math.floor(i / 10) * 100 + 50;
        addBot(ROOM_ID, `bot-${i}`, x, y);
      }

      collisionManager.updateSpatialIndex(ROOM_ID);

      const avgMs = measureMs(() => {
        collisionManager.checkBotCollision(ROOM_ID, 'bot-0', { x: 750, y: 750 });
      }, 50);

      console.log(`[Perf] checkBotCollision (100 bots): ${avgMs.toFixed(3)}ms avg`);
      expect(avgMs).toBeLessThan(10);
    });

    it('getNearbyBots with 100 bots should complete in < 10ms', () => {
      createTestRoom();

      for (let i = 0; i < 100; i++) {
        const x = (i % 10) * 100 + 50;
        const y = Math.floor(i / 10) * 100 + 50;
        addBot(ROOM_ID, `bot-${i}`, x, y);
      }

      collisionManager.updateSpatialIndex(ROOM_ID);

      const avgMs = measureMs(() => {
        collisionManager.getNearbyBots(ROOM_ID, { x: 500, y: 500 }, 200);
      }, 50);

      console.log(`[Perf] getNearbyBots (100 bots, radius=200): ${avgMs.toFixed(3)}ms avg`);
      expect(avgMs).toBeLessThan(10);
    });

    it('updateSpatialIndex with 100 bots should complete in < 10ms', () => {
      createTestRoom();

      for (let i = 0; i < 100; i++) {
        const x = (i % 10) * 100 + 50;
        const y = Math.floor(i / 10) * 100 + 50;
        addBot(ROOM_ID, `bot-${i}`, x, y);
      }

      const avgMs = measureMs(() => {
        collisionManager.updateSpatialIndex(ROOM_ID);
      }, 20);

      console.log(`[Perf] updateSpatialIndex (100 bots): ${avgMs.toFixed(3)}ms avg`);
      expect(avgMs).toBeLessThan(10);
    });
  });

  // -------------------------------------------------------------------------
  // Benchmark 2: 出生点分配延迟 < 5ms
  // -------------------------------------------------------------------------

  describe('出生点分配延迟 < 5ms', () => {
    it('allocateSpawnPoint should complete in < 5ms', () => {
      createTestRoom();

      // Create 20 spawn points spread across the room
      for (let i = 0; i < 20; i++) {
        addSpawnPoint(ROOM_ID, (i % 5) * 400 + 100, Math.floor(i / 5) * 400 + 100);
      }

      // Add some bots to make allocation non-trivial
      for (let i = 0; i < 10; i++) {
        addBot(ROOM_ID, `bot-${i}`, i * 200 + 50, 50);
      }

      const avgMs = measureMs(() => {
        roomManager.allocateSpawnPoint(ROOM_ID);
      }, 50);

      console.log(`[Perf] allocateSpawnPoint (20 spawn points, 10 bots): ${avgMs.toFixed(3)}ms avg`);
      expect(avgMs).toBeLessThan(5);
    });

    it('allocateSpawnPoint with many bots should complete in < 5ms', () => {
      createTestRoom();

      // Create 30 spawn points
      for (let i = 0; i < 30; i++) {
        addSpawnPoint(ROOM_ID, (i % 6) * 300 + 100, Math.floor(i / 6) * 300 + 100);
      }

      // Add 50 bots
      for (let i = 0; i < 50; i++) {
        addBot(ROOM_ID, `bot-${i}`, (i % 10) * 200 + 50, Math.floor(i / 10) * 200 + 50);
      }

      const avgMs = measureMs(() => {
        roomManager.allocateSpawnPoint(ROOM_ID);
      }, 50);

      console.log(`[Perf] allocateSpawnPoint (30 spawn points, 50 bots): ${avgMs.toFixed(3)}ms avg`);
      expect(avgMs).toBeLessThan(5);
    });
  });

  // -------------------------------------------------------------------------
  // Benchmark 3: 房间切换延迟 < 100ms
  // -------------------------------------------------------------------------

  describe('房间切换延迟 < 100ms', () => {
    it('room switch (leave + join) should complete in < 100ms', () => {
      // Create two rooms
      createTestRoom('room-source');
      createTestRoom('room-target');

      // Add spawn points to target room
      for (let i = 0; i < 10; i++) {
        addSpawnPoint('room-target', (i % 5) * 300 + 100, Math.floor(i / 5) * 300 + 100);
      }

      // Add bot to source room
      const botId = 'switch-bot';
      roomManager.addBotToRoom('room-source', botId, { x: 100, y: 100 });

      // Measure: full room switch cycle (remove from source, add to target, allocate spawn)
      const avgMs = measureMs(() => {
        roomManager.removeBotFromRoom('room-source', botId);
        const spawn = roomManager.allocateSpawnPoint('room-target');
        const pos = spawn ? { x: spawn.x, y: spawn.y } : { x: 100, y: 100 };
        roomManager.addBotToRoom('room-target', botId, pos);

        // Clean up for next iteration
        roomManager.removeBotFromRoom('room-target', botId);
        roomManager.addBotToRoom('room-source', botId, { x: 100, y: 100 });
      }, 20);

      console.log(`[Perf] room switch (leave+join+spawn): ${avgMs.toFixed(3)}ms avg`);
      expect(avgMs).toBeLessThan(100);
    });

    it('room switch with spatial index update should complete in < 100ms', () => {
      createTestRoom('room-a');
      createTestRoom('room-b');

      // Populate room-a with 50 bots
      for (let i = 0; i < 50; i++) {
        addBot('room-a', `bot-${i}`, (i % 10) * 100 + 50, Math.floor(i / 10) * 100 + 50);
      }

      // Add spawn points to room-b
      for (let i = 0; i < 10; i++) {
        addSpawnPoint('room-b', (i % 5) * 300 + 100, Math.floor(i / 5) * 300 + 100);
      }

      collisionManager.updateSpatialIndex('room-a');

      const botId = 'bot-0';

      // Measure: full switch including spatial index updates
      const avgMs = measureMs(() => {
        roomManager.removeBotFromRoom('room-a', botId);
        collisionManager.updateSpatialIndex('room-a');

        const spawn = roomManager.allocateSpawnPoint('room-b');
        const pos = spawn ? { x: spawn.x, y: spawn.y } : { x: 100, y: 100 };
        roomManager.addBotToRoom('room-b', botId, pos);
        collisionManager.updateSpatialIndex('room-b');

        // Clean up for next iteration
        roomManager.removeBotFromRoom('room-b', botId);
        roomManager.addBotToRoom('room-a', botId, { x: 50, y: 50 });
        collisionManager.updateSpatialIndex('room-a');
        collisionManager.updateSpatialIndex('room-b');
      }, 10);

      console.log(`[Perf] room switch with spatial index (50 bots): ${avgMs.toFixed(3)}ms avg`);
      expect(avgMs).toBeLessThan(100);
    });
  });
});
