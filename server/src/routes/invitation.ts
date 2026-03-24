// =============================================================================
// XTION_TheFool0 — Invitation API 路由
// POST /api/invitation
// POST /api/invitation/:id/accept
// POST /api/invitation/:id/reject
// Requirements: 3, 4
// =============================================================================

import { Router, type Request, type Response, type NextFunction } from 'express';
import { invitationManager } from '../modules/invitation-manager.js';
import { requireRole } from '../middleware/auth.js';
import type { ErrorResponse } from '../types/index.js';

export const invitationRouter = Router();

// ---------------------------------------------------------------------------
// POST /api/invitation — 发起私聊邀请
// 仅 Agent_Player 可访问
// Requirements: 3.1–3.11
// ---------------------------------------------------------------------------

invitationRouter.post('/', requireRole('Agent_Player'), async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const contestantId = req.contestantId;
    if (!contestantId) {
      const body: ErrorResponse = {
        error: { code: 'AUTH_MISSING_KEY', message: '未携带有效的认证 Key' },
      };
      res.status(401).json(body);
      return;
    }

    const { invitee_id } = req.body as { invitee_id?: unknown };

    if (typeof invitee_id !== 'string' || !invitee_id.trim()) {
      const body: ErrorResponse = {
        error: { code: 'SYS_INVALID_PARAMS', message: 'invitee_id 不能为空' },
      };
      res.status(400).json(body);
      return;
    }

    const invitation = await invitationManager.createInvitation(contestantId, invitee_id);

    res.status(200).json({
      invitation_id: invitation.id,
      expires_at: invitation.expiresAt,
    });
  } catch (err) {
    const error = err as Error & { code?: string };
    const knownCodes = new Set([
      'INVITER_NOT_IN_LOBBY',
      'INVITEE_NOT_IN_LOBBY',
      'INVITEE_NOT_CONTESTANT',
      'NO_ROOM_AVAILABLE',
    ]);
    if (error.code && knownCodes.has(error.code)) {
      const body: ErrorResponse = {
        error: { code: error.code, message: error.message },
      };
      res.status(400).json(body);
      return;
    }
    next(err);
  }
});

// ---------------------------------------------------------------------------
// POST /api/invitation/:id/accept — 接受邀请
// 仅 Agent_Player 可访问
// Requirements: 4.1–4.5, 4.7
// ---------------------------------------------------------------------------

invitationRouter.post('/:id/accept', requireRole('Agent_Player'), async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const contestantId = req.contestantId;
    if (!contestantId) {
      const body: ErrorResponse = {
        error: { code: 'AUTH_MISSING_KEY', message: '未携带有效的认证 Key' },
      };
      res.status(401).json(body);
      return;
    }

    const { id } = req.params as { id: string };

    const result = await invitationManager.acceptInvitation(id, contestantId);

    res.status(200).json({
      room_id: result.roomId,
      slot: result.slot,
    });
  } catch (err) {
    const error = err as Error & { code?: string };
    const knownCodes = new Set([
      'INVITATION_NOT_FOUND',
      'INVITATION_NOT_PENDING',
      'NO_ROOM_AVAILABLE',
      'FORBIDDEN',
    ]);
    if (error.code && knownCodes.has(error.code)) {
      const statusCode = error.code === 'FORBIDDEN' ? 403 : 400;
      const body: ErrorResponse = {
        error: { code: error.code, message: error.message },
      };
      res.status(statusCode).json(body);
      return;
    }
    next(err);
  }
});

// ---------------------------------------------------------------------------
// POST /api/invitation/:id/reject — 拒绝邀请
// 仅 Agent_Player 可访问
// Requirements: 4.6
// ---------------------------------------------------------------------------

invitationRouter.post('/:id/reject', requireRole('Agent_Player'), async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const contestantId = req.contestantId;
    if (!contestantId) {
      const body: ErrorResponse = {
        error: { code: 'AUTH_MISSING_KEY', message: '未携带有效的认证 Key' },
      };
      res.status(401).json(body);
      return;
    }

    const { id } = req.params as { id: string };

    await invitationManager.rejectInvitation(id, contestantId);

    res.status(200).json({ success: true });
  } catch (err) {
    const error = err as Error & { code?: string };
    const knownCodes = new Set([
      'INVITATION_NOT_FOUND',
      'INVITATION_NOT_PENDING',
      'FORBIDDEN',
    ]);
    if (error.code && knownCodes.has(error.code)) {
      const statusCode = error.code === 'FORBIDDEN' ? 403 : 400;
      const body: ErrorResponse = {
        error: { code: error.code, message: error.message },
      };
      res.status(statusCode).json(body);
      return;
    }
    next(err);
  }
});
