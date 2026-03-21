// =============================================================================
// XTION_TheFool0 — 管理员监控 API
// Requirements: 13.6
// =============================================================================

import { Router, type Request, type Response, type NextFunction } from 'express';
import { db } from '../db';
import { heartbeatMonitor } from '../modules/heartbeat-monitor';

export const adminMonitorRouter = Router();

// ---------------------------------------------------------------------------
// GET /api/admin/monitor — 平台运行状态概览
// Requirements: 13.6
// ---------------------------------------------------------------------------

adminMonitorRouter.get('/monitor', (_req: Request, res: Response, next: NextFunction) => {
  try {
    // Zone population distribution
    const zonePopulationRows = db.prepare(`
      SELECT z.id as zone_id, z.name as zone_name, COUNT(c.id) as count
      FROM zones z
      LEFT JOIN contestants c ON c.current_zone_id = z.id AND c.status = 'online'
      GROUP BY z.id, z.name
    `).all() as Array<{ zone_id: string; zone_name: string; count: number }>;
    const zonePopulation = zonePopulationRows.map((zone) => ({
      zoneId: zone.zone_id,
      zoneName: zone.zone_name,
      count: zone.count,
    }));

    // Heartbeat anomalies — contestants with timeout or offline status
    const onlineContestants = db.prepare(
      "SELECT id FROM contestants WHERE status = 'online'",
    ).all() as Array<{ id: string }>;

    const heartbeatAnomalies = onlineContestants
      .map(c => ({
        contestantId: c.id,
        healthStatus: heartbeatMonitor.getHealthStatus(c.id),
      }))
      .filter(c => c.healthStatus === 'timeout' || c.healthStatus === 'delayed');

    // Recent API call counts from events table (last 60 seconds)
    const since = Date.now() - 60_000;
    const recentApiCalls = (db.prepare(
      'SELECT COUNT(*) as cnt FROM events WHERE timestamp > ?',
    ).get(since) as { cnt: number }).cnt;

    res.json({
      zonePopulation,
      recentApiCallsPerMinute: recentApiCalls,
      heartbeatAnomalies,
    });
  } catch (err) {
    next(err);
  }
});
