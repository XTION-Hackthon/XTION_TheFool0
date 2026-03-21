// =============================================================================
// XTION_TheFool0 — API 认证中间件
// Requirements: 8.2, 1.5, 6.1, 6.5
// =============================================================================

import type { Request, Response, NextFunction, RequestHandler } from 'express';
import { authManager } from '../modules/auth-manager';
import type { Role } from '../types';

// Extend Express Request to carry contestantId, keyId, and role after auth
declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      contestantId?: string;
      keyId?: string;   // keys.id
      role?: Role;      // 当前 Key 的角色
    }
  }
}

export function httpError(statusCode: number, code: string, message: string) {
  const err = new Error(message) as Error & { statusCode: number; code: string };
  err.statusCode = statusCode;
  err.code = code;
  return err;
}

/**
 * Validates Bearer token from Authorization header.
 * Sets req.contestantId, req.keyId, and req.role on success.
 * Requirements: 8.2, 1.5, 6.1
 */
export async function authMiddleware(
  req: Request,
  _res: Response,
  next: NextFunction,
): Promise<void> {
  const authHeader = req.headers['authorization'];

  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return next(httpError(401, 'AUTH_MISSING_KEY', '缺少 Authorization: Bearer <key> 头'));
  }

  const key = authHeader.slice(7).trim();
  if (!key) {
    return next(httpError(401, 'AUTH_MISSING_KEY', '缺少 Authorization: Bearer <key> 头'));
  }

  try {
    const result = await authManager.validateKey(key);
    if (!result.valid || !result.contestantId) {
      return next(httpError(401, 'AUTH_INVALID_KEY', 'Key 无效或已被吊销'));
    }
    req.contestantId = result.contestantId;
    req.keyId = result.keyId;
    // 若 role 为 NULL（历史数据），回退为 'Agent_Player'
    req.role = result.role ?? 'Agent_Player';
    next();
  } catch (err) {
    next(err);
  }
}

/**
 * 工厂函数：生成角色检查中间件
 * 必须在 authMiddleware 之后使用
 * Requirements: 6.2, 6.3, 6.4, 6.7
 */
export function requireRole(...roles: Role[]): RequestHandler {
  return (req, _res, next) => {
    if (!req.role) {
      return next(httpError(403, 'MISSING_ROLE', '请求上下文缺少角色信息'));
    }
    if (!roles.includes(req.role)) {
      return next(httpError(403, 'FORBIDDEN_ROLE', `当前角色 ${req.role} 无权访问此接口`));
    }
    next();
  };
}
