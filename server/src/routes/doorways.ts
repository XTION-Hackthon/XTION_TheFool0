// =============================================================================
// XTION_TheFool0 — Doorways API 路由
// Requirements: 3.1, 7.3, 9.3, 9.4, 9.5
// =============================================================================

import { Router, type Request, type Response } from 'express';
import { doorwayManager } from '../modules/doorway-manager';
import { broadcast } from '../ws';

export const doorwaysRouter = Router();

// ---------------------------------------------------------------------------
// POST /api/doorways — 创建门洞
// Body: { roomAId, roomBId, x, y, width, height }
// ---------------------------------------------------------------------------

doorwaysRouter.post('/', async (req: Request, res: Response): Promise<void> => {
  try {
    const { roomAId, roomBId, x, y, width, height } = req.body as {
      roomAId?: unknown;
      roomBId?: unknown;
      x?: unknown;
      y?: unknown;
      width?: unknown;
      height?: unknown;
    };

    if (
      typeof roomAId !== 'string' || !roomAId ||
      typeof roomBId !== 'string' || !roomBId
    ) {
      res.status(400).json({ error: { code: 'INVALID_PARAMS', message: 'roomAId 和 roomBId 必须为非空字符串' } });
      return;
    }

    if (
      typeof x !== 'number' || typeof y !== 'number' ||
      typeof width !== 'number' || typeof height !== 'number'
    ) {
      res.status(400).json({ error: { code: 'INVALID_PARAMS', message: 'x, y, width, height 必须为数字' } });
      return;
    }

    const config = { roomAId, roomBId, x, y, width, height };

    const validation = doorwayManager.validateDoorwayPlacement(config);
    if (!validation.valid) {
      res.status(400).json({ error: { code: 'INVALID_PARAMS', message: validation.errors.join('; ') } });
      return;
    }

    const doorway = doorwayManager.createDoorway(config);

    broadcast({ type: 'doorway.created', payload: { doorway }, timestamp: Date.now() });

    res.status(201).json(doorway);
  } catch (err) {
    res.status(500).json({ error: { code: 'INTERNAL_ERROR', message: (err as Error).message } });
  }
});

// ---------------------------------------------------------------------------
// GET /api/doorways — 获取所有门洞
// ---------------------------------------------------------------------------

doorwaysRouter.get('/', async (_req: Request, res: Response): Promise<void> => {
  try {
    const doorways = doorwayManager.getAllDoorways();
    res.status(200).json(doorways);
  } catch (err) {
    res.status(500).json({ error: { code: 'INTERNAL_ERROR', message: (err as Error).message } });
  }
});

// ---------------------------------------------------------------------------
// GET /api/doorways/:id — 获取门洞详情
// ---------------------------------------------------------------------------

doorwaysRouter.get('/:id', async (req: Request, res: Response): Promise<void> => {
  try {
    const doorway = doorwayManager.getDoorway(req.params['id'] as string);
    res.status(200).json(doorway);
  } catch (err) {
    const msg = (err as Error).message;
    if (msg.includes('not found')) {
      res.status(404).json({ error: { code: 'DOORWAY_NOT_FOUND', message: msg } });
    } else {
      res.status(500).json({ error: { code: 'INTERNAL_ERROR', message: msg } });
    }
  }
});

// ---------------------------------------------------------------------------
// PUT /api/doorways/:id — 更新门洞
// Body: partial { roomAId?, roomBId?, x?, y?, width?, height? }
// ---------------------------------------------------------------------------

doorwaysRouter.put('/:id', async (req: Request, res: Response): Promise<void> => {
  try {
    const updates = req.body as Partial<{
      roomAId: string;
      roomBId: string;
      x: number;
      y: number;
      width: number;
      height: number;
    }>;

    const doorway = doorwayManager.updateDoorway(req.params['id'] as string, updates);
    res.status(200).json(doorway);
  } catch (err) {
    const msg = (err as Error).message;
    if (msg.includes('not found')) {
      res.status(404).json({ error: { code: 'DOORWAY_NOT_FOUND', message: msg } });
    } else {
      res.status(500).json({ error: { code: 'INTERNAL_ERROR', message: msg } });
    }
  }
});

// ---------------------------------------------------------------------------
// DELETE /api/doorways/:id — 删除门洞
// ---------------------------------------------------------------------------

doorwaysRouter.delete('/:id', async (req: Request, res: Response): Promise<void> => {
  try {
    const id = req.params['id'] as string;
    doorwayManager.deleteDoorway(id);

    broadcast({ type: 'doorway.deleted', payload: { doorwayId: id }, timestamp: Date.now() });

    res.status(204).send();
  } catch (err) {
    const msg = (err as Error).message;
    if (msg.includes('not found')) {
      res.status(404).json({ error: { code: 'DOORWAY_NOT_FOUND', message: msg } });
    } else {
      res.status(500).json({ error: { code: 'INTERNAL_ERROR', message: msg } });
    }
  }
});

// ---------------------------------------------------------------------------
// GET /api/rooms/:id/doorways — 获取房间的所有门洞
// (mergeParams: true 以访问父路由的 :id 参数)
// ---------------------------------------------------------------------------

export const roomDoorwaysRouter = Router({ mergeParams: true });

roomDoorwaysRouter.get('/', async (req: Request, res: Response): Promise<void> => {
  try {
    const doorways = doorwayManager.getDoorwaysByRoom(req.params['id'] as string);
    res.status(200).json(doorways);
  } catch (err) {
    res.status(500).json({ error: { code: 'INTERNAL_ERROR', message: (err as Error).message } });
  }
});
