// =============================================================================
// XTION_TheFool0 — 阶段推送完整性属性测试
// Feature: location-state-system
// Property 6: 阶段切换后，所有在线 Agent_Player 均收到 doc.mandatory 事件，内容与配置一致
// Validates: Requirements 13.3, 13.4, 13.5
// =============================================================================

import { describe, it, expect, vi, beforeEach } from 'vitest';
import fc from 'fast-check';
import type { WebSocket } from 'ws';
import type { ServerEvent } from '../../types/index.js';

// =============================================================================
// Hoisted shared state (must be hoisted so vi.mock factories can reference them)
// =============================================================================

const { mockConnections, capturedEvents, mockSendEvent, mockDbAll } = vi.hoisted(() => {
  const mockConnections = new Map<string, WebSocket>();
  const capturedEvents: Array<{ ws: WebSocket; event: ServerEvent }> = [];
  const mockSendEvent = vi.fn((ws: WebSocket, event: ServerEvent) => {
    capturedEvents.push({ ws, event });
  });
  const mockDbAll = vi.fn().mockReturnValue([]);
  return { mockConnections, capturedEvents, mockSendEvent, mockDbAll };
});

// =============================================================================
// Mocks
// =============================================================================

vi.mock('../../db.js', () => ({
  db: {
    prepare: vi.fn().mockReturnValue({
      run: vi.fn(),
      get: vi.fn(),
      all: mockDbAll,
    }),
  },
}));

vi.mock('../../modules/event-logger.js', () => ({
  eventLogger: {
    log: vi.fn().mockResolvedValue(undefined),
  },
}));

vi.mock('../../ws.js', () => ({
  connections: mockConnections,
  sendEvent: mockSendEvent,
}));

// Import after mocks
import { PhaseManagerClass } from '../../modules/phase-manager.js';

// =============================================================================
// Helpers
// =============================================================================

function makeMockWs(): WebSocket {
  return {} as WebSocket;
}

/** Hardcoded phase configs mirroring phase-manager.ts */
const PHASE_IDS = ['phase_1', 'phase_2', 'phase_3', 'phase_4', 'phase_5'] as const;
type PhaseId = typeof PHASE_IDS[number];

const PHASE_PROMPTS: Record<PhaseId, string> = {
  phase_1: '# 阶段一：破冰与亮相\n\n本阶段请进行 45 秒的自我介绍...',
  phase_2: '# 阶段二：设定注入\n\n你刚刚收到了一顶"蠢帽子"...',
  phase_3: '# 阶段三：资源重组\n\n现在需要招募人类助理...',
  phase_4: '# 阶段四：核心 Hack\n\n指挥你的人类小队开发工具...',
  phase_5: '# 阶段五：浪漫收尾\n\n提取今日记忆，生成一首诗...',
};

const PHASE_SKILL_DOCS: Record<PhaseId, string[]> = {
  phase_1: [],
  phase_2: ['openclaw-quickstart'],
  phase_3: [],
  phase_4: ['openclaw-quickstart'],
  phase_5: [],
};

// =============================================================================
// Property 6: 阶段推送完整性
// Validates: Requirements 13.3, 13.4, 13.5
// =============================================================================

describe('Property 6: 阶段推送完整性', () => {
  beforeEach(() => {
    mockConnections.clear();
    capturedEvents.length = 0;
    mockSendEvent.mockClear();
    mockDbAll.mockReturnValue([]);
  });

  it('activatePhase 向所有在线 Agent_Player 发送 doc.mandatory 事件', async () => {
    // **Validates: Requirements 13.3, 13.4**
    await fc.assert(
      fc.asyncProperty(
        fc.constantFrom(...PHASE_IDS),
        fc.integer({ min: 1, max: 5 }),
        async (phaseId, agentCount) => {
          // Reset state
          mockConnections.clear();
          capturedEvents.length = 0;
          mockSendEvent.mockClear();

          // Setup mock agents
          const agentIds: string[] = [];
          const agentWsMap = new Map<string, WebSocket>();
          for (let i = 0; i < agentCount; i++) {
            const id = `agent-${i}`;
            const ws = makeMockWs();
            mockConnections.set(id, ws);
            agentWsMap.set(id, ws);
            agentIds.push(id);
          }

          // Mock db to return these agents as online Agent_Players
          mockDbAll.mockReturnValue(
            agentIds.map(id => ({ id, role: 'Agent_Player', status: 'online' })),
          );

          const mgr = new PhaseManagerClass();
          await mgr.activatePhase(phaseId, 'admin-1');
          await new Promise(resolve => setTimeout(resolve, 10));

          // Each agent should have received exactly one doc.mandatory event
          for (const id of agentIds) {
            const ws = agentWsMap.get(id)!;
            const mandatoryEvents = capturedEvents.filter(
              e => e.ws === ws && e.event.type === 'doc.mandatory',
            );
            if (mandatoryEvents.length !== 1) return false;
          }

          return true;
        },
      ),
      { numRuns: 50 },
    );
  });

  it('doc.mandatory 事件的 docName 格式为 phase_prompt_{phaseId}', async () => {
    // **Validates: Requirements 13.4**
    await fc.assert(
      fc.asyncProperty(
        fc.constantFrom(...PHASE_IDS),
        async (phaseId) => {
          mockConnections.clear();
          capturedEvents.length = 0;
          mockSendEvent.mockClear();

          const agentWs = makeMockWs();
          mockConnections.set('agent-1', agentWs);
          mockDbAll.mockReturnValue([{ id: 'agent-1', role: 'Agent_Player', status: 'online' }]);

          const mgr = new PhaseManagerClass();
          await mgr.activatePhase(phaseId, 'admin-1');
          await new Promise(resolve => setTimeout(resolve, 10));

          const mandatoryEvent = capturedEvents.find(
            e => e.ws === agentWs && e.event.type === 'doc.mandatory',
          );
          if (!mandatoryEvent) return false;

          const payload = mandatoryEvent.event.payload as { docName: string; content: string };
          return payload.docName === `phase_prompt_${phaseId}`;
        },
      ),
      { numRuns: 50 },
    );
  });

  it('doc.mandatory 事件的 content 与阶段配置的 phasePrompt 一致', async () => {
    // **Validates: Requirements 13.4**
    await fc.assert(
      fc.asyncProperty(
        fc.constantFrom(...PHASE_IDS),
        async (phaseId) => {
          mockConnections.clear();
          capturedEvents.length = 0;
          mockSendEvent.mockClear();

          const agentWs = makeMockWs();
          mockConnections.set('agent-1', agentWs);
          mockDbAll.mockReturnValue([{ id: 'agent-1', role: 'Agent_Player', status: 'online' }]);

          const mgr = new PhaseManagerClass();
          await mgr.activatePhase(phaseId, 'admin-1');
          await new Promise(resolve => setTimeout(resolve, 10));

          const mandatoryEvent = capturedEvents.find(
            e => e.ws === agentWs && e.event.type === 'doc.mandatory',
          );
          if (!mandatoryEvent) return false;

          const payload = mandatoryEvent.event.payload as { docName: string; content: string };
          const expectedPrompt = PHASE_PROMPTS[phaseId as PhaseId];
          return payload.content === expectedPrompt;
        },
      ),
      { numRuns: 50 },
    );
  });

  it('有 skillDocNames 的阶段额外推送 doc.update 事件', async () => {
    // **Validates: Requirements 13.4**
    const phasesWithSkills: PhaseId[] = ['phase_2', 'phase_4'];

    for (const phaseId of phasesWithSkills) {
      mockConnections.clear();
      capturedEvents.length = 0;
      mockSendEvent.mockClear();

      const agentWs = makeMockWs();
      mockConnections.set('agent-1', agentWs);
      mockDbAll.mockReturnValue([{ id: 'agent-1', role: 'Agent_Player', status: 'online' }]);

      const mgr = new PhaseManagerClass();
      await mgr.activatePhase(phaseId, 'admin-1');
      await new Promise(resolve => setTimeout(resolve, 10));

      const updateEvents = capturedEvents.filter(
        e => e.ws === agentWs && e.event.type === 'doc.update',
      );

      const expectedSkillDocs = PHASE_SKILL_DOCS[phaseId];
      expect(updateEvents.length).toBe(expectedSkillDocs.length);

      for (const docName of expectedSkillDocs) {
        const found = updateEvents.some(
          e => (e.event.payload as { docName: string }).docName === docName,
        );
        expect(found).toBe(true);
      }
    }
  });

  it('无 skillDocNames 的阶段不推送 doc.update 事件', async () => {
    // **Validates: Requirements 13.4**
    const phasesWithoutSkills: PhaseId[] = ['phase_1', 'phase_3', 'phase_5'];

    for (const phaseId of phasesWithoutSkills) {
      mockConnections.clear();
      capturedEvents.length = 0;
      mockSendEvent.mockClear();

      const agentWs = makeMockWs();
      mockConnections.set('agent-1', agentWs);
      mockDbAll.mockReturnValue([{ id: 'agent-1', role: 'Agent_Player', status: 'online' }]);

      const mgr = new PhaseManagerClass();
      await mgr.activatePhase(phaseId, 'admin-1');
      await new Promise(resolve => setTimeout(resolve, 10));

      const updateEvents = capturedEvents.filter(
        e => e.ws === agentWs && e.event.type === 'doc.update',
      );
      expect(updateEvents.length).toBe(0);
    }
  });

  it('activatePhase 对不存在的 phaseId 抛出 PHASE_NOT_FOUND 错误', async () => {
    // **Validates: Requirements 13.3**
    const mgr = new PhaseManagerClass();
    await expect(mgr.activatePhase('phase_99', 'admin-1')).rejects.toMatchObject({
      code: 'PHASE_NOT_FOUND',
    });
  });
});
