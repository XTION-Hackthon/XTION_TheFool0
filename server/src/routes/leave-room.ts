// =============================================================================
// XTION_TheFool0 — Leave Room API 路由
// POST /api/leave-room
// Requirements: 5.1–5.4, 6.4
// =============================================================================

import { Router, type Request, type Response, type NextFunction } from 'express';
import { locationManager } from '../modules/location-manager.js';
import { connections, sendEvent, broadcast } from '../ws.js';
import { requireRole } from '../middleware/auth.js';
import type { ErrorResponse } from '../types/index.js';

export const leaveRoomRouter = Router();

// ---------------------------------------------------------------------------
// POST /api/leave-room — 离开私聊房间，返回大厅
// 仅 Agent_Player 可访问
// Requirements: 5.1–5.4, 6.4
// ---------------------------------------------------------------------------

leaveRoomRouter.post('/', requireRole('Agent_Player'), (req: Request, res: Response, next: NextFunction) => {
  try {
    const contestantId = req.contestantId;
    if (!contestantId) {
      const body: ErrorResponse = {
        error: { code: 'AUTH_MISSING_KEY', message: '未携带有效的认证 Key' },
      };
      res.status(401).json(body);
      return;
    }

    // Get room occupancy BEFORE leaving to find partner
    const currentState = locationManager.getState(contestantId);
    let partnerId: string | null = null;
    let roomId: number | null = null;

    if (currentState && currentState.locationState !== 'lobby') {
      const match = currentState.locationState.match(/^room_(\d+)$/);
      if (match) {
        roomId = parseInt(match[1], 10);
        const occupancy = locationManager.getRoomOccupancy(roomId);
        if (occupancy.slotA === contestantId) {
          partnerId = occupancy.slotB;
        } else if (occupancy.slotB === contestantId) {
          partnerId = occupancy.slotA;
        }
      }
    }

    // Leave the room — throws AGENT_NOT_IN_ROOM if not in a room
    const newPosition = locationManager.leaveRoom(contestantId);

    const now = Date.now();

    // Push room.partner_left event to partner (if any)
    if (partnerId) {
      const partnerWs = connections.get(partnerId);
      if (partnerWs) {
        sendEvent(partnerWs, {
          type: 'room.partner_left',
          payload: {
            room_id: roomId,
            contestant_id: contestantId,
          },
          timestamp: now,
        });
      }
    }

    // Broadcast location.changed to all clients
    broadcast({
      type: 'location.changed',
      payload: {
        contestant_id: contestantId,
        location_state: 'lobby',
        position: newPosition,
      },
      timestamp: now,
    });

    res.status(200).json({
      location_state: 'lobby',
      position: newPosition,
    });
  } catch (err) {
    const error = err as Error & { code?: string };
    if (error.code === 'AGENT_NOT_IN_ROOM') {
      const body: ErrorResponse = {
        error: { code: 'AGENT_NOT_IN_ROOM', message: error.message },
      };
      res.status(400).json(body);
      return;
    }
    next(err);
  }
});
