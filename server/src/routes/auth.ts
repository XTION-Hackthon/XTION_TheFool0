// =============================================================================
// XTION_TheFool0 — Auth 端点
// Requirements: 7.1
// =============================================================================

import { Router, type Request, type Response } from 'express';
import { authMiddleware } from '../middleware/auth';

export const authRouter = Router();

// ---------------------------------------------------------------------------
// GET /api/auth/me — 返回当前 Key 的角色和基本信息
// 所有已认证角色均可访问（不加 requireRole）
// Requirements: 7.1
// ---------------------------------------------------------------------------

authRouter.get('/me', authMiddleware, (req: Request, res: Response) => {
  res.json({
    keyId: req.keyId,
    role: req.role,
    contestantId: req.contestantId,
  });
});
