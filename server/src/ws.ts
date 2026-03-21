// =============================================================================
// XTION_TheFool0 — WebSocket 服务器
// Requirements: 1.3, 1.4, 1.5, 1.7, 1.8, 8.4
// =============================================================================

import { WebSocketServer, type WebSocket } from 'ws';
import type { IncomingMessage } from 'http';
import type * as http from 'http';
import { v4 as uuidv4 } from 'uuid';
import { db } from './db';
import { authManager } from './modules/auth-manager';
import { docDistributor } from './modules/doc-distributor';
import { heartbeatMonitor } from './modules/heartbeat-monitor';
import type { ClientMessage, ServerEvent, Contestant, Position, Zone, Role } from './types/index';

// ---------------------------------------------------------------------------
// Connection registry — contestantId → WebSocket
// ---------------------------------------------------------------------------

export const connections = new Map<string, WebSocket>();
export const observerConnections = new Set<WebSocket>();

// Disconnect timers — contestantId → NodeJS.Timeout
const disconnectTimers = new Map<string, ReturnType<typeof setTimeout>>();

// ---------------------------------------------------------------------------
// Client connection context
// ---------------------------------------------------------------------------

export interface ClientContext {
  ws: WebSocket;
  contestantId: string | null;
  role: Role | null;
}

// ---------------------------------------------------------------------------
// DB helpers
// ---------------------------------------------------------------------------

interface ZoneRow {
  id: string;
  name: string;
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  zone_type_id: string;
}

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

function getDefaultZone(): ZoneRow | null {
  // Prefer zt-social zone, fallback to first zone
  const zone = db.prepare(`
    SELECT id, name, x1, y1, x2, y2, zone_type_id FROM zones
    WHERE zone_type_id = 'zt-social'
    LIMIT 1
  `).get() as ZoneRow | undefined;

  if (zone) return zone;

  return db.prepare(`
    SELECT id, name, x1, y1, x2, y2, zone_type_id FROM zones LIMIT 1
  `).get() as ZoneRow | null;
}

function getZoneCenterPosition(zone: ZoneRow): Position {
  return {
    x: (zone.x1 + zone.x2) / 2,
    y: (zone.y1 + zone.y2) / 2,
  };
}

function upsertContestant(keyId: string, name: string, position: Position, zoneId: string): Contestant {
  const now = Date.now();

  // Check if contestant already exists for this key
  const existing = db.prepare(`
    SELECT * FROM contestants WHERE key_id = ?
  `).get(keyId) as ContestantRow | undefined;

  if (existing) {
    // Update existing contestant to online
    db.prepare(`
      UPDATE contestants
      SET status = 'online', position_x = ?, position_y = ?, current_zone_id = ?, connected_at = ?, disconnected_at = NULL
      WHERE key_id = ?
    `).run(position.x, position.y, zoneId, now, keyId);

    return {
      id: existing.id,
      keyId,
      name: existing.name,
      status: 'online',
      position,
      currentZoneId: zoneId,
      energy: existing.energy,
      installedSkills: JSON.parse(existing.installed_skills) as string[],
      attributes: JSON.parse(existing.attributes) as Record<string, unknown>,
      connectedAt: now,
    };
  }

  // Create new contestant
  const id = uuidv4();
  db.prepare(`
    INSERT INTO contestants (id, key_id, name, status, position_x, position_y, current_zone_id, energy, installed_skills, attributes, connected_at)
    VALUES (?, ?, ?, 'online', ?, ?, ?, 100, '[]', '{}', ?)
  `).run(id, keyId, name, position.x, position.y, zoneId, now);

  return {
    id,
    keyId,
    name,
    status: 'online',
    position,
    currentZoneId: zoneId,
    energy: 100,
    installedSkills: [],
    attributes: {},
    connectedAt: now,
  };
}

function markContestantOffline(contestantId: string): void {
  const now = Date.now();
  db.prepare(`
    UPDATE contestants SET status = 'offline', disconnected_at = ? WHERE id = ?
  `).run(now, contestantId);
}

function getAllOnlineContestants(): Contestant[] {
  const rows = db.prepare(`
    SELECT * FROM contestants WHERE status = 'online'
  `).all() as ContestantRow[];

  return rows.map(rowToContestant);
}

function rowToContestant(row: ContestantRow): Contestant {
  return {
    id: row.id,
    keyId: row.key_id,
    name: row.name,
    status: row.status as Contestant['status'],
    position: { x: row.position_x, y: row.position_y },
    currentZoneId: row.current_zone_id,
    energy: row.energy,
    installedSkills: JSON.parse(row.installed_skills) as string[],
    attributes: JSON.parse(row.attributes) as Record<string, unknown>,
    ...(row.connected_at != null ? { connectedAt: row.connected_at } : {}),
    ...(row.disconnected_at != null ? { disconnectedAt: row.disconnected_at } : {}),
  };
}

function getHeartbeatSummary(contestantId: string) {
  const latest = heartbeatMonitor.getHistory(contestantId, 1)[0];
  return {
    healthStatus: heartbeatMonitor.getHealthStatus(contestantId),
    lastTimestamp: latest?.timestamp ?? null,
    cpuLoad: latest?.payload.cpuLoad ?? null,
    memoryUsage: latest?.payload.memoryUsage ?? null,
    responseLatency: latest?.payload.responseLatency ?? null,
  };
}

function buildContestantPayload(contestant: Contestant) {
  return {
    id: contestant.id,
    name: contestant.name,
    position: contestant.position,
    zone: contestant.currentZoneId,
    status: contestant.status,
    energy: contestant.energy,
    attributes: {
      ...contestant.attributes,
      heartbeat: getHeartbeatSummary(contestant.id),
    },
  };
}

function getAllZones(): Zone[] {
  const rows = db.prepare(`
    SELECT id, name, x1, y1, x2, y2, zone_type_id, fill_color, border_color, opacity, icon, access_restriction
    FROM zones
  `).all() as Array<{
    id: string; name: string; x1: number; y1: number; x2: number; y2: number;
    zone_type_id: string; fill_color: string; border_color: string; opacity: number;
    icon: string | null; access_restriction: string | null;
  }>;

  return rows.map((r) => ({
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
  }));
}

function getMapDimensions(): { width: number; height: number } {
  // Derive map dimensions from the bounding box of all zones
  const result = db.prepare(`
    SELECT MAX(x2) as width, MAX(y2) as height FROM zones
  `).get() as { width: number | null; height: number | null };

  return {
    width: result.width ?? 1000,
    height: result.height ?? 800,
  };
}

// ---------------------------------------------------------------------------
// Auth handler
// ---------------------------------------------------------------------------

async function handleAuth(
  client: ClientContext,
  payload: { key: string; name?: string },
  registerContestant: (id: string) => void,
): Promise<void> {
  const ws = client.ws;
  const { key, name } = payload;

  // Validate key
  const result = await authManager.validateKey(key);
  if (!result.valid || !result.keyId) {
    sendError(ws, 'AUTH_INVALID_KEY', 'Key 无效或已被吊销');
    ws.close(1008, 'AUTH_INVALID_KEY');
    return;
  }

  const keyId = result.keyId;
  const role: Role = result.role ?? 'Agent_Player';

  // Store role in connection context
  client.role = role;

  // Human_Viewer is not allowed to connect via WebSocket
  if (role === 'Human_Viewer') {
    sendError(ws, 'AUTH_ROLE_NOT_ALLOWED', '人类观众角色不允许建立 WebSocket 连接');
    ws.close(1008, 'AUTH_ROLE_NOT_ALLOWED');
    return;
  }

  // Get default zone and compute initial position
  const defaultZone = getDefaultZone();
  if (!defaultZone) {
    sendError(ws, 'SYS_NO_ZONE', '系统未配置任何 Zone，请联系管理员');
    ws.close(1011, 'SYS_NO_ZONE');
    return;
  }

  const initialPosition = getZoneCenterPosition(defaultZone);

  // Determine contestant name: use provided name or fall back to key's contestantName
  const keyRow = db.prepare('SELECT contestant_name FROM keys WHERE id = ?').get(keyId) as { contestant_name: string } | undefined;
  const contestantName = name ?? keyRow?.contestant_name ?? 'Unknown';

  // Agent_Viewer: allow connection and push world.state, but mark as read-only (no contestant registration)
  if (role === 'Agent_Viewer') {
    observerConnections.add(ws);
    const zones = getAllZones();
    const mapDims = getMapDimensions();
    const onlineContestants = getAllOnlineContestants();

    const worldStatePayload = {
      map: {
        width: mapDims.width,
        height: mapDims.height,
        zones,
      },
      contestants: onlineContestants.map(buildContestantPayload),
    };

    sendEvent(ws, {
      type: 'world.state',
      payload: worldStatePayload,
      timestamp: Date.now(),
    });
    return;
  }

  // Register/update contestant in DB
  const contestant = upsertContestant(keyId, contestantName, initialPosition, defaultZone.id);

  // Cancel any pending offline timer for this contestant (reconnect scenario)
  const existingTimer = disconnectTimers.get(contestant.id);
  if (existingTimer) {
    clearTimeout(existingTimer);
    disconnectTimers.delete(contestant.id);
  }

  // Register connection
  registerContestant(contestant.id);

  // Build world.state payload
  const zones = getAllZones();
  const mapDims = getMapDimensions();
  const onlineContestants = getAllOnlineContestants();

  const worldStatePayload = {
    map: {
      width: mapDims.width,
      height: mapDims.height,
      zones,
    },
    contestants: onlineContestants.map(buildContestantPayload),
    self: buildContestantPayload(contestant),
  };

  sendEvent(ws, {
    type: 'world.state',
    payload: worldStatePayload,
    timestamp: Date.now(),
  });

  // Notify other online contestants that this contestant joined
  broadcast(
    {
      type: 'contestant.join',
      payload: {
        ...buildContestantPayload(contestant),
      },
      timestamp: Date.now(),
    },
    contestant.id,
  );

  // Register contestant with heartbeat monitor (P0-1 fix)
  heartbeatMonitor.register(contestant.id);

  // Push mandatory documents to newly connected contestant (Requirements: 9.2, 12.3)
  docDistributor.pushMandatoryDocuments(contestant.id).catch((err: unknown) => {
    console.error('[WS] pushMandatoryDocuments error:', err);
  });
}

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------

export function setupWebSocket(server: http.Server): WebSocketServer {
  const wss = new WebSocketServer({ server, path: '/ws' });

  wss.on('connection', (ws: WebSocket, _req: IncomingMessage) => {
    const client: ClientContext = { ws, contestantId: null, role: null };

    ws.on('message', (raw) => {
      let msg: ClientMessage;
      try {
        msg = JSON.parse(raw.toString()) as ClientMessage;
      } catch {
        sendError(ws, 'SYS_INVALID_JSON', '消息格式错误，需要 JSON');
        return;
      }

      handleMessage(client, msg, (id) => {
        client.contestantId = id;
        connections.set(id, ws);
      });
    });

    ws.on('close', () => {
      if (client.role === 'Agent_Viewer') {
        observerConnections.delete(ws);
      }

      if (client.contestantId) {
        connections.delete(client.contestantId);
        heartbeatMonitor.unregister(client.contestantId);

        const idToMark = client.contestantId;

        // Schedule offline marking after 5 seconds, preserving position
        const timer = setTimeout(() => {
          markContestantOffline(idToMark);
          disconnectTimers.delete(idToMark);

          // Notify remaining online contestants
          broadcast(
            {
              type: 'contestant.leave',
              payload: { id: idToMark, status: 'offline' },
              timestamp: Date.now(),
            },
          );
        }, 5000);

        disconnectTimers.set(idToMark, timer);
      }
    });

    ws.on('error', (err) => {
      console.error('[WS] socket error:', err.message);
    });
  });

  wss.on('error', (err) => {
    console.error('[WS] server error:', err.message);
  });

  return wss;
}

// ---------------------------------------------------------------------------
// Message routing
// ---------------------------------------------------------------------------

// Game command types that Agent_Viewer is not allowed to send
const GAME_COMMAND_TYPES = new Set(['move', 'talk', 'broadcast', 'heartbeat']);

export function handleMessage(
  client: ClientContext,
  msg: ClientMessage,
  registerContestant: (id: string) => void,
): void {
  const ws = client.ws;

  // Agent_Viewer: intercept game command messages and return error
  if (client.role === 'Agent_Viewer' && GAME_COMMAND_TYPES.has(msg.type)) {
    sendError(ws, 'FORBIDDEN_ROLE', '观察者角色不能发送游戏指令');
    return;
  }

  switch (msg.type) {
    case 'ping':
      sendEvent(ws, { type: 'pong', payload: {}, timestamp: Date.now() });
      break;

    case 'auth': {
      const payload = msg.payload as { key: string; name?: string };
      if (!payload?.key) {
        sendError(ws, 'AUTH_MISSING_KEY', '认证消息缺少 key 字段');
        return;
      }
      handleAuth(client, payload, registerContestant).catch((err: unknown) => {
        console.error('[WS] auth error:', err);
        sendError(ws, 'SYS_INTERNAL', '认证过程发生内部错误');
        ws.close(1011, 'SYS_INTERNAL');
      });
      break;
    }

    default:
      // Unknown message types are silently ignored until handlers are registered
      break;
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

export function sendEvent(ws: WebSocket, event: ServerEvent): void {
  if (ws.readyState === ws.OPEN) {
    ws.send(JSON.stringify(event));
  }
}

export function broadcastToObservers(event: ServerEvent): void {
  for (const ws of observerConnections) {
    sendEvent(ws, event);
  }
}

export function broadcast(event: ServerEvent, exclude?: string): void {
  for (const [id, ws] of connections) {
    if (exclude && id === exclude) continue;
    sendEvent(ws, event);
  }
  broadcastToObservers(event);
}

function sendError(ws: WebSocket, code: string, message: string): void {
  sendEvent(ws, {
    type: 'error',
    payload: { error: { code, message } },
    timestamp: Date.now(),
  });
}
