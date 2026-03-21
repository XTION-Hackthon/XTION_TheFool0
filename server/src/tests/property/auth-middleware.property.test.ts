// =============================================================================
// XTION_TheFool0 — API 认证中间件属性测试
// Property 20: API 认证拦截
// Property 21: 统一错误响应格式
// =============================================================================

import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import express from 'express';
import request from 'supertest';
import Database from 'better-sqlite3';
import { AuthManagerClass } from '../../modules/auth-manager';

// ---------------------------------------------------------------------------
// In-memory DB + AuthManager for isolated testing
// ---------------------------------------------------------------------------

function makeDb() {
  const db = new Database(':memory:');
  db.exec(`
    CREATE TABLE keys (
      id TEXT PRIMARY KEY, key TEXT NOT NULL UNIQUE,
      contestant_name TEXT NOT NULL, role TEXT NOT NULL DEFAULT 'Agent_Player',
      status TEXT NOT NULL DEFAULT 'active',
      created_at INTEGER NOT NULL, revoked_at INTEGER
    );
    CREATE TABLE contestants (
      id TEXT PRIMARY KEY, key_id TEXT, name TEXT
    );
  `);
  return db;
}

function makeApp(db: ReturnType<typeof makeDb>) {
  const authMgr = new AuthManagerClass(db);

  // Inline auth middleware using the test auth manager
  const authMw = async (
    req: express.Request,
    _res: express.Response,
    next: express.NextFunction,
  ) => {
    const authHeader = req.headers['authorization'];
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      const err = Object.assign(new Error('缺少 Authorization: Bearer <key> 头'), {
        statusCode: 401, code: 'AUTH_MISSING_KEY',
      });
      return next(err);
    }
    const key = authHeader.slice(7).trim();
    if (!key) {
      const err = Object.assign(new Error('缺少 Authorization: Bearer <key> 头'), {
        statusCode: 401, code: 'AUTH_MISSING_KEY',
      });
      return next(err);
    }
    const result = await authMgr.validateKey(key);
    if (!result.valid) {
      const err = Object.assign(new Error('Key 无效或已被吊销'), {
        statusCode: 401, code: 'AUTH_INVALID_KEY',
      });
      return next(err);
    }
    next();
  };

  const app = express();
  app.use(express.json());

  // Protected route
  app.get('/api/protected', authMw, (_req, res) => {
    res.json({ ok: true });
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

const safeStr = (min = 1, max = 20) =>
  fc.stringOf(
    fc.constantFrom(...'abcdefghijklmnopqrstuvwxyz0123456789'.split('')),
    { minLength: min, maxLength: max },
  );

// ---------------------------------------------------------------------------
// Property 20: API 认证拦截
// ---------------------------------------------------------------------------

describe('Property 20: API 认证拦截', () => {
  it('有效 Key 返回 200', async () => {
    await fc.assert(
      fc.asyncProperty(
        safeStr(1, 20),
        async (name) => {
          const db = makeDb();
          const { app, authMgr } = makeApp(db);
          const keyObj = await authMgr.generateKey(name, 'Agent_Player');

          const res = await request(app)
            .get('/api/protected')
            .set('Authorization', `Bearer ${keyObj.key}`);

          expect(res.status).toBe(200);
        },
      ),
      { numRuns: 30 },
    );
  });

  it('无效 Key 返回 401 + AUTH_INVALID_KEY', async () => {
    await fc.assert(
      fc.asyncProperty(
        safeStr(5, 40),
        async (fakeKey) => {
          const db = makeDb();
          const { app } = makeApp(db);

          const res = await request(app)
            .get('/api/protected')
            .set('Authorization', `Bearer ${fakeKey}`);

          expect(res.status).toBe(401);
          expect(res.body.error.code).toBe('AUTH_INVALID_KEY');
        },
      ),
      { numRuns: 30 },
    );
  });

  it('缺少 Authorization 头返回 401 + AUTH_MISSING_KEY', async () => {
    const db = makeDb();
    const { app } = makeApp(db);

    const res = await request(app).get('/api/protected');
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('AUTH_MISSING_KEY');
  });

  it('已吊销的 Key 返回 401', async () => {
    await fc.assert(
      fc.asyncProperty(
        safeStr(1, 20),
        async (name) => {
          const db = makeDb();
          const { app, authMgr } = makeApp(db);
          const keyObj = await authMgr.generateKey(name, 'Agent_Player');
          await authMgr.revokeKey(keyObj.id);

          const res = await request(app)
            .get('/api/protected')
            .set('Authorization', `Bearer ${keyObj.key}`);

          expect(res.status).toBe(401);
        },
      ),
      { numRuns: 20 },
    );
  });
});

// ---------------------------------------------------------------------------
// Property 21: 统一错误响应格式
// ---------------------------------------------------------------------------

describe('Property 21: 统一错误响应格式', () => {
  it('所有错误响应符合 { error: { code, message } } 格式', async () => {
    await fc.assert(
      fc.asyncProperty(
        safeStr(5, 40),
        async (fakeKey) => {
          const db = makeDb();
          const { app } = makeApp(db);

          const res = await request(app)
            .get('/api/protected')
            .set('Authorization', `Bearer ${fakeKey}`);

          // Must have error wrapper
          expect(res.body).toHaveProperty('error');
          expect(res.body.error).toHaveProperty('code');
          expect(res.body.error).toHaveProperty('message');
          expect(typeof res.body.error.code).toBe('string');
          expect(typeof res.body.error.message).toBe('string');
          expect(res.body.error.code.length).toBeGreaterThan(0);
        },
      ),
      { numRuns: 30 },
    );
  });

  it('缺少 key 时错误格式正确', async () => {
    const db = makeDb();
    const { app } = makeApp(db);

    const res = await request(app).get('/api/protected');
    expect(res.body).toMatchObject({
      error: {
        code: expect.any(String),
        message: expect.any(String),
      },
    });
  });
});
