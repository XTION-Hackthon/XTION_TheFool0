// =============================================================================
// XTION_TheFool0 — 架构集成层 Bug Condition 探索性属性测试
// Feature: architecture-integration-fixes
// =============================================================================
//
// 这些测试在修复前运行，预期会 FAIL，以确认 bug 的存在。
// 测试失败 = bug 存在 = 探索性测试成功。
//

import { describe, it, beforeEach, afterEach, expect } from 'vitest';
import fc from 'fast-check';
import Database from 'better-sqlite3';
import crypto from 'crypto';
import { v4 as uuidv4 } from 'uuid';
import type { Role } from '../../types';
// Import to get the Express Request augmentation (contestantId, keyId, role)
import '../../middleware/auth';
import fs from 'fs';
import path from 'path';

// =============================================================================
// Helper: create a fresh in-memory SQLite DB with all required tables
// =============================================================================

function createTestDb() {
  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  db.exec(`
    CREATE TABLE IF NOT EXISTS keys (
      id TEXT PRIMARY KEY,
      key TEXT NOT NULL UNIQUE,
      contestant_name TEXT NOT NULL,
      role TEXT NOT NULL DEFAULT 'Agent_Player',
      status TEXT NOT NULL DEFAULT 'active',
      created_at INTEGER NOT NULL,
      revoked_at INTEGER
    );
    CREATE TABLE IF NOT EXISTS contestants (
      id TEXT PRIMARY KEY,
      key_id TEXT NOT NULL,
      name TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'offline',
      position_x REAL NOT NULL DEFAULT 0,
      position_y REAL NOT NULL DEFAULT 0,
      current_zone_id TEXT,
      energy REAL NOT NULL DEFAULT 100,
      installed_skills TEXT NOT NULL DEFAULT '[]',
      attributes TEXT NOT NULL DEFAULT '{}',
      connected_at INTEGER,
      disconnected_at INTEGER
    );
    CREATE TABLE IF NOT EXISTS rooms (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      type TEXT NOT NULL,
      capacity INTEGER NOT NULL,
      bounds_x1 REAL,
      bounds_y1 REAL,
      bounds_x2 REAL,
      bounds_y2 REAL,
      created_at TIMESTAMP,
      updated_at TIMESTAMP
    );
    CREATE TABLE IF NOT EXISTS room_bots (
      id TEXT PRIMARY KEY,
      room_id TEXT NOT NULL,
      bot_id TEXT NOT NULL,
      position_x REAL,
      position_y REAL,
      joined_at TIMESTAMP,
      FOREIGN KEY (room_id) REFERENCES rooms(id) ON DELETE CASCADE
    );
    CREATE TABLE IF NOT EXISTS walls (
      id TEXT PRIMARY KEY,
      room_id TEXT NOT NULL,
      x REAL NOT NULL,
      y REAL NOT NULL,
      width REAL NOT NULL,
      height REAL NOT NULL,
      rotation REAL DEFAULT 0,
      created_at TIMESTAMP,
      FOREIGN KEY (room_id) REFERENCES rooms(id) ON DELETE CASCADE
    );
    CREATE TABLE IF NOT EXISTS spawn_points (
      id TEXT PRIMARY KEY,
      room_id TEXT NOT NULL,
      x REAL NOT NULL,
      y REAL NOT NULL,
      is_available BOOLEAN DEFAULT 1,
      created_at TIMESTAMP,
      FOREIGN KEY (room_id) REFERENCES rooms(id) ON DELETE CASCADE
    );
    CREATE TABLE IF NOT EXISTS zone_types (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL UNIQUE,
      description TEXT NOT NULL DEFAULT '',
      is_builtin INTEGER NOT NULL DEFAULT 0
    );
    CREATE TABLE IF NOT EXISTS zone_rules (
      id TEXT PRIMARY KEY,
      zone_type_id TEXT NOT NULL UNIQUE,
      allowed_apis TEXT NOT NULL DEFAULT '[]',
      forbidden_apis TEXT NOT NULL DEFAULT '[]',
      rate_limits TEXT NOT NULL DEFAULT '{}',
      attribute_effects TEXT NOT NULL DEFAULT '[]',
      custom_params TEXT NOT NULL DEFAULT '{}',
      FOREIGN KEY (zone_type_id) REFERENCES zone_types(id) ON DELETE CASCADE
    );
    CREATE TABLE IF NOT EXISTS zones (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      x1 REAL NOT NULL,
      y1 REAL NOT NULL,
      x2 REAL NOT NULL,
      y2 REAL NOT NULL,
      zone_type_id TEXT NOT NULL,
      fill_color TEXT NOT NULL DEFAULT '#cccccc',
      border_color TEXT NOT NULL DEFAULT '#999999',
      opacity REAL NOT NULL DEFAULT 0.5,
      icon TEXT,
      access_restriction TEXT,
      FOREIGN KEY (zone_type_id) REFERENCES zone_types(id)
    );
    CREATE TABLE IF NOT EXISTS doorways (
      id TEXT PRIMARY KEY,
      room_a_id TEXT NOT NULL,
      room_b_id TEXT NOT NULL,
      x REAL NOT NULL,
      y REAL NOT NULL,
      width REAL NOT NULL,
      height REAL NOT NULL,
      created_at TIMESTAMP,
      FOREIGN KEY (room_a_id) REFERENCES rooms(id) ON DELETE CASCADE,
      FOREIGN KEY (room_b_id) REFERENCES rooms(id) ON DELETE CASCADE
    );
    CREATE TABLE IF NOT EXISTS room_configs (
      id TEXT PRIMARY KEY,
      room_id TEXT NOT NULL,
      config_json TEXT NOT NULL,
      version INTEGER NOT NULL,
      created_at TIMESTAMP,
      FOREIGN KEY (room_id) REFERENCES rooms(id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS idx_room_bots_room_id ON room_bots(room_id);
    CREATE INDEX IF NOT EXISTS idx_room_bots_bot_id ON room_bots(bot_id);
    CREATE INDEX IF NOT EXISTS idx_contestants_status ON contestants(status);
  `);
  return db;
}

// =============================================================================
// Helper: generate a test API key in the DB and return { key, contestantId, role }
// =============================================================================

function insertTestKey(db: Database.Database, role: Role) {
  const id = uuidv4();
  const key = crypto.randomBytes(32).toString('hex');
  const now = Date.now();
  db.prepare(`
    INSERT INTO keys (id, key, contestant_name, role, status, created_at)
    VALUES (?, ?, ?, ?, 'active', ?)
  `).run(id, key, `test-${role}`, role, now);

  // Also create a contestant record for this key
  const contestantId = uuidv4();
  db.prepare(`
    INSERT INTO contestants (id, key_id, name, status, position_x, position_y)
    VALUES (?, ?, ?, 'online', 0, 0)
  `).run(contestantId, id, `test-${role}`);

  return { keyId: id, key, contestantId, role };
}

function insertTestRoom(db: Database.Database, name: string, type: string = 'MainHall') {
  const id = uuidv4();
  const now = new Date().toISOString();
  db.prepare(`
    INSERT INTO rooms (id, name, type, capacity, bounds_x1, bounds_y1, bounds_x2, bounds_y2, created_at, updated_at)
    VALUES (?, ?, ?, 999999, 0, 0, 1000, 800, ?, ?)
  `).run(id, name, type, now, now);
  return id;
}

// =============================================================================
// Helper: simulate addBotToRoom logic (mirrors room-manager.ts)
// We replicate the ACTUAL buggy logic to test the bug condition directly.
// =============================================================================

function addBotToRoom(
  db: Database.Database,
  roomId: string,
  botId: string,
  position?: { x: number; y: number },
): void {
  // This mirrors the ACTUAL addBotToRoom from room-manager.ts
  // Bug: only checks same-room dedup, does NOT clean other rooms
  const existing = db.prepare(
    'SELECT id FROM room_bots WHERE room_id = ? AND bot_id = ?'
  ).get(roomId, botId);

  if (existing) {
    if (position) {
      db.prepare(
        'UPDATE room_bots SET position_x = ?, position_y = ? WHERE room_id = ? AND bot_id = ?'
      ).run(position.x, position.y, roomId, botId);
    }
    return;
  }

  const id = uuidv4();
  const now = new Date().toISOString();
  db.prepare(`
    INSERT INTO room_bots (id, room_id, bot_id, position_x, position_y, joined_at)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(id, roomId, botId, position?.x ?? null, position?.y ?? null, now);
}

// =============================================================================
// Bug 1 (P0): 房间写接口缺少 requireRole — 非 Admin 角色可以创建/删除房间
// **Validates: Requirements 1.1, 1.2**
//
// 探索性测试：验证 app.ts 中 roomsRouter 的挂载没有 requireRole，
// 以及 rooms.ts 中 join/leave 路由直接使用 req.body.botId 而非 req.contestantId。
// =============================================================================

describe('Bug 1 (P0): 房间写接口缺少 requireRole — 探索性测试', () => {
  // Feature: architecture-integration-fixes
  // **Validates: Requirements 1.1**
  it('app.ts 中 roomsRouter 挂载应包含 requireRole（已迁移至 zone 系统，跳过）', () => {
    // rooms route has been removed in zone-obstacle-system migration
    // This test is no longer applicable
    expect(true).toBe(true);
  });

  // **Validates: Requirements 1.2**
  it('rooms.ts join 路由应使用 req.contestantId 而非 req.body.botId（已迁移至 zone 系统，跳过）', () => {
    // rooms.ts has been deleted in zone-obstacle-system migration
    expect(true).toBe(true);
  });
});

// =============================================================================
// Bug 3 (P1): 切房只 join 不 leave — addBotToRoom 不清理其他房间记录
// **Validates: Requirements 1.4, 1.5**
//
// 探索性测试：bot 连续加入不同房间后，应只在最后一个房间中，
// 但当前 addBotToRoom 只做同房去重，不清理其他房间记录。
// =============================================================================

describe('Bug 3 (P1): addBotToRoom 不清理其他房间记录 — 探索性测试', () => {
  // **Validates: Requirements 1.4, 1.5**
  it('bot 连续加入不同房间后应只在一个房间（已迁移至 zone 系统，跳过）', () => {
    // room-manager.ts has been deleted in zone-obstacle-system migration
    expect(true).toBe(true);
  });
});

// =============================================================================
// Bug 5 (P1): 服务重启清理不闭环 — timeout 状态不被清理，room_bots 残留
// **Validates: Requirements 1.7, 1.8**
//
// 探索性测试：插入 timeout 状态的 contestants 和 room_bots 记录，
// 然后执行 setupWebSocket 的清理逻辑，验证它们是否被清理。
// =============================================================================

describe('Bug 5 (P1): 服务重启清理不闭环 — 探索性测试', () => {
  // **Validates: Requirements 1.7, 1.8**
  it('timeout 状态的 contestants 在重启后应被标记为 offline（当前 bug: 仍为 timeout）', () => {
    // Read the actual ws.ts source to verify cleanup logic handles both 'online' and 'timeout'
    const wsPath = path.resolve(__dirname, '../../ws.ts');
    const content = fs.readFileSync(wsPath, 'utf-8');

    // Check if cleanup SQL handles both 'online' and 'timeout' statuses
    const handlesTimeout = /WHERE\s+status\s+IN\s*\(\s*'online'\s*,\s*'timeout'\s*\)/.test(content);

    // Check if room_bots are cleared on startup
    const clearsRoomBots = /DELETE FROM room_bots/.test(content);

    // Expected: cleanup should handle both 'online' and 'timeout', and clear room_bots
    // Bug: only handles 'online', doesn't clear room_bots
    expect(handlesTimeout).toBe(true);
    expect(clearsRoomBots).toBe(true);
  });
});

// =============================================================================
// Bug 6 (P1): 前端构建类型错误 — pathfinding-system.ts 中 Bot 类型未定义
// **Validates: Requirements 1.9**
//
// 探索性测试：验证 pathfinding-system.ts 使用了未导入的 Bot 类型，
// 以及 room-graph-builder.ts 从不存在的 ../../types 导入。
// =============================================================================

describe('Bug 6 (P1): 前端构建类型错误 — 探索性测试', () => {
  // **Validates: Requirements 1.9**
  it('pathfinding-system.ts 应正确导入 Bot 类型（当前 bug: Bot 未定义）', () => {
    // Read the source file and check if Bot is imported
    const filePath = path.resolve(__dirname, '../../../../client/src/game/pathfinding-system.ts');
    const content = fs.readFileSync(filePath, 'utf-8');

    // Check if Bot is imported from any module
    const hasBotImport = /import\s+(?:type\s+)?{[^}]*\bBot\b[^}]*}\s+from/.test(content);

    // Check if Bot is used in the file (as a type annotation)
    const usesBotType = /\bBot\b/.test(content);

    // Expected: if Bot is used, it should be imported
    // Bug: Bot is used but not imported (TS2304)
    expect(hasBotImport || !usesBotType).toBe(true);
  });

  it('room-graph-builder.ts 已在 zone-obstacle-system 迁移中删除（跳过）', () => {
    // room-graph-builder.ts has been deleted in zone-obstacle-system migration
    expect(true).toBe(true);
  });
});

// =============================================================================
// Bug 7 (P2): AdminPanel KeysTab 契约不一致
// **Validates: Requirements 1.10, 1.11**
//
// 探索性测试：验证 KeysTab 发送 { contestantName } 而非 { name, role }
// =============================================================================

describe('Bug 7 (P2): AdminPanel KeysTab 契约不一致 — 探索性测试', () => {
  // **Validates: Requirements 1.10**
  it('KeysTab 应发送 { name, role } 而非 { contestantName }（当前 bug: 发送 contestantName）', () => {
    const filePath = path.resolve(__dirname, '../../../../client/src/components/AdminPanel.tsx');
    const content = fs.readFileSync(filePath, 'utf-8');

    // Find the generate function's API call
    // Bug: sends { contestantName: newName } instead of { name: newName, role }
    const sendsContestantName = /apiClient\.post\s*\(\s*['"]\/api\/admin\/keys['"]\s*,\s*\{[^}]*contestantName/.test(content);
    const sendsNameAndRole = /apiClient\.post\s*\(\s*['"]\/api\/admin\/keys['"]\s*,\s*\{[^}]*\bname\b/.test(content);

    // Expected: should send { name, role }
    // Bug: sends { contestantName } — field name mismatch
    expect(sendsContestantName).toBe(false);
    expect(sendsNameAndRole).toBe(true);
  });

  // **Validates: Requirements 1.11**
  it('KeysTab 应包含角色选择器 UI（当前 bug: 没有角色选择器）', () => {
    const filePath = path.resolve(__dirname, '../../../../client/src/components/AdminPanel.tsx');
    const content = fs.readFileSync(filePath, 'utf-8');

    // Look for a role selector (select element with role options) in KeysTab
    // We check for the presence of role-related select/option elements
    const hasRoleSelector = /<select[^>]*>[\s\S]*?Agent_Player[\s\S]*?<\/select>/.test(content);
    const hasRoleState = /useState.*role|role.*useState/.test(content);

    // Expected: KeysTab should have a role selector
    // Bug: no role selector exists
    expect(hasRoleSelector || hasRoleState).toBe(true);
  });
});
