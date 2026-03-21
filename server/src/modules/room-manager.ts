// =============================================================================
// XTION_TheFool0 — RoomManager 模块
// Requirements: 1, 2, 11
// =============================================================================

import { db } from '../db';
import type { Room, Wall, SpawnPoint, RoomBot, RoomType } from '../types';

// =============================================================================
// DB Row Types
// =============================================================================

interface RoomRow {
  id: string;
  name: string;
  type: string;
  capacity: number;
  bounds_x1: number | null;
  bounds_y1: number | null;
  bounds_x2: number | null;
  bounds_y2: number | null;
  created_at: string;
  updated_at: string;
}

interface SpawnPointRow {
  id: string;
  room_id: string;
  x: number;
  y: number;
  is_available: number;
  created_at: string;
}

interface RoomBotRow {
  id: string;
  room_id: string;
  bot_id: string;
  position_x: number | null;
  position_y: number | null;
  joined_at: string;
}

interface WallRow {
  id: string;
  room_id: string;
  x: number;
  y: number;
  width: number;
  height: number;
  rotation: number;
  created_at: string;
}

// =============================================================================
// RoomConfig for createRoom
// =============================================================================

export interface RoomConfig {
  name: string;
  type: RoomType;
  capacity?: number;
  bounds?: {
    x1: number;
    y1: number;
    x2: number;
    y2: number;
  };
}

// =============================================================================
// Helpers
// =============================================================================

function rowToRoom(row: RoomRow): Room {
  const room: Room = {
    id: row.id,
    name: row.name,
    type: row.type as RoomType,
    capacity: row.capacity,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };

  if (
    row.bounds_x1 !== null &&
    row.bounds_y1 !== null &&
    row.bounds_x2 !== null &&
    row.bounds_y2 !== null
  ) {
    room.bounds = {
      x1: row.bounds_x1,
      y1: row.bounds_y1,
      x2: row.bounds_x2,
      y2: row.bounds_y2,
    };
  }

  return room;
}

function rowToSpawnPoint(row: SpawnPointRow): SpawnPoint {
  return {
    id: row.id,
    roomId: row.room_id,
    x: row.x,
    y: row.y,
    isAvailable: row.is_available === 1,
    createdAt: row.created_at,
  };
}

function rowToRoomBot(row: RoomBotRow): RoomBot {
  return {
    id: row.id,
    roomId: row.room_id,
    botId: row.bot_id,
    positionX: row.position_x,
    positionY: row.position_y,
    joinedAt: row.joined_at,
  };
}

/** Default capacity per room type */
const DEFAULT_CAPACITY: Record<RoomType, number> = {
  MainHall: 999999,
  PrivateRoom: 2,
};

// =============================================================================
// RoomManager Implementation
// =============================================================================

class RoomManager {
  // ---------------------------------------------------------------------------
  // Room CRUD
  // ---------------------------------------------------------------------------

  /**
   * 创建新房间并持久化到数据库
   * Requirements: 1, 2
   */
  createRoom(config: RoomConfig): Room {
    const id = crypto.randomUUID();
    const now = new Date().toISOString();
    const capacity = config.capacity ?? DEFAULT_CAPACITY[config.type];

    db.prepare(`
      INSERT INTO rooms (id, name, type, capacity, bounds_x1, bounds_y1, bounds_x2, bounds_y2, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      id,
      config.name,
      config.type,
      capacity,
      config.bounds?.x1 ?? null,
      config.bounds?.y1 ?? null,
      config.bounds?.x2 ?? null,
      config.bounds?.y2 ?? null,
      now,
      now,
    );

    return this.getRoom(id);
  }

  /**
   * 删除房间及其关联数据
   * Requirements: 1
   */
  deleteRoom(roomId: string): void {
    const result = db.prepare('DELETE FROM rooms WHERE id = ?').run(roomId);
    if (result.changes === 0) {
      throw new Error(`Room not found: ${roomId}`);
    }
  }

  /**
   * 更新房间属性
   * Requirements: 1
   */
  updateRoom(roomId: string, updates: Partial<Room>): void {
    const existing = db.prepare('SELECT * FROM rooms WHERE id = ?').get(roomId) as RoomRow | undefined;
    if (!existing) {
      throw new Error(`Room not found: ${roomId}`);
    }

    const now = new Date().toISOString();

    const name = updates.name ?? existing.name;
    const type = updates.type ?? existing.type;
    const capacity = updates.capacity ?? existing.capacity;
    const boundsX1 = updates.bounds?.x1 ?? existing.bounds_x1;
    const boundsY1 = updates.bounds?.y1 ?? existing.bounds_y1;
    const boundsX2 = updates.bounds?.x2 ?? existing.bounds_x2;
    const boundsY2 = updates.bounds?.y2 ?? existing.bounds_y2;

    db.prepare(`
      UPDATE rooms
      SET name = ?, type = ?, capacity = ?, bounds_x1 = ?, bounds_y1 = ?, bounds_x2 = ?, bounds_y2 = ?, updated_at = ?
      WHERE id = ?
    `).run(name, type, capacity, boundsX1, boundsY1, boundsX2, boundsY2, now, roomId);
  }

  /**
   * 根据ID获取房间
   * Requirements: 1
   */
  getRoom(roomId: string): Room {
    const row = db.prepare('SELECT * FROM rooms WHERE id = ?').get(roomId) as RoomRow | undefined;
    if (!row) {
      throw new Error(`Room not found: ${roomId}`);
    }
    return rowToRoom(row);
  }

  /**
   * 获取所有房间
   * Requirements: 1
   */
  getAllRooms(): Room[] {
    const rows = db.prepare('SELECT * FROM rooms ORDER BY created_at ASC').all() as RoomRow[];
    return rows.map(rowToRoom);
  }

  // ---------------------------------------------------------------------------
  // 容量管理
  // ---------------------------------------------------------------------------

  /**
   * 检查房间是否可以加入（未满员）
   * Requirements: 2
   */
  canJoinRoom(roomId: string): boolean {
    const room = this.getRoom(roomId);

    // MainHall 无限容量
    if (room.type === 'MainHall') {
      return true;
    }

    const currentCount = this.getCurrentCount(roomId);
    return currentCount < room.capacity;
  }

  /**
   * 将bot加入房间（检查容量后插入room_bots表）
   * Requirements: 2, 11
   */
  addBotToRoom(roomId: string, botId: string, position?: { x: number; y: number }): void {
    if (!this.canJoinRoom(roomId)) {
      throw new Error(`Room ${roomId} is at capacity`);
    }

    // 检查bot是否已在该房间
    const existing = db.prepare(
      'SELECT id FROM room_bots WHERE room_id = ? AND bot_id = ?'
    ).get(roomId, botId);

    if (existing) {
      // 已在房间中，更新位置
      if (position) {
        db.prepare(
          'UPDATE room_bots SET position_x = ?, position_y = ? WHERE room_id = ? AND bot_id = ?'
        ).run(position.x, position.y, roomId, botId);
      }
      return;
    }

    const id = crypto.randomUUID();
    const now = new Date().toISOString();

    db.prepare(`
      INSERT INTO room_bots (id, room_id, bot_id, position_x, position_y, joined_at)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(
      id,
      roomId,
      botId,
      position?.x ?? null,
      position?.y ?? null,
      now,
    );
  }

  /**
   * 将bot从房间移除
   * Requirements: 2
   */
  removeBotFromRoom(roomId: string, botId: string): void {
    db.prepare('DELETE FROM room_bots WHERE room_id = ? AND bot_id = ?').run(roomId, botId);
  }

  /**
   * 获取房间当前bot数量
   * Requirements: 2
   */
  getCurrentCount(roomId: string): number {
    const result = db.prepare(
      'SELECT COUNT(*) as cnt FROM room_bots WHERE room_id = ?'
    ).get(roomId) as { cnt: number };
    return result.cnt;
  }

  /**
   * 获取房间内所有bot
   * Requirements: 2
   */
  getRoomBots(roomId: string): RoomBot[] {
    const rows = db.prepare(
      'SELECT * FROM room_bots WHERE room_id = ? ORDER BY joined_at ASC'
    ).all(roomId) as RoomBotRow[];
    return rows.map(rowToRoomBot);
  }

  // ---------------------------------------------------------------------------
  // 出生点分配
  // ---------------------------------------------------------------------------

  /**
   * 获取房间内可用的出生点（is_available = 1）
   * Requirements: 11
   */
  getAvailableSpawnPoints(roomId: string): SpawnPoint[] {
    const rows = db.prepare(
      'SELECT * FROM spawn_points WHERE room_id = ? AND is_available = 1'
    ).all(roomId) as SpawnPointRow[];
    return rows.map(rowToSpawnPoint);
  }

  /**
   * 分配出生点：随机选取可用出生点，检查bot碰撞，最多尝试3次
   * Requirements: 11
   */
  allocateSpawnPoint(roomId: string): SpawnPoint | null {
    const available = this.getAvailableSpawnPoints(roomId);
    if (available.length === 0) {
      return null;
    }

    const bots = this.getRoomBots(roomId);
    const botPositions = bots
      .filter((b) => b.positionX !== null && b.positionY !== null)
      .map((b) => ({ x: b.positionX as number, y: b.positionY as number }));

    const MAX_ATTEMPTS = 3;

    for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
      // 随机选取一个可用出生点
      const idx = Math.floor(Math.random() * available.length);
      const candidate = available[idx];

      // 检查该出生点是否与现有bot碰撞（简单距离检测，阈值32px）
      const hasCollision = botPositions.some(
        (pos) => Math.abs(pos.x - candidate.x) < 32 && Math.abs(pos.y - candidate.y) < 32
      );

      if (!hasCollision) {
        return candidate;
      }

      // 从候选列表中移除已碰撞的出生点，避免重复选取
      available.splice(idx, 1);
      if (available.length === 0) break;
    }

    // 3次尝试后仍有碰撞，返回最后一个候选（降级处理）
    return available.length > 0 ? available[0] : null;
  }

  // ---------------------------------------------------------------------------
  // 辅助方法
  // ---------------------------------------------------------------------------

  /**
   * 获取房间内所有墙体
   */
  getRoomWalls(roomId: string): Wall[] {
    const rows = db.prepare(
      'SELECT * FROM walls WHERE room_id = ? ORDER BY created_at ASC'
    ).all(roomId) as WallRow[];

    return rows.map((row) => ({
      id: row.id,
      roomId: row.room_id,
      x: row.x,
      y: row.y,
      width: row.width,
      height: row.height,
      rotation: row.rotation,
      createdAt: row.created_at,
    }));
  }
}

// =============================================================================
// Singleton Export
// =============================================================================

export const roomManager = new RoomManager();
