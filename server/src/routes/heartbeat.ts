// =============================================================================
// XTION_TheFool0 — Heartbeat API 路由
// POST /api/heartbeat
// Requirements: 9.3, 9.4, 9.5
// =============================================================================

import { Router, type Request, type Response } from 'express';
import { heartbeatMonitor } from '../modules/heartbeat-monitor';
import { requireRole } from '../middleware/auth';
import { eventLogger } from '../modules/event-logger';
import type { ErrorResponse, HeartbeatPayload } from '../types';

export const heartbeatRouter = Router();

// ---------------------------------------------------------------------------
// POST /api/heartbeat
// ---------------------------------------------------------------------------

heartbeatRouter.post('/', requireRole('Admin', 'Agent_Player'), (req: Request, res: Response): void => {
  // Auth: req.contestantId is guaranteed valid by authMiddleware (Bug 2 fix)
  const contestantId = req.contestantId;
  if (!contestantId) {
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

  heartbeatMonitor.onHeartbeat(contestantId, payload as HeartbeatPayload);

  res.status(200).json({
    serverTimestamp: Date.now(),
    pendingEvents: 0,
  });
});
