// =============================================================================
// XTION_TheFool0 — Rooms API 路由
// Requirements: 1, 2, 9
// =============================================================================

import { Router, type Request, type Response } from 'express';
import { roomManager } from '../modules/room-manager';
import {
  broadcastBotJoined,
  broadcastBotLeft,
  broadcastRoomCapacity,
  pushSpawnPointAssignment,
} from '../ws';
import type { RoomType } from '../types';

export const roomsRouter = Router();

// ---------------------------------------------------------------------------
// POST /api/rooms — 创建房间
// Body: { name, type, capacity?, bounds? }
// ---------------------------------------------------------------------------

roomsRouter.post('/', async (req: Request, res: Response): Promise<void> => {
  try {
    const { name, type, capacity, bounds } = req.body as {
      name?: string;
      type?: string;
      capacity?: number;
      bounds?: { x1: number; y1: number; x2: number; y2: number };
    };

    if (!name || typeof name !== 'string') {
      res.status(400).json({ error: { code: 'INVALID_PARAMS', message: 'name 不能为空' } });
      return;
    }

    if (name.length > 100) {
      res.status(400).json({ error: { code: 'INVALID_PARAMS', message: 'name 长度不能超过100个字符' } });
      return;
    }

    if (!type || (type !== 'MainHall' && type !== 'PrivateRoom')) {
      res.status(400).json({ error: { code: 'INVALID_PARAMS', message: 'type 必须为 MainHall 或 PrivateRoom' } });
      return;
    }

    if (capacity !== undefined && (typeof capacity !== 'number' || capacity < 1 || !Number.isFinite(capacity))) {
      res.status(400).json({ error: { code: 'INVALID_PARAMS', message: 'capacity 必须为正整数' } });
      return;
    }

    const room = roomManager.createRoom({ name, type: type as RoomType, capacity, bounds });
    res.status(201).json(room);
  } catch (err) {
    res.status(500).json({ error: { code: 'INTERNAL_ERROR', message: (err as Error).message } });
  }
});

// ---------------------------------------------------------------------------
// GET /api/rooms — 获取所有房间（含 currentCount）
// ---------------------------------------------------------------------------

roomsRouter.get('/', async (_req: Request, res: Response): Promise<void> => {
  try {
    const rooms = roomManager.getAllRooms();
    const result = rooms.map((room) => ({
      ...room,
      currentCount: roomManager.getCurrentCount(room.id),
    }));
    res.status(200).json(result);
  } catch (err) {
    res.status(500).json({ error: { code: 'INTERNAL_ERROR', message: (err as Error).message } });
  }
});

// ---------------------------------------------------------------------------
// GET /api/rooms/:id — 获取房间详情（含 currentCount 和 bots）
// ---------------------------------------------------------------------------

roomsRouter.get('/:id', async (req: Request, res: Response): Promise<void> => {
  try {
    const room = roomManager.getRoom(req.params['id'] as string);
    const currentCount = roomManager.getCurrentCount(room.id);
    const bots = roomManager.getRoomBots(room.id);
    res.status(200).json({ ...room, currentCount, bots });
  } catch (err) {
    const msg = (err as Error).message;
    if (msg.includes('not found')) {
      res.status(404).json({ error: { code: 'ROOM_NOT_FOUND', message: msg } });
    } else {
      res.status(500).json({ error: { code: 'INTERNAL_ERROR', message: msg } });
    }
  }
});

// ---------------------------------------------------------------------------
// PUT /api/rooms/:id — 更新房间
// Body: partial Room fields
// ---------------------------------------------------------------------------

roomsRouter.put('/:id', async (req: Request, res: Response): Promise<void> => {
  try {
    const { name, type, capacity, bounds } = req.body as {
      name?: string;
      type?: string;
      capacity?: number;
      bounds?: { x1: number; y1: number; x2: number; y2: number };
    };

    // Validate individual fields if provided
    const updates: Partial<{ name: string; type: RoomType; capacity: number; bounds: { x1: number; y1: number; x2: number; y2: number } }> = {};

    if (name !== undefined) {
      if (typeof name !== 'string' || name.trim().length === 0) {
        res.status(400).json({ error: { code: 'INVALID_PARAMS', message: 'name 必须为非空字符串' } });
        return;
      }
      updates.name = name;
    }

    if (type !== undefined) {
      if (type !== 'MainHall' && type !== 'PrivateRoom') {
        res.status(400).json({ error: { code: 'INVALID_PARAMS', message: 'type 必须为 MainHall 或 PrivateRoom' } });
        return;
      }
      updates.type = type as RoomType;
    }

    if (capacity !== undefined) {
      if (typeof capacity !== 'number' || capacity < 1 || !Number.isFinite(capacity)) {
        res.status(400).json({ error: { code: 'INVALID_PARAMS', message: 'capacity 必须为正整数' } });
        return;
      }
      updates.capacity = capacity;
    }

    if (bounds !== undefined) {
      if (
        typeof bounds !== 'object' ||
        typeof bounds.x1 !== 'number' || typeof bounds.y1 !== 'number' ||
        typeof bounds.x2 !== 'number' || typeof bounds.y2 !== 'number'
      ) {
        res.status(400).json({ error: { code: 'INVALID_PARAMS', message: 'bounds 必须包含数字类型的 x1, y1, x2, y2' } });
        return;
      }
      updates.bounds = bounds;
    }

    roomManager.updateRoom(req.params['id'] as string, updates);
    const updated = roomManager.getRoom(req.params['id'] as string);
    res.status(200).json(updated);
  } catch (err) {
    const msg = (err as Error).message;
    if (msg.includes('not found')) {
      res.status(404).json({ error: { code: 'ROOM_NOT_FOUND', message: msg } });
    } else {
      res.status(500).json({ error: { code: 'INTERNAL_ERROR', message: msg } });
    }
  }
});

// ---------------------------------------------------------------------------
// DELETE /api/rooms/:id — 删除房间
// ---------------------------------------------------------------------------

roomsRouter.delete('/:id', async (req: Request, res: Response): Promise<void> => {
  try {
    roomManager.deleteRoom(req.params['id'] as string);
    res.status(204).send();
  } catch (err) {
    const msg = (err as Error).message;
    if (msg.includes('not found')) {
      res.status(404).json({ error: { code: 'ROOM_NOT_FOUND', message: msg } });
    } else {
      res.status(500).json({ error: { code: 'INTERNAL_ERROR', message: msg } });
    }
  }
});

// ---------------------------------------------------------------------------
// POST /api/rooms/:id/join — 加入房间
// Body: { botId, position? }
// ---------------------------------------------------------------------------

roomsRouter.post('/:id/join', async (req: Request, res: Response): Promise<void> => {
  try {
    const { botId, position } = req.body as {
      botId?: string;
      position?: { x: number; y: number };
    };

    if (!botId || typeof botId !== 'string') {
      res.status(400).json({ error: { code: 'INVALID_PARAMS', message: 'botId 不能为空' } });
      return;
    }

    if (botId.length > 200) {
      res.status(400).json({ error: { code: 'INVALID_PARAMS', message: 'botId 长度不能超过200个字符' } });
      return;
    }

    // Validate position if provided
    if (position !== undefined) {
      if (
        typeof position !== 'object' ||
        typeof position.x !== 'number' || typeof position.y !== 'number' ||
        !Number.isFinite(position.x) || !Number.isFinite(position.y)
      ) {
        res.status(400).json({ error: { code: 'INVALID_PARAMS', message: 'position 必须包含有限数字类型的 x 和 y' } });
        return;
      }
    }

    const roomId = req.params['id'] as string;

    // Verify room exists first
    roomManager.getRoom(roomId);

    // Check capacity
    if (!roomManager.canJoinRoom(roomId)) {
      res.status(400).json({ error: { code: 'ROOM_AT_CAPACITY', message: '房间已满员' } });
      return;
    }

    // Allocate spawn point if no position provided
    let resolvedPosition = position;
    let spawnPoint = null;
    if (!resolvedPosition) {
      spawnPoint = roomManager.allocateSpawnPoint(roomId);
      if (spawnPoint) {
        resolvedPosition = { x: spawnPoint.x, y: spawnPoint.y };
      }
    }

    roomManager.addBotToRoom(roomId, botId, resolvedPosition);

    // Push spawn point assignment to the joining bot (Req 11)
    if (spawnPoint && resolvedPosition) {
      pushSpawnPointAssignment(botId, roomId, { id: spawnPoint.id, x: resolvedPosition.x, y: resolvedPosition.y });
    }

    // Broadcast bot joined and capacity update (Req 1, 2, 9)
    broadcastBotJoined(roomId, botId, botId, resolvedPosition ?? { x: 0, y: 0 });
    const currentCount = roomManager.getCurrentCount(roomId);
    const room = roomManager.getRoom(roomId);
    broadcastRoomCapacity(roomId, currentCount, room.capacity);

    res.status(200).json({
      roomId,
      botId,
      position: resolvedPosition ?? null,
      spawnPoint: spawnPoint ?? null,
    });
  } catch (err) {
    const msg = (err as Error).message;
    if (msg.includes('not found')) {
      res.status(404).json({ error: { code: 'ROOM_NOT_FOUND', message: msg } });
    } else if (msg.includes('capacity')) {
      res.status(400).json({ error: { code: 'ROOM_AT_CAPACITY', message: msg } });
    } else {
      res.status(500).json({ error: { code: 'INTERNAL_ERROR', message: msg } });
    }
  }
});

// ---------------------------------------------------------------------------
// POST /api/rooms/:id/leave — 离开房间
// Body: { botId }
// ---------------------------------------------------------------------------

roomsRouter.post('/:id/leave', async (req: Request, res: Response): Promise<void> => {
  try {
    const { botId } = req.body as { botId?: string };

    if (!botId || typeof botId !== 'string') {
      res.status(400).json({ error: { code: 'INVALID_PARAMS', message: 'botId 不能为空' } });
      return;
    }

    const roomId = req.params['id'] as string;

    // Verify room exists
    roomManager.getRoom(roomId);

    roomManager.removeBotFromRoom(roomId, botId);

    // Broadcast bot left and capacity update (Req 1, 2, 9)
    broadcastBotLeft(roomId, botId);
    const currentCount = roomManager.getCurrentCount(roomId);
    const room = roomManager.getRoom(roomId);
    broadcastRoomCapacity(roomId, currentCount, room.capacity);

    res.status(200).json({ roomId, botId });
  } catch (err) {
    const msg = (err as Error).message;
    if (msg.includes('not found')) {
      res.status(404).json({ error: { code: 'ROOM_NOT_FOUND', message: msg } });
    } else {
      res.status(500).json({ error: { code: 'INTERNAL_ERROR', message: msg } });
    }
  }
});
