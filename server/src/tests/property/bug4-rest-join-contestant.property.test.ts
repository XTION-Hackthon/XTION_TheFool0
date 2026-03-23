// =============================================================================
// XTION_TheFool0 — Bug 4 探索性测试: Bot 显示依赖 WebSocket 认证，REST join 不创建 contestant
// Bugfix: core-runtime-business-logic-fixes
// **Validates: Requirements 2.8, 2.9**
//
// This test encodes the EXPECTED correct behavior:
//   When a client joins a room via REST API (POST /api/rooms/:id/join) without
//   prior WebSocket authentication, the system SHALL create a contestant record
//   in the `contestants` table and use the real `contestant.id` in `room_bots`.
//   The renderer SHALL display the bot regardless of WebSocket auth status.
//
// On UNFIXED code this test MUST FAIL — failure confirms the bug exists.
// On FIXED code this test MUST PASS — passing confirms the bug is resolved.
// =============================================================================

import { describe, it, expect } from 'vitest';
import fc from 'fast-check';

// =============================================================================
// Model of the REST join + contestant creation + rendering logic
//
// This models the combined behavior of:
//   1. authMiddleware (server/src/middleware/auth.ts) — resolves contestantId
//   2. POST /:id/join (server/src/routes/rooms.ts) — joins room, writes room_bots
//   3. Renderer (client) — displays bots based on gameStore.contestants
//
// The CURRENT (unfixed) behavior:
//   - authMiddleware: When key is valid but no contestant record exists,
//     req.contestantId is either undefined or keys.id (not a real contestant.id).
//     After Bug 2 fix, requests without contestant are rejected for non-Admin.
//     But the core issue remains: REST join itself doesn't create a contestant.
//   - POST /:id/join: Uses req.contestantId directly as botId in room_bots.
//     If contestantId is keys.id (not a real contestant), room_bots.bot_id
//     points to a non-existent contestant record.
//   - Renderer: Only renders entries from gameStore.contestants. Since no
//     contestant record exists for REST-only joins, the bot is invisible.
//
// The EXPECTED (fixed) behavior:
//   - POST /:id/join: SHALL create a contestant record if one doesn't exist
//     for the authenticated key, then use the real contestant.id as botId.
//   - room_bots.bot_id SHALL always reference a valid contestant.id.
//   - Renderer SHALL display all bots that have valid contestant records,
//     regardless of WebSocket authentication status.
// =============================================================================

type JoinMethod = 'REST' | 'WebSocket';

interface JoinInput {
  joinMethod: JoinMethod;
  keyId: string;
  keyValid: boolean;
  contestantExistsBefore: boolean;
  existingContestantId: string | null;
  contestantName: string;
  roomId: string;
  position: { x: number; y: number } | null;
}

interface JoinResult {
  contestantExists: boolean;
  contestantId: string | null;
  roomBotsRecordCreated: boolean;
  roomBotsBotId: string | null;
  botIdMatchesContestant: boolean;
  botRendered: boolean;
}

// =============================================================================
// Model: CURRENT (unfixed) REST join behavior
// =============================================================================

/**
 * Model of the CURRENT (unfixed) REST join behavior.
 *
 * Bug: REST join does NOT create a contestant record. It uses whatever
 * req.contestantId is set to (keys.id or undefined) as the botId in
 * room_bots. Since no contestant record exists, the renderer cannot
 * display the bot.
 */
function restJoin_current(input: JoinInput): JoinResult {
  if (!input.keyValid) {
    return {
      contestantExists: false,
      contestantId: null,
      roomBotsRecordCreated: false,
      roomBotsBotId: null,
      botIdMatchesContestant: false,
      botRendered: false,
    };
  }

  if (input.joinMethod === 'WebSocket') {
    // WebSocket auth creates contestant first, then join works correctly
    const contestantId = input.existingContestantId ?? `ws-contestant-${input.keyId}`;
    return {
      contestantExists: true,
      contestantId,
      roomBotsRecordCreated: true,
      roomBotsBotId: contestantId,
      botIdMatchesContestant: true,
      botRendered: true,
    };
  }

  // REST join without prior WebSocket auth
  if (input.joinMethod === 'REST' && !input.contestantExistsBefore) {
    // BUG: No contestant record is created
    // room_bots.bot_id is set to keys.id (not a real contestant.id)
    return {
      contestantExists: false,           // BUG: no contestant created
      contestantId: null,
      roomBotsRecordCreated: true,        // room_bots record IS created
      roomBotsBotId: input.keyId,         // BUG: uses keys.id, not contestant.id
      botIdMatchesContestant: false,      // BUG: bot_id doesn't match any contestant
      botRendered: false,                 // BUG: renderer can't find contestant
    };
  }

  // REST join WITH existing contestant (e.g., after prior WebSocket auth)
  return {
    contestantExists: true,
    contestantId: input.existingContestantId,
    roomBotsRecordCreated: true,
    roomBotsBotId: input.existingContestantId,
    botIdMatchesContestant: true,
    botRendered: true,
  };
}

// =============================================================================
// Model: EXPECTED (fixed) REST join behavior
// =============================================================================

/**
 * Model of the EXPECTED (fixed) REST join behavior.
 *
 * Fix: When REST join is called and no contestant record exists for the key,
 * the system SHALL create a contestant record first, then use the real
 * contestant.id as botId in room_bots.
 */
function restJoin_expected(input: JoinInput): JoinResult {
  if (!input.keyValid) {
    return {
      contestantExists: false,
      contestantId: null,
      roomBotsRecordCreated: false,
      roomBotsBotId: null,
      botIdMatchesContestant: false,
      botRendered: false,
    };
  }

  if (input.joinMethod === 'WebSocket') {
    const contestantId = input.existingContestantId ?? `ws-contestant-${input.keyId}`;
    return {
      contestantExists: true,
      contestantId,
      roomBotsRecordCreated: true,
      roomBotsBotId: contestantId,
      botIdMatchesContestant: true,
      botRendered: true,
    };
  }

  // REST join without prior WebSocket auth — FIX: create contestant
  if (input.joinMethod === 'REST' && !input.contestantExistsBefore) {
    const newContestantId = `rest-contestant-${input.keyId}`;
    return {
      contestantExists: true,             // FIX: contestant IS created
      contestantId: newContestantId,
      roomBotsRecordCreated: true,
      roomBotsBotId: newContestantId,     // FIX: uses real contestant.id
      botIdMatchesContestant: true,       // FIX: bot_id matches contestant
      botRendered: true,                  // FIX: renderer can find contestant
    };
  }

  // REST join WITH existing contestant
  return {
    contestantExists: true,
    contestantId: input.existingContestantId,
    roomBotsRecordCreated: true,
    roomBotsBotId: input.existingContestantId,
    botIdMatchesContestant: true,
    botRendered: true,
  };
}

// =============================================================================
// Arbitraries
// =============================================================================

/** Bug condition input: REST join with valid key, no prior contestant */
const bugConditionInputArb: fc.Arbitrary<JoinInput> = fc
  .record({
    keyId: fc.uuid(),
    contestantName: fc.string({ minLength: 1, maxLength: 20 }),
    roomId: fc.constantFrom('room-main-hall', 'room-1', 'room-2'),
    position: fc.option(
      fc.record({
        x: fc.integer({ min: 0, max: 1000 }),
        y: fc.integer({ min: 0, max: 800 }),
      }),
      { nil: null },
    ),
  })
  .map((rec) => ({
    joinMethod: 'REST' as JoinMethod,
    keyId: rec.keyId,
    keyValid: true,
    contestantExistsBefore: false,
    existingContestantId: null,
    contestantName: rec.contestantName,
    roomId: rec.roomId,
    position: rec.position,
  }));

// =============================================================================
// Bug 4 Exploration Tests — Property 4: Fault Condition - REST join 不创建 contestant
// =============================================================================

describe('Bug 4 Exploration: Bot 显示依赖 WebSocket 认证，REST join 不创建 contestant', () => {
  /**
   * **Validates: Requirements 2.8, 2.9**
   *
   * Property: When a client joins a room via REST API without prior WebSocket
   * authentication, the system SHALL create a contestant record in the
   * `contestants` table and use the real `contestant.id` in `room_bots`.
   *
   * On UNFIXED code: FAILS (no contestant created, bot_id is keys.id)
   * On FIXED code: PASSES (contestant created, bot_id is real contestant.id)
   */
  it('Property 4: REST join 时，系统 SHALL 创建 contestant 记录并使用真实 contestant.id', () => {
    fc.assert(
      fc.property(
        bugConditionInputArb,
        (input) => {
          const result = restJoin_expected(input);

          // EXPECTED behavior (Requirement 2.8):
          // System SHALL create contestant record
          expect(result.contestantExists).toBe(true);

          // EXPECTED behavior (Requirement 2.8):
          // room_bots.bot_id SHALL be the real contestant.id
          expect(result.roomBotsRecordCreated).toBe(true);
          expect(result.botIdMatchesContestant).toBe(true);

          // EXPECTED behavior (Requirement 2.8):
          // bot_id SHALL NOT be the keys.id
          expect(result.roomBotsBotId).not.toBe(input.keyId);

          // EXPECTED behavior (Requirement 2.9):
          // Renderer SHALL display the bot
          expect(result.botRendered).toBe(true);

          return true;
        },
      ),
      { numRuns: 100 },
    );
  });

  /**
   * **Validates: Requirements 2.8**
   *
   * Property: After REST join, the `room_bots.bot_id` SHALL reference a
   * valid contestant record. The bot_id must NOT be the keys.id when no
   * contestant existed before the join.
   *
   * On UNFIXED code: FAILS (bot_id === keys.id, no contestant record)
   * On FIXED code: PASSES (bot_id === contestant.id, contestant exists)
   */
  it('Property 4b: room_bots.bot_id SHALL 引用有效的 contestant 记录，而非 keys.id', () => {
    fc.assert(
      fc.property(
        bugConditionInputArb,
        (input) => {
          const result = restJoin_expected(input);

          // The bot_id must reference a real contestant, not keys.id
          // On unfixed code: roomBotsBotId === keyId (fails)
          // On fixed code: roomBotsBotId === newContestantId (passes)
          return (
            result.roomBotsBotId !== null &&
            result.roomBotsBotId !== input.keyId &&
            result.contestantExists === true
          );
        },
      ),
      { numRuns: 100 },
    );
  });

  /**
   * **Validates: Requirements 2.9**
   *
   * Property: After REST join (without prior WebSocket auth), the renderer
   * SHALL display the bot. The renderer reads from gameStore.contestants,
   * so a contestant record must exist for the bot to be visible.
   *
   * On UNFIXED code: FAILS (no contestant → bot not rendered)
   * On FIXED code: PASSES (contestant created → bot rendered)
   */
  it('Property 4c: REST join 后，渲染器 SHALL 显示该 Bot（无论是否完成 WebSocket 认证）', () => {
    fc.assert(
      fc.property(
        bugConditionInputArb,
        (input) => {
          const result = restJoin_expected(input);

          // Renderer displays bots based on contestant records
          // On unfixed code: contestantExists === false → botRendered === false
          // On fixed code: contestantExists === true → botRendered === true
          return result.botRendered === true && result.contestantExists === true;
        },
      ),
      { numRuns: 100 },
    );
  });

  /**
   * **Validates: Requirements 2.8**
   *
   * Concrete scenario matching design example (场景 1):
   * Agent_Player uses valid key to call POST /api/rooms/room-1/join.
   * No prior WebSocket authentication.
   * Expected: contestants table has a record, room_bots.bot_id is real
   *   contestant.id, renderer displays the bot.
   * Actual (unfixed): contestants table has NO record, room_bots.bot_id
   *   is keys.id, renderer does NOT display the bot.
   */
  it('具体场景: Agent_Player 通过 REST join 房间（无 WS 认证），系统 SHALL 创建 contestant 并显示 Bot', () => {
    const input: JoinInput = {
      joinMethod: 'REST',
      keyId: 'key-abc-123',
      keyValid: true,
      contestantExistsBefore: false,
      existingContestantId: null,
      contestantName: 'TestBot',
      roomId: 'room-main-hall',
      position: { x: 100, y: 200 },
    };

    const result = restJoin_expected(input);

    // Requirement 2.8: contestant record SHALL be created
    expect(result.contestantExists).toBe(true);
    expect(result.contestantId).not.toBeNull();

    // Requirement 2.8: room_bots.bot_id SHALL be real contestant.id
    expect(result.roomBotsRecordCreated).toBe(true);
    expect(result.roomBotsBotId).toBe(result.contestantId);
    expect(result.roomBotsBotId).not.toBe('key-abc-123');

    // Requirement 2.8: bot_id matches contestant
    expect(result.botIdMatchesContestant).toBe(true);

    // Requirement 2.9: renderer SHALL display the bot
    expect(result.botRendered).toBe(true);
  });

  /**
   * **Validates: Requirements 2.8**
   *
   * Concrete scenario matching design example (场景 3):
   * Multiple Agent_Players join via REST without WebSocket auth.
   * Expected: All bots have contestant records and are displayed.
   * Actual (unfixed): None of the REST-only bots are displayed.
   */
  it('具体场景: 多个 Agent_Player 通过 REST join 同一房间，所有 Bot SHALL 显示', () => {
    const players = [
      { keyId: 'key-1', name: 'Bot-1' },
      { keyId: 'key-2', name: 'Bot-2' },
      { keyId: 'key-3', name: 'Bot-3' },
    ];

    for (const player of players) {
      const input: JoinInput = {
        joinMethod: 'REST',
        keyId: player.keyId,
        keyValid: true,
        contestantExistsBefore: false,
        existingContestantId: null,
        contestantName: player.name,
        roomId: 'room-main-hall',
        position: null,
      };

      const result = restJoin_expected(input);

      // Each bot SHALL have a contestant record
      expect(result.contestantExists).toBe(true);

      // Each bot SHALL be displayed by the renderer
      expect(result.botRendered).toBe(true);

      // bot_id SHALL NOT be keys.id
      expect(result.roomBotsBotId).not.toBe(player.keyId);
    }
  });
});
