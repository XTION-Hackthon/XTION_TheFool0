// =============================================================================
// XTION_TheFool0 — 管理员监控 API
// Requirements: 13.6
// =============================================================================

import { Router, type Request, type Response, type NextFunction } from 'express';
import { db } from '../db';
import { heartbeatMonitor } from '../modules/heartbeat-monitor';
import { eventLogger } from '../modules/event-logger';

export const adminMonitorRouter = Router();

// ---------------------------------------------------------------------------
// GET /api/admin/monitor — 平台运行状态概览
// Requirements: 13.6
// ---------------------------------------------------------------------------

adminMonitorRouter.get('/monitor', (_req: Request, res: Response, next: NextFunction) => {
  try {
    // Online count
    const onlineCount = (db.prepare(
      "SELECT COUNT(*) as cnt FROM contestants WHERE status = 'online'",
    ).get() as { cnt: number }).cnt;

    // Zone population distribution
    const zonePopulation = db.prepare(`
      SELECT z.id as zone_id, z.name as zone_name, COUNT(c.id) as count
      FROM zones z
      LEFT JOIN contestants c ON c.current_zone_id = z.id AND c.status = 'online'
      GROUP BY z.id, z.name
    `).all() as Array<{ zone_id: string; zone_name: string; count: number }>;

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
      onlineCount,
      zoneDistribution: Object.fromEntries(
        zonePopulation.map(z => [z.zone_name, z.count]),
      ),
      apiCallRate: recentApiCalls,
      heartbeatAnomalies: heartbeatAnomalies.map(c => c.contestantId),
      timestamp: Date.now(),
    });
  } catch (err) {
    next(err);
  }
});

// ---------------------------------------------------------------------------
// GET /api/admin/logs/:keyId — 按 API Key 查询对应选手的事件日志
// ---------------------------------------------------------------------------

adminMonitorRouter.get('/logs/:keyId', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { keyId } = req.params as { keyId: string };
    const limit = req.query['limit'] ? parseInt(req.query['limit'] as string, 10) : 50;
    const offset = req.query['offset'] ? parseInt(req.query['offset'] as string, 10) : 0;
    const type = req.query['type'] as string | undefined;

    // Look up contestant_id for this key
    const keyRow = db.prepare(
      'SELECT id, contestant_name, role, status FROM keys WHERE id = ?',
    ).get(keyId) as { id: string; contestant_name: string; role: string; status: string } | undefined;

    if (!keyRow) {
      return res.status(404).json({ error: { code: 'KEY_NOT_FOUND', message: 'Key 不存在' } });
    }

    const contestantRow = db.prepare(
      'SELECT id, name, status FROM contestants WHERE key_id = ?',
    ).get(keyId) as { id: string; name: string; status: string } | undefined;

    // Build query — if no contestant yet, return empty
    if (!contestantRow) {
      return res.json({
        key: keyRow,
        contestant: null,
        events: [],
        total: 0,
      });
    }

    const conditions: string[] = ['contestant_id = ?'];
    const params: unknown[] = [contestantRow.id];

    if (type) {
      conditions.push('type = ?');
      params.push(type);
    }

    const where = `WHERE ${conditions.join(' AND ')}`;

    const total = (db.prepare(
      `SELECT COUNT(*) as cnt FROM events ${where}`,
    ).get(...params) as { cnt: number }).cnt;

    const rows = db.prepare(`
      SELECT id, type, contestant_id, data, timestamp
      FROM events ${where}
      ORDER BY timestamp DESC
      LIMIT ? OFFSET ?
    `).all(...params, limit, offset) as Array<{
      id: string; type: string; contestant_id: string | null; data: string; timestamp: number;
    }>;

    res.json({
      key: keyRow,
      contestant: contestantRow,
      events: rows.map(r => ({
        id: r.id,
        type: r.type,
        contestantId: r.contestant_id,
        data: JSON.parse(r.data) as unknown,
        timestamp: r.timestamp,
      })),
      total,
    });
  } catch (err) {
    next(err);
  }
});
