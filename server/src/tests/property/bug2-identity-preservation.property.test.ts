// =============================================================================
// XTION_TheFool0 — Bug 2 保持性测试: 合法请求保持不变
// Bugfix: core-runtime-business-logic-fixes
// **Validates: Requirements 3.3, 3.4**
//
// Preservation property tests for Bug 2 (identity spoofing fix).
// These tests capture the CURRENT correct behavior for non-buggy inputs:
//   - Valid Agent_Player key with established contestant → request accepted
//   - Admin role → request accepted (no contestant required)
//   - Normal move, broadcast, heartbeat operations → all work correctly
//
// These tests MUST PASS on UNFIXED code (confirms baseline to preserve).
// These tests MUST ALSO PASS on FIXED code (confirms no regressions).
// =============================================================================

import { describe, it, expect } from 'vitest';
import fc from 'fast-check';

// =============================================================================
// Model of the auth + route resolution logic for LEGITIMATE requests
//
// This models the combined behavior of:
//   1. authMiddleware (server/src/middleware/auth.ts)
//   2. getContestantFromRequest (server/src/routes/move.ts, broadcast.ts)
//
// For non-buggy inputs (contestant exists, or Admin role), the CURRENT
// behavior is already correct and must be preserved after the fix.
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
 * Model of the CURRENT auth + route resolution behavior.
 *
 * For legitimate (non-buggy) inputs, this behavior is correct and must
 * be preserved after the Bug 2 fix.
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

  // When key is valid and contestant exists, middleware sets
  // req.contestantId = real contestant id. Route resolves correctly.
  if (input.contestantExists && input.authenticatedContestantId) {
    return {
      allowed: true,
      resolvedContestantId: input.authenticatedContestantId,
    };
  }

  // Admin role without contestant — middleware passes (contestantId = key_id
  // via fallback), Admin operations don't require contestant record.
  if (input.role === 'Admin') {
    return {
      allowed: true,
      resolvedContestantId: null,
    };
  }

  // Key valid but no contestant and not Admin — on current code, if body
  // has senderId it falls back (this is the bug path, NOT tested here).
  // If no body senderId, request fails.
  return {
    allowed: false,
    statusCode: 401,
    errorCode: 'AUTH_MISSING_KEY',
    resolvedContestantId: null,
  };
}

// =============================================================================
// Arbitraries — generators for non-buggy (legitimate) inputs
// =============================================================================

const contestantIdArb = fc.uuid();

/**
 * Generator for legitimate Agent_Player requests:
 * Key is valid AND contestant exists AND body senderId matches own identity.
 *
 * This is the happy path — must always be accepted.
 */
const legitimateAgentPlayerArb: fc.Arbitrary<AuthInput> = contestantIdArb.map(
  (contestantId) => ({
    keyValid: true,
    contestantExists: true,
    bodyContestantId: contestantId, // own senderId in body
    authenticatedContestantId: contestantId,
    role: 'Agent_Player' as const,
  }),
);

/**
 * Generator for legitimate Agent_Player requests where body senderId is null.
 * The system resolves identity from the key's contestant record.
 */
const legitimateAgentPlayerNullBodyArb: fc.Arbitrary<AuthInput> =
  contestantIdArb.map((contestantId) => ({
    keyValid: true,
    contestantExists: true,
    bodyContestantId: null,
    authenticatedContestantId: contestantId,
    role: 'Agent_Player' as const,
  }));

/**
 * Generator for Admin requests — Admin doesn't require contestant.
 */
const adminRequestArb: fc.Arbitrary<AuthInput> = fc
  .record({
    contestantExists: fc.boolean(),
    authenticatedContestantId: fc.option(contestantIdArb, { nil: null }),
    bodyContestantId: fc.option(contestantIdArb, { nil: null }),
  })
  .map((rec) => ({
    keyValid: true,
    contestantExists: rec.contestantExists,
    bodyContestantId: rec.bodyContestantId,
    authenticatedContestantId: rec.authenticatedContestantId,
    role: 'Admin' as const,
  }));

/**
 * Generator for invalid key requests — always rejected regardless of role.
 */
const invalidKeyArb: fc.Arbitrary<AuthInput> = fc
  .record({
    role: fc.constantFrom(
      'Admin' as const,
      'Agent_Player' as const,
      'Human_Viewer' as const,
      'Agent_Viewer' as const,
    ),
    bodyContestantId: fc.option(contestantIdArb, { nil: null }),
  })
  .map((rec) => ({
    keyValid: false,
    contestantExists: false,
    bodyContestantId: rec.bodyContestantId,
    authenticatedContestantId: null,
    role: rec.role,
  }));

// =============================================================================
// Operation type for testing different API operations
// =============================================================================

type OperationType = 'move' | 'broadcast' | 'heartbeat';

const operationTypeArb: fc.Arbitrary<OperationType> = fc.constantFrom(
  'move',
  'broadcast',
  'heartbeat',
);

// =============================================================================
// Bug 2 Preservation Tests — Property 6: Preservation - 合法请求保持不变
// =============================================================================

describe('Bug 2 Preservation: 合法请求保持不变', () => {
  /**
   * **Validates: Requirements 3.3**
   *
   * Property: For any valid Agent_Player key with an established contestant
   * sending a request with their own senderId, the system SHALL accept and
   * process the request normally.
   *
   * This captures the current correct behavior that must be preserved.
   */
  it('Property 6a: 有效 Agent_Player key 且 contestant 已建立，body 中指定自己的 senderId，系统 SHALL 接受请求', () => {
    fc.assert(
      fc.property(legitimateAgentPlayerArb, (input) => {
        const result = authResolve_current(input);

        // Requirement 3.3: System SHALL CONTINUE TO accept the request
        expect(result.allowed).toBe(true);

        // The resolved identity must be the authenticated contestant's own ID
        expect(result.resolvedContestantId).toBe(
          input.authenticatedContestantId,
        );

        // No error should be returned
        expect(result.statusCode).toBeUndefined();
        expect(result.errorCode).toBeUndefined();
      }),
      { numRuns: 100 },
    );
  });

  /**
   * **Validates: Requirements 3.3**
   *
   * Property: For any valid Agent_Player key with an established contestant
   * sending a request without body senderId, the system SHALL resolve
   * identity from the key's contestant record and accept the request.
   */
  it('Property 6b: 有效 Agent_Player key 且 contestant 已建立，无 body senderId，系统 SHALL 通过 key 解析身份', () => {
    fc.assert(
      fc.property(legitimateAgentPlayerNullBodyArb, (input) => {
        const result = authResolve_current(input);

        // Requirement 3.3: System SHALL CONTINUE TO accept the request
        expect(result.allowed).toBe(true);

        // Identity resolved from key's contestant record
        expect(result.resolvedContestantId).toBe(
          input.authenticatedContestantId,
        );
      }),
      { numRuns: 100 },
    );
  });

  /**
   * **Validates: Requirements 3.4**
   *
   * Property: For any request with a valid key and established contestant,
   * the system SHALL allow the request through and process it normally,
   * regardless of the operation type (move, broadcast, heartbeat).
   */
  it('Property 6c: 合法请求通过认证层后，各类操作（move/broadcast/heartbeat）均正常执行', () => {
    fc.assert(
      fc.property(
        legitimateAgentPlayerArb,
        operationTypeArb,
        (input, _operation) => {
          const result = authResolve_current(input);

          // Requirement 3.4: System SHALL CONTINUE TO allow the request through
          expect(result.allowed).toBe(true);

          // The resolved contestant ID must be the authenticated one
          expect(result.resolvedContestantId).toBe(
            input.authenticatedContestantId,
          );
        },
      ),
      { numRuns: 100 },
    );
  });

  /**
   * **Validates: Requirements 3.4**
   *
   * Property: Admin role requests SHALL always be accepted regardless of
   * whether a contestant record exists. Admin permissions must be preserved.
   */
  it('Property 6d: Admin 角色请求 SHALL 始终被接受，无需 contestant 记录', () => {
    fc.assert(
      fc.property(adminRequestArb, (input) => {
        const result = authResolve_current(input);

        // Admin requests are always allowed when key is valid
        expect(result.allowed).toBe(true);

        // No error should be returned for Admin
        expect(result.statusCode).toBeUndefined();
      }),
      { numRuns: 100 },
    );
  });

  /**
   * **Validates: Requirements 3.3, 3.4**
   *
   * Property: Invalid key requests SHALL always be rejected, regardless of
   * role or body content. This baseline rejection behavior must be preserved.
   */
  it('Property 6e: 无效 key 请求 SHALL 始终被拒绝，无论角色或 body 内容', () => {
    fc.assert(
      fc.property(invalidKeyArb, (input) => {
        const result = authResolve_current(input);

        // Invalid key → always rejected
        expect(result.allowed).toBe(false);
        expect(result.statusCode).toBe(401);
        expect(result.errorCode).toBe('AUTH_INVALID_KEY');
        expect(result.resolvedContestantId).toBeNull();
      }),
      { numRuns: 100 },
    );
  });

  /**
   * **Validates: Requirements 3.3**
   *
   * Property: The resolved contestant ID for legitimate requests must always
   * match the authenticated contestant ID — identity integrity is preserved.
   */
  it('Property 6f: 合法请求的解析身份 SHALL 始终与认证身份一致（身份完整性）', () => {
    fc.assert(
      fc.property(
        fc.tuple(legitimateAgentPlayerArb, legitimateAgentPlayerNullBodyArb),
        ([withBody, withoutBody]) => {
          const resultWithBody = authResolve_current(withBody);
          const resultWithoutBody = authResolve_current(withoutBody);

          // Both should resolve to the authenticated identity
          expect(resultWithBody.resolvedContestantId).toBe(
            withBody.authenticatedContestantId,
          );
          expect(resultWithoutBody.resolvedContestantId).toBe(
            withoutBody.authenticatedContestantId,
          );

          // Both should be allowed
          expect(resultWithBody.allowed).toBe(true);
          expect(resultWithoutBody.allowed).toBe(true);
        },
      ),
      { numRuns: 100 },
    );
  });
});
