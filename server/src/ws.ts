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
import { roomManager } from './modules/room-manager';
import type { ClientMessage, ServerEvent, Contestant, Position, Zone, Role } from './types/index';

// ---------------------------------------------------------------------------
// Connection registry — contestantId → WebSocket
// ---------------------------------------------------------------------------

export const connections = new Map<string, WebSocket>();

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
    const zones = getAllZones();
    const mapDims = getMapDimensions();
    const onlineContestants = getAllOnlineContestants();

    const worldStatePayload = {
      map: {
        width: mapDims.width,
        height: mapDims.height,
        zones,
      },
      contestants: onlineContestants.map((c) => ({
        id: c.id,
        name: c.name,
        position: c.position,
        zone: c.currentZoneId,
        status: c.status,
      })),
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
    contestants: onlineContestants.map((c) => ({
      id: c.id,
      name: c.name,
      position: c.position,
      zone: c.currentZoneId,
      status: c.status,
    })),
    self: {
      id: contestant.id,
      name: contestant.name,
      position: contestant.position,
      zone: contestant.currentZoneId,
      energy: contestant.energy,
      status: contestant.status,
    },
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
        id: contestant.id,
        name: contestant.name,
        position: contestant.position,
        zone: contestant.currentZoneId,
        status: contestant.status,
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
  // Clean up stale online contestants on server startup
  // (all connections are lost when server restarts)
  console.log('[WS] Cleaning up stale online contestants from previous session...');
  const staleCount = db.prepare(`
    UPDATE contestants SET status = 'offline', disconnected_at = ? WHERE status = 'online'
  `).run(Date.now()).changes;
  if (staleCount > 0) {
    console.log(`[WS] Marked ${staleCount} stale contestant(s) as offline`);
  }

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

export function broadcast(event: ServerEvent, exclude?: string): void {
  for (const [id, ws] of connections) {
    if (exclude && id === exclude) continue;
    sendEvent(ws, event);
  }
}

function sendError(ws: WebSocket, code: string, message: string): void {
  sendEvent(ws, {
    type: 'error',
    payload: { error: { code, message } },
    timestamp: Date.now(),
  });
}

// ---------------------------------------------------------------------------
// Room broadcast helpers
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Batch broadcast infrastructure (task 9.4)
// High-frequency events (room capacity, bot join/leave) are queued and flushed
// together after 16ms (one frame) to reduce WebSocket message overhead.
// ---------------------------------------------------------------------------

const _pendingBroadcasts: Map<string, ServerEvent[]> = new Map();
let _batchTimer: ReturnType<typeof setTimeout> | null = null;

/** Queue an event for batched delivery. Schedules a flush after 16ms if not already pending. */
function queueBroadcast(event: ServerEvent): void {
  const key = (event as { payload?: { roomId?: string } }).payload && typeof (event as { payload?: { roomId?: string } }).payload === 'object'
    ? ((event as { payload: { roomId?: string } }).payload.roomId ?? '__global__')
    : '__global__';

  const queue = _pendingBroadcasts.get(key);
  if (queue) {
    queue.push(event);
  } else {
    _pendingBroadcasts.set(key, [event]);
  }

  if (_batchTimer === null) {
    _batchTimer = setTimeout(() => {
      _batchTimer = null;
      const allEvents: ServerEvent[] = [];
      for (const events of _pendingBroadcasts.values()) {
        allEvents.push(...events);
      }
      _pendingBroadcasts.clear();

      if (allEvents.length > 0) {
        broadcast({
          type: 'batch.events',
          payload: { events: allEvents },
          timestamp: Date.now(),
        } as unknown as ServerEvent);
      }
    }, 16);
  }
}

// Delta compression: track last sent room state per roomId
const _lastRoomState: Map<string, string> = new Map();

/**
 * Fetch current room state and broadcast to all connected clients.
 * Uses delta compression — skips broadcast if state hasn't changed.
 * Requirements: 1, 9
 */
export function broadcastRoomState(roomId: string): void {
  try {
    const room = roomManager.getRoom(roomId);
    const bots = roomManager.getRoomBots(roomId);
    const currentCount = roomManager.getCurrentCount(roomId);

    const payload = {
      roomId,
      room,
      bots,
      currentCount,
      capacity: room.capacity,
    };

    const stateJson = JSON.stringify(payload);
    const lastJson = _lastRoomState.get(roomId);

    // Skip broadcast if nothing changed
    if (lastJson === stateJson) return;

    _lastRoomState.set(roomId, stateJson);

    broadcast({
      type: 'room.state',
      payload,
      timestamp: Date.now(),
    });
  } catch (err) {
    console.error('[WS] broadcastRoomState error:', err);
  }
}

/**
 * Broadcast room capacity change — batched for efficiency.
 * Requirements: 2, 9
 */
export function broadcastRoomCapacity(roomId: string, currentCount: number, capacity: number): void {
  queueBroadcast({
    type: 'room.capacity',
    payload: { roomId, currentCount, capacity },
    timestamp: Date.now(),
  });
}

/**
 * Broadcast bot joined event — batched for efficiency.
 * Requirements: 1, 2, 9
 */
export function broadcastBotJoined(
  roomId: string,
  botId: string,
  botName: string,
  position: { x: number; y: number },
): void {
  queueBroadcast({
    type: 'room.bot_joined',
    payload: { roomId, botId, botName, position },
    timestamp: Date.now(),
  });
}

/**
 * Broadcast bot left event — batched for efficiency.
 * Requirements: 1, 2, 9
 */
export function broadcastBotLeft(roomId: string, botId: string): void {
  queueBroadcast({
    type: 'room.bot_left',
    payload: { roomId, botId },
    timestamp: Date.now(),
  });
}

/**
 * Broadcast collision event immediately (latency-sensitive).
 * Requirements: 3, 4, 5, 10
 */
export function broadcastCollisionEvent(
  roomId: string,
  botId: string,
  collisionType: 'bot' | 'wall',
  targetId: string | undefined,
  position: { x: number; y: number },
): void {
  broadcast({
    type: 'collision.event',
    payload: { roomId, botId, collisionType, targetId, position },
    timestamp: Date.now(),
  });
}

/**
 * Push spawn point assignment immediately to a specific bot (latency-sensitive).
 * Requirements: 11
 */
export function pushSpawnPointAssignment(
  botId: string,
  roomId: string,
  spawnPoint: { id: string; x: number; y: number },
): void {
  const ws = connections.get(botId);
  if (ws) {
    sendEvent(ws, {
      type: 'room.spawn_assigned',
      payload: { roomId, botId, spawnPoint },
      timestamp: Date.now(),
    });
  }
}

/**
 * Broadcast only the changed bot position (incremental sync).
 * Call this from the move route instead of broadcastRoomState for position updates.
 * Requirements: 6
 */
export function broadcastBotPositionDelta(
  roomId: string,
  botId: string,
  position: { x: number; y: number },
): void {
  broadcast({
    type: 'room.bot_position',
    payload: { roomId, botId, position },
    timestamp: Date.now(),
  });
}

/**
 * Broadcast room membership change when a bot crosses a doorway.
 * Requirements: 4.5, 4.6
 */
export function broadcastMembershipChanged(
  botId: string,
  previousRoomId: string | null,
  newRoomId: string | null,
  position: { x: number; y: number },
): void {
  broadcast({
    type: 'room.membership_changed',
    payload: { botId, previousRoomId, newRoomId, position },
    timestamp: Date.now(),
  });
}
