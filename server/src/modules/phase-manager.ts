// =============================================================================
// XTION_TheFool0 — PhaseManager 模块
// Requirements: 13.1, 13.2, 13.3, 13.4, 13.5, 13.6, 13.7, 13.8, 13.9
// =============================================================================

import { db } from '../db.js';
import { connections, sendEvent } from '../ws.js';
import { eventLogger } from './event-logger.js';
import type { PhaseConfig, ServerEvent } from '../types/index.js';
import type { WebSocket } from 'ws';

// ---------------------------------------------------------------------------
// Hardcoded phase configurations (Task 4.1)
// ---------------------------------------------------------------------------

const PHASE_CONFIGS: PhaseConfig[] = [
  {
    phaseId: 'phase_1',
    phaseName: '破冰与亮相：龙虾上场',
    phasePrompt: '# 阶段一：破冰与亮相\n\n本阶段请进行 45 秒的自我介绍...',
    skillDocNames: [],
  },
  {
    phaseId: 'phase_2',
    phaseName: '设定注入：画帽子',
    phasePrompt: '# 阶段二：设定注入\n\n你刚刚收到了一顶"蠢帽子"...',
    skillDocNames: ['openclaw-quickstart'],
  },
  {
    phaseId: 'phase_3',
    phaseName: '资源重组：碳基助理编队',
    phasePrompt: '# 阶段三：资源重组\n\n现在需要招募人类助理...',
    skillDocNames: [],
  },
  {
    phaseId: 'phase_4',
    phaseName: '核心 Hack：龙虾的复仇',
    phasePrompt: '# 阶段四：核心 Hack\n\n指挥你的人类小队开发工具...',
    skillDocNames: ['openclaw-quickstart'],
  },
  {
    phaseId: 'phase_5',
    phaseName: '浪漫收尾：赛博作诗与艺术展',
    phasePrompt: '# 阶段五：浪漫收尾\n\n提取今日记忆，生成一首诗...',
    skillDocNames: [],
  },
];

// ---------------------------------------------------------------------------
// Row types for DB queries
// ---------------------------------------------------------------------------

interface ContestantKeyRow {
  id: string;
  role: string;
  status: string;
}

// ---------------------------------------------------------------------------
// PhaseManagerClass
// ---------------------------------------------------------------------------

export class PhaseManagerClass {
  private activePhaseId: string | null = null;

  // -------------------------------------------------------------------------
  // Task 4.2: getPhases() — return all phases as { phaseId, phaseName }[]
  // -------------------------------------------------------------------------

  getPhases(): Array<{ phaseId: string; phaseName: string }> {
    return PHASE_CONFIGS.map(({ phaseId, phaseName }) => ({ phaseId, phaseName }));
  }

  // -------------------------------------------------------------------------
  // Task 4.3: getActivePhase() — return current active PhaseConfig or null
  // -------------------------------------------------------------------------

  getActivePhase(): PhaseConfig | null {
    if (this.activePhaseId === null) return null;
    return PHASE_CONFIGS.find((p) => p.phaseId === this.activePhaseId) ?? null;
  }

  // -------------------------------------------------------------------------
  // Task 4.4: activatePhase(phaseId, operatorId)
  // -------------------------------------------------------------------------

  async activatePhase(phaseId: string, operatorId: string): Promise<void> {
    const config = PHASE_CONFIGS.find((p) => p.phaseId === phaseId);
    if (!config) {
      throw Object.assign(new Error(`阶段不存在: ${phaseId}`), {
        code: 'PHASE_NOT_FOUND',
        statusCode: 404,
      });
    }

    // Set active phase
    this.activePhaseId = phaseId;

    // Async push to all online Agent_Player contestants
    this._pushPhaseToOnlineAgents(config).catch((err: unknown) => {
      console.error('[PhaseManager] pushPhaseToOnlineAgents error:', err);
    });

    // Log phase.switched event
    await eventLogger.log({
      type: 'phase.switched',
      data: { phaseId, operatorId },
    });
  }

  // -------------------------------------------------------------------------
  // Task 4.5: pushCurrentPhaseToAgent(contestantId)
  // -------------------------------------------------------------------------

  async pushCurrentPhaseToAgent(contestantId: string): Promise<void> {
    const config = this.getActivePhase();
    if (!config) return;

    const ws = connections.get(contestantId);
    if (!ws) return;

    this._pushPhaseToWs(ws, config);
  }

  // -------------------------------------------------------------------------
  // Private helpers
  // -------------------------------------------------------------------------

  private _getOnlineAgentPlayerIds(): string[] {
    const rows = db.prepare(`
      SELECT c.id, k.role, c.status
      FROM contestants c
      JOIN keys k ON c.key_id = k.id
      WHERE c.status = 'online' AND k.role = 'Agent_Player'
    `).all() as ContestantKeyRow[];

    return rows.map((r) => r.id);
  }

  private async _pushPhaseToOnlineAgents(config: PhaseConfig): Promise<void> {
    const agentIds = this._getOnlineAgentPlayerIds();

    for (const contestantId of agentIds) {
      const ws = connections.get(contestantId);
      if (!ws) continue;
      this._pushPhaseToWs(ws, config);
    }
  }

  private _pushPhaseToWs(ws: WebSocket, config: PhaseConfig): void {
    const timestamp = Date.now();

    // Push phase prompt as doc.mandatory
    const mandatoryEvent: ServerEvent = {
      type: 'doc.mandatory',
      payload: {
        docName: `phase_prompt_${config.phaseId}`,
        content: config.phasePrompt,
      },
      timestamp,
    };
    sendEvent(ws, mandatoryEvent);

    // Push each skill doc as doc.update
    for (const docName of config.skillDocNames) {
      const updateEvent: ServerEvent = {
        type: 'doc.update',
        payload: { docName, timestamp },
        timestamp,
      };
      sendEvent(ws, updateEvent);
    }
  }
}

// ---------------------------------------------------------------------------
// Task 4.6: Export singleton phaseManager
// ---------------------------------------------------------------------------

export const phaseManager = new PhaseManagerClass();
