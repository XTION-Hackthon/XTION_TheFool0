// =============================================================================
// XTION_TheFool0 — Phase API 路由
// GET  /api/admin/phases              (Admin only)
// POST /api/admin/phases/:id/activate (Admin only)
// GET  /api/phases/current            (all authenticated users)
// Requirements: 13.7, 13.8
// =============================================================================

import { Router, type Request, type Response, type NextFunction } from 'express';
import { phaseManager } from '../modules/phase-manager.js';
import type { ErrorResponse } from '../types/index.js';

// ---------------------------------------------------------------------------
// Admin phase router — mounted at /api/admin by app.ts (Admin middleware applied)
// ---------------------------------------------------------------------------

export const adminPhaseRouter = Router();

// GET /api/admin/phases — 查询所有阶段列表
// Requirements: 13.8
adminPhaseRouter.get('/phases', (_req: Request, res: Response, next: NextFunction) => {
  try {
    const phases = phaseManager.getPhases();
    res.status(200).json({ phases });
  } catch (err) {
    next(err);
  }
});

// POST /api/admin/phases/:id/activate — 切换到指定阶段
// Requirements: 13.3, 13.4, 13.9
adminPhaseRouter.post('/phases/:id/activate', async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const operatorId = req.contestantId ?? req.keyId ?? 'admin';
    const { id } = req.params as { id: string };

    await phaseManager.activatePhase(id, operatorId);

    const activePhase = phaseManager.getActivePhase();
    if (!activePhase) {
      const body: ErrorResponse = {
        error: { code: 'PHASE_NOT_FOUND', message: '阶段不存在' },
      };
      res.status(404).json(body);
      return;
    }

    res.status(200).json({
      phase_id: activePhase.phaseId,
      phase_name: activePhase.phaseName,
    });
  } catch (err) {
    const error = err as Error & { code?: string; statusCode?: number };
    if (error.code === 'PHASE_NOT_FOUND') {
      const body: ErrorResponse = {
        error: { code: error.code, message: error.message },
      };
      res.status(404).json(body);
      return;
    }
    next(err);
  }
});

// ---------------------------------------------------------------------------
// Public phase router — mounted at /api by app.ts (authMiddleware applied)
// ---------------------------------------------------------------------------

export const currentPhaseRouter = Router();

// GET /api/phases/current — 查询当前活跃阶段（所有已认证用户）
// Requirements: 13.7
currentPhaseRouter.get('/phases/current', (_req: Request, res: Response, next: NextFunction) => {
  try {
    const activePhase = phaseManager.getActivePhase();
    if (!activePhase) {
      res.status(200).json({ phase_id: null, phase_name: null });
      return;
    }
    res.status(200).json({
      phase_id: activePhase.phaseId,
      phase_name: activePhase.phaseName,
    });
  } catch (err) {
    next(err);
  }
});
