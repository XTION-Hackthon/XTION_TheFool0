// =============================================================================
// XTION_TheFool0 — Talk API 路由
// POST /api/talk
// Requirements: 3.1, 3.2, 3.3, 3.4, 3.5, 3.6, 3.7, 3.8
// =============================================================================

import { Router, type Request, type Response } from 'express';
import { randomUUID } from 'crypto';
import { coreAPIHandler, APIError } from '../modules/core-api-handler';
import { db } from '../db';
import { locationManager } from '../modules/location-manager';
import type { ErrorResponse } from '../types';

export const talkRouter = Router();

// ---------------------------------------------------------------------------
// POST /api/talk
// ---------------------------------------------------------------------------

talkRouter.post('/', async (req: Request, res: Response): Promise<void> => {
  // Auth: req.contestantId is guaranteed valid by authMiddleware (Bug 2 fix)
  const contestantId = req.contestantId;
  if (!contestantId) {
    const body: ErrorResponse = {
      error: { code: 'AUTH_MISSING_KEY', message: '未携带有效的认证 Key' },
    };
    res.status(401).json(body);
    return;
  }

  const { target_ids, message } = req.body as { target_ids?: unknown; message?: unknown };

  // Validate request body
  if (!Array.isArray(target_ids) || target_ids.length === 0) {
    const body: ErrorResponse = {
      error: { code: 'SYS_INVALID_PARAMS', message: 'target_ids 必须是非空数组' },
    };
    res.status(400).json(body);
    return;
  }

  if (typeof message !== 'string' || message.trim() === '') {
    const body: ErrorResponse = {
      error: { code: 'SYS_INVALID_PARAMS', message: 'message 不能为空' },
    };
    res.status(400).json(body);
    return;
  }

  try {
    // Validate sender is in a room (not lobby)
    const senderState = locationManager.getState(contestantId);
    if (!senderState || senderState.locationState === 'lobby') {
      const body: ErrorResponse = {
        error: { code: 'SENDER_NOT_IN_ROOM', message: '发送方不在私聊房间内' },
      };
      res.status(400).json(body);
      return;
    }

    // Validate target is in the same room
    const receiverId = target_ids[0] as string;
    const targetState = locationManager.getState(receiverId);
    if (!targetState || targetState.locationState !== senderState.locationState) {
      const body: ErrorResponse = {
        error: { code: 'TARGET_NOT_IN_SAME_ROOM', message: '接收方不在同一房间内' },
      };
      res.status(400).json(body);
      return;
    }

    // Extract room_id from locationState (e.g. 'room_3' → 3)
    const roomId = parseInt(senderState.locationState.replace('room_', ''), 10);

    const result = await coreAPIHandler.handleTalk({
      senderId: contestantId,
      targetIds: target_ids as string[],
      message,
    });

    // Archive private message to messages table
    db.prepare(
      `INSERT INTO messages (id, type, sender_id, receiver_id, room_id, content, timestamp)
       VALUES (?, 'private', ?, ?, ?, ?, ?)`
    ).run(randomUUID(), contestantId, receiverId, roomId, message, result.timestamp);

    res.status(200).json({ messageId: result.messageId, timestamp: result.timestamp });
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
