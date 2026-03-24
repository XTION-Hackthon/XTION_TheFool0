// =============================================================================
// XTION_TheFool0 — 槽位释放完整性属性测试
// Feature: location-state-system
// Property 5: Agent 断开连接后，其占用的所有槽位均被释放，可被后续 Agent 使用
// Validates: Requirements 2.5, 5.3, 5.5
// =============================================================================

import { describe, it, expect, beforeEach } from 'vitest';
import fc from 'fast-check';
import { LocationManagerClass, LOBBY_SLOTS } from '../../modules/location-manager.js';

// =============================================================================
// Property 5: 槽位释放完整性
// Validates: Requirements 2.5, 5.3, 5.5
// =============================================================================

describe('Property 5: 槽位释放完整性', () => {
  let manager: LocationManagerClass;

  beforeEach(() => {
    manager = new LocationManagerClass();
  });

  it('大厅槽位释放后，getState 返回 null', () => {
    // **Validates: Requirements 2.5**
    fc.assert(
      fc.property(
        fc.string({ minLength: 4, maxLength: 16 }).filter(s => s.trim().length > 0),
        (agentId) => {
          const mgr = new LocationManagerClass();
          mgr.assignLobbySlot(agentId);
          expect(mgr.getState(agentId)).not.toBeNull();

          mgr.releaseSlot(agentId);
          return mgr.getState(agentId) === null;
        },
      ),
      { numRuns: 200 },
    );
  });

  it('大厅槽位释放后，该槽位索引可被新 Agent 重新分配', () => {
    // **Validates: Requirements 2.5**
    fc.assert(
      fc.property(
        fc.string({ minLength: 4, maxLength: 16 }).filter(s => s.trim().length > 0),
        (agentId) => {
          const mgr = new LocationManagerClass();
          mgr.assignLobbySlot(agentId);
          const releasedIndex = mgr.getState(agentId)!.slotIndex;

          mgr.releaseSlot(agentId);

          // New agent should get the same slot (first-fit)
          const newId = `new-${agentId}`;
          mgr.assignLobbySlot(newId);
          const newState = mgr.getState(newId);

          return newState !== null && newState.slotIndex === releasedIndex;
        },
      ),
      { numRuns: 200 },
    );
  });

  it('房间槽位释放后，getRoomOccupancy 对应槽位变为 null', () => {
    // **Validates: Requirements 5.5**
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 8 }),
        fc.boolean(),
        (roomId, releaseInviter) => {
          const mgr = new LocationManagerClass();
          mgr.assignLobbySlot('inviter');
          mgr.assignLobbySlot('invitee');
          mgr.enterRoom('inviter', 'invitee', roomId);

          const agentToRelease = releaseInviter ? 'inviter' : 'invitee';
          mgr.releaseSlot(agentToRelease);

          const occupancy = mgr.getRoomOccupancy(roomId);

          if (releaseInviter) {
            // inviter was in slotA
            return occupancy.slotA === null && occupancy.slotB === 'invitee';
          } else {
            // invitee was in slotB
            return occupancy.slotA === 'inviter' && occupancy.slotB === null;
          }
        },
      ),
      { numRuns: 100 },
    );
  });

  it('所有 Agent 释放后，大厅槽位全部可用（无槽位泄漏）', () => {
    // **Validates: Requirements 2.5**
    fc.assert(
      fc.property(
        fc.uniqueArray(
          fc.string({ minLength: 4, maxLength: 16 }).filter(s => s.trim().length > 0),
          { minLength: 1, maxLength: 15 },
        ),
        (agentIds) => {
          const mgr = new LocationManagerClass();

          // Assign all agents
          for (const id of agentIds) {
            mgr.assignLobbySlot(id);
          }

          // Release all agents
          for (const id of agentIds) {
            mgr.releaseSlot(id);
          }

          // All states should be gone
          const allStates = mgr.getAllStates();
          if (allStates.length !== 0) return false;

          // All 20 lobby slots should be available again
          // Verify by assigning 20 new agents without error
          for (let i = 0; i < LOBBY_SLOTS.length; i++) {
            mgr.assignLobbySlot(`fresh-agent-${i}`);
          }

          return mgr.getAllStates().length === LOBBY_SLOTS.length;
        },
      ),
      { numRuns: 100 },
    );
  });

  it('房间内双方都释放后，房间完全空闲（findFreeRoom 可找到该房间）', () => {
    // **Validates: Requirements 5.5**
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 8 }),
        (roomId) => {
          const mgr = new LocationManagerClass();

          // Fill all rooms except the target
          for (let r = 1; r <= 8; r++) {
            if (r === roomId) continue;
            mgr.assignLobbySlot(`inv-${r}`);
            mgr.assignLobbySlot(`inv2-${r}`);
            mgr.enterRoom(`inv-${r}`, `inv2-${r}`, r);
          }

          // Enter target room
          mgr.assignLobbySlot('inviter');
          mgr.assignLobbySlot('invitee');
          mgr.enterRoom('inviter', 'invitee', roomId);

          // All rooms are now full
          expect(mgr.findFreeRoom()).toBeNull();

          // Release both agents from target room
          mgr.releaseSlot('inviter');
          mgr.releaseSlot('invitee');

          // Target room should now be free
          const freeRoom = mgr.findFreeRoom();
          return freeRoom === roomId;
        },
      ),
      { numRuns: 50 },
    );
  });

  it('releaseSlot 对不存在的 Agent 不抛出错误', () => {
    // **Validates: Requirements 2.5**
    fc.assert(
      fc.property(
        fc.string({ minLength: 4, maxLength: 16 }).filter(s => s.trim().length > 0),
        (nonExistentId) => {
          const mgr = new LocationManagerClass();
          // Should not throw
          mgr.releaseSlot(nonExistentId);
          return true;
        },
      ),
      { numRuns: 100 },
    );
  });
});
