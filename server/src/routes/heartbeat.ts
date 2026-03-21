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

function getContestantFromRequest(req: Request): ContestantRow | null {
  const contestantId = req.contestantId;
  if (!contestantId) return null;
  return db.prepare('SELECT id, name, status FROM contestants WHERE id = ?').get(contestantId) as ContestantRow | null;
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

  const { payload } = req.body as {
    payload?: Partial<HeartbeatPayload>;
  };

  if (
    !payload ||
    typeof payload.cpuLoad !== 'number' ||
    typeof payload.memoryUsage !== 'number' ||
    typeof payload.responseLatency !== 'number'
  ) {
    const body: ErrorResponse = {
      error: { code: 'SYS_INVALID_PARAMS', message: 'payload 必须包含 cpuLoad, memoryUsage, responseLatency' },
    };
    res.status(400).json(body);
    return;
  }

  heartbeatMonitor.onHeartbeat(contestant.id, payload as HeartbeatPayload);

  res.status(200).json({
    serverTimestamp: Date.now(),
    pendingEvents: 0,
  });
});
