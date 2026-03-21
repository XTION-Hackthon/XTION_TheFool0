// =============================================================================
// XTION_TheFool0 — Collision API 路由
// POST /api/collision/validate-move
// GET  /api/collision/nearby-bots
// Requirements: 3, 4, 5
// =============================================================================

import { Router, type Request, type Response } from 'express';
import { collisionManager } from '../modules/collision-manager';
import { broadcastCollisionEvent } from '../ws';
import type { Position } from '../types';

export const collisionRouter = Router();

// ---------------------------------------------------------------------------
// POST /api/collision/validate-move
// Body: { roomId: string, botId: string, targetPos: { x: number, y: number } }
// Returns: { valid: boolean, error?: string, collisionType?: 'bot'|'wall', collidedWith?: string }
// ---------------------------------------------------------------------------

collisionRouter.post('/validate-move', async (req: Request, res: Response): Promise<void> => {
  const { roomId, botId, targetPos } = req.body as {
    roomId?: unknown;
    botId?: unknown;
    targetPos?: unknown;
  };

  // Validate required params
  if (!roomId || typeof roomId !== 'string') {
    res.status(400).json({ error: 'roomId 不能为空' });
    return;
  }
  if (!botId || typeof botId !== 'string') {
    res.status(400).json({ error: 'botId 不能为空' });
    return;
  }
  if (!targetPos || typeof targetPos !== 'object') {
    res.status(400).json({ error: 'targetPos 不能为空' });
    return;
  }

  const pos = targetPos as Record<string, unknown>;
  if (typeof pos['x'] !== 'number' || typeof pos['y'] !== 'number') {
    res.status(400).json({ error: 'targetPos 必须包含数字类型的 x 和 y' });
    return;
  }

  if (!Number.isFinite(pos['x']) || !Number.isFinite(pos['y'])) {
    res.status(400).json({ error: 'targetPos 的 x 和 y 必须为有限数字' });
    return;
  }

  const position: Position = { x: pos['x'] as number, y: pos['y'] as number };

  try {
    collisionManager.updateSpatialIndex(roomId);
    const result = collisionManager.validateMovement(roomId, botId, position);

    // Broadcast collision event when a collision is detected (Req 3, 4, 5, 10)
    if (!result.valid && result.collisionType) {
      broadcastCollisionEvent(roomId, botId, result.collisionType, result.collidedWith, position);
    }

    res.status(200).json({
      valid: result.valid,
      ...(result.error !== undefined && { error: result.error }),
      ...(result.collisionType !== undefined && { collisionType: result.collisionType }),
      ...(result.collidedWith !== undefined && { collidedWith: result.collidedWith }),
    });
  } catch (err) {
    res.status(500).json({ error: '内部服务器错误' });
  }
});

// ---------------------------------------------------------------------------
// GET /api/collision/nearby-bots
// Query: roomId, x, y, radius (default 100)
// Returns: { botIds: string[] }
// ---------------------------------------------------------------------------

collisionRouter.get('/nearby-bots', async (req: Request, res: Response): Promise<void> => {
  const { roomId, x, y, radius } = req.query as Record<string, string | undefined>;

  if (!roomId) {
    res.status(400).json({ error: 'roomId 不能为空' });
    return;
  }

  const parsedX = Number(x);
  const parsedY = Number(y);

  if (x === undefined || y === undefined || isNaN(parsedX) || isNaN(parsedY)) {
    res.status(400).json({ error: 'x 和 y 参数不能为空且必须为数字' });
    return;
  }

  const parsedRadius = radius !== undefined ? Number(radius) : 100;
  if (isNaN(parsedRadius) || parsedRadius <= 0) {
    res.status(400).json({ error: 'radius 必须为正数' });
    return;
  }

  try {
    collisionManager.updateSpatialIndex(roomId);
    const botIds = collisionManager.getNearbyBots(roomId, { x: parsedX, y: parsedY }, parsedRadius);
    res.status(200).json({ botIds });
  } catch (err) {
    res.status(500).json({ error: '内部服务器错误' });
  }
});
