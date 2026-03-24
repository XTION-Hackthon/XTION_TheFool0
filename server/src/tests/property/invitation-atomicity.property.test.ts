// =============================================================================
// XTION_TheFool0 — 邀请原子性属性测试
// Feature: location-state-system
// Property 4: 接受邀请后，双方状态要么都变为 room_n，要么都保持 lobby（无中间状态）
// Validates: Requirements 4.3, 4.4, 4.5, 7.3
// =============================================================================

import { describe, it, expect, beforeEach } from 'vitest';
import fc from 'fast-check';
import { LocationManagerClass } from '../../modules/location-manager.js';

// =============================================================================
// Property 4: 邀请原子性
// Validates: Requirements 4.3, 4.4, 4.5, 7.3
// =============================================================================

describe('Property 4: 邀请原子性', () => {
  let manager: LocationManagerClass;

  beforeEach(() => {
    manager = new LocationManagerClass();
  });

  it('enterRoom 后，双方 locationState 均为 room_n', () => {
    // **Validates: Requirements 4.3, 4.4, 4.5**
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 8 }),
        (roomId) => {
          const mgr = new LocationManagerClass();
          mgr.assignLobbySlot('inviter');
          mgr.assignLobbySlot('invitee');

          mgr.enterRoom('inviter', 'invitee', roomId);

          const inviterState = mgr.getState('inviter');
          const inviteeState = mgr.getState('invitee');

          if (!inviterState || !inviteeState) return false;

          // Both must be in the same room
          return (
            inviterState.locationState === `room_${roomId}` &&
            inviteeState.locationState === `room_${roomId}`
          );
        },
      ),
      { numRuns: 100 },
    );
  });

  it('enterRoom 后，inviter 在 Slot_A (slotIndex=0)，invitee 在 Slot_B (slotIndex=1)', () => {
    // **Validates: Requirements 4.4, 4.5**
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 8 }),
        (roomId) => {
          const mgr = new LocationManagerClass();
          mgr.assignLobbySlot('inviter');
          mgr.assignLobbySlot('invitee');

          mgr.enterRoom('inviter', 'invitee', roomId);

          const inviterState = mgr.getState('inviter');
          const inviteeState = mgr.getState('invitee');

          if (!inviterState || !inviteeState) return false;

          return inviterState.slotIndex === 0 && inviteeState.slotIndex === 1;
        },
      ),
      { numRuns: 100 },
    );
  });

  it('enterRoom 对无效房间 ID 抛出错误时，双方状态保持不变', () => {
    // **Validates: Requirements 7.3**
    fc.assert(
      fc.property(
        fc.integer({ min: 9, max: 100 }), // invalid room IDs
        (invalidRoomId) => {
          const mgr = new LocationManagerClass();
          mgr.assignLobbySlot('inviter');
          mgr.assignLobbySlot('invitee');

          const inviterBefore = mgr.getState('inviter');
          const inviteeBefore = mgr.getState('invitee');

          let threw = false;
          try {
            mgr.enterRoom('inviter', 'invitee', invalidRoomId);
          } catch {
            threw = true;
          }

          if (!threw) return false;

          const inviterAfter = mgr.getState('inviter');
          const inviteeAfter = mgr.getState('invitee');

          // States must be unchanged after failed enterRoom
          if (!inviterBefore || !inviteeBefore || !inviterAfter || !inviteeAfter) return false;

          return (
            inviterAfter.locationState === inviterBefore.locationState &&
            inviteeAfter.locationState === inviteeBefore.locationState
          );
        },
      ),
      { numRuns: 100 },
    );
  });

  it('enterRoom 不出现部分分配：不存在一方在房间而另一方在大厅的中间状态', () => {
    // **Validates: Requirements 7.3**
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 8 }),
        (roomId) => {
          const mgr = new LocationManagerClass();
          mgr.assignLobbySlot('inviter');
          mgr.assignLobbySlot('invitee');

          mgr.enterRoom('inviter', 'invitee', roomId);

          const inviterState = mgr.getState('inviter');
          const inviteeState = mgr.getState('invitee');

          if (!inviterState || !inviteeState) return false;

          // Both must be in the same location — no partial state
          const bothInRoom =
            inviterState.locationState === `room_${roomId}` &&
            inviteeState.locationState === `room_${roomId}`;

          const bothInLobby =
            inviterState.locationState === 'lobby' &&
            inviteeState.locationState === 'lobby';

          // Must be one or the other — never mixed
          return bothInRoom || bothInLobby;
        },
      ),
      { numRuns: 100 },
    );
  });

  it('多对 Agent 进入不同房间后，各自状态独立正确', () => {
    // **Validates: Requirements 4.3, 7.1**
    const mgr = new LocationManagerClass();

    // Put 4 pairs into 4 different rooms
    for (let roomId = 1; roomId <= 4; roomId++) {
      mgr.assignLobbySlot(`inviter-${roomId}`);
      mgr.assignLobbySlot(`invitee-${roomId}`);
      mgr.enterRoom(`inviter-${roomId}`, `invitee-${roomId}`, roomId);
    }

    // Verify each pair is in the correct room
    for (let roomId = 1; roomId <= 4; roomId++) {
      const inviterState = mgr.getState(`inviter-${roomId}`);
      const inviteeState = mgr.getState(`invitee-${roomId}`);

      expect(inviterState?.locationState).toBe(`room_${roomId}`);
      expect(inviteeState?.locationState).toBe(`room_${roomId}`);
      expect(inviterState?.slotIndex).toBe(0);
      expect(inviteeState?.slotIndex).toBe(1);
    }
  });
});
