// =============================================================================
// XTION_TheFool0 — 房间容量约束属性测试
// Feature: multi-room-collision-system
// Requirements: 2
// =============================================================================

import { describe, it, beforeEach } from 'vitest';
import { expect } from 'vitest';
import fc from 'fast-check';

// =============================================================================
// In-memory RoomCapacityManager for property testing
// Models the capacity enforcement logic from room-manager.ts
// =============================================================================

type RoomType = 'MainHall' | 'PrivateRoom';

const PRIVATE_ROOM_CAPACITY = 2;
const MAIN_HALL_CAPACITY = Infinity;

interface RoomState {
  id: string;
  type: RoomType;
  capacity: number;
  bots: Set<string>;
}

class InMemoryRoomCapacityManager {
  private rooms: Map<string, RoomState> = new Map();

  createRoom(id: string, type: RoomType, capacity?: number): void {
    const cap = capacity ?? (type === 'PrivateRoom' ? PRIVATE_ROOM_CAPACITY : MAIN_HALL_CAPACITY);
    this.rooms.set(id, { id, type, capacity: cap, bots: new Set() });
  }

  canJoin(roomId: string): boolean {
    const room = this.rooms.get(roomId);
    if (!room) throw new Error(`Room not found: ${roomId}`);
    if (room.type === 'MainHall') return true;
    return room.bots.size < room.capacity;
  }

  addBot(roomId: string, botId: string): { success: boolean; error?: string } {
    const room = this.rooms.get(roomId);
    if (!room) throw new Error(`Room not found: ${roomId}`);

    if (!this.canJoin(roomId)) {
      return { success: false, error: 'Room is at capacity' };
    }

    room.bots.add(botId);
    return { success: true };
  }

  removeBot(roomId: string, botId: string): void {
    const room = this.rooms.get(roomId);
    if (!room) throw new Error(`Room not found: ${roomId}`);
    room.bots.delete(botId);
  }

  getCount(roomId: string): number {
    return this.rooms.get(roomId)?.bots.size ?? 0;
  }

  getCapacity(roomId: string): number {
    return this.rooms.get(roomId)?.capacity ?? 0;
  }
}

// =============================================================================
// Property 4: 房间容量约束
// Requirements: 2
// =============================================================================

describe('Property 4: 房间容量约束', () => {
  let mgr: InMemoryRoomCapacityManager;

  beforeEach(() => {
    mgr = new InMemoryRoomCapacityManager();
  });

  it('私聊房间的bot数量永远不超过容量限制(2)', () => {
    fc.assert(
      fc.property(
        // Generate a sequence of unique bot IDs to add
        fc.array(fc.uuid(), { minLength: 1, maxLength: 20 }),
        (botIds) => {
          const m = new InMemoryRoomCapacityManager();
          m.createRoom('private-1', 'PrivateRoom');

          for (const botId of botIds) {
            m.addBot('private-1', botId);
            // Invariant: count must never exceed capacity
            if (m.getCount('private-1') > PRIVATE_ROOM_CAPACITY) return false;
          }
          return true;
        },
      ),
      { numRuns: 200 },
    );
  });

  it('私聊房间满员后，新bot加入请求被拒绝', () => {
    fc.assert(
      fc.property(
        fc.uuid(),
        fc.uuid(),
        fc.uuid(),
        (bot1, bot2, bot3) => {
          fc.pre(bot1 !== bot2 && bot2 !== bot3 && bot1 !== bot3);

          const m = new InMemoryRoomCapacityManager();
          m.createRoom('private-2', 'PrivateRoom');

          m.addBot('private-2', bot1);
          m.addBot('private-2', bot2);

          // Room is now full (2/2)
          const result = m.addBot('private-2', bot3);
          return result.success === false && result.error !== undefined;
        },
      ),
      { numRuns: 200 },
    );
  });

  it('bot离开后，房间重新可加入', () => {
    fc.assert(
      fc.property(
        fc.uuid(),
        fc.uuid(),
        fc.uuid(),
        (bot1, bot2, bot3) => {
          fc.pre(bot1 !== bot2 && bot2 !== bot3 && bot1 !== bot3);

          const m = new InMemoryRoomCapacityManager();
          m.createRoom('private-3', 'PrivateRoom');

          m.addBot('private-3', bot1);
          m.addBot('private-3', bot2);

          // Full — bot3 cannot join
          const blocked = m.addBot('private-3', bot3);
          if (blocked.success) return false;

          // bot1 leaves
          m.removeBot('private-3', bot1);

          // Now bot3 can join
          const allowed = m.addBot('private-3', bot3);
          return allowed.success === true && m.getCount('private-3') <= PRIVATE_ROOM_CAPACITY;
        },
      ),
      { numRuns: 200 },
    );
  });

  it('主大厅允许任意数量的bot加入', () => {
    fc.assert(
      fc.property(
        fc.array(fc.uuid(), { minLength: 1, maxLength: 100 }),
        (botIds) => {
          const m = new InMemoryRoomCapacityManager();
          m.createRoom('main-hall', 'MainHall');

          const uniqueBots = [...new Set(botIds)];
          for (const botId of uniqueBots) {
            const result = m.addBot('main-hall', botId);
            if (!result.success) return false;
          }
          return m.getCount('main-hall') === uniqueBots.length;
        },
      ),
      { numRuns: 100 },
    );
  });

  it('canJoin 与实际加入结果一致（无竞态）', () => {
    fc.assert(
      fc.property(
        fc.array(fc.uuid(), { minLength: 1, maxLength: 10 }),
        (botIds) => {
          const m = new InMemoryRoomCapacityManager();
          m.createRoom('private-4', 'PrivateRoom');

          const unique = [...new Set(botIds)];
          for (const botId of unique) {
            const canJoin = m.canJoin('private-4');
            const result = m.addBot('private-4', botId);
            // canJoin prediction must match actual result
            if (canJoin !== result.success) return false;
          }
          return true;
        },
      ),
      { numRuns: 200 },
    );
  });

  it('私聊房间容量约束在任意加入/离开序列下保持不变', () => {
    fc.assert(
      fc.property(
        // Commands: true = add, false = remove
        fc.array(
          fc.record({ add: fc.boolean(), botId: fc.uuid() }),
          { minLength: 1, maxLength: 50 },
        ),
        (commands) => {
          const m = new InMemoryRoomCapacityManager();
          m.createRoom('private-5', 'PrivateRoom');
          const inRoom = new Set<string>();

          for (const cmd of commands) {
            if (cmd.add) {
              const result = m.addBot('private-5', cmd.botId);
              if (result.success) inRoom.add(cmd.botId);
            } else {
              if (inRoom.has(cmd.botId)) {
                m.removeBot('private-5', cmd.botId);
                inRoom.delete(cmd.botId);
              }
            }

            // Invariant must hold after every operation
            if (m.getCount('private-5') > PRIVATE_ROOM_CAPACITY) return false;
          }
          return true;
        },
      ),
      { numRuns: 200 },
    );
  });
});
