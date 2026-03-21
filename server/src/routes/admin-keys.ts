// =============================================================================
// XTION_TheFool0 — 管理员 Key 管理路由
// Requirements: 1.2, 1.4, 1.6
// =============================================================================

import { Router, type Request, type Response, type NextFunction } from 'express';
import { authManager } from '../modules/auth-manager';
import type { Role } from '../types';

export const adminKeysRouter = Router();

// ---------------------------------------------------------------------------
// 辅助函数：创建带 statusCode 和 code 属性的 HTTP 错误
// ---------------------------------------------------------------------------

function createHttpError(statusCode: number, code: string, message: string): Error & { statusCode: number; code: string } {
  const err = new Error(message) as Error & { statusCode: number; code: string };
  err.statusCode = statusCode;
  err.code = code;
  return err;
}

// ---------------------------------------------------------------------------
// POST /api/admin/keys — 生成新 Key
// Requirements: 1.2, 1.3, 1.7, 1.9
// ---------------------------------------------------------------------------

adminKeysRouter.post('/', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { name, role } = req.body as { name?: string; role?: Role };
    if (!name || typeof name !== 'string' || name.trim() === '') {
      return next(createHttpError(400, 'INVALID_PARAM', '参数 name 不能为空'));
    }
    if (!role) {
      return next(createHttpError(400, 'MISSING_ROLE_FIELD', '参数 role 不能为空'));
    }
    const key = await authManager.generateKey(name.trim(), role);
    res.status(201).json(key);
  } catch (err) {
    next(err);
  }
});

// ---------------------------------------------------------------------------
// GET /api/admin/keys — 获取所有 Key 列表
// Requirements: 1.2, 1.6
// ---------------------------------------------------------------------------

adminKeysRouter.get('/', async (_req: Request, res: Response, next: NextFunction) => {
  try {
    const keys = await authManager.listKeys();
    res.json(keys);
  } catch (err) {
    next(err);
  }
});

// ---------------------------------------------------------------------------
// DELETE /api/admin/keys/:id — 吊销 Key
// Requirements: 1.2
// ---------------------------------------------------------------------------

adminKeysRouter.delete('/:id', async (req: Request, res: Response, next: NextFunction) => {
  try {
    await authManager.revokeKey(req.params['id'] as string);
    res.status(204).end();
  } catch (err) {
    const e = err as Error;
    if (e.message.includes('not found') || e.message.includes('already revoked')) {
      return next(createHttpError(404, 'KEY_NOT_FOUND', e.message));
    }
    next(err);
  }
});

// ---------------------------------------------------------------------------
// POST /api/admin/keys/:id/regenerate — 重新生成 Key
// Requirements: 1.2
// ---------------------------------------------------------------------------

adminKeysRouter.post('/:id/regenerate', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const key = await authManager.regenerateKey(req.params['id'] as string);
    res.json(key);
  } catch (err) {
    const e = err as Error;
    if (e.message.includes('not found')) {
      return next(createHttpError(404, 'KEY_NOT_FOUND', e.message));
    }
    next(err);
  }
});

// ---------------------------------------------------------------------------
// PATCH /api/admin/keys/:id/role — 更新 Key 的角色
// Requirements: 1.4
// ---------------------------------------------------------------------------

adminKeysRouter.patch('/:id/role', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { role } = req.body as { role?: Role };
    const key = await authManager.updateKeyRole(req.params['id'] as string, role as Role);
    res.json(key);
  } catch (err) {
    const e = err as Error;
    if (e.message.includes('not found')) {
      return next(createHttpError(404, 'KEY_NOT_FOUND', e.message));
    }
    next(err);
  }
});
