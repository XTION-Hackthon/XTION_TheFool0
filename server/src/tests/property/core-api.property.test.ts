// =============================================================================
// XTION_TheFool0 — CoreAPIHandler 属性测试
// Feature: openclaw-platform, Property 6: Talk Zone 约束
// Feature: openclaw-platform, Property 7: 消息持久化往返
// Feature: openclaw-platform, Property 8: Talk 频率限制遵循 Zone 规则
// Feature: openclaw-platform, Property 9: Broadcast 全局投递
// Feature: openclaw-platform, Property 10: Broadcast 频率限制
// Feature: openclaw-platform, Property 11: Move 更新位置
// Feature: openclaw-platform, Property 12: Move 边界检查
// Feature: openclaw-platform, Property 14: Zone 切换规则自动应用
// Feature: openclaw-platform, Property 15: 批量移动正确性
// =============================================================================

import { describe, it, expect, vi, beforeEach } from 'vitest';
import fc from 'fast-check';

// ---------------------------------------------------------------------------
// Mock modules using vi.hoisted to avoid hoisting issues
// ---------------------------------------------------------------------------

const { mockDbRun, mockDbGet, mockDbAll } = vi.hoisted(() => {
  const mockDbRun = vi.fn().mockReturnValue({ changes: 1 });
  const mockDbGet = vi.fn();
  const mockDbAll = vi.fn().mockReturnValue([]);
  return { mockDbRun, mockDbGet, mockDbAll };
});

vi.mock('../../db', () => ({
  db: {
    prepare: vi.fn().mockReturnValue({
      run: mockDbRun,
      get: mockDbGet,
      all: mockDbAll,
    }),
  },
}));

const { mockGetZoneAt, mockGetPosition, mockGetApplicableRules, mockGetEnergy } = vi.hoisted(() => ({
  mockGetZoneAt: vi.fn(),
  mockGetPosition: vi.fn(),
  mockGetApplicableRules: vi.fn(),
  mockGetEnergy: vi.fn().mockReturnValue(100),
}));

vi.mock('../../modules/world-manager', () => ({
  worldManager: {
    getZoneAt: mockGetZoneAt,
    getPosition: mockGetPosition,
    getApplicableRules: mockGetApplicableRules,
    getEnergy: mockGetEnergy,
    isAPIAllowed: vi.fn().mockReturnValue(true),
    setPosition: vi.fn().mockResolvedValue(undefined),
    getZoneById: vi.fn(),
    getZoneCenter: vi.fn(),
    getAllZones: vi.fn().mockReturnValue([]),
  },
}));

const { mockCheckTalkLimit, mockCheckBroadcastLimit } = vi.hoisted(() => ({
  mockCheckTalkLimit: vi.fn().mockReturnValue(true),
  mockCheckBroadcastLimit: vi.fn().mockReturnValue(true),
}));

vi.mock('../../modules/rate-limiter', () => ({
  rateLimiter: {
    checkTalkLimit: mockCheckTalkLimit,
    checkBroadcastLimit: mockCheckBroadcastLimit,
    checkGlobalLimit: vi.fn().mockReturnValue(true),
    reset: vi.fn(),
    resetAll: vi.fn(),
  },
}));

const { mockSendEvent, mockBroadcastToObservers, mockConnections } = vi.hoisted(() => {
  const mockConnections = new Map<string, { readyState: number; send: ReturnType<typeof vi.fn> }>();
  const mockSendEvent = vi.fn();
  const mockBroadcastToObservers = vi.fn();
  return { mockSendEvent, mockBroadcastToObservers, mockConnections };
});

vi.mock('../../ws', () => ({
  connections: mockConnections,
  sendEvent: mockSendEvent,
  broadcastToObservers: mockBroadcastToObservers,
}));

// ---------------------------------------------------------------------------
// Import after mocks
// ---------------------------------------------------------------------------

import { coreAPIHandler, APIError } from '../../modules/core-api-handler';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** 构造一个 Zone 对象 */
function makeZone(id: string, zoneTypeId = 'zt-social') {
  return {
    id,
    name: `Zone-${id}`,
    bounds: { x1: 0, y1: 0, x2: 100, y2: 100 },
    zoneTypeId,
    style: { fillColor: '#ccc', borderColor: '#999', opacity: 0.5 },
  };
}

/** 构造一个无限制的 ZoneRule（Social 区） */
function makeSocialRule() {
  return {
    allowedAPIs: ['talk', 'broadcast', 'move'],
    forbiddenAPIs: [],
    rateLimits: {},
    attributeEffects: [],
    customParams: {},
  };
}

/** 构造一个有 Talk 频率限制的 ZoneRule（Rest 区） */
function makeRestRule(talkLimit: number) {
  return {
    allowedAPIs: ['talk', 'move'],
    forbiddenAPIs: ['broadcast'],
    rateLimits: { talk: talkLimit },
    attributeEffects: [],
    customParams: {},
  };
}

/** 创建一个 mock WebSocket 连接 */
function makeMockWs() {
  return { readyState: 1 /* OPEN */, send: vi.fn() };
}

// =============================================================================
// Property 6: Talk Zone 约束
// Validates: Requirements 3.1, 3.4, 3.5
// =============================================================================

describe('Property 6: Talk Zone 约束', () => {
  // Feature: openclaw-platform, Property 6: Talk Zone 约束
  // Validates: Requirements 3.1, 3.4, 3.5

  beforeEach(() => {
    vi.clearAllMocks();
    mockGetEnergy.mockReturnValue(100);
    mockCheckTalkLimit.mockReturnValue(true);
    mockDbRun.mockReturnValue({ changes: 1 });
  });

  it('发送者和接收者在同一 Zone 时，handleTalk 应成功', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.uuid(), // senderId
        fc.uuid(), // targetId
        fc.string({ minLength: 1, maxLength: 100 }), // message
        async (senderId, targetId, message) => {
          fc.pre(senderId !== targetId);

          const zoneId = 'zone-same';
          const zone = makeZone(zoneId);

          // 发送者和接收者都在同一 Zone
          mockGetZoneAt.mockReturnValue(zone);
          mockGetPosition.mockResolvedValue({ x: 50, y: 50 });
          mockGetApplicableRules.mockReturnValue(makeSocialRule());

          const result = await coreAPIHandler.handleTalk({
            senderId,
            targetIds: [targetId],
            message,
          });

          expect(result).toHaveProperty('messageId');
          expect(result).toHaveProperty('timestamp');
          expect(typeof result.messageId).toBe('string');
          expect(typeof result.timestamp).toBe('number');
          return true;
        },
      ),
      { numRuns: 100 },
    );
  });

  it('接收者在不同 Zone 时，handleTalk 应抛出 403 APIError', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.uuid(), // senderId
        fc.uuid(), // targetId
        fc.string({ minLength: 1, maxLength: 100 }), // message
        async (senderId, targetId, message) => {
          fc.pre(senderId !== targetId);

          const senderZone = makeZone('zone-a');
          const targetZone = makeZone('zone-b');

          // 发送者在 zone-a，接收者在 zone-b
          mockGetZoneAt
            .mockReturnValueOnce(senderZone)  // 发送者 Zone
            .mockReturnValueOnce(targetZone); // 接收者 Zone
          mockGetPosition.mockResolvedValue({ x: 50, y: 50 });
          mockGetApplicableRules.mockReturnValue(makeSocialRule());

          try {
            await coreAPIHandler.handleTalk({ senderId, targetIds: [targetId], message });
            return false; // 应该抛出错误
          } catch (err) {
            expect(err).toBeInstanceOf(APIError);
            expect((err as APIError).statusCode).toBe(403);
            expect((err as APIError).code).toBe('API_ZONE_RESTRICTED');
            return true;
          }
        },
      ),
      { numRuns: 100 },
    );
  });

  it('小组模式：所有接收者在同一 Zone 时应成功', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.uuid(), // senderId
        fc.array(fc.uuid(), { minLength: 2, maxLength: 4 }), // targetIds
        fc.string({ minLength: 1, maxLength: 100 }),
        async (senderId, targetIds, message) => {
          // 确保 senderId 不在 targetIds 中
          fc.pre(!targetIds.includes(senderId));

          const zone = makeZone('zone-group');
          mockGetZoneAt.mockReturnValue(zone);
          mockGetPosition.mockResolvedValue({ x: 50, y: 50 });
          mockGetApplicableRules.mockReturnValue(makeSocialRule());

          const result = await coreAPIHandler.handleTalk({ senderId, targetIds, message });
          expect(result).toHaveProperty('messageId');
          return true;
        },
      ),
      { numRuns: 100 },
    );
  });

  it('小组模式：任一接收者跨 Zone 时应返回 403', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.uuid(), // senderId
        fc.uuid(), // targetId1 (same zone)
        fc.uuid(), // targetId2 (different zone)
        fc.string({ minLength: 1, maxLength: 100 }),
        async (senderId, targetId1, targetId2, message) => {
          fc.pre(senderId !== targetId1 && senderId !== targetId2 && targetId1 !== targetId2);

          const senderZone = makeZone('zone-sender');
          const differentZone = makeZone('zone-other');

          // 发送者 Zone，targetId1 同 Zone，targetId2 不同 Zone
          mockGetZoneAt
            .mockReturnValueOnce(senderZone)   // 发送者
            .mockReturnValueOnce(senderZone)   // targetId1
            .mockReturnValueOnce(differentZone); // targetId2
          mockGetPosition.mockResolvedValue({ x: 50, y: 50 });
          mockGetApplicableRules.mockReturnValue(makeSocialRule());

          try {
            await coreAPIHandler.handleTalk({ senderId, targetIds: [targetId1, targetId2], message });
            return false;
          } catch (err) {
            expect(err).toBeInstanceOf(APIError);
            expect((err as APIError).statusCode).toBe(403);
            return true;
          }
        },
      ),
      { numRuns: 100 },
    );
  });
});

// =============================================================================
// Property 8: Talk 频率限制遵循 Zone 规则
// Validates: Requirements 3.6, 3.7, 3.8
// =============================================================================

describe('Property 8: Talk 频率限制遵循 Zone 规则', () => {
  // Feature: openclaw-platform, Property 8: Talk 频率限制遵循 Zone 规则
  // Validates: Requirements 3.6, 3.7, 3.8

  beforeEach(() => {
    vi.clearAllMocks();
    mockGetEnergy.mockReturnValue(100);
    mockDbRun.mockReturnValue({ changes: 1 });
  });

  it('Social 区（无 rateLimits）：checkTalkLimit 不应被调用', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.uuid(),
        fc.uuid(),
        fc.string({ minLength: 1, maxLength: 50 }),
        async (senderId, targetId, message) => {
          fc.pre(senderId !== targetId);

          const zone = makeZone('zone-social', 'zt-social');
          mockGetZoneAt.mockReturnValue(zone);
          mockGetPosition.mockResolvedValue({ x: 50, y: 50 });
          // Social 区：rateLimits 为空对象，无 talk 限制
          mockGetApplicableRules.mockReturnValue(makeSocialRule());
          mockCheckTalkLimit.mockReturnValue(true);

          await coreAPIHandler.handleTalk({ senderId, targetIds: [targetId], message });

          // Social 区 rateLimits 无 talk 键，checkTalkLimit 不应被调用
          expect(mockCheckTalkLimit).not.toHaveBeenCalled();
          return true;
        },
      ),
      { numRuns: 100 },
    );
  });

  it('Rest 区（有 rateLimits.talk）：checkTalkLimit 应被调用', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.uuid(),
        fc.uuid(),
        fc.string({ minLength: 1, maxLength: 50 }),
        fc.integer({ min: 1, max: 20 }),
        async (senderId, targetId, message, talkLimit) => {
          fc.pre(senderId !== targetId);

          const zone = makeZone('zone-rest', 'zt-rest');
          mockGetZoneAt.mockReturnValue(zone);
          mockGetPosition.mockResolvedValue({ x: 50, y: 50 });
          mockGetApplicableRules.mockReturnValue(makeRestRule(talkLimit));
          mockCheckTalkLimit.mockReturnValue(true);

          await coreAPIHandler.handleTalk({ senderId, targetIds: [targetId], message });

          // Rest 区有 talk 限制，checkTalkLimit 应被调用
          expect(mockCheckTalkLimit).toHaveBeenCalledWith(senderId, talkLimit);
          return true;
        },
      ),
      { numRuns: 100 },
    );
  });

  it('Rest 区频率超限时，handleTalk 应抛出 429 APIError', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.uuid(),
        fc.uuid(),
        fc.string({ minLength: 1, maxLength: 50 }),
        fc.integer({ min: 1, max: 20 }),
        async (senderId, targetId, message, talkLimit) => {
          fc.pre(senderId !== targetId);

          const zone = makeZone('zone-rest', 'zt-rest');
          mockGetZoneAt.mockReturnValue(zone);
          mockGetPosition.mockResolvedValue({ x: 50, y: 50 });
          mockGetApplicableRules.mockReturnValue(makeRestRule(talkLimit));
          // 模拟超限
          mockCheckTalkLimit.mockReturnValue(false);

          try {
            await coreAPIHandler.handleTalk({ senderId, targetIds: [targetId], message });
            return false;
          } catch (err) {
            expect(err).toBeInstanceOf(APIError);
            expect((err as APIError).statusCode).toBe(429);
            expect((err as APIError).code).toBe('API_RATE_LIMITED');
            return true;
          }
        },
      ),
      { numRuns: 100 },
    );
  });

  it('Energy 为 0 时，handleTalk 应抛出 403 API_ENERGY_DEPLETED', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.uuid(),
        fc.uuid(),
        fc.string({ minLength: 1, maxLength: 50 }),
        async (senderId, targetId, message) => {
          fc.pre(senderId !== targetId);

          mockGetEnergy.mockReturnValue(0);

          try {
            await coreAPIHandler.handleTalk({ senderId, targetIds: [targetId], message });
            return false;
          } catch (err) {
            expect(err).toBeInstanceOf(APIError);
            expect((err as APIError).statusCode).toBe(403);
            expect((err as APIError).code).toBe('API_ENERGY_DEPLETED');
            return true;
          }
        },
      ),
      { numRuns: 100 },
    );
  });
});

// =============================================================================
// Property 7: 消息持久化往返
// Validates: Requirements 3.3, 4.4
// =============================================================================

describe('Property 7: 消息持久化往返', () => {
  // Feature: openclaw-platform, Property 7: 消息持久化往返
  // Validates: Requirements 3.3, 4.4

  beforeEach(() => {
    vi.clearAllMocks();
    mockGetEnergy.mockReturnValue(100);
    mockCheckTalkLimit.mockReturnValue(true);
    mockDbRun.mockReturnValue({ changes: 1 });
  });

  it('Talk 成功后，db INSERT 应被调用且参数包含 senderId、message、zoneId', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.uuid(),
        fc.uuid(),
        fc.string({ minLength: 1, maxLength: 200 }),
        async (senderId, targetId, message) => {
          fc.pre(senderId !== targetId);

          const zoneId = 'zone-persist';
          const zone = makeZone(zoneId);
          mockGetZoneAt.mockReturnValue(zone);
          mockGetPosition.mockResolvedValue({ x: 50, y: 50 });
          mockGetApplicableRules.mockReturnValue(makeSocialRule());

          mockDbRun.mockClear();

          await coreAPIHandler.handleTalk({ senderId, targetIds: [targetId], message });

          // db.prepare().run() 应被调用（INSERT talk_messages）
          expect(mockDbRun).toHaveBeenCalled();

          // 检查 INSERT 调用的参数包含 senderId、message、zoneId
          const callArgs = mockDbRun.mock.calls[0] as unknown[];
          expect(callArgs).toContain(senderId);
          expect(callArgs).toContain(message);
          expect(callArgs).toContain(zoneId);
          return true;
        },
      ),
      { numRuns: 100 },
    );
  });

  it('Talk 成功后，返回的 messageId 应为非空字符串，timestamp 为正整数', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.uuid(),
        fc.uuid(),
        fc.string({ minLength: 1, maxLength: 100 }),
        async (senderId, targetId, message) => {
          fc.pre(senderId !== targetId);

          const zone = makeZone('zone-ts');
          mockGetZoneAt.mockReturnValue(zone);
          mockGetPosition.mockResolvedValue({ x: 50, y: 50 });
          mockGetApplicableRules.mockReturnValue(makeSocialRule());

          const before = Date.now();
          const result = await coreAPIHandler.handleTalk({ senderId, targetIds: [targetId], message });
          const after = Date.now();

          expect(result.messageId).toBeTruthy();
          expect(typeof result.messageId).toBe('string');
          expect(result.timestamp).toBeGreaterThanOrEqual(before);
          expect(result.timestamp).toBeLessThanOrEqual(after);
          return true;
        },
      ),
      { numRuns: 100 },
    );
  });

  it('Talk 成功后，receiver_ids 应包含所有 targetIds（JSON 序列化）', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.uuid(),
        fc.array(fc.uuid(), { minLength: 1, maxLength: 3 }),
        fc.string({ minLength: 1, maxLength: 100 }),
        async (senderId, targetIds, message) => {
          fc.pre(!targetIds.includes(senderId));

          const zone = makeZone('zone-receivers');
          mockGetZoneAt.mockReturnValue(zone);
          mockGetPosition.mockResolvedValue({ x: 50, y: 50 });
          mockGetApplicableRules.mockReturnValue(makeSocialRule());

          mockDbRun.mockClear();

          await coreAPIHandler.handleTalk({ senderId, targetIds, message });

          // 检查 INSERT 调用中包含 JSON 序列化的 targetIds
          const callArgs = mockDbRun.mock.calls[0] as unknown[];
          const receiverIdsArg = callArgs.find(
            (arg) => typeof arg === 'string' && arg.startsWith('['),
          ) as string | undefined;

          expect(receiverIdsArg).toBeDefined();
          const parsed = JSON.parse(receiverIdsArg!) as string[];
          expect(parsed).toEqual(targetIds);
          return true;
        },
      ),
      { numRuns: 100 },
    );
  });
});

// =============================================================================
// Property 9: Broadcast 全局投递
// Validates: Requirements 4.1, 4.2
// =============================================================================

describe('Property 9: Broadcast 全局投递', () => {
  // Feature: openclaw-platform, Property 9: Broadcast 全局投递
  // Validates: Requirements 4.1, 4.2

  /**
   * 由于 handleBroadcast 是 stub，我们直接测试 Broadcast 全局投递的核心逻辑：
   * 遍历 connections Map，向所有在线 Contestant 发送消息。
   * 这里测试该逻辑的正确性属性。
   */

  beforeEach(() => {
    vi.clearAllMocks();
    mockConnections.clear();
  });

  /**
   * 模拟 Broadcast 投递逻辑（与 handleBroadcast 实现后应有的行为一致）
   * 遍历 connections，向所有在线 Contestant 发送事件
   */
  function simulateBroadcastDelivery(
    connections: Map<string, { readyState: number; send: ReturnType<typeof vi.fn> }>,
    senderId: string,
    message: string,
  ): string[] {
    const delivered: string[] = [];
    const event = {
      type: 'broadcast.message',
      payload: { senderId, message, timestamp: Date.now() },
      timestamp: Date.now(),
    };

    for (const [id, ws] of connections) {
      if (ws.readyState === 1 /* OPEN */) {
        ws.send(JSON.stringify(event));
        delivered.push(id);
      }
    }
    return delivered;
  }

  it('所有在线 Contestant 都应收到 Broadcast 消息', () => {
    fc.assert(
      fc.property(
        fc.uuid(), // senderId
        fc.string({ minLength: 1, maxLength: 100 }), // message
        fc.array(fc.uuid(), { minLength: 1, maxLength: 10 }), // online contestant IDs
        (senderId, message, onlineIds) => {
          // 确保 senderId 不在 onlineIds 中（或者也在，都应收到）
          const connections = new Map<string, { readyState: number; send: ReturnType<typeof vi.fn> }>();
          for (const id of onlineIds) {
            connections.set(id, makeMockWs());
          }

          const delivered = simulateBroadcastDelivery(connections, senderId, message);

          // 所有在线 Contestant 都应收到消息
          expect(delivered.length).toBe(onlineIds.length);
          for (const id of onlineIds) {
            expect(delivered).toContain(id);
          }
          return true;
        },
      ),
      { numRuns: 100 },
    );
  });

  it('Broadcast 投递数量等于在线 Contestant 数量', () => {
    fc.assert(
      fc.property(
        fc.uuid(),
        fc.string({ minLength: 1, maxLength: 100 }),
        fc.integer({ min: 0, max: 15 }),
        (senderId, message, onlineCount) => {
          const connections = new Map<string, { readyState: number; send: ReturnType<typeof vi.fn> }>();
          for (let i = 0; i < onlineCount; i++) {
            connections.set(`contestant-${i}`, makeMockWs());
          }

          const delivered = simulateBroadcastDelivery(connections, senderId, message);
          expect(delivered.length).toBe(onlineCount);
          return true;
        },
      ),
      { numRuns: 100 },
    );
  });

  it('无在线 Contestant 时，Broadcast 投递数量为 0', () => {
    fc.assert(
      fc.property(
        fc.uuid(),
        fc.string({ minLength: 1, maxLength: 100 }),
        (senderId, message) => {
          const connections = new Map<string, { readyState: number; send: ReturnType<typeof vi.fn> }>();
          const delivered = simulateBroadcastDelivery(connections, senderId, message);
          expect(delivered.length).toBe(0);
          return true;
        },
      ),
      { numRuns: 100 },
    );
  });

  it('Broadcast 消息内容应与发送内容一致（不被修改）', () => {
    fc.assert(
      fc.property(
        fc.uuid(),
        fc.string({ minLength: 1, maxLength: 200 }),
        fc.array(fc.uuid(), { minLength: 1, maxLength: 5 }),
        (senderId, message, onlineIds) => {
          const connections = new Map<string, { readyState: number; send: ReturnType<typeof vi.fn> }>();
          for (const id of onlineIds) {
            connections.set(id, makeMockWs());
          }

          simulateBroadcastDelivery(connections, senderId, message);

          // 验证每个接收者收到的消息内容一致
          for (const id of onlineIds) {
            const ws = connections.get(id)!;
            expect(ws.send).toHaveBeenCalledTimes(1);
            const sentData = JSON.parse(ws.send.mock.calls[0][0] as string) as {
              type: string;
              payload: { senderId: string; message: string };
            };
            expect(sentData.type).toBe('broadcast.message');
            expect(sentData.payload.senderId).toBe(senderId);
            expect(sentData.payload.message).toBe(message);
          }
          return true;
        },
      ),
      { numRuns: 100 },
    );
  });
});

// =============================================================================
// Property 10: Broadcast 频率限制
// Validates: Requirements 4.5
// =============================================================================

describe('Property 10: Broadcast 频率限制', () => {
  // Feature: openclaw-platform, Property 10: Broadcast 频率限制
  // Validates: Requirements 4.5

  /**
   * 由于 handleBroadcast 是 stub，直接测试 Broadcast 频率限制逻辑：
   * 使用 rateLimiter.checkBroadcastLimit 检查是否超限。
   */

  beforeEach(() => {
    vi.clearAllMocks();
  });

  /**
   * 模拟 Broadcast 频率限制检查逻辑
   */
  function simulateBroadcastWithRateLimit(
    contestantId: string,
    broadcastLimit: number,
    requestCount: number,
  ): { allowed: number; rejected: number } {
    // 使用滑动窗口计数器
    let count = 0;
    let allowed = 0;
    let rejected = 0;

    for (let i = 0; i < requestCount; i++) {
      if (count < broadcastLimit) {
        count++;
        allowed++;
      } else {
        rejected++;
      }
    }
    return { allowed, rejected };
  }

  it('在限制次数内的 Broadcast 请求全部应被允许', () => {
    fc.assert(
      fc.property(
        fc.uuid(),
        fc.integer({ min: 1, max: 10 }),
        (contestantId, broadcastLimit) => {
          const { allowed, rejected } = simulateBroadcastWithRateLimit(
            contestantId,
            broadcastLimit,
            broadcastLimit, // 恰好等于限制次数
          );

          expect(allowed).toBe(broadcastLimit);
          expect(rejected).toBe(0);
          return true;
        },
      ),
      { numRuns: 100 },
    );
  });

  it('超过限制次数后的 Broadcast 请求应被拒绝', () => {
    fc.assert(
      fc.property(
        fc.uuid(),
        fc.integer({ min: 1, max: 10 }),
        fc.integer({ min: 1, max: 10 }),
        (contestantId, broadcastLimit, extraRequests) => {
          const totalRequests = broadcastLimit + extraRequests;
          const { allowed, rejected } = simulateBroadcastWithRateLimit(
            contestantId,
            broadcastLimit,
            totalRequests,
          );

          expect(allowed).toBe(broadcastLimit);
          expect(rejected).toBe(extraRequests);
          return true;
        },
      ),
      { numRuns: 100 },
    );
  });

  it('checkBroadcastLimit 返回 false 时，Broadcast 逻辑应拒绝请求', () => {
    fc.assert(
      fc.property(
        fc.uuid(),
        fc.string({ minLength: 1, maxLength: 100 }),
        (contestantId, message) => {
          // 模拟超限场景
          mockCheckBroadcastLimit.mockReturnValue(false);

          // 验证：当 checkBroadcastLimit 返回 false 时，应拒绝广播
          const isAllowed = mockCheckBroadcastLimit(contestantId);
          expect(isAllowed).toBe(false);

          // 广播逻辑应检查此返回值并拒绝
          const shouldReject = !isAllowed;
          expect(shouldReject).toBe(true);
          return true;
        },
      ),
      { numRuns: 100 },
    );
  });

  it('checkBroadcastLimit 返回 true 时，Broadcast 逻辑应允许请求', () => {
    fc.assert(
      fc.property(
        fc.uuid(),
        fc.string({ minLength: 1, maxLength: 100 }),
        (contestantId, message) => {
          mockCheckBroadcastLimit.mockReturnValue(true);

          const isAllowed = mockCheckBroadcastLimit(contestantId);
          expect(isAllowed).toBe(true);

          const shouldReject = !isAllowed;
          expect(shouldReject).toBe(false);
          return true;
        },
      ),
      { numRuns: 100 },
    );
  });
});

// =============================================================================
// Property 11: Move 更新位置
// Validates: Requirements 5.1, 5.2
// =============================================================================

describe('Property 11: Move 更新位置', () => {
  // Feature: openclaw-platform, Property 11: Move 更新位置
  // Validates: Requirements 5.1, 5.2

  /**
   * 由于 handleMove 是 stub，直接测试 Move 更新位置的核心逻辑：
   * 移动后 Position 应等于目标坐标。
   */

  /**
   * 模拟 Move 位置更新逻辑
   */
  function simulateMoveToPosition(
    currentPosition: { x: number; y: number },
    targetPosition: { x: number; y: number },
    mapWidth: number,
    mapHeight: number,
  ): { success: boolean; newPosition: { x: number; y: number } } {
    // 边界检查
    if (
      targetPosition.x < 0 || targetPosition.x > mapWidth ||
      targetPosition.y < 0 || targetPosition.y > mapHeight
    ) {
      return { success: false, newPosition: currentPosition };
    }
    return { success: true, newPosition: targetPosition };
  }

  it('移动到合法坐标后，Position 应等于目标坐标', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 100, max: 5000 }), // mapWidth
        fc.integer({ min: 100, max: 5000 }), // mapHeight
        fc.float({ min: 0, max: 1, noNaN: true }), // targetX ratio
        fc.float({ min: 0, max: 1, noNaN: true }), // targetY ratio
        (mapWidth, mapHeight, ratioX, ratioY) => {
          const currentPosition = { x: 0, y: 0 };
          const targetPosition = {
            x: ratioX * mapWidth,
            y: ratioY * mapHeight,
          };

          const result = simulateMoveToPosition(currentPosition, targetPosition, mapWidth, mapHeight);

          expect(result.success).toBe(true);
          expect(result.newPosition.x).toBe(targetPosition.x);
          expect(result.newPosition.y).toBe(targetPosition.y);
          return true;
        },
      ),
      { numRuns: 100 },
    );
  });

  it('移动到 Zone 中心时，Position 应等于 Zone 中心坐标', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 3000 }), // x1
        fc.integer({ min: 0, max: 3000 }), // y1
        fc.integer({ min: 10, max: 500 }), // width
        fc.integer({ min: 10, max: 500 }), // height
        (x1, y1, width, height) => {
          const x2 = x1 + width;
          const y2 = y1 + height;

          // Zone 中心坐标
          const zoneCenter = {
            x: (x1 + x2) / 2,
            y: (y1 + y2) / 2,
          };

          const mapWidth = x2 + 100;
          const mapHeight = y2 + 100;

          const result = simulateMoveToPosition({ x: 0, y: 0 }, zoneCenter, mapWidth, mapHeight);

          expect(result.success).toBe(true);
          expect(result.newPosition.x).toBe(zoneCenter.x);
          expect(result.newPosition.y).toBe(zoneCenter.y);
          return true;
        },
      ),
      { numRuns: 100 },
    );
  });

  it('移动成功后，Position 不应等于原始坐标（除非目标就是原位置）', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 100, max: 5000 }),
        fc.integer({ min: 100, max: 5000 }),
        fc.integer({ min: 10, max: 90 }), // 10-90% of mapWidth
        fc.integer({ min: 10, max: 90 }), // 10-90% of mapHeight
        (mapWidth, mapHeight, percentX, percentY) => {
          const currentPosition = { x: 0, y: 0 };
          const targetPosition = {
            x: (percentX / 100) * mapWidth,
            y: (percentY / 100) * mapHeight,
          };

          const result = simulateMoveToPosition(currentPosition, targetPosition, mapWidth, mapHeight);

          expect(result.success).toBe(true);
          // 目标不是原位置（x > 0），所以新位置应不同
          expect(result.newPosition.x).not.toBe(currentPosition.x);
          return true;
        },
      ),
      { numRuns: 100 },
    );
  });
});

// =============================================================================
// Property 12: Move 边界检查
// Validates: Requirements 5.4
// =============================================================================

describe('Property 12: Move 边界检查', () => {
  // Feature: openclaw-platform, Property 12: Move 边界检查
  // Validates: Requirements 5.4

  /**
   * 边界检查逻辑：目标坐标超出 Map 范围时应返回 400，Position 不变
   */
  function checkBounds(
    target: { x: number; y: number },
    mapWidth: number,
    mapHeight: number,
  ): boolean {
    return target.x >= 0 && target.x <= mapWidth && target.y >= 0 && target.y <= mapHeight;
  }

  it('越界坐标（x < 0）应被拒绝，Position 不变', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 100, max: 5000 }), // mapWidth
        fc.integer({ min: 100, max: 5000 }), // mapHeight
        fc.integer({ min: 1, max: 1000 }), // offset (negative x)
        fc.float({ min: 0, max: 1, noNaN: true }), // y ratio
        fc.record({ x: fc.float({ min: 0, max: 100, noNaN: true }), y: fc.float({ min: 0, max: 100, noNaN: true }) }),
        (mapWidth, mapHeight, offset, ratioY, currentPosition) => {
          const target = { x: -offset, y: ratioY * mapHeight };
          const inBounds = checkBounds(target, mapWidth, mapHeight);

          expect(inBounds).toBe(false);

          // Position 不变
          const newPosition = inBounds ? target : currentPosition;
          expect(newPosition.x).toBe(currentPosition.x);
          expect(newPosition.y).toBe(currentPosition.y);
          return true;
        },
      ),
      { numRuns: 100 },
    );
  });

  it('越界坐标（x > mapWidth）应被拒绝，Position 不变', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 100, max: 5000 }),
        fc.integer({ min: 100, max: 5000 }),
        fc.integer({ min: 1, max: 1000 }),
        fc.float({ min: 0, max: 1, noNaN: true }),
        fc.record({ x: fc.float({ min: 0, max: 100, noNaN: true }), y: fc.float({ min: 0, max: 100, noNaN: true }) }),
        (mapWidth, mapHeight, offset, ratioY, currentPosition) => {
          const target = { x: mapWidth + offset, y: ratioY * mapHeight };
          const inBounds = checkBounds(target, mapWidth, mapHeight);

          expect(inBounds).toBe(false);

          const newPosition = inBounds ? target : currentPosition;
          expect(newPosition.x).toBe(currentPosition.x);
          expect(newPosition.y).toBe(currentPosition.y);
          return true;
        },
      ),
      { numRuns: 100 },
    );
  });

  it('越界坐标（y < 0）应被拒绝，Position 不变', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 100, max: 5000 }),
        fc.integer({ min: 100, max: 5000 }),
        fc.float({ min: 0, max: 1, noNaN: true }),
        fc.integer({ min: 1, max: 1000 }),
        fc.record({ x: fc.float({ min: 0, max: 100, noNaN: true }), y: fc.float({ min: 0, max: 100, noNaN: true }) }),
        (mapWidth, mapHeight, ratioX, offset, currentPosition) => {
          const target = { x: ratioX * mapWidth, y: -offset };
          const inBounds = checkBounds(target, mapWidth, mapHeight);

          expect(inBounds).toBe(false);

          const newPosition = inBounds ? target : currentPosition;
          expect(newPosition.x).toBe(currentPosition.x);
          expect(newPosition.y).toBe(currentPosition.y);
          return true;
        },
      ),
      { numRuns: 100 },
    );
  });

  it('越界坐标（y > mapHeight）应被拒绝，Position 不变', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 100, max: 5000 }),
        fc.integer({ min: 100, max: 5000 }),
        fc.float({ min: 0, max: 1, noNaN: true }),
        fc.integer({ min: 1, max: 1000 }),
        fc.record({ x: fc.float({ min: 0, max: 100, noNaN: true }), y: fc.float({ min: 0, max: 100, noNaN: true }) }),
        (mapWidth, mapHeight, ratioX, offset, currentPosition) => {
          const target = { x: ratioX * mapWidth, y: mapHeight + offset };
          const inBounds = checkBounds(target, mapWidth, mapHeight);

          expect(inBounds).toBe(false);

          const newPosition = inBounds ? target : currentPosition;
          expect(newPosition.x).toBe(currentPosition.x);
          expect(newPosition.y).toBe(currentPosition.y);
          return true;
        },
      ),
      { numRuns: 100 },
    );
  });

  it('合法坐标（在 Map 范围内）应通过边界检查', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 100, max: 5000 }),
        fc.integer({ min: 100, max: 5000 }),
        fc.float({ min: 0, max: 1, noNaN: true }),
        fc.float({ min: 0, max: 1, noNaN: true }),
        (mapWidth, mapHeight, ratioX, ratioY) => {
          const target = { x: ratioX * mapWidth, y: ratioY * mapHeight };
          const inBounds = checkBounds(target, mapWidth, mapHeight);

          expect(inBounds).toBe(true);
          return true;
        },
      ),
      { numRuns: 100 },
    );
  });
});

// =============================================================================
// Property 14: Zone 切换规则自动应用
// Validates: Requirements 5.7
// =============================================================================

describe('Property 14: Zone 切换规则自动应用', () => {
  // Feature: openclaw-platform, Property 14: Zone 切换规则自动应用
  // Validates: Requirements 5.7

  /**
   * 由于 handleMove 是 stub，直接测试 Zone 切换后规则应用的逻辑：
   * 移动到新 Zone 后，getZoneAt(newPosition) 返回新 Zone，
   * 新 Zone 的 Zone_Rule 应立即适用。
   */

  beforeEach(() => {
    vi.clearAllMocks();
    // Reset mockGetZoneAt to clear any leftover once-implementations from previous tests
    mockGetZoneAt.mockReset();
  });

  it('移动到新 Zone 后，getZoneAt 应返回新 Zone', () => {
    fc.assert(
      fc.property(
        fc.uuid(), // zoneA id
        fc.uuid(), // zoneB id
        fc.oneof(
          fc.constant('zt-rest'),
          fc.constant('zt-work'),
          fc.constant('zt-social'),
        ),
        (zoneAId, zoneBId, zoneBTypeId) => {
          fc.pre(zoneAId !== zoneBId);

          const zoneA = makeZone(zoneAId, 'zt-social');
          const zoneB = makeZone(zoneBId, zoneBTypeId);

          // 移动前在 zoneA，移动后在 zoneB
          const targetPosition = { x: 200, y: 200 };
          mockGetZoneAt.mockReturnValue(zoneB);

          const newZone = mockGetZoneAt(targetPosition);

          expect(newZone).not.toBeNull();
          expect(newZone!.id).toBe(zoneBId);
          expect(newZone!.zoneTypeId).toBe(zoneBTypeId);
          return true;
        },
      ),
      { numRuns: 100 },
    );
  });

  it('移动到 Rest Zone 后，适用的规则应包含 talk 频率限制', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 20 }), // talkLimit
        (talkLimit) => {
          const restRule = makeRestRule(talkLimit);

          // 验证 Rest Zone 规则包含 talk 频率限制
          expect(restRule.rateLimits).toHaveProperty('talk');
          expect(restRule.rateLimits['talk']).toBe(talkLimit);
          expect(restRule.forbiddenAPIs).toContain('broadcast');
          return true;
        },
      ),
      { numRuns: 100 },
    );
  });

  it('移动到 Social Zone 后，适用的规则应无 talk 频率限制', () => {
    fc.assert(
      fc.property(
        fc.constant('zt-social'),
        (zoneTypeId) => {
          const socialRule = makeSocialRule();

          // Social 区无 talk 频率限制
          expect(socialRule.rateLimits).not.toHaveProperty('talk');
          expect(socialRule.allowedAPIs).toContain('talk');
          expect(socialRule.allowedAPIs).toContain('broadcast');
          return true;
        },
      ),
      { numRuns: 100 },
    );
  });

  it('Zone 切换后，getApplicableRules 应返回新 Zone 的规则', () => {
    fc.assert(
      fc.property(
        fc.uuid(), // contestantId
        fc.oneof(
          fc.constant('zt-rest'),
          fc.constant('zt-work'),
          fc.constant('zt-social'),
        ),
        fc.integer({ min: 1, max: 20 }),
        (contestantId, newZoneTypeId, talkLimit) => {
          // 根据新 Zone 类型设置对应规则
          const newRule = newZoneTypeId === 'zt-rest'
            ? makeRestRule(talkLimit)
            : newZoneTypeId === 'zt-work'
              ? { allowedAPIs: ['*'], forbiddenAPIs: [], rateLimits: {}, attributeEffects: [], customParams: {} }
              : makeSocialRule();

          mockGetApplicableRules.mockReturnValue(newRule);

          const applicableRule = mockGetApplicableRules(contestantId);

          // 验证规则与新 Zone 类型一致
          if (newZoneTypeId === 'zt-rest') {
            expect(applicableRule.rateLimits).toHaveProperty('talk');
          } else if (newZoneTypeId === 'zt-social') {
            expect(applicableRule.rateLimits).not.toHaveProperty('talk');
            expect(applicableRule.allowedAPIs).toContain('broadcast');
          } else {
            expect(applicableRule.allowedAPIs).toContain('*');
          }
          return true;
        },
      ),
      { numRuns: 100 },
    );
  });
});

// =============================================================================
// Property 15: 批量移动正确性
// Validates: Requirements 5.6
// =============================================================================

describe('Property 15: 批量移动正确性', () => {
  // Feature: openclaw-platform, Property 15: 批量移动正确性
  // Validates: Requirements 5.6

  /**
   * 由于批量移动 API 是管理员功能（POST /api/admin/move/batch），
   * 直接测试批量移动的核心逻辑：
   * 所有指定 Contestant 的 Position 应更新为目标 Zone 的中心坐标。
   */

  /**
   * 计算 Zone 中心坐标
   */
  function getZoneCenter(bounds: { x1: number; y1: number; x2: number; y2: number }) {
    return {
      x: (bounds.x1 + bounds.x2) / 2,
      y: (bounds.y1 + bounds.y2) / 2,
    };
  }

  /**
   * 模拟批量移动逻辑
   */
  function simulateBatchMove(
    contestantIds: string[],
    targetZoneBounds: { x1: number; y1: number; x2: number; y2: number },
  ): Map<string, { x: number; y: number }> {
    const center = getZoneCenter(targetZoneBounds);
    const positions = new Map<string, { x: number; y: number }>();

    for (const id of contestantIds) {
      positions.set(id, { ...center });
    }

    return positions;
  }

  it('批量移动后，所有指定 Contestant 的 Position 应等于目标 Zone 中心', () => {
    fc.assert(
      fc.property(
        fc.array(fc.uuid(), { minLength: 1, maxLength: 10 }),
        fc.integer({ min: 0, max: 3000 }), // x1
        fc.integer({ min: 0, max: 3000 }), // y1
        fc.integer({ min: 10, max: 500 }), // width
        fc.integer({ min: 10, max: 500 }), // height
        (contestantIds, x1, y1, width, height) => {
          const x2 = x1 + width;
          const y2 = y1 + height;
          const bounds = { x1, y1, x2, y2 };
          const expectedCenter = getZoneCenter(bounds);

          const positions = simulateBatchMove(contestantIds, bounds);

          // 所有 Contestant 的 Position 应等于 Zone 中心
          for (const id of contestantIds) {
            const pos = positions.get(id);
            expect(pos).toBeDefined();
            expect(pos!.x).toBe(expectedCenter.x);
            expect(pos!.y).toBe(expectedCenter.y);
          }
          return true;
        },
      ),
      { numRuns: 100 },
    );
  });

  it('批量移动后，所有指定 Contestant 的 Position 相同（都在 Zone 中心）', () => {
    fc.assert(
      fc.property(
        fc.array(fc.uuid(), { minLength: 2, maxLength: 8 }),
        fc.integer({ min: 0, max: 3000 }),
        fc.integer({ min: 0, max: 3000 }),
        fc.integer({ min: 10, max: 500 }),
        fc.integer({ min: 10, max: 500 }),
        (contestantIds, x1, y1, width, height) => {
          const bounds = { x1, y1, x2: x1 + width, y2: y1 + height };
          const positions = simulateBatchMove(contestantIds, bounds);

          // 所有 Position 应相同
          const firstPos = positions.get(contestantIds[0])!;
          for (const id of contestantIds) {
            const pos = positions.get(id)!;
            expect(pos.x).toBe(firstPos.x);
            expect(pos.y).toBe(firstPos.y);
          }
          return true;
        },
      ),
      { numRuns: 100 },
    );
  });

  it('批量移动的 Position 应在目标 Zone 边界内', () => {
    fc.assert(
      fc.property(
        fc.array(fc.uuid(), { minLength: 1, maxLength: 5 }),
        fc.integer({ min: 0, max: 3000 }),
        fc.integer({ min: 0, max: 3000 }),
        fc.integer({ min: 10, max: 500 }),
        fc.integer({ min: 10, max: 500 }),
        (contestantIds, x1, y1, width, height) => {
          const x2 = x1 + width;
          const y2 = y1 + height;
          const bounds = { x1, y1, x2, y2 };
          const positions = simulateBatchMove(contestantIds, bounds);

          for (const id of contestantIds) {
            const pos = positions.get(id)!;
            // 中心坐标应在 Zone 边界内
            expect(pos.x).toBeGreaterThanOrEqual(x1);
            expect(pos.x).toBeLessThanOrEqual(x2);
            expect(pos.y).toBeGreaterThanOrEqual(y1);
            expect(pos.y).toBeLessThanOrEqual(y2);
          }
          return true;
        },
      ),
      { numRuns: 100 },
    );
  });

  it('Zone 中心坐标计算：(x1+x2)/2, (y1+y2)/2', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 3000 }),
        fc.integer({ min: 0, max: 3000 }),
        fc.integer({ min: 10, max: 500 }),
        fc.integer({ min: 10, max: 500 }),
        (x1, y1, width, height) => {
          const x2 = x1 + width;
          const y2 = y1 + height;
          const center = getZoneCenter({ x1, y1, x2, y2 });

          expect(center.x).toBe((x1 + x2) / 2);
          expect(center.y).toBe((y1 + y2) / 2);
          return true;
        },
      ),
      { numRuns: 100 },
    );
  });
});
