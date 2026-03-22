// =============================================================================
// XTION_TheFool0 — RoomMembershipService 模块
// Requirements: 4.1, 4.2, 4.3, 4.4, 8.2, 8.4
// =============================================================================

import { db } from '../db';
import type { Room, MembershipChange } from '../types';
import { roomManager } from './room-manager';
import { doorwayManager } from './doorway-manager';

// =============================================================================
// RoomMembershipService Implementation
// =============================================================================

class RoomMembershipService {
  /**
   * 根据坐标判定所在房间（AABB 包含检测）
   * Requirements: 4.1, 4.2
   */
  getRoomAtPosition(x: number, y: number): Room | null {
    const rooms = roomManager.getAllRooms();
    for (const room of rooms) {
      if (!room.bounds) continue;
      const { x1, y1, x2, y2 } = room.bounds;
      if (x >= x1 && x <= x2 && y >= y1 && y <= y2) {
        return room;
      }
    }
    return null;
  }

  /**
   * 处理 bot 移动后的房间归属更新（原子操作）
   * Requirements: 4.3, 8.4
   */
  updateMembership(botId: string, newX: number, newY: number): MembershipChange | null {
    const newRoom = this.getRoomAtPosition(newX, newY);

    // 查询 bot 当前所在房间
    const currentRow = db.prepare(
      'SELECT room_id FROM room_bots WHERE bot_id = ?'
    ).get(botId) as { room_id: string } | undefined;

    const oldRoomId = currentRow?.room_id ?? null;
    const newRoomId = newRoom?.id ?? null;

    // 房间未变化，无需更新
    if (oldRoomId === newRoomId) {
      return null;
    }

    // 原子更新房间归属
    const updateTransaction = db.transaction(() => {
      // 从旧房间移除
      if (oldRoomId) {
        db.prepare('DELETE FROM room_bots WHERE bot_id = ? AND room_id = ?').run(botId, oldRoomId);
      }

      // 加入新房间
      if (newRoomId) {
        roomManager.addBotToRoom(newRoomId, botId, { x: newX, y: newY });
      }

      // 同步 contestants 表的位置
      db.prepare('UPDATE contestants SET position_x = ?, position_y = ? WHERE id = ?').run(newX, newY, botId);
    });

    updateTransaction();

    return {
      botId,
      previousRoomId: oldRoomId,
      newRoomId,
    };
  }

  /**
   * 验证两个房间之间是否有门洞连接
   * Requirements: 8.2
   */
  hasConnection(roomAId: string, roomBId: string): boolean {
    const doorways = doorwayManager.getDoorwayBetweenRooms(roomAId, roomBId);
    return doorways.length > 0;
  }

  /**
   * 验证房间边界不与现有房间重叠
   * Requirements: 1.4, 9.7
   */
  validateNoOverlap(
    bounds: { x1: number; y1: number; x2: number; y2: number },
    excludeRoomId?: string,
  ): boolean {
    const rooms = roomManager.getAllRooms();
    for (const room of rooms) {
      if (excludeRoomId && room.id === excludeRoomId) continue;
      if (!room.bounds) continue;

      const b = room.bounds;
      const overlaps =
        bounds.x1 < b.x2 &&
        bounds.x2 > b.x1 &&
        bounds.y1 < b.y2 &&
        bounds.y2 > b.y1;

      if (overlaps) {
        return false;
      }
    }
    return true;
  }
}

// =============================================================================
// Singleton Export
// =============================================================================

export const roomMembershipService = new RoomMembershipService();
