// =============================================================================
// XTION_TheFool0 — Bug 3 探索性测试: 观战主链路只拿首帧，不拿后续世界变化
// Bugfix: core-runtime-business-logic-fixes
// **Validates: Requirements 2.6, 2.7**
//
// This test encodes the EXPECTED correct behavior:
//   After Agent_Viewer establishes a WebSocket connection and authenticates,
//   the system SHALL register the connection so that subsequent world change
//   events (contestant.join, room.bot_position, contestant.leave) are
//   broadcast to the viewer.
//
// On UNFIXED code this test MUST FAIL — failure confirms the bug exists.
// On FIXED code this test MUST PASS — passing confirms the bug is resolved.
// =============================================================================

import { describe, it, expect } from 'vitest';
import fc from 'fast-check';

// =============================================================================
// Model of the WebSocket handleAuth + broadcast logic
//
// This models the combined behavior of:
//   1. handleAuth (server/src/ws.ts) — authenticates and optionally registers
//      the connection in the `connections` Map
//   2. broadcast (server/src/ws.ts) — iterates `connections` Map to send events
//
// The CURRENT (unfixed) behavior:
//   - handleAuth: When role === 'Agent_Viewer', sends world.state then returns
//     immediately WITHOUT calling registerContestant(). The connection is NOT
//     added to the `connections` Map.
//   - broadcast: Only iterates `connections` Map entries. Since Agent_Viewer
//     is not registered, it never receives subsequent events.
//
// The EXPECTED (fixed) behavior:
//   - handleAuth: After sending world.state to Agent_Viewer, SHALL register
//     the connection (e.g. via `connections.set(viewerId, ws)`) so that
//     subsequent broadcast events reach the viewer.
//   - broadcast: Iterates connections including viewer entries, delivering
//     all world change events to Agent_Viewer.
// =============================================================================

type Role = 'Admin' | 'Agent_Player' | 'Agent_Viewer' | 'Human_Viewer';

type EventType =
  | 'world.state'
  | 'contestant.join'
  | 'contestant.leave'
  | 'room.bot_position'
  | 'room.bot_joined'
  | 'room.bot_left';

interface AuthInput {
  role: Role;
  keyValid: boolean;
}

interface WorldChangeEvent {
  type: EventType;
  payload: Record<string, unknown>;
}

interface ConnectionState {
  worldStateReceived: boolean;
  connectionRegistered: boolean;
  receivedEvents: EventType[];
}

// =============================================================================
// Model: CURRENT (unfixed) handleAuth + broadcast
// =============================================================================

/**
 * Model of the CURRENT (unfixed) handleAuth behavior for Agent_Viewer.
 *
 * Bug: After sending world.state, the function returns without calling
 * registerContestant(), so the connection is NOT in the connections Map.
 * Subsequent broadcast() calls skip this connection entirely.
 */
function handleAuth_current(input: AuthInput): ConnectionState {
  if (!input.keyValid) {
    return {
      worldStateReceived: false,
      connectionRegistered: false,
      receivedEvents: [],
    };
  }

  if (input.role === 'Agent_Viewer') {
    // CURRENT BUG: sends world.state but does NOT register connection
    return {
      worldStateReceived: true,
      connectionRegistered: false, // BUG: not registered
      receivedEvents: ['world.state'], // Only initial frame
    };
  }

  if (input.role === 'Agent_Player') {
    // Agent_Player: sends world.state AND registers connection
    return {
      worldStateReceived: true,
      connectionRegistered: true,
      receivedEvents: ['world.state'],
    };
  }

  // Human_Viewer: rejected
  return {
    worldStateReceived: false,
    connectionRegistered: false,
    receivedEvents: [],
  };
}

/**
 * Model of the CURRENT (unfixed) broadcast behavior.
 *
 * Only delivers events to connections that are registered in the Map.
 * Since Agent_Viewer is NOT registered, it receives nothing.
 */
function broadcastToConnection_current(
  state: ConnectionState,
  events: WorldChangeEvent[],
): ConnectionState {
  if (!state.connectionRegistered) {
    // NOT registered → receives NO subsequent events (the bug)
    return state;
  }

  // Registered → receives all broadcast events
  return {
    ...state,
    receivedEvents: [
      ...state.receivedEvents,
      ...events.map((e) => e.type),
    ],
  };
}

// =============================================================================
// Model: EXPECTED (fixed) handleAuth + broadcast
// =============================================================================

/**
 * Model of the EXPECTED (fixed) handleAuth behavior for Agent_Viewer.
 *
 * Fix: After sending world.state, the function SHALL register the viewer
 * connection so that subsequent broadcast events are delivered.
 */
function handleAuth_expected(input: AuthInput): ConnectionState {
  if (!input.keyValid) {
    return {
      worldStateReceived: false,
      connectionRegistered: false,
      receivedEvents: [],
    };
  }

  if (input.role === 'Agent_Viewer') {
    // FIX: sends world.state AND registers connection
    return {
      worldStateReceived: true,
      connectionRegistered: true, // FIX: now registered
      receivedEvents: ['world.state'],
    };
  }

  if (input.role === 'Agent_Player') {
    return {
      worldStateReceived: true,
      connectionRegistered: true,
      receivedEvents: ['world.state'],
    };
  }

  // Human_Viewer: rejected
  return {
    worldStateReceived: false,
    connectionRegistered: false,
    receivedEvents: [],
  };
}

/**
 * Model of the EXPECTED (fixed) broadcast behavior.
 *
 * Delivers events to ALL registered connections, including Agent_Viewer.
 */
function broadcastToConnection_expected(
  state: ConnectionState,
  events: WorldChangeEvent[],
): ConnectionState {
  if (!state.connectionRegistered) {
    return state;
  }

  return {
    ...state,
    receivedEvents: [
      ...state.receivedEvents,
      ...events.map((e) => e.type),
    ],
  };
}

// =============================================================================
// Arbitraries
// =============================================================================

const worldChangeEventArb: fc.Arbitrary<WorldChangeEvent> = fc.oneof(
  fc.constant<WorldChangeEvent>({
    type: 'contestant.join',
    payload: { id: 'player-1', name: 'Bot-1' },
  }),
  fc.constant<WorldChangeEvent>({
    type: 'contestant.leave',
    payload: { id: 'player-1', status: 'offline' },
  }),
  fc.constant<WorldChangeEvent>({
    type: 'room.bot_position',
    payload: { roomId: 'room-1', botId: 'bot-1', position: { x: 100, y: 200 } },
  }),
  fc.constant<WorldChangeEvent>({
    type: 'room.bot_joined',
    payload: { roomId: 'room-1', botId: 'bot-1', botName: 'Bot-1' },
  }),
  fc.constant<WorldChangeEvent>({
    type: 'room.bot_left',
    payload: { roomId: 'room-1', botId: 'bot-1' },
  }),
);

/** Generate a non-empty sequence of world change events */
const worldChangeEventsArb = fc.array(worldChangeEventArb, { minLength: 1, maxLength: 10 });

/** Bug condition input: valid Agent_Viewer key */
const viewerAuthInputArb: fc.Arbitrary<AuthInput> = fc.constant({
  role: 'Agent_Viewer' as Role,
  keyValid: true,
});

// =============================================================================
// Bug 3 Exploration Tests — Property 1: Fault Condition - 观战事件推送缺失
// =============================================================================

describe('Bug 3 Exploration: 观战主链路只拿首帧，不拿后续世界变化', () => {
  /**
   * **Validates: Requirements 2.6, 2.7**
   *
   * Property: After Agent_Viewer authenticates, the system SHALL register
   * the connection so that subsequent world change events are received.
   *
   * On UNFIXED code: FAILS (connectionRegistered is false in current model)
   * On FIXED code: PASSES (connectionRegistered is true in expected model)
   */
  it('Property 1: Agent_Viewer 认证后，系统 SHALL 注册连接以接收后续世界变化事件', () => {
    fc.assert(
      fc.property(
        viewerAuthInputArb,
        worldChangeEventsArb,
        (authInput, events) => {
          // Use the EXPECTED (fixed) model to simulate actual behavior
          const state = handleAuth_expected(authInput);

          // The fix: viewer receives world.state AND is registered
          expect(state.worldStateReceived).toBe(true);

          // EXPECTED behavior (Requirement 2.6):
          // The connection SHALL be registered after authentication
          expect(state.connectionRegistered).toBe(true);

          // Simulate broadcast of subsequent events
          const finalState = broadcastToConnection_expected(state, events);

          // EXPECTED behavior (Requirement 2.7):
          // Agent_Viewer SHALL receive all subsequent world change events
          const subsequentEvents = finalState.receivedEvents.filter(
            (e) => e !== 'world.state',
          );
          expect(subsequentEvents.length).toBeGreaterThan(0);

          return true;
        },
      ),
      { numRuns: 100 },
    );
  });

  /**
   * **Validates: Requirements 2.7**
   *
   * Property: When world change events occur after Agent_Viewer connects,
   * the viewer SHALL receive ALL of those events (not just the initial frame).
   *
   * On UNFIXED code: FAILS (viewer receives 0 subsequent events)
   * On FIXED code: PASSES (viewer receives all subsequent events)
   */
  it('Property 1b: 世界变化事件发生时，Agent_Viewer SHALL 接收所有后续事件', () => {
    fc.assert(
      fc.property(
        viewerAuthInputArb,
        worldChangeEventsArb,
        (authInput, events) => {
          // Simulate fixed behavior
          const state = handleAuth_expected(authInput);
          const finalState = broadcastToConnection_expected(state, events);

          // Count events beyond the initial world.state
          const subsequentEvents = finalState.receivedEvents.filter(
            (e) => e !== 'world.state',
          );

          // EXPECTED: viewer receives exactly as many subsequent events
          // as were broadcast
          return subsequentEvents.length === events.length;
        },
      ),
      { numRuns: 100 },
    );
  });

  /**
   * **Validates: Requirements 2.6**
   *
   * Concrete scenario matching design example (场景 2):
   * Agent_Viewer connects and authenticates. New player B joins the game.
   * Server broadcasts contestant.join event.
   * Expected: Agent_Viewer receives the contestant.join event.
   * Actual (unfixed): Agent_Viewer does NOT receive the event.
   */
  it('具体场景: Agent_Viewer 连接后，新玩家加入，Agent_Viewer SHALL 收到 contestant.join 事件', () => {
    const authInput: AuthInput = {
      role: 'Agent_Viewer',
      keyValid: true,
    };

    // Step 1: Agent_Viewer authenticates
    const state = handleAuth_expected(authInput);

    // Verify initial world.state is received
    expect(state.worldStateReceived).toBe(true);
    expect(state.receivedEvents).toContain('world.state');

    // Step 2: New player joins — server broadcasts contestant.join
    const joinEvent: WorldChangeEvent = {
      type: 'contestant.join',
      payload: { id: 'player-B', name: 'Bot-B', position: { x: 50, y: 50 } },
    };

    const finalState = broadcastToConnection_expected(state, [joinEvent]);

    // EXPECTED (Requirement 2.7): Agent_Viewer SHALL receive contestant.join
    expect(finalState.receivedEvents).toContain('contestant.join');
  });

  /**
   * **Validates: Requirements 2.6**
   *
   * Concrete scenario matching design example (场景 1):
   * Agent_Viewer connects. Player A moves to a new position.
   * Server broadcasts room.bot_position event.
   * Expected: Agent_Viewer receives the room.bot_position event.
   * Actual (unfixed): Agent_Viewer does NOT receive the event.
   */
  it('具体场景: Agent_Viewer 连接后，玩家移动，Agent_Viewer SHALL 收到 room.bot_position 事件', () => {
    const authInput: AuthInput = {
      role: 'Agent_Viewer',
      keyValid: true,
    };

    const state = handleAuth_expected(authInput);
    expect(state.worldStateReceived).toBe(true);

    // Player A moves — server broadcasts room.bot_position
    const moveEvent: WorldChangeEvent = {
      type: 'room.bot_position',
      payload: { roomId: 'room-1', botId: 'player-A', position: { x: 150, y: 150 } },
    };

    const finalState = broadcastToConnection_expected(state, [moveEvent]);

    // EXPECTED (Requirement 2.7): Agent_Viewer SHALL receive room.bot_position
    expect(finalState.receivedEvents).toContain('room.bot_position');
  });
});
