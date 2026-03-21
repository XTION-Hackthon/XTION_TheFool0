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
  const authHeader = req.headers['authorization'];
  if (authHeader && authHeader.startsWith('Bearer ')) {
    const key = authHeader.slice(7).trim();
    if (key) {
      const keyRow = db.prepare(`
        SELECT id FROM keys WHERE key = ? AND status = 'active'
      `).get(key) as { id: string } | undefined;

      if (keyRow) {
        const contestant = db.prepare(`
          SELECT id, name, status FROM contestants WHERE key_id = ?
        `).get(keyRow.id) as ContestantRow | undefined;
        if (contestant) return contestant;
      }
    }
  }

  // Fallback: use contestant_id from body
  const { contestant_id } = req.body as { contestant_id?: string };
  if (contestant_id) {
    const contestant = db.prepare(`
      SELECT id, name, status FROM contestants WHERE id = ?
    `).get(contestant_id) as ContestantRow | undefined;
    if (contestant) return contestant;
  }

  return null;
}

// ---------------------------------------------------------------------------
// POST /api/heartbeat
// ---------------------------------------------------------------------------

heartbeatRouter.post('/', requireRole('Admin', 'Agent_Player'), (req: Request, res: Response): void => {
  const contestant = getContestantFromRequest(req);
  if (!contestant) {
    const body: ErrorResponse = {
      error: { code: 'AUTH_MISSING_KEY', message: '未携带有效的认证 Key 或 contestant_id' },
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
