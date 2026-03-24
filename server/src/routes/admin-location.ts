// =============================================================================
// XTION_TheFool0 — Admin Location API 路由
// GET /api/admin/location/all
// GET /api/admin/rooms/:id
// Requirements: 6.2, 6.3
// =============================================================================

import { Router, type Request, type Response, type NextFunction } from 'express';
import { locationManager } from '../modules/location-manager.js';
import type { ErrorResponse } from '../types/index.js';

export const adminLocationRouter = Router();

// ---------------------------------------------------------------------------
// GET /api/admin/location/all — 查询所有 Agent 位置状态
// 仅 Admin 可访问（由 app.ts 中的 requireRole 中间件保证）
// Requirements: 6.2
// ---------------------------------------------------------------------------

adminLocationRouter.get('/location/all', (_req: Request, res: Response, next: NextFunction) => {
  try {
    const agents = locationManager.getAllStates();
    res.status(200).json({ agents });
  } catch (err) {
    next(err);
  }
});

// ---------------------------------------------------------------------------
// GET /api/admin/rooms/:id — 查询指定房间占用情况
// 仅 Admin 可访问（由 app.ts 中的 requireRole 中间件保证）
// Requirements: 6.3
// ---------------------------------------------------------------------------

adminLocationRouter.get('/rooms/:id', (req: Request, res: Response, next: NextFunction) => {
  try {
    const roomId = parseInt((req.params as { id: string }).id, 10);

    if (isNaN(roomId) || roomId < 1 || roomId > 8) {
      const body: ErrorResponse = {
        error: { code: 'SYS_INVALID_PARAMS', message: '房间 ID 必须为 1-8 之间的整数' },
      };
      res.status(400).json(body);
      return;
    }

    const occupancy = locationManager.getRoomOccupancy(roomId);
    res.status(200).json({
      room_id: roomId,
      slotA: occupancy.slotA,
      slotB: occupancy.slotB,
    });
  } catch (err) {
    next(err);
  }
});
