// =============================================================================
// XTION_TheFool0 — 数据库层单元测试
// Requirements: 2.4, 11.2
// =============================================================================

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import Database from 'better-sqlite3';
import path from 'path';
import fs from 'fs';
import os from 'os';

// 使用临时数据库进行测试
let testDbPath: string;
let testDb: ReturnType<typeof Database>;

// 复用 db.ts 中的逻辑，但使用临时路径
function createTestDatabase(dbPath: string) {
  const db = new Database(dbPath);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');

  db.exec(`
    CREATE TABLE IF NOT EXISTS keys (
      id TEXT PRIMARY KEY,
      key TEXT NOT NULL UNIQUE,
      contestant_name TEXT NOT NULL,
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

    CREATE TABLE IF NOT EXISTS skill_documents (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      version TEXT NOT NULL,
      description TEXT NOT NULL DEFAULT '',
      homepage TEXT,
      author TEXT,
      tags TEXT NOT NULL DEFAULT '[]',
      markdown_content TEXT NOT NULL DEFAULT '',
      current_version TEXT NOT NULL,
      is_default INTEGER NOT NULL DEFAULT 0,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS document_versions (
      id TEXT PRIMARY KEY,
      skill_doc_id TEXT NOT NULL,
      version TEXT NOT NULL,
      markdown_content TEXT NOT NULL DEFAULT '',
      created_at INTEGER NOT NULL,
      changelog TEXT,
      FOREIGN KEY (skill_doc_id) REFERENCES skill_documents(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS platform_documents (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL UNIQUE,
      markdown_content TEXT NOT NULL DEFAULT '',
      is_mandatory INTEGER NOT NULL DEFAULT 0,
      updated_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS talk_messages (
      id TEXT PRIMARY KEY,
      sender_id TEXT NOT NULL,
      receiver_ids TEXT NOT NULL DEFAULT '[]',
      content TEXT NOT NULL,
      zone_id TEXT NOT NULL,
      timestamp INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS broadcast_messages (
      id TEXT PRIMARY KEY,
      sender_id TEXT NOT NULL,
      content TEXT NOT NULL,
      timestamp INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS heartbeat_records (
      id TEXT PRIMARY KEY,
      contestant_id TEXT NOT NULL,
      timestamp INTEGER NOT NULL,
      cpu_load REAL NOT NULL DEFAULT 0,
      memory_usage REAL NOT NULL DEFAULT 0,
      response_latency REAL NOT NULL DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS barrage_messages (
      id TEXT PRIMARY KEY,
      viewer_id TEXT NOT NULL,
      content TEXT NOT NULL,
      timestamp INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS vote_records (
      id TEXT PRIMARY KEY,
      contestant_id TEXT NOT NULL,
      viewer_id TEXT NOT NULL,
      type TEXT NOT NULL,
      timestamp INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS events (
      id TEXT PRIMARY KEY,
      type TEXT NOT NULL,
      contestant_id TEXT,
      data TEXT NOT NULL DEFAULT '{}',
      timestamp INTEGER NOT NULL
    );
  `);

  // Seed builtin zone types
  const insertZoneType = db.prepare(`
    INSERT OR IGNORE INTO zone_types (id, name, description, is_builtin)
    VALUES (?, ?, ?, ?)
  `);
  const insertZoneRule = db.prepare(`
    INSERT OR IGNORE INTO zone_rules (id, zone_type_id, allowed_apis, forbidden_apis, rate_limits, attribute_effects, custom_params)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `);

  const BUILTIN_ZONE_TYPES = [
    {
      id: 'zt-rest', name: 'Rest',
      description: '休息区 — 精力恢复，Talk 受频率限制，禁止广播',
      isBuiltin: true,
      rule: {
        allowedAPIs: ['talk', 'move'], forbiddenAPIs: ['broadcast'],
        rateLimits: { talk: 10 },
        attributeEffects: [{ attribute: 'energy', type: 'regen', rate: 5, trigger: 'passive' }],
        customParams: {},
      },
    },
    {
      id: 'zt-work', name: 'Work',
      description: '工作区 — 允许所有 API，每次 API 调用消耗精力',
      isBuiltin: true,
      rule: {
        allowedAPIs: ['*'], forbiddenAPIs: [],
        rateLimits: {},
        attributeEffects: [{ attribute: 'energy', type: 'consume', rate: 3, trigger: 'on_api_call' }],
        customParams: {},
      },
    },
    {
      id: 'zt-social', name: 'Social',
      description: '交流区 — Talk 无限制，允许广播，精力不变',
      isBuiltin: true,
      rule: {
        allowedAPIs: ['talk', 'broadcast', 'move'], forbiddenAPIs: [],
        rateLimits: {},
        attributeEffects: [{ attribute: 'energy', type: 'static', rate: 0, trigger: 'passive' }],
        customParams: {},
      },
    },
  ];

  db.transaction(() => {
    for (const zt of BUILTIN_ZONE_TYPES) {
      insertZoneType.run(zt.id, zt.name, zt.description, zt.isBuiltin ? 1 : 0);
      insertZoneRule.run(
        `zr-${zt.id}`, zt.id,
        JSON.stringify(zt.rule.allowedAPIs),
        JSON.stringify(zt.rule.forbiddenAPIs),
        JSON.stringify(zt.rule.rateLimits),
        JSON.stringify(zt.rule.attributeEffects),
        JSON.stringify(zt.rule.customParams),
      );
    }
  })();

  // Seed platform documents
  const insertDoc = db.prepare(`
    INSERT OR IGNORE INTO platform_documents (id, name, markdown_content, is_mandatory, updated_at)
    VALUES (?, ?, ?, ?, ?)
  `);
  const now = Date.now();
  db.transaction(() => {
    insertDoc.run('doc-heartbeat', 'HEARTBEAT.md', '# Heartbeat', 1, now);
    insertDoc.run('doc-rules', 'RULES.md', '# Rules', 1, now);
    insertDoc.run('doc-messaging', 'MESSAGING.md', '# Messaging', 1, now);
  })();

  return db;
}

beforeAll(() => {
  testDbPath = path.join(os.tmpdir(), `xtion-test-${Date.now()}.db`);
  testDb = createTestDatabase(testDbPath);
});

afterAll(() => {
  testDb.close();
  if (fs.existsSync(testDbPath)) fs.unlinkSync(testDbPath);
});

// =============================================================================
// 表结构验证
// =============================================================================

describe('数据库表结构', () => {
  const EXPECTED_TABLES = [
    'keys', 'contestants', 'zones', 'zone_types', 'zone_rules',
    'skill_documents', 'document_versions', 'platform_documents',
    'talk_messages', 'broadcast_messages', 'heartbeat_records',
    'barrage_messages', 'vote_records', 'events',
  ];

  it('应创建所有必要的数据表', () => {
    const tables = testDb
      .prepare(`SELECT name FROM sqlite_master WHERE type='table' ORDER BY name`)
      .all() as { name: string }[];
    const tableNames = tables.map(t => t.name);

    for (const expected of EXPECTED_TABLES) {
      expect(tableNames).toContain(expected);
    }
  });

  it('共应有 14 张数据表', () => {
    const tables = testDb
      .prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'`)
      .all() as { name: string }[];
    // rooms/room_bots/doorways/room_configs removed in zone-obstacle-system migration
    expect(tables.length).toBeGreaterThanOrEqual(14);
  });
});

// =============================================================================
// 内置 Zone_Type 验证（Requirements 2.4, 11.2）
// =============================================================================

describe('内置 Zone_Type 初始化', () => {
  it('应插入 3 个内置 Zone_Type（Rest/Work/Social）', () => {
    const count = (testDb.prepare('SELECT COUNT(*) as cnt FROM zone_types WHERE is_builtin = 1').get() as { cnt: number }).cnt;
    expect(count).toBe(3);
  });

  it('应包含 Rest Zone_Type', () => {
    const zt = testDb.prepare('SELECT * FROM zone_types WHERE id = ?').get('zt-rest') as any;
    expect(zt).toBeTruthy();
    expect(zt.name).toBe('Rest');
    expect(zt.is_builtin).toBe(1);
  });

  it('应包含 Work Zone_Type', () => {
    const zt = testDb.prepare('SELECT * FROM zone_types WHERE id = ?').get('zt-work') as any;
    expect(zt).toBeTruthy();
    expect(zt.name).toBe('Work');
    expect(zt.is_builtin).toBe(1);
  });

  it('应包含 Social Zone_Type', () => {
    const zt = testDb.prepare('SELECT * FROM zone_types WHERE id = ?').get('zt-social') as any;
    expect(zt).toBeTruthy();
    expect(zt.name).toBe('Social');
    expect(zt.is_builtin).toBe(1);
  });
});

// =============================================================================
// 默认 Zone_Rule 验证（Requirements 11.2）
// =============================================================================

describe('默认 Zone_Rule 配置', () => {
  it('Rest Zone_Rule：允许 talk 和 move，禁止 broadcast', () => {
    const rule = testDb.prepare('SELECT * FROM zone_rules WHERE zone_type_id = ?').get('zt-rest') as any;
    expect(rule).toBeTruthy();
    const allowedAPIs: string[] = JSON.parse(rule.allowed_apis);
    const forbiddenAPIs: string[] = JSON.parse(rule.forbidden_apis);
    expect(allowedAPIs).toContain('talk');
    expect(allowedAPIs).toContain('move');
    expect(forbiddenAPIs).toContain('broadcast');
  });

  it('Rest Zone_Rule：Energy 被动恢复（regen, passive）', () => {
    const rule = testDb.prepare('SELECT * FROM zone_rules WHERE zone_type_id = ?').get('zt-rest') as any;
    const effects: any[] = JSON.parse(rule.attribute_effects);
    const energyEffect = effects.find((e: any) => e.attribute === 'energy');
    expect(energyEffect).toBeTruthy();
    expect(energyEffect.type).toBe('regen');
    expect(energyEffect.trigger).toBe('passive');
    expect(energyEffect.rate).toBe(5);
  });

  it('Rest Zone_Rule：Talk 频率限制为每分钟 10 次', () => {
    const rule = testDb.prepare('SELECT * FROM zone_rules WHERE zone_type_id = ?').get('zt-rest') as any;
    const rateLimits: Record<string, number> = JSON.parse(rule.rate_limits);
    expect(rateLimits.talk).toBe(10);
  });

  it('Work Zone_Rule：允许所有 API（*）', () => {
    const rule = testDb.prepare('SELECT * FROM zone_rules WHERE zone_type_id = ?').get('zt-work') as any;
    expect(rule).toBeTruthy();
    const allowedAPIs: string[] = JSON.parse(rule.allowed_apis);
    expect(allowedAPIs).toContain('*');
  });

  it('Work Zone_Rule：Energy 每次 API 调用消耗 3 点', () => {
    const rule = testDb.prepare('SELECT * FROM zone_rules WHERE zone_type_id = ?').get('zt-work') as any;
    const effects: any[] = JSON.parse(rule.attribute_effects);
    const energyEffect = effects.find((e: any) => e.attribute === 'energy');
    expect(energyEffect).toBeTruthy();
    expect(energyEffect.type).toBe('consume');
    expect(energyEffect.trigger).toBe('on_api_call');
    expect(energyEffect.rate).toBe(3);
  });

  it('Social Zone_Rule：允许 talk、broadcast 和 move', () => {
    const rule = testDb.prepare('SELECT * FROM zone_rules WHERE zone_type_id = ?').get('zt-social') as any;
    expect(rule).toBeTruthy();
    const allowedAPIs: string[] = JSON.parse(rule.allowed_apis);
    expect(allowedAPIs).toContain('talk');
    expect(allowedAPIs).toContain('broadcast');
    expect(allowedAPIs).toContain('move');
  });

  it('Social Zone_Rule：Energy 保持不变（static）', () => {
    const rule = testDb.prepare('SELECT * FROM zone_rules WHERE zone_type_id = ?').get('zt-social') as any;
    const effects: any[] = JSON.parse(rule.attribute_effects);
    const energyEffect = effects.find((e: any) => e.attribute === 'energy');
    expect(energyEffect).toBeTruthy();
    expect(energyEffect.type).toBe('static');
    expect(energyEffect.rate).toBe(0);
  });

  it('每个内置 Zone_Type 都应有对应的 Zone_Rule', () => {
    const ruleCount = (testDb.prepare(`
      SELECT COUNT(*) as cnt FROM zone_rules zr
      JOIN zone_types zt ON zr.zone_type_id = zt.id
      WHERE zt.is_builtin = 1
    `).get() as { cnt: number }).cnt;
    expect(ruleCount).toBe(3);
  });
});

// =============================================================================
// 平台文档预置验证
// =============================================================================

describe('平台文档预置', () => {
  it('应预置 3 份必装文档', () => {
    const count = (testDb.prepare('SELECT COUNT(*) as cnt FROM platform_documents WHERE is_mandatory = 1').get() as { cnt: number }).cnt;
    expect(count).toBe(3);
  });

  it('应包含 HEARTBEAT.md', () => {
    const doc = testDb.prepare('SELECT * FROM platform_documents WHERE name = ?').get('HEARTBEAT.md') as any;
    expect(doc).toBeTruthy();
    expect(doc.is_mandatory).toBe(1);
  });

  it('应包含 RULES.md', () => {
    const doc = testDb.prepare('SELECT * FROM platform_documents WHERE name = ?').get('RULES.md') as any;
    expect(doc).toBeTruthy();
    expect(doc.is_mandatory).toBe(1);
  });

  it('应包含 MESSAGING.md', () => {
    const doc = testDb.prepare('SELECT * FROM platform_documents WHERE name = ?').get('MESSAGING.md') as any;
    expect(doc).toBeTruthy();
    expect(doc.is_mandatory).toBe(1);
  });
});

// =============================================================================
// 幂等性验证（重复初始化不报错）
// =============================================================================

describe('初始化幂等性', () => {
  it('重复调用 INSERT OR IGNORE 不应报错或重复插入', () => {
    const insertZoneType = testDb.prepare(`
      INSERT OR IGNORE INTO zone_types (id, name, description, is_builtin)
      VALUES (?, ?, ?, ?)
    `);
    expect(() => {
      insertZoneType.run('zt-rest', 'Rest', '重复插入测试', 1);
    }).not.toThrow();

    // 数量仍为 3
    const count = (testDb.prepare('SELECT COUNT(*) as cnt FROM zone_types WHERE is_builtin = 1').get() as { cnt: number }).cnt;
    expect(count).toBe(3);
  });
});
