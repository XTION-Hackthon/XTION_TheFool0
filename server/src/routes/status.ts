// =============================================================================
// XTION_TheFool0 — Status API 端点
// Requirements: 8.3, 8.6, 8.7, 8.8, 8.9, 13.1, 13.2, 13.3, 13.4
// =============================================================================

import { Router, type Request, type Response, type NextFunction } from 'express';
import { db } from '../db';
import { adminMapConfigStore } from '../modules/admin-map-config';
import { worldManager } from '../modules/world-manager';
import { requireRole } from '../middleware/auth';

export const statusRouter = Router();

function httpError(statusCode: number, code: string, message: string) {
  const err = new Error(message) as Error & { statusCode: number; code: string };
  err.statusCode = statusCode;
  err.code = code;
  return err;
}

// ---------------------------------------------------------------------------
// DB helpers
// ---------------------------------------------------------------------------

interface ContestantRow {
  id: string;
  key_id: string;
  name: string;
  status: string;
  position_x: number;
  position_y: number;
  current_zone_id: string | null;
  energy: number;
  installed_skills: string;
  attributes: string;
  connected_at: number | null;
  disconnected_at: number | null;
}

interface ZoneRow {
  id: string;
  name: string;
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  zone_type_id: string;
  fill_color: string;
  border_color: string;
  opacity: number;
  icon: string | null;
  access_restriction: string | null;
}

function rowToZone(r: ZoneRow) {
  return {
    id: r.id,
    name: r.name,
    bounds: { x1: r.x1, y1: r.y1, x2: r.x2, y2: r.y2 },
    zoneTypeId: r.zone_type_id,
    style: {
      fillColor: r.fill_color,
      borderColor: r.border_color,
      opacity: r.opacity,
      ...(r.icon ? { icon: r.icon } : {}),
    },
    ...(r.access_restriction ? { accessRestriction: JSON.parse(r.access_restriction) as string[] } : {}),
  };
}

// ---------------------------------------------------------------------------
// GET /api/status/me — 自身完整状态
// Requirements: 8.6, 13.1
// ---------------------------------------------------------------------------

statusRouter.get('/status/me', requireRole('Admin', 'Agent_Player'), (req: Request, res: Response, next: NextFunction) => {
  try {
    const contestantId = req.contestantId ?? (req.headers['x-contestant-id'] as string);
    if (!contestantId) return next(httpError(401, 'AUTH_MISSING_KEY', '需要认证'));

    const row = db.prepare('SELECT * FROM contestants WHERE id = ?').get(contestantId) as ContestantRow | undefined;
    if (!row) return next(httpError(404, 'CONTESTANT_NOT_FOUND', '选手不存在'));

    const zoneRule = worldManager.getApplicableRules(contestantId);

    res.json({
      id: row.id,
      name: row.name,
      status: row.status,
      position: { x: row.position_x, y: row.position_y },
      currentZoneId: row.current_zone_id,
      energy: row.energy,
      installedSkills: JSON.parse(row.installed_skills) as string[],
      zoneRuleSummary: {
        allowedAPIs: zoneRule.allowedAPIs,
        forbiddenAPIs: zoneRule.forbiddenAPIs,
      },
    });
  } catch (err) {
    next(err);
  }
});

// ---------------------------------------------------------------------------
// GET /api/status/:id — 其他 Contestant 公开状态
// Requirements: 13.2
// ---------------------------------------------------------------------------

statusRouter.get('/status/:id', requireRole('Admin', 'Agent_Player'), (req: Request, res: Response, next: NextFunction) => {
  try {
    const row = db.prepare('SELECT * FROM contestants WHERE id = ?').get(req.params['id'] as string) as ContestantRow | undefined;
    if (!row) return next(httpError(404, 'CONTESTANT_NOT_FOUND', '选手不存在'));

    res.json({
      id: row.id,
      name: row.name,
      status: row.status,
      position: { x: row.position_x, y: row.position_y },
      currentZoneId: row.current_zone_id,
    });
  } catch (err) {
    next(err);
  }
});

// ---------------------------------------------------------------------------
// GET /api/contestants — 在线 Contestant 列表（可按 Zone 过滤）
// Requirements: 8.7
// ---------------------------------------------------------------------------

statusRouter.get('/contestants', requireRole('Admin', 'Agent_Player', 'Human_Viewer', 'Agent_Viewer'), (req: Request, res: Response, next: NextFunction) => {
  try {
    const zoneId = req.query['zone_id'] as string | undefined;

    let rows: ContestantRow[];
    if (zoneId) {
      rows = db.prepare(
        "SELECT * FROM contestants WHERE status = 'online' AND current_zone_id = ?",
      ).all(zoneId) as ContestantRow[];
    } else {
      rows = db.prepare(
        "SELECT * FROM contestants WHERE status = 'online'",
      ).all() as ContestantRow[];
    }

    res.json(rows.map(r => ({
      id: r.id,
      name: r.name,
      status: r.status,
      position: { x: r.position_x, y: r.position_y },
      currentZoneId: r.current_zone_id,
    })));
  } catch (err) {
    next(err);
  }
});

// ---------------------------------------------------------------------------
// GET /api/zones — 所有 Zone 信息
// Requirements: 8.8
// ---------------------------------------------------------------------------

statusRouter.get('/zones', requireRole('Admin', 'Agent_Player', 'Human_Viewer', 'Agent_Viewer'), (_req: Request, res: Response, next: NextFunction) => {
  try {
    const rows = db.prepare('SELECT * FROM zones').all() as ZoneRow[];
    res.json(rows.map(rowToZone));
  } catch (err) {
    next(err);
  }
});

// ---------------------------------------------------------------------------
// GET /api/zones/:id — Zone 详情（含在线 Contestant 列表）
// Requirements: 13.3
// ---------------------------------------------------------------------------

statusRouter.get('/zones/:id', requireRole('Admin', 'Agent_Player', 'Human_Viewer', 'Agent_Viewer'), (req: Request, res: Response, next: NextFunction) => {
  try {
    const zoneId = req.params['id'] as string;
    const row = db.prepare('SELECT * FROM zones WHERE id = ?').get(zoneId) as ZoneRow | undefined;
    if (!row) return next(httpError(404, 'ZONE_NOT_FOUND', 'Zone 不存在'));

    const contestants = db.prepare(
      "SELECT id, name, status, position_x, position_y FROM contestants WHERE current_zone_id = ? AND status = 'online'",
    ).all(zoneId) as Array<{ id: string; name: string; status: string; position_x: number; position_y: number }>;

    res.json({
      ...rowToZone(row),
      onlineContestants: contestants.map(c => ({
        id: c.id,
        name: c.name,
        status: c.status,
        position: { x: c.position_x, y: c.position_y },
      })),
    });
  } catch (err) {
    next(err);
  }
});

// ---------------------------------------------------------------------------
// GET /api/world — World 概览
// Requirements: 8.9, 13.4
// ---------------------------------------------------------------------------

statusRouter.get('/world', requireRole('Admin', 'Agent_Player', 'Human_Viewer', 'Agent_Viewer'), (_req: Request, res: Response, next: NextFunction) => {
  try {
    const mapDims = db.prepare('SELECT MAX(x2) as width, MAX(y2) as height FROM zones').get() as
      | { width: number | null; height: number | null };
    const mapConfig = adminMapConfigStore.getConfig();

    const zones = (db.prepare('SELECT * FROM zones').all() as ZoneRow[]).map(rowToZone);

    const onlineTotal = (db.prepare(
      "SELECT COUNT(*) as cnt FROM contestants WHERE status = 'online'",
    ).get() as { cnt: number }).cnt;

    const zonePopulation = zones.map(z => {
      const cnt = (db.prepare(
        "SELECT COUNT(*) as cnt FROM contestants WHERE current_zone_id = ? AND status = 'online'",
      ).get(z.id) as { cnt: number }).cnt;
      return { zoneId: z.id, zoneName: z.name, count: cnt };
    });

    res.json({
      map: {
        width: mapDims.width ?? 1000,
        height: mapDims.height ?? 800,
        ...(mapConfig.backgroundImage ? { backgroundImage: mapConfig.backgroundImage } : {}),
      },
      zones,
      onlineTotal,
      zonePopulation,
    });
  } catch (err) {
    next(err);
  }
});

// ---------------------------------------------------------------------------
// GET /api/messages — 消息历史（分页）
// Requirements: 8.3
// ---------------------------------------------------------------------------

statusRouter.get('/messages', requireRole('Admin', 'Agent_Player'), (req: Request, res: Response, next: NextFunction) => {
  try {
    const page = req.query['page'] ? parseInt(req.query['page'] as string, 10) : 1;
    const pageSize = req.query['page_size'] ? parseInt(req.query['page_size'] as string, 10) : 20;
    const normalizedPage = Number.isFinite(page) && page > 0 ? page : 1;
    const normalizedPageSize = Number.isFinite(pageSize) && pageSize > 0 ? Math.min(pageSize, 200) : 20;
    const role = req.role;
    const requesterId = req.contestantId;
    if (role !== 'Admin' && !requesterId) {
      return next(httpError(401, 'AUTH_MISSING_KEY', '需要认证'));
    }

    const offset = (normalizedPage - 1) * normalizedPageSize;

    type MessageRow = {
      id: string;
      sender_id: string;
      receiver_ids: string;
      content: string;
      zone_id: string | null;
      timestamp: number;
      type: 'talk' | 'broadcast';
    };

    let rows: MessageRow[];
    let total = 0;

    if (role === 'Admin') {
      rows = db.prepare(`
        SELECT id, sender_id, receiver_ids, content, zone_id, timestamp, 'talk' as type
        FROM talk_messages
        UNION ALL
        SELECT id, sender_id, '[]' as receiver_ids, content, NULL as zone_id, timestamp, 'broadcast' as type
        FROM broadcast_messages
        ORDER BY timestamp DESC
        LIMIT ? OFFSET ?
      `).all(normalizedPageSize, offset) as MessageRow[];

      total = (db.prepare(`
        SELECT
          (SELECT COUNT(*) FROM talk_messages) +
          (SELECT COUNT(*) FROM broadcast_messages) as total
      `).get() as { total: number }).total;
    } else {
      rows = db.prepare(`
        SELECT id, sender_id, receiver_ids, content, zone_id, timestamp, 'talk' as type
        FROM talk_messages
        WHERE sender_id = ? OR INSTR(receiver_ids, '"' || ? || '"') > 0
        UNION ALL
        SELECT id, sender_id, '[]' as receiver_ids, content, NULL as zone_id, timestamp, 'broadcast' as type
        FROM broadcast_messages
        ORDER BY timestamp DESC
        LIMIT ? OFFSET ?
      `).all(requesterId, requesterId, normalizedPageSize, offset) as MessageRow[];

      total = (db.prepare(`
        SELECT
          (SELECT COUNT(*) FROM talk_messages WHERE sender_id = ? OR INSTR(receiver_ids, '"' || ? || '"') > 0) +
          (SELECT COUNT(*) FROM broadcast_messages) as total
      `).get(requesterId, requesterId) as { total: number }).total;
    }

    type TalkItem = {
      id: string;
      type: 'talk';
      senderId: string;
      receiverIds: string[];
      content: string;
      zoneId: string;
      timestamp: number;
    };

    type BroadcastItem = {
      id: string;
      type: 'broadcast';
      senderId: string;
      content: string;
      timestamp: number;
    };

    const messages = rows.map((row): TalkItem | BroadcastItem => {
      if (row.type === 'talk') {
        return {
          id: row.id,
          type: 'talk',
          senderId: row.sender_id,
          receiverIds: JSON.parse(row.receiver_ids) as string[],
          content: row.content,
          zoneId: row.zone_id ?? '',
          timestamp: row.timestamp,
        };
      }

      return {
        id: row.id,
        type: 'broadcast',
        senderId: row.sender_id,
        content: row.content,
        timestamp: row.timestamp,
      };
    });

    const talks = messages.filter((m): m is TalkItem => m.type === 'talk');
    const broadcasts = messages.filter((m): m is BroadcastItem => m.type === 'broadcast');

    res.json({
      messages,
      talks: talks.map((t) => ({
        id: t.id,
        senderId: t.senderId,
        receiverIds: t.receiverIds,
        content: t.content,
        zoneId: t.zoneId,
        timestamp: t.timestamp,
      })),
      broadcasts: broadcasts.map((b) => ({
        id: b.id,
        senderId: b.senderId,
        content: b.content,
        timestamp: b.timestamp,
      })),
      page: normalizedPage,
      pageSize: normalizedPageSize,
      total,
    });
  } catch (err) {
    next(err);
  }
});
