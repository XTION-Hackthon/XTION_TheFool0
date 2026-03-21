// =============================================================================
// XTION_TheFool0 — DoorwayManager 模块
// Requirements: 3.1, 3.2, 3.3, 3.5, 7.3, 7.4
// =============================================================================

import { db } from '../db';
import type { Doorway, DoorwayConfig, ValidationResult } from '../types';
import { roomManager } from './room-manager';

// =============================================================================
// DB Row Type
// =============================================================================

interface DoorwayRow {
  id: string;
  room_a_id: string;
  room_b_id: string;
  x: number;
  y: number;
  width: number;
  height: number;
  created_at: string;
}

// =============================================================================
// Helpers
// =============================================================================

function rowToDoorway(row: DoorwayRow): Doorway {
  return {
    id: row.id,
    roomAId: row.room_a_id,
    roomBId: row.room_b_id,
    x: row.x,
    y: row.y,
    width: row.width,
    height: row.height,
    createdAt: row.created_at,
  };
}

// =============================================================================
// DoorwayManager Implementation
// =============================================================================

class DoorwayManager {
  // ---------------------------------------------------------------------------
  // CRUD
  // ---------------------------------------------------------------------------

  /**
   * 创建新门洞并持久化到数据库
   * Requirements: 3.1, 7.3, 7.4
   */
  createDoorway(config: DoorwayConfig): Doorway {
    const id = crypto.randomUUID();
    const now = new Date().toISOString();

    db.prepare(`
      INSERT INTO doorways (id, room_a_id, room_b_id, x, y, width, height, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(id, config.roomAId, config.roomBId, config.x, config.y, config.width, config.height, now);

    return this.getDoorway(id);
  }

  /**
   * 根据ID获取门洞，不存在则抛出错误
   * Requirements: 3.1
   */
  getDoorway(doorwayId: string): Doorway {
    const row = db.prepare('SELECT * FROM doorways WHERE id = ?').get(doorwayId) as DoorwayRow | undefined;
    if (!row) {
      throw new Error(`Doorway not found: ${doorwayId}`);
    }
    return rowToDoorway(row);
  }

  /**
   * 获取某个房间关联的所有门洞（room_a_id 或 room_b_id 匹配）
   * Requirements: 3.1
   */
  getDoorwaysByRoom(roomId: string): Doorway[] {
    const rows = db.prepare(
      'SELECT * FROM doorways WHERE room_a_id = ? OR room_b_id = ? ORDER BY created_at ASC'
    ).all(roomId, roomId) as DoorwayRow[];
    return rows.map(rowToDoorway);
  }

  /**
   * 获取连接两个特定房间的门洞（双向检查）
   * Requirements: 3.1
   */
  getDoorwayBetweenRooms(roomAId: string, roomBId: string): Doorway[] {
    const rows = db.prepare(`
      SELECT * FROM doorways
      WHERE (room_a_id = ? AND room_b_id = ?)
         OR (room_a_id = ? AND room_b_id = ?)
      ORDER BY created_at ASC
    `).all(roomAId, roomBId, roomBId, roomAId) as DoorwayRow[];
    return rows.map(rowToDoorway);
  }

  /**
   * 获取所有门洞
   * Requirements: 3.1
   */
  getAllDoorways(): Doorway[] {
    const rows = db.prepare('SELECT * FROM doorways ORDER BY created_at ASC').all() as DoorwayRow[];
    return rows.map(rowToDoorway);
  }

  /**
   * 更新门洞属性并返回更新后的门洞
   * Requirements: 3.1
   */
  updateDoorway(doorwayId: string, updates: Partial<DoorwayConfig>): Doorway {
    const existing = db.prepare('SELECT * FROM doorways WHERE id = ?').get(doorwayId) as DoorwayRow | undefined;
    if (!existing) {
      throw new Error(`Doorway not found: ${doorwayId}`);
    }

    const roomAId = updates.roomAId ?? existing.room_a_id;
    const roomBId = updates.roomBId ?? existing.room_b_id;
    const x = updates.x ?? existing.x;
    const y = updates.y ?? existing.y;
    const width = updates.width ?? existing.width;
    const height = updates.height ?? existing.height;

    db.prepare(`
      UPDATE doorways
      SET room_a_id = ?, room_b_id = ?, x = ?, y = ?, width = ?, height = ?
      WHERE id = ?
    `).run(roomAId, roomBId, x, y, width, height, doorwayId);

    return this.getDoorway(doorwayId);
  }

  /**
   * 删除门洞，不存在则抛出错误
   * Requirements: 3.1
   */
  deleteDoorway(doorwayId: string): void {
    const result = db.prepare('DELETE FROM doorways WHERE id = ?').run(doorwayId);
    if (result.changes === 0) {
      throw new Error(`Doorway not found: ${doorwayId}`);
    }
  }

  // ---------------------------------------------------------------------------
  // Validation
  // ---------------------------------------------------------------------------

  /**
   * 验证门洞放置是否合法：
   * 1. 两个房间必须存在
   * 2. 宽度不小于 32px（bot 碰撞箱大小）
   * 3. 门洞位置必须在两个房间的共享边界上（容差 20px）
   * Requirements: 3.2, 3.3, 3.5
   */
  validateDoorwayPlacement(config: DoorwayConfig): ValidationResult {
    const errors: string[] = [];

    // 1. 验证两个房间是否存在
    let roomA;
    let roomB;

    try {
      roomA = roomManager.getRoom(config.roomAId);
    } catch {
      errors.push(`Room A not found: ${config.roomAId}`);
    }

    try {
      roomB = roomManager.getRoom(config.roomBId);
    } catch {
      errors.push(`Room B not found: ${config.roomBId}`);
    }

    // 2. 验证宽度不小于 32px
    if (config.width < 32) {
      errors.push(`Doorway width ${config.width} is less than minimum 32px (bot collision box size)`);
    }

    // 3. 验证门洞位置在共享边界上（需要两个房间都存在且有 bounds）
    if (roomA && roomB) {
      if (!roomA.bounds || !roomB.bounds) {
        errors.push('Both rooms must have bounds defined for doorway placement validation');
      } else {
        const sharedBoundaryError = this._validateSharedBoundary(config, roomA.bounds, roomB.bounds);
        if (sharedBoundaryError) {
          errors.push(sharedBoundaryError);
        }
      }
    }

    return { valid: errors.length === 0, errors };
  }

  // ---------------------------------------------------------------------------
  // Private helpers
  // ---------------------------------------------------------------------------

  /**
   * 检查门洞是否位于两个房间的共享边界上
   * 容差：边界相邻检查 20px，门洞坐标偏离边界检查 10px
   */
  private _validateSharedBoundary(
    config: DoorwayConfig,
    boundsA: { x1: number; y1: number; x2: number; y2: number },
    boundsB: { x1: number; y1: number; x2: number; y2: number },
  ): string | null {
    const BOUNDARY_TOLERANCE = 20;
    const POSITION_TOLERANCE = 10;

    // 检查垂直共享边界（A 的右边 ≈ B 的左边，或 B 的右边 ≈ A 的左边）
    const aRightBLeft = Math.abs(boundsA.x2 - boundsB.x1) <= BOUNDARY_TOLERANCE;
    const bRightALeft = Math.abs(boundsB.x2 - boundsA.x1) <= BOUNDARY_TOLERANCE;

    if (aRightBLeft) {
      // 共享垂直边界在 x ≈ boundsA.x2 ≈ boundsB.x1
      const boundaryX = (boundsA.x2 + boundsB.x1) / 2;
      if (Math.abs(config.x - boundaryX) <= POSITION_TOLERANCE) {
        return null; // 有效
      }
      return `Doorway x=${config.x} is not near the shared vertical boundary at x≈${boundaryX}`;
    }

    if (bRightALeft) {
      // 共享垂直边界在 x ≈ boundsB.x2 ≈ boundsA.x1
      const boundaryX = (boundsB.x2 + boundsA.x1) / 2;
      if (Math.abs(config.x - boundaryX) <= POSITION_TOLERANCE) {
        return null; // 有效
      }
      return `Doorway x=${config.x} is not near the shared vertical boundary at x≈${boundaryX}`;
    }

    // 检查水平共享边界（A 的下边 ≈ B 的上边，或 B 的下边 ≈ A 的上边）
    const aBottomBTop = Math.abs(boundsA.y2 - boundsB.y1) <= BOUNDARY_TOLERANCE;
    const bBottomATop = Math.abs(boundsB.y2 - boundsA.y1) <= BOUNDARY_TOLERANCE;

    if (aBottomBTop) {
      // 共享水平边界在 y ≈ boundsA.y2 ≈ boundsB.y1
      const boundaryY = (boundsA.y2 + boundsB.y1) / 2;
      if (Math.abs(config.y - boundaryY) <= POSITION_TOLERANCE) {
        return null; // 有效
      }
      return `Doorway y=${config.y} is not near the shared horizontal boundary at y≈${boundaryY}`;
    }

    if (bBottomATop) {
      // 共享水平边界在 y ≈ boundsB.y2 ≈ boundsA.y1
      const boundaryY = (boundsB.y2 + boundsA.y1) / 2;
      if (Math.abs(config.y - boundaryY) <= POSITION_TOLERANCE) {
        return null; // 有效
      }
      return `Doorway y=${config.y} is not near the shared horizontal boundary at y≈${boundaryY}`;
    }

    return 'Rooms are not adjacent (do not share a boundary edge)';
  }
}

// =============================================================================
// Singleton Export
// =============================================================================

export const doorwayManager = new DoorwayManager();
