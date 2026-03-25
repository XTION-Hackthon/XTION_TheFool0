// =============================================================================
// XTION_TheFool0 — 黑客松幕次控制 API
// Admin 设置当前幕次，Agent 查询当前幕次
// =============================================================================

import { Router, type Request, type Response, type NextFunction } from 'express';
import { requireRole } from '../middleware/auth';

export const hackathonRouter = Router();
export const adminHackathonRouter = Router();

// ---------------------------------------------------------------------------
// 内存状态（简单方案，重启后重置为 0）
// ---------------------------------------------------------------------------

let currentAct = 0; // 0 = 未开始, 1 = 第一幕, 2 = 第二幕, 3 = 第三幕

const ACT_INFO: Record<number, { name: string; skillUrl: string }> = {
  0: { name: '未开始', skillUrl: '' },
  1: { name: '第一幕：自我介绍', skillUrl: 'http://localhost:3000/act1-intro.md' },
  2: { name: '第二幕：破冰组队', skillUrl: 'http://localhost:3000/act2-team.md' },
  3: { name: '第三幕：协作产出', skillUrl: 'http://localhost:3000/act3-product.md' },
};

// ---------------------------------------------------------------------------
// GET /api/hackathon/act — 查询当前幕次（所有已认证用户）
// ---------------------------------------------------------------------------

hackathonRouter.get('/act', (_req: Request, res: Response) => {
  const info = ACT_INFO[currentAct] ?? ACT_INFO[0];
  res.json({
    act: currentAct,
    name: info.name,
    skillUrl: info.skillUrl,
  });
});

// ---------------------------------------------------------------------------
// POST /api/admin/hackathon/act — 设置当前幕次（Admin only）
// Body: { "act": 1 }
// ---------------------------------------------------------------------------

adminHackathonRouter.post(
  '/hackathon/act',
  requireRole('Admin'),
  (req: Request, res: Response, next: NextFunction) => {
    try {
      const { act } = req.body as { act?: number };

      if (act === undefined || typeof act !== 'number' || ![0, 1, 2, 3].includes(act)) {
        const err = new Error('act 必须是 0, 1, 2, 3 之一') as Error & { statusCode: number; code: string };
        err.statusCode = 400;
        err.code = 'INVALID_PARAM';
        return next(err);
      }

      currentAct = act;
      const info = ACT_INFO[currentAct]!;

      console.log(`[Hackathon] 切换到 ${info.name} (act=${act})`);

      res.json({
        act: currentAct,
        name: info.name,
        skillUrl: info.skillUrl,
      });
    } catch (err) {
      next(err);
    }
  },
);
