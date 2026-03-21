// =============================================================================
// XTION_TheFool0 — 地图编辑集成测试
// Feature: multi-room-collision-system
// Requirements: 6, 7
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

const AGENT_KEY = 'test-map-editor-agent-key-12345';
const ADMIN_KEY = 'test-map-editor-admin-key-67890';
memDb.prepare(`INSERT INTO keys (id, key, contestant_name, role, status, created_at) VALUES (?, ?, ?, ?, ?, ?)`).run(
  'key-map-agent', AGENT_KEY, 'TestAgent', 'Agent_Player', 'active', Date.now()
);
memDb.prepare(`INSERT INTO keys (id, key, contestant_name, role, status, created_at) VALUES (?, ?, ?, ?, ?, ?)`).run(
  'key-map-admin', ADMIN_KEY, 'TestAdmin', 'Admin', 'active', Date.now()
);

import { app } from '../../app';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function adminAuth() {
  return { Authorization: `Bearer ${ADMIN_KEY}` };
}

function agentAuth() {
  return { Authorization: `Bearer ${AGENT_KEY}` };
}

function clearData() {
  memDb.exec('DELETE FROM room_bots; DELETE FROM walls; DELETE FROM spawn_points; DELETE FROM room_configs; DELETE FROM rooms;');
}

async function createRoom(name = 'Test Room', type = 'MainHall') {
  const res = await request(app)
    .post('/api/rooms')
    .set(agentAuth())
    .send({ name, type });
  return res.body as { id: string };
}

const sampleWall = (id = crypto.randomUUID()) => ({
  id,
  roomId: '',
  x: 100,
  y: 100,
  width: 64,
  height: 32,
  rotation: 0,
  createdAt: new Date().toISOString(),
});

const sampleSpawnPoint = (id = crypto.randomUUID()) => ({
  id,
  roomId: '',
  x: 200,
  y: 200,
  isAvailable: true,
  createdAt: new Date().toISOString(),
});

// =============================================================================
// Tests
// =============================================================================

describe('地图编辑集成测试', () => {
  beforeEach(() => {
    clearData();
  });

  // -------------------------------------------------------------------------
  // Requirement 6 & 7: 配置保存和加载
  // -------------------------------------------------------------------------

  describe('需求6&7: 配置保存和加载', () => {
    it('POST /api/map-editor/rooms/:id/config — 保存配置成功', async () => {
      const room = await createRoom();

      const res = await request(app)
        .post(`/api/map-editor/rooms/${room.id}/config`)
        .set(adminAuth())
        .send({
          walls: [sampleWall()],
          spawnPoints: [sampleSpawnPoint()],
          bounds: { x1: 0, y1: 0, x2: 1000, y2: 800 },
        });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.version).toBe(1);
    });

    it('GET /api/map-editor/rooms/:id/config — 加载最新配置', async () => {
      const room = await createRoom();
      const wall = sampleWall();
      const spawn = sampleSpawnPoint();

      await request(app)
        .post(`/api/map-editor/rooms/${room.id}/config`)
        .set(adminAuth())
        .send({ walls: [wall], spawnPoints: [spawn] });

      const res = await request(app)
        .get(`/api/map-editor/rooms/${room.id}/config`)
        .set(adminAuth());

      expect(res.status).toBe(200);
      expect(res.body.walls).toHaveLength(1);
      expect(res.body.spawnPoints).toHaveLength(1);
      expect(res.body.walls[0].x).toBe(100);
    });

    it('GET /api/map-editor/rooms/:id/config — 无配置时返回404', async () => {
      const room = await createRoom();

      const res = await request(app)
        .get(`/api/map-editor/rooms/${room.id}/config`)
        .set(adminAuth());

      expect(res.status).toBe(404);
    });

    it('多次保存后加载最新版本', async () => {
      const room = await createRoom();

      // Save version 1
      await request(app)
        .post(`/api/map-editor/rooms/${room.id}/config`)
        .set(adminAuth())
        .send({ walls: [{ ...sampleWall(), x: 100 }], spawnPoints: [] });

      // Save version 2 with different wall position
      await request(app)
        .post(`/api/map-editor/rooms/${room.id}/config`)
        .set(adminAuth())
        .send({ walls: [{ ...sampleWall(), x: 500 }], spawnPoints: [] });

      const res = await request(app)
        .get(`/api/map-editor/rooms/${room.id}/config`)
        .set(adminAuth());

      expect(res.body.walls[0].x).toBe(500);
    });

    it('保存配置时更新房间bounds', async () => {
      const room = await createRoom();

      await request(app)
        .post(`/api/map-editor/rooms/${room.id}/config`)
        .set(adminAuth())
        .send({
          walls: [],
          spawnPoints: [],
          bounds: { x1: 10, y1: 20, x2: 800, y2: 600 },
        });

      const roomDetail = await request(app)
        .get(`/api/rooms/${room.id}`)
        .set(agentAuth());

      expect(roomDetail.body.bounds).toBeDefined();
      expect(roomDetail.body.bounds.x1).toBe(10);
    });
  });

  // -------------------------------------------------------------------------
  // Requirement 6 AC8 & 7 AC5: 配置验证
  // -------------------------------------------------------------------------

  describe('需求6&7: 配置验证', () => {
    it('墙体宽度为0时验证失败', async () => {
      const room = await createRoom();

      const res = await request(app)
        .post(`/api/map-editor/rooms/${room.id}/config`)
        .set(adminAuth())
        .send({
          walls: [{ ...sampleWall(), width: 0 }],
          spawnPoints: [],
        });

      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('VALIDATION_ERROR');
    });

    it('墙体高度为负数时验证失败', async () => {
      const room = await createRoom();

      const res = await request(app)
        .post(`/api/map-editor/rooms/${room.id}/config`)
        .set(adminAuth())
        .send({
          walls: [{ ...sampleWall(), height: -10 }],
          spawnPoints: [],
        });

      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('VALIDATION_ERROR');
    });

    it('bounds x2 <= x1 时验证失败', async () => {
      const room = await createRoom();

      const res = await request(app)
        .post(`/api/map-editor/rooms/${room.id}/config`)
        .set(adminAuth())
        .send({
          walls: [],
          spawnPoints: [],
          bounds: { x1: 500, y1: 0, x2: 100, y2: 800 },
        });

      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('VALIDATION_ERROR');
    });

    it('bounds y2 <= y1 时验证失败', async () => {
      const room = await createRoom();

      const res = await request(app)
        .post(`/api/map-editor/rooms/${room.id}/config`)
        .set(adminAuth())
        .send({
          walls: [],
          spawnPoints: [],
          bounds: { x1: 0, y1: 800, x2: 1000, y2: 100 },
        });

      expect(res.status).toBe(400);
    });

    it('walls不是数组时返回400', async () => {
      const room = await createRoom();

      const res = await request(app)
        .post(`/api/map-editor/rooms/${room.id}/config`)
        .set(adminAuth())
        .send({ walls: 'not-an-array', spawnPoints: [] });

      expect(res.status).toBe(400);
    });

    it('spawnPoints不是数组时返回400', async () => {
      const room = await createRoom();

      const res = await request(app)
        .post(`/api/map-editor/rooms/${room.id}/config`)
        .set(adminAuth())
        .send({ walls: [], spawnPoints: 'not-an-array' });

      expect(res.status).toBe(400);
    });

    it('有效配置通过验证', async () => {
      const room = await createRoom();

      const res = await request(app)
        .post(`/api/map-editor/rooms/${room.id}/config`)
        .set(adminAuth())
        .send({
          walls: [sampleWall()],
          spawnPoints: [sampleSpawnPoint()],
        });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
    });
  });

  // -------------------------------------------------------------------------
  // Requirement 7 AC4: 版本历史和回滚
  // -------------------------------------------------------------------------

  describe('需求7: 版本历史和回滚', () => {
    it('GET /api/map-editor/rooms/:id/config/history — 返回版本历史', async () => {
      const room = await createRoom();

      await request(app)
        .post(`/api/map-editor/rooms/${room.id}/config`)
        .set(adminAuth())
        .send({ walls: [sampleWall()], spawnPoints: [] });

      await request(app)
        .post(`/api/map-editor/rooms/${room.id}/config`)
        .set(adminAuth())
        .send({ walls: [], spawnPoints: [sampleSpawnPoint()] });

      const res = await request(app)
        .get(`/api/map-editor/rooms/${room.id}/config/history`)
        .set(adminAuth());

      expect(res.status).toBe(200);
      expect(res.body.length).toBe(2);
      // Newest first
      expect(res.body[0].version).toBe(2);
      expect(res.body[1].version).toBe(1);
    });

    it('版本号递增', async () => {
      const room = await createRoom();

      const v1 = await request(app)
        .post(`/api/map-editor/rooms/${room.id}/config`)
        .set(adminAuth())
        .send({ walls: [], spawnPoints: [] });

      const v2 = await request(app)
        .post(`/api/map-editor/rooms/${room.id}/config`)
        .set(adminAuth())
        .send({ walls: [], spawnPoints: [] });

      const v3 = await request(app)
        .post(`/api/map-editor/rooms/${room.id}/config`)
        .set(adminAuth())
        .send({ walls: [], spawnPoints: [] });

      expect(v1.body.version).toBe(1);
      expect(v2.body.version).toBe(2);
      expect(v3.body.version).toBe(3);
    });

    it('POST /api/map-editor/rooms/:id/config/rollback — 回滚到指定版本', async () => {
      const room = await createRoom();

      // Save v1 with a wall
      await request(app)
        .post(`/api/map-editor/rooms/${room.id}/config`)
        .set(adminAuth())
        .send({ walls: [{ ...sampleWall(), x: 111 }], spawnPoints: [] });

      // Get v1 id
      const history1 = await request(app)
        .get(`/api/map-editor/rooms/${room.id}/config/history`)
        .set(adminAuth());
      const v1Id = history1.body[0].id;

      // Save v2 with different wall
      await request(app)
        .post(`/api/map-editor/rooms/${room.id}/config`)
        .set(adminAuth())
        .send({ walls: [{ ...sampleWall(), x: 999 }], spawnPoints: [] });

      // Rollback to v1
      const rollback = await request(app)
        .post(`/api/map-editor/rooms/${room.id}/config/rollback`)
        .set(adminAuth())
        .send({ versionId: v1Id });

      expect(rollback.status).toBe(200);
      expect(rollback.body.success).toBe(true);

      // Latest config should now have x: 111
      const latest = await request(app)
        .get(`/api/map-editor/rooms/${room.id}/config`)
        .set(adminAuth());

      expect(latest.body.walls[0].x).toBe(111);
    });

    it('回滚后版本号继续递增', async () => {
      const room = await createRoom();

      await request(app)
        .post(`/api/map-editor/rooms/${room.id}/config`)
        .set(adminAuth())
        .send({ walls: [], spawnPoints: [] });

      const history = await request(app)
        .get(`/api/map-editor/rooms/${room.id}/config/history`)
        .set(adminAuth());
      const v1Id = history.body[0].id;

      await request(app)
        .post(`/api/map-editor/rooms/${room.id}/config/rollback`)
        .set(adminAuth())
        .send({ versionId: v1Id });

      const historyAfter = await request(app)
        .get(`/api/map-editor/rooms/${room.id}/config/history`)
        .set(adminAuth());

      // Should now have 2 versions (v1 + rollback as v2)
      expect(historyAfter.body.length).toBe(2);
      expect(historyAfter.body[0].version).toBe(2);
    });

    it('回滚不存在的版本返回404', async () => {
      const room = await createRoom();

      const res = await request(app)
        .post(`/api/map-editor/rooms/${room.id}/config/rollback`)
        .set(adminAuth())
        .send({ versionId: 'nonexistent-version-id' });

      expect(res.status).toBe(404);
    });

    it('回滚缺少versionId返回400', async () => {
      const room = await createRoom();

      const res = await request(app)
        .post(`/api/map-editor/rooms/${room.id}/config/rollback`)
        .set(adminAuth())
        .send({});

      expect(res.status).toBe(400);
    });

    it('空房间历史返回空数组', async () => {
      const room = await createRoom();

      const res = await request(app)
        .get(`/api/map-editor/rooms/${room.id}/config/history`)
        .set(adminAuth());

      expect(res.status).toBe(200);
      expect(res.body).toEqual([]);
    });
  });

  // -------------------------------------------------------------------------
  // Auth & Role guard
  // -------------------------------------------------------------------------

  describe('认证和角色守卫', () => {
    it('非Admin角色访问地图编辑API返回403', async () => {
      const room = await createRoom();

      const res = await request(app)
        .post(`/api/map-editor/rooms/${room.id}/config`)
        .set(agentAuth())
        .send({ walls: [], spawnPoints: [] });

      expect(res.status).toBe(403);
    });

    it('无token访问地图编辑API返回401', async () => {
      const res = await request(app)
        .get('/api/map-editor/rooms/some-room/config');

      expect(res.status).toBe(401);
    });
  });
});
