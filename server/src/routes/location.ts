// =============================================================================
// XTION_TheFool0 — Location API 路由
// GET /api/location/me
// GET /api/location/:id
// Requirements: 6.1, 6.2
// =============================================================================

import { Router, type Request, type Response, type NextFunction } from 'express';
import { locationManager } from '../modules/location-manager.js';
import { requireRole } from '../middleware/auth.js';
import type { ErrorResponse } from '../types/index.js';

export const locationRouter = Router();

// ---------------------------------------------------------------------------
// GET /api/location/me — 查询自身位置状态和坐标
// 仅 Agent_Player 可访问
// Requirements: 6.1
// ---------------------------------------------------------------------------

locationRouter.get('/me', requireRole('Agent_Player'), (req: Request, res: Response, next: NextFunction) => {
  try {
    const contestantId = req.contestantId;
    if (!contestantId) {
      const body: ErrorResponse = {
        error: { code: 'AUTH_MISSING_KEY', message: '未携带有效的认证 Key' },
      };
      res.status(401).json(body);
      return;
    }

    const state = locationManager.getState(contestantId);
    if (!state) {
      const body: ErrorResponse = {
        error: { code: 'NOT_FOUND', message: '未找到该 Agent 的位置状态' },
      };
      res.status(404).json(body);
      return;
    }

    res.status(200).json({
      location_state: state.locationState,
      position: state.slot,
    });
  } catch (err) {
    next(err);
  }
});

// ---------------------------------------------------------------------------
// GET /api/location/:id — 查询指定 Agent 位置状态
// 所有已认证用户可访问
// Requirements: 6.1
// ---------------------------------------------------------------------------

locationRouter.get('/:id', (req: Request, res: Response, next: NextFunction) => {
  try {
    const { id } = req.params as { id: string };

    const state = locationManager.getState(id);
    if (!state) {
      const body: ErrorResponse = {
        error: { code: 'NOT_FOUND', message: '未找到该 Agent 的位置状态' },
      };
      res.status(404).json(body);
      return;
    }

    res.status(200).json({
      location_state: state.locationState,
      position: state.slot,
    });
  } catch (err) {
    next(err);
  }
});
