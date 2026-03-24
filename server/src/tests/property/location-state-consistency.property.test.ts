// =============================================================================
// XTION_TheFool0 — 位置状态一致性属性测试
// Feature: location-state-system
// Property 3: Agent 的 locationState 与其 slot 坐标始终对应正确的硬编码坐标
// Validates: Requirements 1.1, 1.2, 1.3, 4.4, 4.5, 5.3
// =============================================================================

import { describe, it, beforeEach } from 'vitest';
import fc from 'fast-check';
import { LocationManagerClass, LOBBY_SLOTS, ROOM_SLOTS } from '../../modules/location-manager.js';

// =============================================================================
// Property 3: 位置状态一致性
// Validates: Requirements 1.1, 1.2, 1.3, 4.4, 4.5, 5.3
// =============================================================================

describe('Property 3: 位置状态一致性', () => {
  let manager: LocationManagerClass;

  beforeEach(() => {
    manager = new LocationManagerClass();
  });

  it('assignLobbySlot 后：slot 坐标与 LOBBY_SLOTS[slotIndex] 完全一致', () => {
    // **Validates: Requirements 1.1, 2.1**
    fc.assert(
      fc.property(
        fc.uniqueArray(
          fc.string({ minLength: 4, maxLength: 16 }).filter(s => s.trim().length > 0),
          { minLength: 1, maxLength: 15 },
        ),
        (agentIds) => {
          const mgr = new LocationManagerClass();

          for (const id of agentIds) {
            const returnedSlot = mgr.assignLobbySlot(id);
            const state = mgr.getState(id);
            if (!state) return false;

            // locationState must be 'lobby'
            if (state.locationState !== 'lobby') return false;

            // slot must match LOBBY_SLOTS[slotIndex]
            const expected = LOBBY_SLOTS[state.slotIndex];
            if (!expected) return false;
            if (state.slot.x !== expected.x || state.slot.y !== expected.y) return false;

            // returned slot must also match
            if (returnedSlot.x !== expected.x || returnedSlot.y !== expected.y) return false;
          }
          return true;
        },
      ),
      { numRuns: 200 },
    );
  });

  it('enterRoom 后：inviter 的 slot 对应 ROOM_SLOTS[roomId][0]，invitee 对应 [1]', () => {
    // **Validates: Requirements 1.2, 1.3, 4.4, 4.5**
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

          // Both must have locationState = room_n
          if (inviterState.locationState !== `room_${roomId}`) return false;
          if (inviteeState.locationState !== `room_${roomId}`) return false;

          // Inviter gets Slot_A (index 0), invitee gets Slot_B (index 1)
          if (inviterState.slotIndex !== 0) return false;
          if (inviteeState.slotIndex !== 1) return false;

          // Coordinates must match ROOM_SLOTS
          const [slotA, slotB] = ROOM_SLOTS[roomId];
          if (inviterState.slot.x !== slotA.x || inviterState.slot.y !== slotA.y) return false;
          if (inviteeState.slot.x !== slotB.x || inviteeState.slot.y !== slotB.y) return false;

          return true;
        },
      ),
      { numRuns: 100 },
    );
  });

  it('leaveRoom 后：Agent 的 slot 坐标对应有效的 LOBBY_SLOTS 条目', () => {
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
          const newSlot = mgr.leaveRoom(leavingAgent);
          const state = mgr.getState(leavingAgent);
          if (!state) return false;

          // locationState must be 'lobby'
          if (state.locationState !== 'lobby') return false;

          // slot must be a valid LOBBY_SLOTS entry
          const isValidLobbySlot = LOBBY_SLOTS.some(
            (s) => s.x === state.slot.x && s.y === state.slot.y,
          );
          if (!isValidLobbySlot) return false;

          // returned slot must match state.slot
          if (newSlot.x !== state.slot.x || newSlot.y !== state.slot.y) return false;

          return true;
        },
      ),
      { numRuns: 100 },
    );
  });

  it('所有 Agent 的 slot 坐标始终是有效的硬编码坐标', () => {
    // **Validates: Requirements 1.1, 1.2, 1.3**
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 8 }),
        (roomId) => {
          const mgr = new LocationManagerClass();
          mgr.assignLobbySlot('a1');
          mgr.assignLobbySlot('a2');
          mgr.assignLobbySlot('a3');

          // a1 and a2 enter a room
          mgr.enterRoom('a1', 'a2', roomId);

          // Verify all states have valid coordinates
          const allStates = mgr.getAllStates();
          for (const state of allStates) {
            if (state.locationState === 'lobby') {
              const valid = LOBBY_SLOTS.some(
                (s) => s.x === state.slot.x && s.y === state.slot.y,
              );
              if (!valid) return false;
            } else {
              const match = state.locationState.match(/^room_(\d+)$/);
              if (!match) return false;
              const rId = parseInt(match[1], 10);
              const roomSlots = ROOM_SLOTS[rId];
              if (!roomSlots) return false;
              const valid = roomSlots.some(
                (s) => s.x === state.slot.x && s.y === state.slot.y,
              );
              if (!valid) return false;
            }
          }
          return true;
        },
      ),
      { numRuns: 100 },
    );
  });
});
