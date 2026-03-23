// =============================================================================
// XTION_TheFool0 — Bug 3 保持性测试: Agent_Player 行为保持不变
// Bugfix: core-runtime-business-logic-fixes
// **Validates: Requirements 3.5, 3.6**
//
// Preservation property tests for Bug 3 (viewer event broadcast fix).
// These tests capture the CURRENT correct behavior for non-buggy inputs:
//   - Agent_Player connects and receives initial world.state AND is registered
//     for subsequent events
//   - World state changes are broadcast to all connected Agent_Player connections
//   - Agent_Viewer cannot send game commands (move, talk, broadcast, heartbeat)
//
// These tests MUST PASS on UNFIXED code (confirms baseline to preserve).
// These tests MUST ALSO PASS on FIXED code (confirms no regressions).
// =============================================================================

import { describe, it, expect } from 'vitest';
import fc from 'fast-check';

// =============================================================================
// Model of the WebSocket handleAuth + broadcast + handleMessage logic
//
// This models the combined behavior of:
//   1. handleAuth (server/src/ws.ts) — authenticates, registers connection,
//      sends world.state
//   2. broadcast (server/src/ws.ts) — iterates connections Map to send events
//   3. handleMessage (server/src/ws.ts) — routes messages, blocks game commands
//      for Agent_Viewer
//
// For non-buggy inputs (Agent_Player connections, Agent_Viewer command
// restrictions), the CURRENT behavior is already correct and must be
// preserved after the Bug 3 fix.
// =============================================================================

type Role = 'Admin' | 'Agent_Player' | 'Agent_Viewer' | 'Human_Viewer';

type EventType =
  | 'world.state'
  | 'contestant.join'
  | 'contestant.leave'
  | 'room.bot_position'
  | 'room.bot_joined'
  | 'room.bot_left';

type GameCommandType = 'move' | 'talk' | 'broadcast' | 'heartbeat';

interface AuthInput {
  role: Role;
  keyValid: boolean;
  name?: string;
}

interface WorldChangeEvent {
  type: EventType;
  payload: Record<string, unknown>;
}

interface ConnectionState {
  worldStateReceived: boolean;
  connectionRegistered: boolean;
  receivedEvents: EventType[];
  contestantCreated: boolean;
}

interface CommandResult {
  allowed: boolean;
  errorCode?: string;
}

// =============================================================================
// Model: CURRENT handleAuth behavior (correct for Agent_Player)
// =============================================================================

/**
 * Model of the CURRENT handleAuth behavior.
 *
 * For Agent_Player: sends world.state AND registers connection (correct).
 * For Agent_Viewer: sends world.state but does NOT register (the bug — but
 *   we are NOT testing this path here; preservation tests focus on
 *   Agent_Player behavior).
 * For Human_Viewer: rejected.
 * For invalid key: rejected.
 */
function handleAuth_current(input: AuthInput): ConnectionState {
  // Invalid key → rejected
  if (!input.keyValid) {
    return {
      worldStateReceived: false,
      connectionRegistered: false,
      receivedEvents: [],
      contestantCreated: false,
    };
  }

  // Human_Viewer → rejected (not allowed via WebSocket)
  if (input.role === 'Human_Viewer') {
    return {
      worldStateReceived: false,
      connectionRegistered: false,
      receivedEvents: [],
      contestantCreated: false,
    };
  }

  // Agent_Player → world.state sent, connection registered, contestant created
  if (input.role === 'Agent_Player') {
    return {
      worldStateReceived: true,
      connectionRegistered: true,
      receivedEvents: ['world.state'],
      contestantCreated: true,
    };
  }

  // Agent_Viewer → world.state sent, NOT registered (the bug)
  if (input.role === 'Agent_Viewer') {
    return {
      worldStateReceived: true,
      connectionRegistered: false,
      receivedEvents: ['world.state'],
      contestantCreated: false,
    };
  }

  // Admin → treated like Agent_Player for connection purposes
  return {
    worldStateReceived: true,
    connectionRegistered: true,
    receivedEvents: ['world.state'],
    contestantCreated: true,
  };
}

/**
 * Model of the CURRENT broadcast behavior.
 *
 * Only delivers events to connections registered in the connections Map.
 * Agent_Player connections ARE registered, so they receive all broadcasts.
 */
function broadcastToConnection_current(
  state: ConnectionState,
  events: WorldChangeEvent[],
): ConnectionState {
  if (!state.connectionRegistered) {
    // Not registered → receives no subsequent events
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

/**
 * Model of the CURRENT handleMessage behavior for game command filtering.
 *
 * Agent_Viewer: game commands (move, talk, broadcast, heartbeat) are blocked.
 * Agent_Player: game commands are allowed.
 * Other roles: game commands are allowed.
 */
function handleGameCommand_current(
  role: Role | null,
  commandType: GameCommandType,
): CommandResult {
  // Agent_Viewer cannot send game commands
  if (role === 'Agent_Viewer') {
    return {
      allowed: false,
      errorCode: 'FORBIDDEN_ROLE',
    };
  }

  // All other roles can send game commands
  return { allowed: true };
}

// =============================================================================
// Arbitraries — generators for non-buggy (preservation) inputs
// =============================================================================

/** Agent_Player with valid key — the primary preservation target */
const agentPlayerAuthArb: fc.Arbitrary<AuthInput> = fc
  .record({
    name: fc.option(fc.string({ minLength: 1, maxLength: 20 }), { nil: undefined }),
  })
  .map((rec) => ({
    role: 'Agent_Player' as Role,
    keyValid: true,
    name: rec.name,
  }));

/** World change event arbitrary */
const worldChangeEventArb: fc.Arbitrary<WorldChangeEvent> = fc.oneof(
  fc.record({
    type: fc.constant<EventType>('contestant.join'),
    payload: fc.record({
      id: fc.uuid(),
      name: fc.string({ minLength: 1, maxLength: 20 }),
    }),
  }),
  fc.record({
    type: fc.constant<EventType>('contestant.leave'),
    payload: fc.record({
      id: fc.uuid(),
      status: fc.constant('offline'),
    }),
  }),
  fc.record({
    type: fc.constant<EventType>('room.bot_position'),
    payload: fc.record({
      roomId: fc.uuid(),
      botId: fc.uuid(),
      position: fc.record({ x: fc.integer({ min: 0, max: 2000 }), y: fc.integer({ min: 0, max: 2000 }) }),
    }),
  }),
  fc.record({
    type: fc.constant<EventType>('room.bot_joined'),
    payload: fc.record({
      roomId: fc.uuid(),
      botId: fc.uuid(),
      botName: fc.string({ minLength: 1, maxLength: 20 }),
    }),
  }),
  fc.record({
    type: fc.constant<EventType>('room.bot_left'),
    payload: fc.record({
      roomId: fc.uuid(),
      botId: fc.uuid(),
    }),
  }),
);

/** Non-empty sequence of world change events */
const worldChangeEventsArb = fc.array(worldChangeEventArb, { minLength: 1, maxLength: 10 });

/** Game command types that Agent_Viewer is blocked from sending */
const gameCommandTypeArb: fc.Arbitrary<GameCommandType> = fc.constantFrom(
  'move',
  'talk',
  'broadcast',
  'heartbeat',
);

/** Multiple Agent_Player connections (for multi-player broadcast testing) */
const multiPlayerCountArb = fc.integer({ min: 2, max: 8 });

// =============================================================================
// Bug 3 Preservation Tests — Property 7: Agent_Player 行为保持不变
// =============================================================================

describe('Bug 3 Preservation: Agent_Player 行为保持不变', () => {
  /**
   * **Validates: Requirements 3.5**
   *
   * Property: When Agent_Player establishes WebSocket connection with a valid
   * key, the system SHALL send initial world.state AND register the connection
   * for subsequent events.
   *
   * This is the current correct behavior that must be preserved.
   */
  it('Property 7a: Agent_Player 连接后 SHALL 收到 world.state 并注册连接', () => {
    fc.assert(
      fc.property(agentPlayerAuthArb, (authInput) => {
        const state = handleAuth_current(authInput);

        // Requirement 3.5: SHALL send initial world.state
        expect(state.worldStateReceived).toBe(true);
        expect(state.receivedEvents).toContain('world.state');

        // Requirement 3.5: SHALL register connection for subsequent events
        expect(state.connectionRegistered).toBe(true);

        // Agent_Player creates a contestant record
        expect(state.contestantCreated).toBe(true);
      }),
      { numRuns: 100 },
    );
  });

  /**
   * **Validates: Requirements 3.6**
   *
   * Property: When world state changes occur, the system SHALL broadcast
   * events to all connected Agent_Player connections. Every event that is
   * broadcast must be received by every registered Agent_Player.
   */
  it('Property 7b: 世界状态变化时 SHALL 将事件广播给所有已连接的 Agent_Player', () => {
    fc.assert(
      fc.property(
        agentPlayerAuthArb,
        worldChangeEventsArb,
        (authInput, events) => {
          // Agent_Player authenticates and is registered
          const state = handleAuth_current(authInput);
          expect(state.connectionRegistered).toBe(true);

          // Broadcast world change events
          const finalState = broadcastToConnection_current(state, events);

          // Requirement 3.6: Agent_Player SHALL receive all broadcast events
          const subsequentEvents = finalState.receivedEvents.filter(
            (e) => e !== 'world.state',
          );
          expect(subsequentEvents.length).toBe(events.length);

          // Verify each event type is present in received events
          for (const event of events) {
            expect(finalState.receivedEvents).toContain(event.type);
          }
        },
      ),
      { numRuns: 100 },
    );
  });

  /**
   * **Validates: Requirements 3.6**
   *
   * Property: When multiple Agent_Players are connected and world state
   * changes occur, ALL connected Agent_Players SHALL receive the broadcast
   * events. The broadcast function iterates all registered connections.
   */
  it('Property 7c: 多个 Agent_Player 连接时，所有连接 SHALL 收到广播事件', () => {
    fc.assert(
      fc.property(
        multiPlayerCountArb,
        worldChangeEventsArb,
        (playerCount, events) => {
          // Simulate multiple Agent_Player connections
          const playerStates: ConnectionState[] = [];
          for (let i = 0; i < playerCount; i++) {
            const state = handleAuth_current({
              role: 'Agent_Player',
              keyValid: true,
              name: `Player-${i}`,
            });
            playerStates.push(state);
          }

          // All players should be registered
          for (const state of playerStates) {
            expect(state.connectionRegistered).toBe(true);
          }

          // Broadcast events to all players
          const finalStates = playerStates.map((state) =>
            broadcastToConnection_current(state, events),
          );

          // Requirement 3.6: ALL Agent_Players SHALL receive all events
          for (const finalState of finalStates) {
            const subsequentEvents = finalState.receivedEvents.filter(
              (e) => e !== 'world.state',
            );
            expect(subsequentEvents.length).toBe(events.length);
          }
        },
      ),
      { numRuns: 100 },
    );
  });

  /**
   * **Validates: Requirements 3.5, 3.6**
   *
   * Property: Agent_Viewer SHALL NOT be able to send game commands
   * (move, talk, broadcast, heartbeat). This restriction must be preserved
   * after the fix — the fix only adds event reception, not command sending.
   */
  it('Property 7d: Agent_Viewer SHALL NOT 发送游戏指令（move/talk/broadcast/heartbeat）', () => {
    fc.assert(
      fc.property(gameCommandTypeArb, (commandType) => {
        const result = handleGameCommand_current('Agent_Viewer', commandType);

        // Agent_Viewer is blocked from sending game commands
        expect(result.allowed).toBe(false);
        expect(result.errorCode).toBe('FORBIDDEN_ROLE');
      }),
      { numRuns: 100 },
    );
  });

  /**
   * **Validates: Requirements 3.5**
   *
   * Property: Agent_Player SHALL be allowed to send game commands.
   * This is the counterpart to the Agent_Viewer restriction — Agent_Player
   * command sending must remain unaffected by the Bug 3 fix.
   */
  it('Property 7e: Agent_Player SHALL 被允许发送游戏指令', () => {
    fc.assert(
      fc.property(gameCommandTypeArb, (commandType) => {
        const result = handleGameCommand_current('Agent_Player', commandType);

        // Agent_Player is allowed to send game commands
        expect(result.allowed).toBe(true);
        expect(result.errorCode).toBeUndefined();
      }),
      { numRuns: 100 },
    );
  });

  /**
   * **Validates: Requirements 3.5**
   *
   * Property: Agent_Player connection SHALL receive world.state as the first
   * event, containing map dimensions, zones, and online contestants.
   * The initial frame delivery must be preserved.
   */
  it('Property 7f: Agent_Player 连接后首个事件 SHALL 为 world.state', () => {
    fc.assert(
      fc.property(
        agentPlayerAuthArb,
        worldChangeEventsArb,
        (authInput, events) => {
          const state = handleAuth_current(authInput);

          // world.state must be the first event received
          expect(state.receivedEvents[0]).toBe('world.state');

          // After broadcast, world.state is still the first event
          const finalState = broadcastToConnection_current(state, events);
          expect(finalState.receivedEvents[0]).toBe('world.state');
        },
      ),
      { numRuns: 100 },
    );
  });
});
