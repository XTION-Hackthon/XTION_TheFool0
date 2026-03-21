// =============================================================================
// XTION_TheFool0 — Heartbeat API 路由
// POST /api/heartbeat
// Requirements: 9.3, 9.4, 9.5
// =============================================================================

import { Router, type Request, type Response } from 'express';
import { db } from '../db';
import { heartbeatMonitor } from '../modules/heartbeat-monitor';
import { requireRole } from '../middleware/auth';
import type { ErrorResponse, HeartbeatPayload } from '../types';

export const heartbeatRouter = Router();

// ---------------------------------------------------------------------------
// Helper: extract contestant from Authorization header or body fallback
// ---------------------------------------------------------------------------

interface ContestantRow {
  id: string;
  name: string;
  status: string;
}

type HeartbeatRequestBody = {
  contestant_id?: string;
  contestantId?: string;
  timestamp?: string | number;
  payload?: Partial<HeartbeatPayload> & {
    cpu_load?: number;
    memory_usage?: number;
    response_latency_ms?: number;
  };
};

function getContestantFromRequest(req: Request): ContestantRow | null {
  const contestantId = req.contestantId;
  if (!contestantId) return null;
  return db.prepare('SELECT id, name, status FROM contestants WHERE id = ?').get(contestantId) as ContestantRow | null;
}

function normalizeHeartbeatPayload(body: HeartbeatRequestBody): HeartbeatPayload | null {
  const payload = body.payload;
  if (!payload) {
    return null;
  }

  const cpuLoad = payload.cpuLoad ?? payload.cpu_load;
  const memoryUsage = payload.memoryUsage ?? payload.memory_usage;
  const responseLatency = payload.responseLatency ?? payload.response_latency_ms;

  if (
    typeof cpuLoad !== 'number' ||
    typeof memoryUsage !== 'number' ||
    typeof responseLatency !== 'number'
  ) {
    return null;
  }

  return {
    cpuLoad,
    memoryUsage,
    responseLatency,
  };
}

// ---------------------------------------------------------------------------
// POST /api/heartbeat
// ---------------------------------------------------------------------------

heartbeatRouter.post('/', requireRole('Admin', 'Agent_Player'), (req: Request, res: Response): void => {
  const contestant = getContestantFromRequest(req);
  if (!contestant) {
    const body: ErrorResponse = {
      error: { code: 'AUTH_MISSING_KEY', message: '未携带有效的认证 Key' },
    };
    res.status(401).json(body);
    return;
  }

  const normalizedPayload = normalizeHeartbeatPayload(req.body as HeartbeatRequestBody);

  if (!normalizedPayload) {
    const body: ErrorResponse = {
      error: {
        code: 'SYS_INVALID_PARAMS',
        message: 'payload 必须包含 cpuLoad, memoryUsage, responseLatency（兼容旧字段 cpu_load, memory_usage, response_latency_ms）',
      },
    };
    res.status(400).json(body);
    return;
  }

  heartbeatMonitor.onHeartbeat(contestant.id, normalizedPayload);

  res.status(200).json({
    serverTimestamp: Date.now(),
    pendingEvents: 0,
  });
});
