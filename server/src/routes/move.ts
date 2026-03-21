// =============================================================================
// XTION_TheFool0 — Move API 路由
// POST /api/move
// Requirements: 5.1, 5.2, 5.4, 5.5, 5.7, 11.5
// =============================================================================

import { Router, type Request, type Response } from 'express';
import { db } from '../db';
import { coreAPIHandler, APIError } from '../modules/core-api-handler';
import { requireRole } from '../middleware/auth';
import type { ErrorResponse, Position } from '../types';

export const moveRouter = Router();

// ---------------------------------------------------------------------------
// Helper: extract contestant from Authorization header or senderId fallback
// (Same pattern as broadcast.ts)
// ---------------------------------------------------------------------------

interface ContestantRow {
  id: string;
  name: string;
  status: string;
}

function getContestantFromRequest(req: Request): ContestantRow | null {
  const authHeader = req.headers['authorization'];
  if (authHeader && authHeader.startsWith('Bearer ')) {
    const key = authHeader.slice(7).trim();
    if (key) {
      const keyRow = db.prepare(`
        SELECT id FROM keys WHERE key = ? AND status = 'active'
      `).get(key) as { id: string } | undefined;

      if (keyRow) {
        const contestant = db.prepare(`
          SELECT id, name, status FROM contestants WHERE key_id = ?
        `).get(keyRow.id) as ContestantRow | undefined;
        if (contestant) return contestant;
      }
    }
  }

  // Fallback: use senderId from body
  const { senderId } = req.body as { senderId?: string };
  if (senderId) {
    const contestant = db.prepare(`
      SELECT id, name, status FROM contestants WHERE id = ?
    `).get(senderId) as ContestantRow | undefined;
    if (contestant) return contestant;
  }

  return null;
}

// ---------------------------------------------------------------------------
// POST /api/move
// Body: { target: {x, y} | {zoneId: string} }
// Returns: { newPosition, newZoneId, timestamp }
// ---------------------------------------------------------------------------

moveRouter.post('/', requireRole('Admin', 'Agent_Player'), async (req: Request, res: Response): Promise<void> => {
  // Auth / sender resolution
  const contestant = getContestantFromRequest(req);
  if (!contestant) {
    const body: ErrorResponse = {
      error: { code: 'AUTH_MISSING_KEY', message: '未携带有效的认证 Key 或 senderId' },
    };
    res.status(401).json(body);
    return;
  }

  const { target } = req.body as { target?: unknown };

  // Validate target
  if (!target || typeof target !== 'object') {
    const body: ErrorResponse = {
      error: { code: 'SYS_INVALID_PARAMS', message: 'target 不能为空，需为 {x, y} 或 {zoneId: string}' },
    };
    res.status(400).json(body);
    return;
  }

  const targetObj = target as Record<string, unknown>;

  // Determine target type
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
      contestantId: contestant.id,
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
