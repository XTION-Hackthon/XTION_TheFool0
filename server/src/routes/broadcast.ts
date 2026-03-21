// =============================================================================
// XTION_TheFool0 — Broadcast API 路由
// POST /api/broadcast
// Requirements: 4.1, 4.2, 4.4, 4.5
// =============================================================================

import { Router, type Request, type Response } from 'express';
import { db } from '../db';
import { coreAPIHandler, APIError } from '../modules/core-api-handler';
import type { ErrorResponse } from '../types';

export const broadcastRouter = Router();

interface ContestantRow {
  id: string;
  name: string;
  status: string;
}

function getContestantFromRequest(req: Request): ContestantRow | null {
  const contestantId = req.contestantId;
  if (!contestantId) return null;
  return db.prepare('SELECT id, name, status FROM contestants WHERE id = ?').get(contestantId) as ContestantRow | null;
}

// ---------------------------------------------------------------------------
// POST /api/broadcast
// ---------------------------------------------------------------------------

broadcastRouter.post('/', async (req: Request, res: Response): Promise<void> => {
  // Auth / sender resolution
  const contestant = getContestantFromRequest(req);
  if (!contestant) {
    const body: ErrorResponse = {
      error: { code: 'AUTH_MISSING_KEY', message: '未携带有效的认证 Key' },
    };
    res.status(401).json(body);
    return;
  }

  const { message } = req.body as { message?: unknown };

  // Validate request body
  if (typeof message !== 'string' || message.trim() === '') {
    const body: ErrorResponse = {
      error: { code: 'SYS_INVALID_PARAMS', message: 'message 不能为空' },
    };
    res.status(400).json(body);
    return;
  }

  try {
    const result = await coreAPIHandler.handleBroadcast({
      senderId: contestant.id,
      message,
    });

    res.status(200).json({
      messageId: result.messageId,
      recipientCount: result.recipientCount,
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
