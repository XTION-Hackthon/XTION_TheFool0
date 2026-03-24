// =============================================================================
// XTION_TheFool0 — Collision API 路由（Zone 级别）
// POST /api/collision/validate-move
// GET  /api/collision/nearby-bots
// Requirements: 3, 4, 5
// =============================================================================

import { Router, type Request, type Response } from 'express';
import { collisionManager } from '../modules/collision-manager';
import { broadcastCollisionEvent } from '../ws';
import { worldManager } from '../modules/world-manager';
import { db } from '../db';
import type { Position } from '../types';

export const collisionRouter = Router();

// ---------------------------------------------------------------------------
// POST /api/collision/validate-move
// Body: { zoneId: string, botId: string, targetPos: { x: number, y: number } }
// ---------------------------------------------------------------------------

collisionRouter.post('/validate-move', async (req: Request, res: Response): Promise<void> => {
  const { zoneId, botId, targetPos } = req.body as {
    zoneId?: unknown;
    botId?: unknown;
    targetPos?: unknown;
  };

  if (!zoneId || typeof zoneId !== 'string') {
    res.status(400).json({ error: 'zoneId 不能为空' });
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
    // Build spatial index from current bot positions in this zone
    const botRows = db.prepare(
      `SELECT id as botId, position_x as x, position_y as y FROM contestants WHERE current_zone_id = ? AND status != 'offline'`
    ).all(zoneId) as Array<{ botId: string; x: number; y: number }>;
    collisionManager.updateSpatialIndex(zoneId, botRows);

    const result = collisionManager.validateMovement(zoneId, botId, position);

    if (!result.valid && result.collisionType) {
      broadcastCollisionEvent(zoneId, botId, result.collisionType, result.collidedWith, position);
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
// Query: zoneId, x, y, radius (default 100)
// ---------------------------------------------------------------------------

collisionRouter.get('/nearby-bots', async (req: Request, res: Response): Promise<void> => {
  const { zoneId, x, y, radius } = req.query as Record<string, string | undefined>;

  if (!zoneId) {
    res.status(400).json({ error: 'zoneId 不能为空' });
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
    const botRows = db.prepare(
      `SELECT id as botId, position_x as x, position_y as y FROM contestants WHERE current_zone_id = ? AND status != 'offline'`
    ).all(zoneId) as Array<{ botId: string; x: number; y: number }>;
    collisionManager.updateSpatialIndex(zoneId, botRows);
    const botIds = collisionManager.getNearbyBots(zoneId, { x: parsedX, y: parsedY }, parsedRadius, botRows);
    res.status(200).json({ botIds });
  } catch (err) {
    res.status(500).json({ error: '内部服务器错误' });
  }
});
