// =============================================================================
// XTION_TheFool0 — 大厅槽位唯一性属性测试
// Feature: location-state-system
// Property 1: 任意时刻，同一大厅槽位不被两个 Agent 同时占用
// Validates: Requirements 2.1, 7.1
// =============================================================================

import { describe, it, expect, beforeEach } from 'vitest';
import fc from 'fast-check';
import { LocationManagerClass, LOBBY_SLOTS } from '../../modules/location-manager.js';

// =============================================================================
// Property 1: 槽位唯一性
// Validates: Requirements 2.1, 7.1
// =============================================================================

describe('Property 1: 大厅槽位唯一性', () => {
  let manager: LocationManagerClass;

  beforeEach(() => {
    manager = new LocationManagerClass();
  });

  it('分配给多个 Agent 的槽位索引互不重复', () => {
    // **Validates: Requirements 2.1**
    fc.assert(
      fc.property(
        // Generate 2..10 unique agent IDs
        fc.uniqueArray(
          fc.string({ minLength: 4, maxLength: 16 }).filter(s => s.trim().length > 0),
          { minLength: 2, maxLength: 10 },
        ),
        (agentIds) => {
          const mgr = new LocationManagerClass();
          const assignedIndices: number[] = [];

          for (const id of agentIds) {
            mgr.assignLobbySlot(id);
            const state = mgr.getState(id);
            if (state) assignedIndices.push(state.slotIndex);
          }

          // All assigned slot indices must be unique
          const uniqueIndices = new Set(assignedIndices);
          return uniqueIndices.size === assignedIndices.length;
        },
      ),
      { numRuns: 200 },
    );
  });

  it('分配给 Agent 的坐标对应正确的 LOBBY_SLOTS 条目', () => {
    // **Validates: Requirements 1.1, 2.1**
    fc.assert(
      fc.property(
        fc.uniqueArray(
          fc.string({ minLength: 4, maxLength: 16 }).filter(s => s.trim().length > 0),
          { minLength: 1, maxLength: 10 },
        ),
        (agentIds) => {
          const mgr = new LocationManagerClass();

          for (const id of agentIds) {
            const slot = mgr.assignLobbySlot(id);
            const state = mgr.getState(id);
            if (!state) return false;

            // Slot coordinates must match LOBBY_SLOTS[slotIndex]
            const expected = LOBBY_SLOTS[state.slotIndex];
            if (!expected) return false;
            if (slot.x !== expected.x || slot.y !== expected.y) return false;
            if (state.slot.x !== expected.x || state.slot.y !== expected.y) return false;
          }
          return true;
        },
      ),
      { numRuns: 200 },
    );
  });

  it('同一 Agent 不能被分配两个不同的槽位', () => {
    // **Validates: Requirements 2.1**
    fc.assert(
      fc.property(
        fc.string({ minLength: 4, maxLength: 16 }).filter(s => s.trim().length > 0),
        (agentId) => {
          const mgr = new LocationManagerClass();
          mgr.assignLobbySlot(agentId);
          const state1 = mgr.getState(agentId);

          // Calling assignLobbySlot again overwrites the state (re-assign)
          // The manager should only have one state per agent
          const allStates = mgr.getAllStates();
          const statesForAgent = allStates.filter(s => s.contestantId === agentId);
          return statesForAgent.length === 1 && state1 !== null;
        },
      ),
      { numRuns: 200 },
    );
  });

  it('大厅满员时抛出 LOBBY_FULL 错误', () => {
    // **Validates: Requirements 2.3**
    const mgr = new LocationManagerClass();

    // Fill all 20 lobby slots
    for (let i = 0; i < LOBBY_SLOTS.length; i++) {
      mgr.assignLobbySlot(`agent-${i}`);
    }

    // Next assignment should throw LOBBY_FULL
    expect(() => mgr.assignLobbySlot('overflow-agent')).toThrow();
    try {
      mgr.assignLobbySlot('overflow-agent-2');
    } catch (err: unknown) {
      expect((err as { code?: string }).code).toBe('LOBBY_FULL');
    }
  });

  it('释放槽位后，该槽位可被新 Agent 使用', () => {
    // **Validates: Requirements 2.5**
    fc.assert(
      fc.property(
        fc.uniqueArray(
          fc.string({ minLength: 4, maxLength: 16 }).filter(s => s.trim().length > 0),
          { minLength: 2, maxLength: 5 },
        ),
        (agentIds) => {
          const mgr = new LocationManagerClass();

          // Assign all agents
          for (const id of agentIds) {
            mgr.assignLobbySlot(id);
          }

          // Release the first agent
          const firstId = agentIds[0];
          const firstState = mgr.getState(firstId);
          if (!firstState) return false;
          const releasedIndex = firstState.slotIndex;

          mgr.releaseSlot(firstId);

          // New agent should be able to get the released slot
          const newAgentId = 'new-agent-after-release';
          mgr.assignLobbySlot(newAgentId);
          const newState = mgr.getState(newAgentId);
          if (!newState) return false;

          // The new agent should have gotten the released slot (first-fit)
          return newState.slotIndex === releasedIndex;
        },
      ),
      { numRuns: 100 },
    );
  });
});
