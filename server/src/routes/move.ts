// =============================================================================
// XTION_TheFool0 — Move API 路由
// POST /api/move
// Requirements: 5.1, 5.2, 5.4, 5.5, 5.7, 11.5
// =============================================================================

import { Router, type Request, type Response } from 'express';
import { db } from '../db';
import { coreAPIHandler, APIError } from '../modules/core-api-handler';
import { collisionManager } from '../modules/collision-manager';
import { roomMembershipService } from '../modules/room-membership-service';
import { broadcastCollisionEvent, broadcastMembershipChanged, broadcastBotPositionDelta } from '../ws';
import { requireRole } from '../middleware/auth';
import type { ErrorResponse, Position } from '../types';

export const moveRouter = Router();

// ---------------------------------------------------------------------------
// POST /api/move
// Body: { target: {x, y} | {zoneId: string} }
// Returns: { newPosition, newZoneId, timestamp }
// ---------------------------------------------------------------------------

moveRouter.post('/', requireRole('Admin', 'Agent_Player'), async (req: Request, res: Response): Promise<void> => {
  // Auth: req.contestantId is guaranteed valid by authMiddleware (Bug 2 fix)
  const contestantId = req.contestantId;
  if (!contestantId) {
    const body: ErrorResponse = {
      error: { code: 'AUTH_MISSING_KEY', message: '未携带有效的认证 Key' },
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
    // If target is a coordinate position, check room collision first (Req 3, 4, 5)
    if ('x' in (parsedTarget as object) && 'y' in (parsedTarget as object)) {
      const targetPos = parsedTarget as Position;

      // Look up the room the bot is currently in
      const roomBotRow = db.prepare(
        'SELECT room_id FROM room_bots WHERE bot_id = ?'
      ).get(contestantId) as { room_id: string } | undefined;

      if (roomBotRow) {
        const roomId = roomBotRow.room_id;
        collisionManager.updateSpatialIndex(roomId);

        // Check bot collision
        if (collisionManager.checkBotCollision(roomId, contestantId, targetPos)) {
          broadcastCollisionEvent(roomId, contestantId, 'bot', undefined, targetPos);
          res.status(400).json({ error: { code: 'COLLISION_BOT', message: '移动被其他 bot 阻止' } });
          return;
        }

        // Check wall collision with doorway exclusion
        if (collisionManager.checkWallCollisionWithDoorways(roomId, targetPos, { width: 32, height: 32 })) {
          broadcastCollisionEvent(roomId, contestantId, 'wall', undefined, targetPos);
          res.status(400).json({ error: { code: 'COLLISION_WALL', message: '移动被墙体阻止' } });
          return;
        }

        // Check if this is a cross-room movement
        const newRoom = roomMembershipService.getRoomAtPosition(targetPos.x, targetPos.y);
        if (newRoom && newRoom.id !== roomId) {
          // Validate cross-room movement (doorway connection + capacity)
          const crossRoomValidation = collisionManager.validateCrossRoomMovement(
            contestantId, roomId, newRoom.id, targetPos
          );
          if (!crossRoomValidation.valid) {
            res.status(400).json({ error: { code: 'NO_DOORWAY_CONNECTION', message: crossRoomValidation.error ?? '跨房间移动被阻止' } });
            return;
          }
        }
      }
    }

    const result = await coreAPIHandler.handleMove({
      contestantId,
      target: parsedTarget,
    });

    // Update room membership based on new position
    if ('x' in (parsedTarget as object) && 'y' in (parsedTarget as object)) {
      const targetPos = parsedTarget as Position;
      const membershipChange = roomMembershipService.updateMembership(contestantId, targetPos.x, targetPos.y);
      if (membershipChange) {
        broadcastMembershipChanged(contestantId, membershipChange.previousRoomId, membershipChange.newRoomId, targetPos);
      }
      // Broadcast position delta for real-time sync
      const roomBotRow2 = db.prepare('SELECT room_id FROM room_bots WHERE bot_id = ?').get(contestantId) as { room_id: string } | undefined;
      if (roomBotRow2) {
        broadcastBotPositionDelta(roomBotRow2.room_id, contestantId, targetPos);
      }
    }

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
