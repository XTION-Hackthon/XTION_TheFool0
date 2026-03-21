// =============================================================================
// XTION_TheFool0 — AuthManager 属性测试
// Feature: openclaw-platform, Property 1: Key 唯一性与长度
// Requirements: 1.1
// =============================================================================

// Feature: openclaw-platform, Property 1: Key 唯一性与长度
// Validates: Requirements 1.1

import { describe, it, expect, vi, beforeEach } from 'vitest';
import fc from 'fast-check';

// Mock db 模块，避免依赖真实数据库
vi.mock('../../db', () => {
  const mockDb = {
    prepare: vi.fn().mockReturnValue({
      run: vi.fn(),
      get: vi.fn(),
      all: vi.fn().mockReturnValue([]),
    }),
  };
  return { db: mockDb };
});

// 在 mock 之后再 import authManager
import { authManager } from '../../modules/auth-manager';

describe('Property 1: Key 唯一性与长度', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('批量生成的 Key 长度应至少为 32 个字符', async () => {
    // 使用 fast-check 生成不同的 contestantName，验证每个 Key 长度 ≥ 32
    await fc.assert(
      fc.asyncProperty(
        fc.string({ minLength: 1, maxLength: 50 }),
        async (name) => {
          const result = await authManager.generateKey(name, 'Agent_Player');
          return result.key.length >= 32;
        },
      ),
      { numRuns: 100 },
    );
  });

  it('批量生成的 Key 集合中不应存在重复', async () => {
    // 生成 100 个 Key，验证全部唯一
    await fc.assert(
      fc.asyncProperty(
        fc.integer({ min: 10, max: 50 }),
        async (count) => {
          const keys: string[] = [];
          for (let i = 0; i < count; i++) {
            const result = await authManager.generateKey(`contestant-${i}`, 'Agent_Player');
            keys.push(result.key);
          }
          const uniqueKeys = new Set(keys);
          return uniqueKeys.size === keys.length;
        },
      ),
      { numRuns: 100 },
    );
  });

  it('生成 1000 个 Key 时，所有 Key 长度 ≥ 32 且无重复', async () => {
    const keys: string[] = [];
    for (let i = 0; i < 1000; i++) {
      const result = await authManager.generateKey(`contestant-${i}`, 'Agent_Player');
      keys.push(result.key);
    }

    // 验证长度
    for (const key of keys) {
      expect(key.length).toBeGreaterThanOrEqual(32);
    }

    // 验证唯一性
    const uniqueKeys = new Set(keys);
    expect(uniqueKeys.size).toBe(1000);
  });
});

// =============================================================================
// Feature: openclaw-platform, Property 2: 认证正确性
// Validates: Requirements 1.3, 1.4
// =============================================================================

describe('Property 2: 认证正确性', () => {
  // 获取 mock db 的引用，用于在每个测试中控制返回值
  let mockGet: ReturnType<typeof vi.fn>;

  beforeEach(async () => {
    vi.clearAllMocks();
    // 重新获取 mock db 的 prepare().get 引用
    const { db } = await import('../../db');
    mockGet = (db.prepare as ReturnType<typeof vi.fn>)().get;
  });

  it('有效 Key（active）→ validateKey 返回 { valid: true, contestantId: keyId }', async () => {
    // Validates: Requirements 1.3
    await fc.assert(
      fc.asyncProperty(
        // 随机生成 keyId（模拟数据库中存在的 active key）
        fc.uuid(),
        async (keyId) => {
          // mock db 返回 active 状态的 key（匹配 validateKey 的 JOIN 查询列名）
          mockGet.mockReturnValue({ key_id: keyId, status: 'active', role: 'Agent_Player', contestant_id: null });

          const result = await authManager.validateKey('some-valid-key');
          return result.valid === true && result.contestantId === keyId;
        },
      ),
      { numRuns: 100 },
    );
  });

  it('无效 Key（不存在）→ validateKey 返回 { valid: false }', async () => {
    // Validates: Requirements 1.4
    await fc.assert(
      fc.asyncProperty(
        // 随机生成任意字符串作为不存在的 key
        fc.string({ minLength: 1, maxLength: 100 }),
        async (_nonExistentKey) => {
          // mock db 返回 undefined（key 不存在）
          mockGet.mockReturnValue(undefined);

          const result = await authManager.validateKey(_nonExistentKey);
          return result.valid === false && result.contestantId === undefined;
        },
      ),
      { numRuns: 100 },
    );
  });

  it('已吊销 Key（revoked）→ validateKey 返回 { valid: false }', async () => {
    // Validates: Requirements 1.4
    await fc.assert(
      fc.asyncProperty(
        // 随机生成 keyId（模拟数据库中存在但已吊销的 key）
        fc.uuid(),
        async (keyId) => {
          // mock db 返回 revoked 状态的 key
          mockGet.mockReturnValue({ id: keyId, status: 'revoked' });

          const result = await authManager.validateKey('some-revoked-key');
          return result.valid === false && result.contestantId === undefined;
        },
      ),
      { numRuns: 100 },
    );
  });

  it('认证成功当且仅当 Key 存在且状态为 active', async () => {
    // 综合验证：随机生成不同的 key 状态，验证认证结果符合预期
    // Validates: Requirements 1.3, 1.4
    await fc.assert(
      fc.asyncProperty(
        fc.oneof(
          // 场景 1: active key
          fc.record({
            scenario: fc.constant('active' as const),
            keyId: fc.uuid(),
          }),
          // 场景 2: revoked key
          fc.record({
            scenario: fc.constant('revoked' as const),
            keyId: fc.uuid(),
          }),
          // 场景 3: 不存在的 key
          fc.record({
            scenario: fc.constant('nonexistent' as const),
            keyId: fc.uuid(),
          }),
        ),
        async ({ scenario, keyId }) => {
          if (scenario === 'active') {
            mockGet.mockReturnValue({ key_id: keyId, status: 'active', role: 'Agent_Player', contestant_id: null });
            const result = await authManager.validateKey('test-key');
            return result.valid === true && result.contestantId === keyId;
          } else if (scenario === 'revoked') {
            mockGet.mockReturnValue({ key_id: keyId, status: 'revoked', role: 'Agent_Player', contestant_id: null });
            const result = await authManager.validateKey('test-key');
            return result.valid === false && result.contestantId === undefined;
          } else {
            // nonexistent
            mockGet.mockReturnValue(undefined);
            const result = await authManager.validateKey('test-key');
            return result.valid === false && result.contestantId === undefined;
          }
        },
      ),
      { numRuns: 100 },
    );
  });
});
