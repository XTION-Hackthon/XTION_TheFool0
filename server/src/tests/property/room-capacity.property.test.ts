// =============================================================================
// XTION_TheFool0 — 房间容量上限属性测试
// Feature: location-state-system
// Property 2: 任意时刻，任意房间的占用人数 ≤ 2
// Validates: Requirements 7.1, 7.3
// =============================================================================

import { describe, it, expect, beforeEach } from 'vitest';
import fc from 'fast-check';
import { LocationManagerClass, ROOM_SLOTS } from '../../modules/location-manager.js';

// =============================================================================
// Helpers
// =============================================================================

/** Count non-null slots in a room occupancy record */
function countOccupants(occupancy: { slotA: string | null; slotB: string | null }): number {
  return (occupancy.slotA !== null ? 1 : 0) + (occupancy.slotB !== null ? 1 : 0);
}

/** Valid room IDs */
const ROOM_IDS = Object.keys(ROOM_SLOTS).map(Number);

// =============================================================================
// Property 2: 房间容量上限
// Validates: Requirements 7.1, 7.3
// =============================================================================

describe('Property 2: 房间容量上限', () => {
  let manager: LocationManagerClass;

  beforeEach(() => {
    manager = new LocationManagerClass();
  });

  it('enterRoom 后，房间占用人数恰好为 2', () => {
    // **Validates: Requirements 7.1**
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 8 }),
        (roomId) => {
          const mgr = new LocationManagerClass();
          mgr.assignLobbySlot('inviter');
          mgr.assignLobbySlot('invitee');

          mgr.enterRoom('inviter', 'invitee', roomId);

          const occupancy = mgr.getRoomOccupancy(roomId);
          return countOccupants(occupancy) === 2;
        },
      ),
      { numRuns: 100 },
    );
  });

  it('任意操作序列后，每个房间占用人数始终 ≤ 2', () => {
    // **Validates: Requirements 7.1**
    // Generate a sequence of enter/leave operations
    const enterOp = fc.record({
      type: fc.constant('enter' as const),
      inviterId: fc.string({ minLength: 4, maxLength: 12 }).filter(s => s.trim().length > 0),
      inviteeId: fc.string({ minLength: 4, maxLength: 12 }).filter(s => s.trim().length > 0),
      roomId: fc.integer({ min: 1, max: 8 }),
    });

    fc.assert(
      fc.property(
        fc.array(enterOp, { minLength: 1, maxLength: 8 }),
        (ops) => {
          const mgr = new LocationManagerClass();
          const usedAgents = new Set<string>();

          for (const op of ops) {
            if (op.inviterId === op.inviteeId) continue;
            if (usedAgents.has(op.inviterId) || usedAgents.has(op.inviteeId)) continue;

            // Assign lobby slots first
            try {
              mgr.assignLobbySlot(op.inviterId);
              mgr.assignLobbySlot(op.inviteeId);
            } catch {
              break; // lobby full
            }

            // Try to enter room (may fail if room already occupied)
            try {
              mgr.enterRoom(op.inviterId, op.inviteeId, op.roomId);
              usedAgents.add(op.inviterId);
              usedAgents.add(op.inviteeId);
            } catch {
              // Room may be occupied — that's fine, just skip
              mgr.releaseSlot(op.inviterId);
              mgr.releaseSlot(op.inviteeId);
            }

            // After every operation, verify all rooms have ≤ 2 occupants
            for (const rId of ROOM_IDS) {
              const occupancy = mgr.getRoomOccupancy(rId);
              if (countOccupants(occupancy) > 2) return false;
            }
          }
          return true;
        },
      ),
      { numRuns: 200 },
    );
  });

  it('leaveRoom 后，房间对应槽位变为 null', () => {
    // **Validates: Requirements 5.3**
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 8 }),
        fc.boolean(),
        (roomId, inviterLeaves) => {
          const mgr = new LocationManagerClass();
          mgr.assignLobbySlot('inviter');
          mgr.assignLobbySlot('invitee');
          mgr.enterRoom('inviter', 'invitee', roomId);

          const leavingAgent = inviterLeaves ? 'inviter' : 'invitee';
          mgr.leaveRoom(leavingAgent);

          const occupancy = mgr.getRoomOccupancy(roomId);
          const count = countOccupants(occupancy);
          // After one agent leaves, room should have exactly 1 occupant
          return count === 1;
        },
      ),
      { numRuns: 100 },
    );
  });

  it('findFreeRoom() 仅在所有 8 个房间都被占用时返回 null', () => {
    // **Validates: Requirements 3.7, 3.8**
    const mgr = new LocationManagerClass();

    // Initially all rooms are free
    expect(mgr.findFreeRoom()).not.toBeNull();

    // Fill all 8 rooms
    for (let roomId = 1; roomId <= 8; roomId++) {
      mgr.assignLobbySlot(`inviter-${roomId}`);
      mgr.assignLobbySlot(`invitee-${roomId}`);
      mgr.enterRoom(`inviter-${roomId}`, `invitee-${roomId}`, roomId);
    }

    // Now all rooms are full
    expect(mgr.findFreeRoom()).toBeNull();

    // After one agent leaves, a room becomes available again
    mgr.leaveRoom('inviter-1');
    // Room 1 now has only 1 occupant — not fully free (slotA is null but slotB is not)
    // findFreeRoom only returns rooms where BOTH slots are null
    expect(mgr.findFreeRoom()).toBeNull();

    // After both agents leave room 1
    mgr.leaveRoom('invitee-1');
    expect(mgr.findFreeRoom()).toBe(1);
  });

  it('enterRoom 对无效房间 ID 抛出 INVALID_ROOM 错误', () => {
    // **Validates: Requirements 7.3**
    const mgr = new LocationManagerClass();
    mgr.assignLobbySlot('inviter');
    mgr.assignLobbySlot('invitee');

    expect(() => mgr.enterRoom('inviter', 'invitee', 99)).toThrow();
    try {
      mgr.enterRoom('inviter', 'invitee', 0);
    } catch (err: unknown) {
      expect((err as { code?: string }).code).toBe('INVALID_ROOM');
    }
  });
});
