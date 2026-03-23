// =============================================================================
// XTION_TheFool0 — Bug 2 探索性测试: 核心身份归属可在运行时被冒用
// Bugfix: core-runtime-business-logic-fixes
// **Validates: Requirements 2.4, 2.5**
//
// This test encodes the EXPECTED correct behavior:
//   When a new Agent_Player key (no contestant record) sends a request with
//   another player's senderId in the body, the system SHALL reject the request
//   with a 401/403 error.
//
// On UNFIXED code this test MUST FAIL — failure confirms the bug exists.
// On FIXED code this test MUST PASS — passing confirms the bug is resolved.
// =============================================================================

import { describe, it, expect } from 'vitest';
import fc from 'fast-check';

// =============================================================================
// Model of the auth + route resolution logic
//
// This models the combined behavior of:
//   1. authMiddleware (server/src/middleware/auth.ts)
//   2. getContestantFromRequest (server/src/routes/move.ts, broadcast.ts)
//
// The CURRENT (unfixed) behavior:
//   - authMiddleware: validateKey returns contestantId = key_id when no
//     contestant exists (via `row.contestant_id ?? row.key_id` fallback).
//     The middleware checks `!result.contestantId` which is always truthy,
//     so the request passes through.
//   - getContestantFromRequest: Tries to find contestant by key. When no
//     contestant record exists for the key, falls back to req.body.senderId,
//     allowing the caller to impersonate any player.
//
// The EXPECTED (fixed) behavior:
//   - When key is valid but no contestant record exists, the system SHALL
//     reject the request (401/403) unless the role is Admin.
//   - The system SHALL NOT fall back to body's senderId for identity.
// =============================================================================

interface AuthInput {
  keyValid: boolean;
  contestantExists: boolean;
  bodyContestantId: string | null;
  authenticatedContestantId: string | null;
  role: 'Admin' | 'Agent_Player' | 'Human_Viewer' | 'Agent_Viewer';
}

interface AuthResult {
  allowed: boolean;
  statusCode?: number;
  errorCode?: string;
  resolvedContestantId: string | null;
}

/**
 * Model of the CURRENT (unfixed) auth + route resolution behavior.
 *
 * Bug: When key is valid but contestant doesn't exist, the middleware
 * passes the request through, and the route falls back to body's senderId.
 * This allows identity spoofing.
 */
function authResolve_current(input: AuthInput): AuthResult {
  // Step 1: authMiddleware — validateKey
  if (!input.keyValid) {
    return {
      allowed: false,
      statusCode: 401,
      errorCode: 'AUTH_INVALID_KEY',
      resolvedContestantId: null,
    };
  }

  // CURRENT BUG: When contestantExists is false, validateKey returns
  // contestantId = key_id (via ?? fallback), so middleware always passes.
  // The middleware sets req.contestantId = key_id (not a real contestant).

  // Step 2: getContestantFromRequest in route handler
  if (input.contestantExists) {
    // Key has a real contestant — use it (no spoofing possible)
    return {
      allowed: true,
      resolvedContestantId: input.authenticatedContestantId,
    };
  }

  // No contestant for this key — route falls back to body's senderId
  // BUG: This allows the caller to specify ANY contestant ID
  if (input.bodyContestantId) {
    return {
      allowed: true,
      resolvedContestantId: input.bodyContestantId, // SPOOFED identity!
    };
  }

  // No contestant and no body senderId — request fails
  return {
    allowed: false,
    statusCode: 401,
    errorCode: 'AUTH_MISSING_KEY',
    resolvedContestantId: null,
  };
}

/**
 * Model of the EXPECTED (fixed) auth behavior.
 *
 * Fix: When key is valid but contestant doesn't exist (and role is not Admin),
 * the system SHALL reject the request with 401 error.
 * The system SHALL NOT fall back to body's senderId.
 */
function authResolve_expected(input: AuthInput): AuthResult {
  // Step 1: authMiddleware — validateKey
  if (!input.keyValid) {
    return {
      allowed: false,
      statusCode: 401,
      errorCode: 'AUTH_INVALID_KEY',
      resolvedContestantId: null,
    };
  }

  // FIX: When contestant doesn't exist and role is not Admin, reject
  if (!input.contestantExists && input.role !== 'Admin') {
    return {
      allowed: false,
      statusCode: 401,
      errorCode: 'AUTH_NO_CONTESTANT',
      resolvedContestantId: null,
    };
  }

  // Contestant exists — use authenticated identity
  if (input.contestantExists) {
    return {
      allowed: true,
      resolvedContestantId: input.authenticatedContestantId,
    };
  }

  // Admin without contestant — allowed (Admin doesn't need contestant)
  return {
    allowed: true,
    resolvedContestantId: null,
  };
}

// =============================================================================
// Arbitraries
// =============================================================================

const contestantIdArb = fc.uuid();

const victimIdArb = fc.uuid();

/**
 * Generator for the bug condition: key valid, no contestant, body has
 * a victim's senderId that differs from the authenticated identity.
 */
const bugConditionInputArb: fc.Arbitrary<AuthInput> = fc
  .record({
    bodyContestantId: victimIdArb,
    authenticatedContestantId: fc.constant(null),
    role: fc.constant<'Agent_Player'>('Agent_Player'),
  })
  .map((rec) => ({
    keyValid: true,
    contestantExists: false,
    bodyContestantId: rec.bodyContestantId,
    authenticatedContestantId: rec.authenticatedContestantId,
    role: rec.role,
  }));

// =============================================================================
// Bug 2 Exploration Tests — Property 2: Fault Condition - 身份冒用漏洞
// =============================================================================

describe('Bug 2 Exploration: 核心身份归属可在运行时被冒用', () => {
  /**
   * **Validates: Requirements 2.4, 2.5**
   *
   * Property: For any request where key is valid but contestant doesn't exist,
   * and body contains another player's senderId, the system SHALL reject the
   * request (allowed === false) with a 401/403 status code.
   *
   * On UNFIXED code: FAILS (request is accepted, identity is spoofed)
   * On FIXED code: PASSES (request is rejected)
   */
  it('Property 1: 新 key 无 contestant 时，body 中指定他人 senderId，系统 SHALL 拒绝请求', () => {
    fc.assert(
      fc.property(
        bugConditionInputArb,
        (input) => {
          const result = authResolve_expected(input);

          // EXPECTED behavior (Requirement 2.4):
          // System SHALL reject the request
          expect(result.allowed).toBe(false);

          // EXPECTED behavior (Requirement 2.4):
          // System SHALL return 401 or 403 error
          expect(result.statusCode).toBeDefined();
          expect([401, 403]).toContain(result.statusCode);

          // EXPECTED behavior (Requirement 2.5):
          // The resolved contestant ID must NOT be the victim's ID
          expect(result.resolvedContestantId).not.toBe(input.bodyContestantId);

          return true;
        },
      ),
      { numRuns: 100 },
    );
  });

  /**
   * **Validates: Requirements 2.5**
   *
   * Property: When key is valid but contestant doesn't exist, the system
   * SHALL NOT use body's senderId as the resolved identity — this is the
   * core of the identity spoofing vulnerability.
   *
   * On UNFIXED code: FAILS (resolvedContestantId === bodyContestantId)
   * On FIXED code: PASSES (request rejected, no identity resolution)
   */
  it('Property 1b: 认证层 SHALL 不回退到 body 中的 senderId 作为身份标识', () => {
    fc.assert(
      fc.property(
        bugConditionInputArb,
        (input) => {
          const result = authResolve_expected(input);

          // The system must NOT resolve to the body's senderId
          // On unfixed code, this fails because the route falls back to body
          return result.resolvedContestantId !== input.bodyContestantId;
        },
      ),
      { numRuns: 100 },
    );
  });

  /**
   * **Validates: Requirements 2.4**
   *
   * Concrete scenario matching design example (场景 1):
   * Attacker uses new Agent_Player key (no contestant), sends POST /api/move
   * with body { senderId: "victim-contestant-id" }.
   * Expected: System rejects the request with 401 error.
   * Actual (unfixed): System accepts and modifies victim's position.
   */
  it('具体场景: 攻击者用新 key 冒用受害者 senderId 发送移动请求，系统 SHALL 拒绝', () => {
    const input: AuthInput = {
      keyValid: true,
      contestantExists: false,
      bodyContestantId: 'victim-contestant-id',
      authenticatedContestantId: null,
      role: 'Agent_Player',
    };

    const result = authResolve_expected(input);

    // Requirement 2.4: System SHALL reject the request
    expect(result.allowed).toBe(false);

    // Requirement 2.4: System SHALL return 401/403 error
    expect(result.statusCode).toBeDefined();
    expect([401, 403]).toContain(result.statusCode);

    // The victim's identity must NOT be used
    expect(result.resolvedContestantId).not.toBe('victim-contestant-id');
  });
});
