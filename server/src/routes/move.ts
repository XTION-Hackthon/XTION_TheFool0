// =============================================================================
// XTION_TheFool0 — Move API 路由
// POST /api/move
// Requirements: 5.1, 5.2, 5.4, 5.5, 5.7, 11.5
// =============================================================================

import { Router, type Request, type Response } from 'express';
import { coreAPIHandler, APIError } from '../modules/core-api-handler';
import { requireRole } from '../middleware/auth';
import type { ErrorResponse, Position } from '../types';

export const moveRouter = Router();

// ---------------------------------------------------------------------------
// POST /api/move
// Body: { target: {x, y} | {zoneId: string} }
// Returns: { newPosition, newZoneId, timestamp }
// ---------------------------------------------------------------------------

moveRouter.post('/', requireRole('Admin', 'Agent_Player'), async (req: Request, res: Response): Promise<void> => {
  const contestantId = req.contestantId;
  if (!contestantId) {
    const body: ErrorResponse = {
      error: { code: 'AUTH_MISSING_KEY', message: '未携带有效的认证 Key' },
    };
    res.status(401).json(body);
    return;
  }

  const { target } = req.body as { target?: unknown };

  if (!target || typeof target !== 'object') {
    const body: ErrorResponse = {
      error: { code: 'SYS_INVALID_PARAMS', message: 'target 不能为空，需为 {x, y} 或 {zoneId: string}' },
    };
    res.status(400).json(body);
    return;
  }

  const targetObj = target as Record<string, unknown>;

  let parsedTarget: Position | { zoneId: string };

  if ('zoneId' in targetObj && typeof targetObj['zoneId'] === 'string') {
    parsedTarget = { zoneId: targetObj['zoneId'] };
  } else if (
    'x' in targetObj &&
    'y' in targetObj &&
    typeof targetObj['x'] === 'number' &&
    typeof targetObj['y'] === 'number'
  ) {
    parsedTarget = { x: targetObj['x'], y: targetObj['y'] };
  } else {
    const body: ErrorResponse = {
      error: { code: 'SYS_INVALID_PARAMS', message: 'target 格式无效，需为 {x, y} 或 {zoneId: string}' },
    };
    res.status(400).json(body);
    return;
  }

  try {
    const result = await coreAPIHandler.handleMove({
      contestantId,
      target: parsedTarget,
    });

    res.status(200).json({
      newPosition: result.newPosition,
      newZoneId: result.newZoneId,
      timestamp: result.timestamp,
    });
  } catch (err) {
    if (err instanceof APIError) {
      const body: ErrorResponse = {
        error: { code: err.code, message: err.message },
      };
      res.status(err.statusCode).json(body);
      return;
    }
    throw err;
  }
});
