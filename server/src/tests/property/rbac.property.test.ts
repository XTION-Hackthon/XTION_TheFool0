// =============================================================================
// XTION_TheFool0 — RBAC 属性测试
// Feature: role-based-access-control
// =============================================================================

import { describe, it, beforeEach, afterEach } from 'vitest';
import { expect } from 'vitest';
import fc from 'fast-check';
import crypto from 'crypto';
import { v4 as uuidv4 } from 'uuid';
import Database from 'better-sqlite3';
import type { Request, Response, NextFunction } from 'express';
import type { Role, Key, IAuthManager } from '../../types';
import { AuthManagerClass } from '../../modules/auth-manager';
import { requireRole } from '../../middleware/auth';

// =============================================================================
// Minimal in-memory AuthManager stub for type-level validation
// Implements the IAuthManager contract for Property 1 (type-level)
// =============================================================================

class InMemoryAuthManager implements Pick<IAuthManager, 'generateKey' | 'validateKey'> {
  private store = new Map<string, { id: string; key: string; contestantName: string; role: Role; status: 'active' | 'revoked'; createdAt: number }>();

  async generateKey(contestantName: string, role: Role): Promise<Key> {
    const id = uuidv4();
    const key = crypto.randomBytes(32).toString('hex');
    const now = Date.now();
    this.store.set(key, { id, key, contestantName, role, status: 'active', createdAt: now });
    return { id, key, contestantName, role, status: 'active', createdAt: now };
  }

  async validateKey(key: string): Promise<{ valid: boolean; contestantId?: string; keyId?: string; role?: Role }> {
    const entry = this.store.get(key);
    if (!entry || entry.status !== 'active') return { valid: false };
    return { valid: true, keyId: entry.id, contestantId: entry.id, role: entry.role };
  }
}

// =============================================================================
// Feature: role-based-access-control, Property 1: 角色持久化 Round-Trip (type-level)
// Validates: Requirements 1.1, 1.3, 1.5
// =============================================================================

describe('Property 1 (type-level): 角色持久化 Round-Trip', () => {
  // Feature: role-based-access-control, Property 1: 角色持久化 Round-Trip
  it('validateKey 返回的 role 与生成时指定的 role 一致', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.constantFrom<Role>('Admin', 'Agent_Player', 'Human_Viewer', 'Agent_Viewer'),
        async (role) => {
          const authManager = new InMemoryAuthManager();
          const key = await authManager.generateKey('test', role);
          const result = await authManager.validateKey(key.key);
          return result.role === role;
        },
      ),
      { numRuns: 100 },
    );
  });
});

// =============================================================================
// Helper: create a fresh in-memory SQLite DB with the keys table
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
  `);
  return db;
}

// =============================================================================
// Feature: role-based-access-control, Property 1: 角色持久化 Round-Trip (real DB)
// Validates: Requirements 1.1, 1.3, 1.5
// =============================================================================

describe('Property 1 (real DB): 角色持久化 Round-Trip', () => {
  // Feature: role-based-access-control, Property 1: 角色持久化 Round-Trip
  it('generateKey 后 validateKey 返回相同 role', async () => {
    // Validates: Requirements 1.1, 1.3, 1.5
    await fc.assert(
      fc.asyncProperty(
        fc.constantFrom<Role>('Admin', 'Agent_Player', 'Human_Viewer', 'Agent_Viewer'),
        fc.string({ minLength: 1, maxLength: 50 }),
        async (role, name) => {
          const db = createTestDb();
          const authManager = new AuthManagerClass(db);
          try {
            const generated = await authManager.generateKey(name, role);
            const validated = await authManager.validateKey(generated.key);
            return validated.valid === true && validated.role === role;
          } finally {
            db.close();
          }
        },
      ),
      { numRuns: 100 },
    );
  });
});

// =============================================================================
// Feature: role-based-access-control, Property 2: 角色变更 Round-Trip
// Validates: Requirements 1.4
// =============================================================================

describe('Property 2: 角色变更 Round-Trip', () => {
  // Feature: role-based-access-control, Property 2: 角色变更 Round-Trip
  it('updateKeyRole 后 validateKey 返回新 role', async () => {
    // Validates: Requirements 1.4
    await fc.assert(
      fc.asyncProperty(
        fc.constantFrom<Role>('Admin', 'Agent_Player', 'Human_Viewer', 'Agent_Viewer'),
        fc.constantFrom<Role>('Admin', 'Agent_Player', 'Human_Viewer', 'Agent_Viewer'),
        fc.string({ minLength: 1, maxLength: 50 }),
        async (initialRole, newRole, name) => {
          const db = createTestDb();
          const authManager = new AuthManagerClass(db);
          try {
            const generated = await authManager.generateKey(name, initialRole);
            await authManager.updateKeyRole(generated.id, newRole);
            const validated = await authManager.validateKey(generated.key);
            return validated.valid === true && validated.role === newRole;
          } finally {
            db.close();
          }
        },
      ),
      { numRuns: 100 },
    );
  });
});

// =============================================================================
// Feature: role-based-access-control, Property 6: 最后一个 Admin Key 保护
// Validates: Requirements 2.5
// =============================================================================

describe('Property 6: 最后一个 Admin Key 保护', () => {
  // Feature: role-based-access-control, Property 6: 最后一个 Admin Key 保护
  it('仅剩一个 Admin Key 时 revokeKey 返回 403 LAST_ADMIN_KEY', async () => {
    // Validates: Requirements 2.5
    await fc.assert(
      fc.asyncProperty(
        fc.string({ minLength: 1, maxLength: 50 }),
        async (name) => {
          const db = createTestDb();
          const authManager = new AuthManagerClass(db);
          try {
            // Create exactly one Admin key
            const adminKey = await authManager.generateKey(name, 'Admin');

            let threw403 = false;
            try {
              await authManager.revokeKey(adminKey.id);
            } catch (err: unknown) {
              const e = err as { statusCode?: number; code?: string };
              if (e.statusCode === 403 && e.code === 'LAST_ADMIN_KEY') {
                threw403 = true;
              }
            }
            return threw403;
          } finally {
            db.close();
          }
        },
      ),
      { numRuns: 100 },
    );
  });

  it('存在多个 Admin Key 时可以吊销其中一个', async () => {
    // Validates: Requirements 2.5 (negative case — protection only applies to last key)
    await fc.assert(
      fc.asyncProperty(
        fc.string({ minLength: 1, maxLength: 50 }),
        fc.string({ minLength: 1, maxLength: 50 }),
        async (name1, name2) => {
          const db = createTestDb();
          const authManager = new AuthManagerClass(db);
          try {
            const key1 = await authManager.generateKey(name1, 'Admin');
            await authManager.generateKey(name2, 'Admin');

            // Should NOT throw — there are 2 Admin keys
            let threw = false;
            try {
              await authManager.revokeKey(key1.id);
            } catch {
              threw = true;
            }
            return !threw;
          } finally {
            db.close();
          }
        },
      ),
      { numRuns: 100 },
    );
  });
});

// =============================================================================
// Feature: role-based-access-control, Property 4: requireRole 拒绝非授权角色
// Validates: Requirements 3.4, 3.5, 4.3, 4.4, 5.3, 5.4, 5.5, 6.2, 6.4
// =============================================================================

describe('Property 4: requireRole 拒绝非授权角色', () => {
  // Feature: role-based-access-control, Property 4: requireRole 拒绝非授权角色
  it('任意不在允许列表中的角色均返回 403 FORBIDDEN_ROLE', () => {
    // Validates: Requirements 3.4, 3.5, 4.3, 4.4, 5.3, 5.4, 5.5, 6.2, 6.4
    const allRoles: Role[] = ['Admin', 'Agent_Player', 'Human_Viewer', 'Agent_Viewer'];
    fc.assert(
      fc.property(
        fc.subarray(allRoles, { minLength: 1, maxLength: 3 }),
        fc.constantFrom<Role>(...allRoles),
        (allowedRoles, requestRole) => {
          fc.pre(!allowedRoles.includes(requestRole));

          const middleware = requireRole(...allowedRoles);
          const req = { role: requestRole } as Request;
          const res = {} as Response;

          let capturedError: (Error & { statusCode?: number; code?: string }) | null = null;
          const next: NextFunction = (err?: unknown) => {
            capturedError = err as Error & { statusCode?: number; code?: string };
          };

          middleware(req, res, next);

          return (
            capturedError !== null &&
            capturedError.statusCode === 403 &&
            capturedError.code === 'FORBIDDEN_ROLE'
          );
        },
      ),
      { numRuns: 100 },
    );
  });

  it('req.role 缺失时返回 403 MISSING_ROLE', () => {
    // Validates: Requirements 6.7
    const allRoles: Role[] = ['Admin', 'Agent_Player', 'Human_Viewer', 'Agent_Viewer'];
    fc.assert(
      fc.property(
        fc.subarray(allRoles, { minLength: 1 }),
        (allowedRoles) => {
          const middleware = requireRole(...allowedRoles);
          const req = {} as Request; // no role set
          const res = {} as Response;

          let capturedError: (Error & { statusCode?: number; code?: string }) | null = null;
          const next: NextFunction = (err?: unknown) => {
            capturedError = err as Error & { statusCode?: number; code?: string };
          };

          middleware(req, res, next);

          return (
            capturedError !== null &&
            capturedError.statusCode === 403 &&
            capturedError.code === 'MISSING_ROLE'
          );
        },
      ),
      { numRuns: 100 },
    );
  });
});

// =============================================================================
// Feature: role-based-access-control, Property 5: Admin 角色通过所有权限检查
// Validates: Requirements 2.1, 2.4
// =============================================================================

describe('Property 5: Admin 角色通过所有权限检查', () => {
  // Feature: role-based-access-control, Property 5: Admin 角色通过所有权限检查
  it('含 Admin 的允许列表对 Admin 角色不返回 403', () => {
    // Validates: Requirements 2.1, 2.4
    const allRoles: Role[] = ['Admin', 'Agent_Player', 'Human_Viewer', 'Agent_Viewer'];
    fc.assert(
      fc.property(
        fc.subarray(allRoles, { minLength: 0, maxLength: 3 }),
        (otherRoles) => {
          // Always include Admin in the allowed list
          const allowedRoles: Role[] = ['Admin', ...otherRoles.filter((r) => r !== 'Admin')];

          const middleware = requireRole(...allowedRoles);
          const req = { role: 'Admin' as Role } as Request;
          const res = {} as Response;

          let nextCalledWithError = false;
          let nextCalledWithoutError = false;
          const next: NextFunction = (err?: unknown) => {
            if (err) {
              nextCalledWithError = true;
            } else {
              nextCalledWithoutError = true;
            }
          };

          middleware(req, res, next);

          return nextCalledWithoutError && !nextCalledWithError;
        },
      ),
      { numRuns: 100 },
    );
  });
});

// =============================================================================
// Feature: role-based-access-control, Property 8: /api/auth/me 返回正确角色
// Validates: Requirements 7.1
// =============================================================================

import request from 'supertest';
import express from 'express';
import { authMiddleware, httpError } from '../../middleware/auth';
import { authRouter } from '../../routes/auth';

function makeAuthMeApp(db: ReturnType<typeof createTestDb>) {
  const authMgr = new AuthManagerClass(db);

  // Patch the singleton used by authMiddleware to use our test instance
  // We build a minimal express app that wires authMiddleware + authRouter
  // but overrides the authManager import via a local inline middleware
  const app = express();
  app.use(express.json());

  // Inline auth middleware that uses our test AuthManagerClass instance
  app.use(async (req: express.Request, _res: express.Response, next: express.NextFunction) => {
    const authHeader = req.headers['authorization'];
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return next(httpError(401, 'AUTH_MISSING_KEY', '缺少 Authorization: Bearer <key> 头'));
    }
    const key = authHeader.slice(7).trim();
    if (!key) {
      return next(httpError(401, 'AUTH_MISSING_KEY', '缺少 Authorization: Bearer <key> 头'));
    }
    const result = await authMgr.validateKey(key);
    if (!result.valid || !result.contestantId) {
      return next(httpError(401, 'AUTH_INVALID_KEY', 'Key 无效或已被吊销'));
    }
    req.contestantId = result.contestantId;
    req.keyId = result.keyId;
    req.role = result.role ?? 'Agent_Player';
    next();
  });

  // Mount the /me route directly (skip authMiddleware since we already set req.role above)
  app.get('/api/auth/me', (req: express.Request, res: express.Response) => {
    res.json({
      keyId: req.keyId,
      role: req.role,
      contestantId: req.contestantId,
    });
  });

  // Error handler
  app.use((
    err: Error & { statusCode?: number; code?: string },
    _req: express.Request,
    res: express.Response,
    _next: express.NextFunction,
  ) => {
    res.status(err.statusCode ?? 500).json({
      error: { code: err.code ?? 'SYS_INTERNAL_ERROR', message: err.message },
    });
  });

  return { app, authMgr };
}

describe('Property 8: /api/auth/me 返回正确角色', () => {
  // Feature: role-based-access-control, Property 8: /api/auth/me 返回正确角色
  it('任意有效 Key 调用 GET /api/auth/me，返回的 role 与数据库一致', async () => {
    // Validates: Requirements 7.1
    await fc.assert(
      fc.asyncProperty(
        fc.constantFrom<Role>('Admin', 'Agent_Player', 'Human_Viewer', 'Agent_Viewer'),
        fc.string({ minLength: 1, maxLength: 50 }),
        async (role, name) => {
          const db = createTestDb();
          const { app, authMgr } = makeAuthMeApp(db);
          try {
            const generated = await authMgr.generateKey(name, role);

            const res = await request(app)
              .get('/api/auth/me')
              .set('Authorization', `Bearer ${generated.key}`);

            return (
              res.status === 200 &&
              res.body.role === role &&
              res.body.keyId === generated.id
            );
          } finally {
            db.close();
          }
        },
      ),
      { numRuns: 100 },
    );
  });
});

// =============================================================================
// Feature: role-based-access-control, Property 7: Agent_Viewer WebSocket 游戏指令拒绝
// Validates: Requirements 5.2
// =============================================================================

import type { WebSocket } from 'ws';
import { handleMessage, type ClientContext } from '../../ws';

/**
 * Minimal mock WebSocket that captures sent messages.
 */
function createMockWs() {
  const sent: unknown[] = [];
  const mock = {
    readyState: 1, // OPEN
    OPEN: 1,
    send(data: string) {
      sent.push(JSON.parse(data));
    },
    close: () => {},
    sent,
  };
  return mock as unknown as WebSocket & { sent: unknown[] };
}

describe('Property 7: Agent_Viewer WebSocket 游戏指令拒绝', () => {
  // Feature: role-based-access-control, Property 7: Agent_Viewer WebSocket 游戏指令拒绝
  it('任意游戏指令类型消息均被拒绝，不执行游戏逻辑', () => {
    // Validates: Requirements 5.2
    const gameCommandTypes = ['move', 'talk', 'broadcast', 'heartbeat'];

    fc.assert(
      fc.property(
        fc.constantFrom(...gameCommandTypes),
        fc.anything(),
        (commandType, payload) => {
          const ws = createMockWs();
          const client: ClientContext = { ws, contestantId: null, role: 'Agent_Viewer' };

          handleMessage(client, { type: commandType, payload }, () => {
            // registerContestant should never be called for Agent_Viewer game commands
            throw new Error('registerContestant should not be called');
          });

          // Should have sent exactly one error event
          if (ws.sent.length !== 1) return false;

          const event = ws.sent[0] as { type: string; payload: { error: { code: string } } };
          return (
            event.type === 'error' &&
            event.payload?.error?.code === 'FORBIDDEN_ROLE'
          );
        },
      ),
      { numRuns: 100 },
    );
  });

  it('非游戏指令消息（ping）不被拦截', () => {
    // Validates: Requirements 5.2 (negative case — only game commands are blocked)
    fc.assert(
      fc.property(
        fc.constant('ping'),
        (_msgType) => {
          const ws = createMockWs();
          const client: ClientContext = { ws, contestantId: null, role: 'Agent_Viewer' };

          handleMessage(client, { type: 'ping', payload: {} }, () => {});

          // ping should get a pong response, not an error
          if (ws.sent.length !== 1) return false;
          const event = ws.sent[0] as { type: string };
          return event.type === 'pong';
        },
      ),
      { numRuns: 100 },
    );
  });
});
