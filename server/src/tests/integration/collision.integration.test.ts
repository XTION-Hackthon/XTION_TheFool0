// =============================================================================
// XTION_TheFool0 — 碰撞检测集成测试
// Feature: multi-room-collision-system
// Requirements: 3, 4, 5, 10
// =============================================================================

import { describe, it, expect, beforeEach, vi } from 'vitest';
import request from 'supertest';

// ---------------------------------------------------------------------------
// Setup in-memory SQLite and mock db + ws
// ---------------------------------------------------------------------------

const { memDb } = vi.hoisted(() => {
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
  CREATE TABLE IF NOT EXISTS keys (
    id TEXT PRIMARY KEY, key TEXT NOT NULL UNIQUE, contestant_name TEXT NOT NULL,
    role TEXT NOT NULL DEFAULT 'Agent_Player', status TEXT NOT NULL DEFAULT 'active',
    created_at INTEGER NOT NULL, revoked_at INTEGER
  );
  CREATE TABLE IF NOT EXISTS contestants (
    id TEXT PRIMARY KEY, key_id TEXT NOT NULL, name TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'offline', position_x REAL NOT NULL DEFAULT 0,
    position_y REAL NOT NULL DEFAULT 0, current_zone_id TEXT, energy REAL NOT NULL DEFAULT 100,
    installed_skills TEXT NOT NULL DEFAULT '[]', attributes TEXT NOT NULL DEFAULT '{}',
    connected_at INTEGER, disconnected_at INTEGER
  );
  CREATE TABLE IF NOT EXISTS zones (
    id TEXT PRIMARY KEY, name TEXT NOT NULL, x1 REAL NOT NULL, y1 REAL NOT NULL,
    x2 REAL NOT NULL, y2 REAL NOT NULL, zone_type_id TEXT NOT NULL,
    fill_color TEXT NOT NULL DEFAULT '#cccccc', border_color TEXT NOT NULL DEFAULT '#999999',
    opacity REAL NOT NULL DEFAULT 0.5, icon TEXT, access_restriction TEXT
  );
  CREATE TABLE IF NOT EXISTS zone_types (
    id TEXT PRIMARY KEY, name TEXT NOT NULL UNIQUE, description TEXT NOT NULL DEFAULT '',
    is_builtin INTEGER NOT NULL DEFAULT 0
  );
  CREATE TABLE IF NOT EXISTS zone_rules (
    id TEXT PRIMARY KEY, zone_type_id TEXT NOT NULL UNIQUE,
    allowed_apis TEXT NOT NULL DEFAULT '[]', forbidden_apis TEXT NOT NULL DEFAULT '[]',
    rate_limits TEXT NOT NULL DEFAULT '{}', attribute_effects TEXT NOT NULL DEFAULT '[]',
    custom_params TEXT NOT NULL DEFAULT '{}',
    FOREIGN KEY (zone_type_id) REFERENCES zone_types(id) ON DELETE CASCADE
  );
  CREATE TABLE IF NOT EXISTS skill_documents (
    id TEXT PRIMARY KEY, name TEXT NOT NULL, version TEXT NOT NULL,
    description TEXT NOT NULL DEFAULT '', homepage TEXT, author TEXT,
    tags TEXT NOT NULL DEFAULT '[]', markdown_content TEXT NOT NULL DEFAULT '',
    current_version TEXT NOT NULL, is_default INTEGER NOT NULL DEFAULT 0,
    created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL
  );
  CREATE TABLE IF NOT EXISTS platform_documents (
    id TEXT PRIMARY KEY, name TEXT NOT NULL UNIQUE,
    markdown_content TEXT NOT NULL DEFAULT '', is_mandatory INTEGER NOT NULL DEFAULT 0,
    updated_at INTEGER NOT NULL
  );
  CREATE TABLE IF NOT EXISTS talk_messages (
    id TEXT PRIMARY KEY, sender_id TEXT NOT NULL, receiver_ids TEXT NOT NULL DEFAULT '[]',
    content TEXT NOT NULL, zone_id TEXT NOT NULL, timestamp INTEGER NOT NULL
  );
  CREATE TABLE IF NOT EXISTS broadcast_messages (
    id TEXT PRIMARY KEY, sender_id TEXT NOT NULL, content TEXT NOT NULL, timestamp INTEGER NOT NULL
  );
  CREATE TABLE IF NOT EXISTS heartbeat_records (
    id TEXT PRIMARY KEY, contestant_id TEXT NOT NULL, timestamp INTEGER NOT NULL,
    cpu_load REAL NOT NULL DEFAULT 0, memory_usage REAL NOT NULL DEFAULT 0,
    response_latency REAL NOT NULL DEFAULT 0
  );
  CREATE TABLE IF NOT EXISTS barrage_messages (
    id TEXT PRIMARY KEY, viewer_id TEXT NOT NULL, content TEXT NOT NULL, timestamp INTEGER NOT NULL
  );
  CREATE TABLE IF NOT EXISTS vote_records (
    id TEXT PRIMARY KEY, contestant_id TEXT NOT NULL, viewer_id TEXT NOT NULL,
    type TEXT NOT NULL, timestamp INTEGER NOT NULL
  );
  CREATE TABLE IF NOT EXISTS events (
    id TEXT PRIMARY KEY, type TEXT NOT NULL, contestant_id TEXT,
    data TEXT NOT NULL DEFAULT '{}', timestamp INTEGER NOT NULL
  );
  CREATE TABLE IF NOT EXISTS document_versions (
    id TEXT PRIMARY KEY, skill_doc_id TEXT NOT NULL, version TEXT NOT NULL,
    markdown_content TEXT NOT NULL DEFAULT '', created_at INTEGER NOT NULL, changelog TEXT,
    FOREIGN KEY (skill_doc_id) REFERENCES skill_documents(id) ON DELETE CASCADE
  );
`);

vi.mock('../../db', () => ({ db: memDb }));
vi.mock('../../ws', () => ({
  broadcastBotJoined: vi.fn(),
  broadcastBotLeft: vi.fn(),
  broadcastRoomCapacity: vi.fn(),
  pushSpawnPointAssignment: vi.fn(),
  broadcastCollisionEvent: vi.fn(),
  broadcastRoomState: vi.fn(),
  broadcast: vi.fn(),
  connections: new Map(),
  sendEvent: vi.fn(),
}));

const TEST_KEY = 'test-collision-integration-key-12345';
memDb.prepare(`INSERT INTO keys (id, key, contestant_name, role, status, created_at) VALUES (?, ?, ?, ?, ?, ?)`).run(
  'key-collision-1', TEST_KEY, 'TestAgent', 'Agent_Player', 'active', Date.now()
);

import { app } from '../../app';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function auth() {
  return { Authorization: `Bearer ${TEST_KEY}` };
}

function clearData() {
  memDb.exec('DELETE FROM room_bots; DELETE FROM walls; DELETE FROM spawn_points; DELETE FROM room_configs; DELETE FROM rooms;');
}

async function createRoom(name = 'Test Room', type = 'MainHall') {
  const res = await request(app)
    .post('/api/rooms')
    .set(auth())
    .send({ name, type });
  return res.body as { id: string };
}

async function joinRoom(roomId: string, botId: string, x: number, y: number) {
  return request(app)
    .post(`/api/rooms/${roomId}/join`)
    .set(auth())
    .send({ botId, position: { x, y } });
}

// =============================================================================
// Tests
// =============================================================================

describe('碰撞检测集成测试', () => {
  beforeEach(() => {
    clearData();
  });

  // -------------------------------------------------------------------------
  // Requirement 3 & 5: Bot-Bot 碰撞检测
  // -------------------------------------------------------------------------

  describe('需求3&5: Bot-Bot 碰撞检测', () => {
    it('两个bot位置重叠时检测到碰撞', async () => {
      const room = await createRoom();

      // bot-a at (100, 100)
      await joinRoom(room.id, 'bot-a', 100, 100);

      // bot-b tries to move to (100, 100) — same position as bot-a
      const res = await request(app)
        .post('/api/collision/validate-move')
        .set(auth())
        .send({ roomId: room.id, botId: 'bot-b', targetPos: { x: 100, y: 100 } });

      expect(res.status).toBe(200);
      expect(res.body.valid).toBe(false);
      expect(res.body.collisionType).toBe('bot');
    });

    it('两个bot位置不重叠时不检测到碰撞', async () => {
      const room = await createRoom();

      // bot-a at (100, 100)
      await joinRoom(room.id, 'bot-a', 100, 100);

      // bot-b tries to move to (200, 200) — far from bot-a (100px gap > 32px box)
      const res = await request(app)
        .post('/api/collision/validate-move')
        .set(auth())
        .send({ roomId: room.id, botId: 'bot-b', targetPos: { x: 200, y: 200 } });

      expect(res.status).toBe(200);
      expect(res.body.valid).toBe(true);
    });

    it('bot移动到自身位置不检测到碰撞', async () => {
      const room = await createRoom();
      await joinRoom(room.id, 'bot-self', 150, 150);

      const res = await request(app)
        .post('/api/collision/validate-move')
        .set(auth())
        .send({ roomId: room.id, botId: 'bot-self', targetPos: { x: 150, y: 150 } });

      expect(res.status).toBe(200);
      expect(res.body.valid).toBe(true);
    });

    it('碰撞响应包含collidedWith字段', async () => {
      const room = await createRoom();
      await joinRoom(room.id, 'bot-a', 100, 100);

      const res = await request(app)
        .post('/api/collision/validate-move')
        .set(auth())
        .send({ roomId: room.id, botId: 'bot-b', targetPos: { x: 100, y: 100 } });

      expect(res.body.valid).toBe(false);
      expect(res.body.collidedWith).toBe('bot-a');
    });

    it('空房间中不存在bot碰撞', async () => {
      const room = await createRoom();

      const res = await request(app)
        .post('/api/collision/validate-move')
        .set(auth())
        .send({ roomId: room.id, botId: 'bot-alone', targetPos: { x: 100, y: 100 } });

      expect(res.status).toBe(200);
      expect(res.body.valid).toBe(true);
    });

    it('AABB边界：距离恰好32px时不碰撞', async () => {
      const room = await createRoom();
      await joinRoom(room.id, 'bot-a', 100, 100);

      // 32px gap on x-axis: abs(100 - 132) = 32, NOT < 32, so no collision
      const res = await request(app)
        .post('/api/collision/validate-move')
        .set(auth())
        .send({ roomId: room.id, botId: 'bot-b', targetPos: { x: 132, y: 100 } });

      expect(res.body.valid).toBe(true);
    });

    it('AABB边界：距离31px时碰撞', async () => {
      const room = await createRoom();
      await joinRoom(room.id, 'bot-a', 100, 100);

      // 31px gap: abs(100 - 131) = 31 < 32, collision
      const res = await request(app)
        .post('/api/collision/validate-move')
        .set(auth())
        .send({ roomId: room.id, botId: 'bot-b', targetPos: { x: 131, y: 100 } });

      expect(res.body.valid).toBe(false);
      expect(res.body.collisionType).toBe('bot');
    });
  });

  // -------------------------------------------------------------------------
  // Requirement 4: Bot-Wall 碰撞检测
  // -------------------------------------------------------------------------

  describe('需求4: Bot-Wall 碰撞检测', () => {
    it('bot移动到墙体位置时检测到碰撞', async () => {
      const room = await createRoom();

      // Insert a wall at (200, 200) with 64x64 size
      const wallId = crypto.randomUUID();
      memDb.prepare(
        'INSERT INTO walls (id, room_id, x, y, width, height, rotation, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
      ).run(wallId, room.id, 200, 200, 64, 64, 0, new Date().toISOString());

      // Bot tries to move to wall center (232, 232)
      const res = await request(app)
        .post('/api/collision/validate-move')
        .set(auth())
        .send({ roomId: room.id, botId: 'bot-a', targetPos: { x: 232, y: 232 } });

      expect(res.status).toBe(200);
      expect(res.body.valid).toBe(false);
      expect(res.body.collisionType).toBe('wall');
    });

    it('bot移动到远离墙体的位置时不碰撞', async () => {
      const room = await createRoom();

      const wallId = crypto.randomUUID();
      memDb.prepare(
        'INSERT INTO walls (id, room_id, x, y, width, height, rotation, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
      ).run(wallId, room.id, 200, 200, 64, 64, 0, new Date().toISOString());

      // Bot moves far from wall
      const res = await request(app)
        .post('/api/collision/validate-move')
        .set(auth())
        .send({ roomId: room.id, botId: 'bot-a', targetPos: { x: 500, y: 500 } });

      expect(res.status).toBe(200);
      expect(res.body.valid).toBe(true);
    });

    it('墙体碰撞响应包含collidedWith字段（墙体ID）', async () => {
      const room = await createRoom();

      const wallId = crypto.randomUUID();
      memDb.prepare(
        'INSERT INTO walls (id, room_id, x, y, width, height, rotation, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
      ).run(wallId, room.id, 300, 300, 64, 64, 0, new Date().toISOString());

      const res = await request(app)
        .post('/api/collision/validate-move')
        .set(auth())
        .send({ roomId: room.id, botId: 'bot-a', targetPos: { x: 332, y: 332 } });

      expect(res.body.valid).toBe(false);
      expect(res.body.collisionType).toBe('wall');
      expect(res.body.collidedWith).toBe(wallId);
    });

    it('没有墙体的房间不检测到墙体碰撞', async () => {
      const room = await createRoom();

      const res = await request(app)
        .post('/api/collision/validate-move')
        .set(auth())
        .send({ roomId: room.id, botId: 'bot-a', targetPos: { x: 100, y: 100 } });

      expect(res.body.valid).toBe(true);
    });
  });

  // -------------------------------------------------------------------------
  // Requirement 3: 移动验证
  // -------------------------------------------------------------------------

  describe('需求3: 移动验证', () => {
    it('bot碰撞优先于墙体碰撞检测', async () => {
      const room = await createRoom();

      // Place bot-a at (100, 100)
      await joinRoom(room.id, 'bot-a', 100, 100);

      // Also place a wall at (100, 100)
      const wallId = crypto.randomUUID();
      memDb.prepare(
        'INSERT INTO walls (id, room_id, x, y, width, height, rotation, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
      ).run(wallId, room.id, 84, 84, 32, 32, 0, new Date().toISOString());

      const res = await request(app)
        .post('/api/collision/validate-move')
        .set(auth())
        .send({ roomId: room.id, botId: 'bot-b', targetPos: { x: 100, y: 100 } });

      // Bot collision is checked first
      expect(res.body.valid).toBe(false);
      expect(res.body.collisionType).toBe('bot');
    });

    it('缺少roomId返回400', async () => {
      const res = await request(app)
        .post('/api/collision/validate-move')
        .set(auth())
        .send({ botId: 'bot-a', targetPos: { x: 100, y: 100 } });

      expect(res.status).toBe(400);
    });

    it('缺少botId返回400', async () => {
      const res = await request(app)
        .post('/api/collision/validate-move')
        .set(auth())
        .send({ roomId: 'some-room', targetPos: { x: 100, y: 100 } });

      expect(res.status).toBe(400);
    });

    it('缺少targetPos返回400', async () => {
      const res = await request(app)
        .post('/api/collision/validate-move')
        .set(auth())
        .send({ roomId: 'some-room', botId: 'bot-a' });

      expect(res.status).toBe(400);
    });

    it('targetPos缺少x/y返回400', async () => {
      const res = await request(app)
        .post('/api/collision/validate-move')
        .set(auth())
        .send({ roomId: 'some-room', botId: 'bot-a', targetPos: { x: 'bad' } });

      expect(res.status).toBe(400);
    });
  });

  // -------------------------------------------------------------------------
  // Requirement 8: 空间索引 — nearby-bots
  // -------------------------------------------------------------------------

  describe('需求8: 空间索引 — nearby-bots', () => {
    it('GET /api/collision/nearby-bots — 返回附近bot', async () => {
      const room = await createRoom();
      await joinRoom(room.id, 'bot-near', 100, 100);
      await joinRoom(room.id, 'bot-far', 1000, 1000);

      const res = await request(app)
        .get('/api/collision/nearby-bots')
        .set(auth())
        .query({ roomId: room.id, x: 100, y: 100, radius: 200 });

      expect(res.status).toBe(200);
      expect(res.body.botIds).toContain('bot-near');
      expect(res.body.botIds).not.toContain('bot-far');
    });

    it('GET /api/collision/nearby-bots — 缺少roomId返回400', async () => {
      const res = await request(app)
        .get('/api/collision/nearby-bots')
        .set(auth())
        .query({ x: 100, y: 100 });

      expect(res.status).toBe(400);
    });

    it('GET /api/collision/nearby-bots — 缺少x/y返回400', async () => {
      const res = await request(app)
        .get('/api/collision/nearby-bots')
        .set(auth())
        .query({ roomId: 'some-room' });

      expect(res.status).toBe(400);
    });

    it('GET /api/collision/nearby-bots — 无效radius返回400', async () => {
      const res = await request(app)
        .get('/api/collision/nearby-bots')
        .set(auth())
        .query({ roomId: 'some-room', x: 100, y: 100, radius: -10 });

      expect(res.status).toBe(400);
    });
  });

  // -------------------------------------------------------------------------
  // Requirement 10: 碰撞响应和恢复
  // -------------------------------------------------------------------------

  describe('需求10: 碰撞响应和恢复', () => {
    it('碰撞时返回足够信息供bot绕行', async () => {
      const room = await createRoom();
      await joinRoom(room.id, 'bot-blocker', 100, 100);

      const res = await request(app)
        .post('/api/collision/validate-move')
        .set(auth())
        .send({ roomId: room.id, botId: 'bot-mover', targetPos: { x: 100, y: 100 } });

      expect(res.body.valid).toBe(false);
      expect(res.body.error).toBeDefined();
      expect(res.body.collisionType).toBeDefined();
      expect(res.body.collidedWith).toBeDefined();
    });

    it('碰撞后可以尝试替代位置', async () => {
      const room = await createRoom();
      await joinRoom(room.id, 'bot-blocker', 100, 100);

      // First attempt — blocked
      const blocked = await request(app)
        .post('/api/collision/validate-move')
        .set(auth())
        .send({ roomId: room.id, botId: 'bot-mover', targetPos: { x: 100, y: 100 } });
      expect(blocked.body.valid).toBe(false);

      // Alternative position — clear
      const clear = await request(app)
        .post('/api/collision/validate-move')
        .set(auth())
        .send({ roomId: room.id, botId: 'bot-mover', targetPos: { x: 300, y: 300 } });
      expect(clear.body.valid).toBe(true);
    });

    it('无token访问碰撞API返回401', async () => {
      const res = await request(app)
        .post('/api/collision/validate-move')
        .send({ roomId: 'r', botId: 'b', targetPos: { x: 0, y: 0 } });
      expect(res.status).toBe(401);
    });
  });
});
