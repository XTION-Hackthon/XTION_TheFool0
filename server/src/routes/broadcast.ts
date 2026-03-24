// =============================================================================
// XTION_TheFool0 — Broadcast API 路由
// POST /api/broadcast
// Requirements: 4.1, 4.2, 4.4, 4.5
// =============================================================================

import { Router, type Request, type Response } from 'express';
import { randomUUID } from 'crypto';
import { coreAPIHandler, APIError } from '../modules/core-api-handler';
import { db } from '../db';
import type { ErrorResponse } from '../types';

export const broadcastRouter = Router();

// ---------------------------------------------------------------------------
// POST /api/broadcast
// ---------------------------------------------------------------------------

broadcastRouter.post('/', async (req: Request, res: Response): Promise<void> => {
  // Auth: req.contestantId is guaranteed valid by authMiddleware (Bug 2 fix)
  const contestantId = req.contestantId;
  if (!contestantId) {
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
      senderId: contestantId,
      message,
    });

    // Archive broadcast message to messages table
    db.prepare(
      `INSERT INTO messages (id, type, sender_id, content, timestamp)
       VALUES (?, 'broadcast', ?, ?, ?)`
    ).run(randomUUID(), contestantId, message, result.timestamp);

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
