// =============================================================================
// XTION_TheFool0 — 多房间场景集成测试
// Feature: multi-room-collision-system
// Requirements: 1, 2, 9
// =============================================================================

import { describe, it, expect, beforeEach, vi } from 'vitest';
import request from 'supertest';

// ---------------------------------------------------------------------------
// Setup in-memory SQLite and mock db + ws before importing app
// vi.hoisted ensures memDb is created before vi.mock factories run
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

// Insert test keys for auth
const TEST_KEY = 'test-integration-key-multi-room-12345';
const ADMIN_KEY = 'test-admin-key-multi-room-67890';
memDb.prepare(`INSERT INTO keys (id, key, contestant_name, role, status, created_at) VALUES (?, ?, ?, ?, ?, ?)`).run(
  'key-agent-1', TEST_KEY, 'TestAgent', 'Agent_Player', 'active', Date.now()
);
memDb.prepare(`INSERT INTO keys (id, key, contestant_name, role, status, created_at) VALUES (?, ?, ?, ?, ?, ?)`).run(
  'key-admin-1', ADMIN_KEY, 'TestAdmin', 'Admin', 'active', Date.now()
);

import { app } from '../../app';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function authHeader(key = TEST_KEY) {
  return { Authorization: `Bearer ${key}` };
}

function clearRooms() {
  memDb.exec('DELETE FROM room_bots; DELETE FROM spawn_points; DELETE FROM walls; DELETE FROM room_configs; DELETE FROM rooms;');
}

// =============================================================================
// Tests
// =============================================================================

describe('多房间场景集成测试', () => {
  beforeEach(() => {
    clearRooms();
  });

  // -------------------------------------------------------------------------
  // Requirement 1: 多房间架构
  // -------------------------------------------------------------------------

  describe('需求1: 多房间架构', () => {
    it('POST /api/rooms — 创建主大厅', async () => {
      const res = await request(app)
        .post('/api/rooms')
        .set(authHeader())
        .send({ name: 'Main Hall', type: 'MainHall' });

      expect(res.status).toBe(201);
      expect(res.body.name).toBe('Main Hall');
      expect(res.body.type).toBe('MainHall');
      expect(res.body.id).toBeDefined();
    });

    it('POST /api/rooms — 创建私聊房间', async () => {
      const res = await request(app)
        .post('/api/rooms')
        .set(authHeader())
        .send({ name: 'Private Room 1', type: 'PrivateRoom' });

      expect(res.status).toBe(201);
      expect(res.body.type).toBe('PrivateRoom');
      expect(res.body.capacity).toBe(2);
    });

    it('GET /api/rooms — 获取所有房间', async () => {
      await request(app).post('/api/rooms').set(authHeader()).send({ name: 'Hall', type: 'MainHall' });
      await request(app).post('/api/rooms').set(authHeader()).send({ name: 'Private', type: 'PrivateRoom' });

      const res = await request(app).get('/api/rooms').set(authHeader());
      expect(res.status).toBe(200);
      expect(res.body.length).toBe(2);
    });

    it('GET /api/rooms/:id — 获取房间详情', async () => {
      const created = await request(app)
        .post('/api/rooms')
        .set(authHeader())
        .send({ name: 'Hall', type: 'MainHall' });

      const res = await request(app)
        .get(`/api/rooms/${created.body.id}`)
        .set(authHeader());

      expect(res.status).toBe(200);
      expect(res.body.id).toBe(created.body.id);
      expect(res.body.currentCount).toBe(0);
    });

    it('GET /api/rooms/:id — 不存在的房间返回404', async () => {
      const res = await request(app)
        .get('/api/rooms/nonexistent-id')
        .set(authHeader());
      expect(res.status).toBe(404);
    });

    it('DELETE /api/rooms/:id — 删除房间', async () => {
      const created = await request(app)
        .post('/api/rooms')
        .set(authHeader())
        .send({ name: 'Temp Room', type: 'PrivateRoom' });

      const del = await request(app)
        .delete(`/api/rooms/${created.body.id}`)
        .set(authHeader());
      expect(del.status).toBe(204);

      const get = await request(app)
        .get(`/api/rooms/${created.body.id}`)
        .set(authHeader());
      expect(get.status).toBe(404);
    });

    it('POST /api/rooms — 缺少name返回400', async () => {
      const res = await request(app)
        .post('/api/rooms')
        .set(authHeader())
        .send({ type: 'MainHall' });
      expect(res.status).toBe(400);
    });

    it('POST /api/rooms — 无效type返回400', async () => {
      const res = await request(app)
        .post('/api/rooms')
        .set(authHeader())
        .send({ name: 'Bad Room', type: 'InvalidType' });
      expect(res.status).toBe(400);
    });
  });

  // -------------------------------------------------------------------------
  // Requirement 2: 房间容量管理
  // -------------------------------------------------------------------------

  describe('需求2: 房间容量管理', () => {
    it('私聊房间默认容量为2', async () => {
      const res = await request(app)
        .post('/api/rooms')
        .set(authHeader())
        .send({ name: 'Private', type: 'PrivateRoom' });
      expect(res.body.capacity).toBe(2);
    });

    it('主大厅容量为999999（无限）', async () => {
      const res = await request(app)
        .post('/api/rooms')
        .set(authHeader())
        .send({ name: 'Hall', type: 'MainHall' });
      expect(res.body.capacity).toBe(999999);
    });

    it('bot加入房间后currentCount增加', async () => {
      const room = await request(app)
        .post('/api/rooms')
        .set(authHeader())
        .send({ name: 'Hall', type: 'MainHall' });

      await request(app)
        .post(`/api/rooms/${room.body.id}/join`)
        .set(authHeader())
        .send({ botId: 'bot-1', position: { x: 100, y: 100 } });

      const detail = await request(app)
        .get(`/api/rooms/${room.body.id}`)
        .set(authHeader());

      expect(detail.body.currentCount).toBe(1);
    });

    it('私聊房间满员后第三个bot被拒绝', async () => {
      const room = await request(app)
        .post('/api/rooms')
        .set(authHeader())
        .send({ name: 'Private', type: 'PrivateRoom' });

      await request(app)
        .post(`/api/rooms/${room.body.id}/join`)
        .set(authHeader())
        .send({ botId: 'bot-1', position: { x: 100, y: 100 } });

      await request(app)
        .post(`/api/rooms/${room.body.id}/join`)
        .set(authHeader())
        .send({ botId: 'bot-2', position: { x: 200, y: 200 } });

      const res = await request(app)
        .post(`/api/rooms/${room.body.id}/join`)
        .set(authHeader())
        .send({ botId: 'bot-3', position: { x: 300, y: 300 } });

      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('ROOM_AT_CAPACITY');
    });

    it('bot离开后房间重新可加入', async () => {
      const room = await request(app)
        .post('/api/rooms')
        .set(authHeader())
        .send({ name: 'Private', type: 'PrivateRoom' });

      await request(app)
        .post(`/api/rooms/${room.body.id}/join`)
        .set(authHeader())
        .send({ botId: 'bot-1', position: { x: 100, y: 100 } });

      await request(app)
        .post(`/api/rooms/${room.body.id}/join`)
        .set(authHeader())
        .send({ botId: 'bot-2', position: { x: 200, y: 200 } });

      // Leave
      await request(app)
        .post(`/api/rooms/${room.body.id}/leave`)
        .set(authHeader())
        .send({ botId: 'bot-1' });

      // Now bot-3 can join
      const res = await request(app)
        .post(`/api/rooms/${room.body.id}/join`)
        .set(authHeader())
        .send({ botId: 'bot-3', position: { x: 300, y: 300 } });

      expect(res.status).toBe(200);
    });

    it('GET /api/rooms 显示currentCount', async () => {
      const room = await request(app)
        .post('/api/rooms')
        .set(authHeader())
        .send({ name: 'Hall', type: 'MainHall' });

      await request(app)
        .post(`/api/rooms/${room.body.id}/join`)
        .set(authHeader())
        .send({ botId: 'bot-x', position: { x: 50, y: 50 } });

      const list = await request(app).get('/api/rooms').set(authHeader());
      const found = list.body.find((r: { id: string }) => r.id === room.body.id);
      expect(found.currentCount).toBe(1);
    });
  });

  // -------------------------------------------------------------------------
  // Requirement 9: 房间切换
  // -------------------------------------------------------------------------

  describe('需求9: 房间切换', () => {
    it('bot可以离开一个房间并加入另一个房间', async () => {
      const hall = await request(app)
        .post('/api/rooms')
        .set(authHeader())
        .send({ name: 'Main Hall', type: 'MainHall' });

      const priv = await request(app)
        .post('/api/rooms')
        .set(authHeader())
        .send({ name: 'Private', type: 'PrivateRoom' });

      // Join hall
      await request(app)
        .post(`/api/rooms/${hall.body.id}/join`)
        .set(authHeader())
        .send({ botId: 'bot-switch', position: { x: 100, y: 100 } });

      // Leave hall
      await request(app)
        .post(`/api/rooms/${hall.body.id}/leave`)
        .set(authHeader())
        .send({ botId: 'bot-switch' });

      // Join private
      const joinPriv = await request(app)
        .post(`/api/rooms/${priv.body.id}/join`)
        .set(authHeader())
        .send({ botId: 'bot-switch', position: { x: 50, y: 50 } });

      expect(joinPriv.status).toBe(200);

      const hallDetail = await request(app).get(`/api/rooms/${hall.body.id}`).set(authHeader());
      const privDetail = await request(app).get(`/api/rooms/${priv.body.id}`).set(authHeader());

      expect(hallDetail.body.currentCount).toBe(0);
      expect(privDetail.body.currentCount).toBe(1);
    });

    it('加入房间时返回botId和roomId', async () => {
      const room = await request(app)
        .post('/api/rooms')
        .set(authHeader())
        .send({ name: 'Hall', type: 'MainHall' });

      const res = await request(app)
        .post(`/api/rooms/${room.body.id}/join`)
        .set(authHeader())
        .send({ botId: 'bot-join', position: { x: 10, y: 20 } });

      expect(res.status).toBe(200);
      expect(res.body.botId).toBe('bot-join');
      expect(res.body.roomId).toBe(room.body.id);
    });

    it('离开不存在的房间返回404', async () => {
      const res = await request(app)
        .post('/api/rooms/nonexistent/leave')
        .set(authHeader())
        .send({ botId: 'bot-x' });
      expect(res.status).toBe(404);
    });

    it('加入不存在的房间返回404', async () => {
      const res = await request(app)
        .post('/api/rooms/nonexistent/join')
        .set(authHeader())
        .send({ botId: 'bot-x' });
      expect(res.status).toBe(404);
    });

    it('PUT /api/rooms/:id — 更新房间名称', async () => {
      const room = await request(app)
        .post('/api/rooms')
        .set(authHeader())
        .send({ name: 'Old Name', type: 'MainHall' });

      const updated = await request(app)
        .put(`/api/rooms/${room.body.id}`)
        .set(authHeader())
        .send({ name: 'New Name' });

      expect(updated.status).toBe(200);
      expect(updated.body.name).toBe('New Name');
    });
  });

  // -------------------------------------------------------------------------
  // Auth guard
  // -------------------------------------------------------------------------

  describe('认证守卫', () => {
    it('无token访问返回401', async () => {
      const res = await request(app).get('/api/rooms');
      expect(res.status).toBe(401);
    });
  });
});
