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
import { locationManager } from './modules/location-manager';
import { phaseManager } from './modules/phase-manager';
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
  // 在地图中间区域随机生成出生点
  const centerX = (zone.x1 + zone.x2) / 2;
  const centerY = (zone.y1 + zone.y2) / 2;
  const rangeX = (zone.x2 - zone.x1) * 0.3; // 中间60%区域
  const rangeY = (zone.y2 - zone.y1) * 0.3;
  return {
    x: centerX + (Math.random() * 2 - 1) * rangeX,
    y: centerY + (Math.random() * 2 - 1) * rangeY,
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

/**
 * Forcefully disconnect a contestant by id.
 * Closes the WebSocket, removes from connections map, cancels any pending
 * offline timer, unregisters heartbeat, marks the contestant offline in DB,
 * and broadcasts a leave event.
 * Called by auth-manager when a key is revoked (Requirement 9).
 */
export function disconnectContestant(contestantId: string): void {
  // Cancel any pending offline timer
  const timer = disconnectTimers.get(contestantId);
  if (timer) {
    clearTimeout(timer);
    disconnectTimers.delete(contestantId);
  }

  // Close WebSocket if connected
  const ws = connections.get(contestantId);
  if (ws) {
    try {
      ws.close(1008, 'KEY_REVOKED');
    } catch {
      // ignore close errors on already-closed sockets
    }
    connections.delete(contestantId);
  }

  // Task 6.5: Release location slot after removing from connections
  locationManager.releaseSlot(contestantId);

  // Unregister from heartbeat monitor
  heartbeatMonitor.unregister(contestantId);

  // Mark offline in DB
  markContestantOffline(contestantId);

  // Notify remaining contestants
  broadcast(
    {
      type: 'contestant.leave',
      payload: { id: contestantId, status: 'offline' },
      timestamp: Date.now(),
    },
  );
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

  // Admin connects as a read-only observer — same as Agent_Viewer but no audience slot
  if (role === 'Admin') {
    const zones = getAllZones();
    const mapDims = getMapDimensions();
    const onlineContestants = getAllOnlineContestants();

    sendEvent(ws, {
      type: 'world.state',
      payload: {
        map: { width: mapDims.width, height: mapDims.height, zones },
        contestants: onlineContestants.map((c) => ({
          id: c.id, name: c.name, position: c.position, zone: c.currentZoneId, status: c.status,
        })),
      },
      timestamp: Date.now(),
    });

    // Register admin connection for subsequent broadcasts
    const adminConnId = `admin-${keyId}`;
    client.contestantId = adminConnId;
    connections.set(adminConnId, ws);
    return;
  }

  // Get default zone (still needed for DB zone reference)
  const defaultZone = getDefaultZone();
  if (!defaultZone) {
    sendError(ws, 'SYS_NO_ZONE', '系统未配置任何 Zone，请联系管理员');
    ws.close(1011, 'SYS_NO_ZONE');
    return;
  }

  // Determine contestant name: use provided name or fall back to key's contestantName
  const keyRow = db.prepare('SELECT contestant_name FROM keys WHERE id = ?').get(keyId) as { contestant_name: string } | undefined;
  const contestantName = name ?? keyRow?.contestant_name ?? 'Unknown';

  // Agent_Viewer: allow connection and push world.state, then register for subsequent broadcasts
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

    // Register viewer connection for subsequent broadcasts (Bug 3 fix)
    const viewerId = `viewer-${keyId}`;
    client.contestantId = viewerId;
    connections.set(viewerId, ws);

    // Task 6.2: Assign audience slot for Agent_Viewer
    try {
      locationManager.assignAudienceSlot(viewerId);
    } catch (err: unknown) {
      const e = err as { code?: string };
      if (e.code === 'AUDIENCE_FULL') {
        sendError(ws, 'AUDIENCE_FULL', '观众席已满，无法连接');
        ws.close(1008, 'AUDIENCE_FULL');
        connections.delete(viewerId);
        client.contestantId = null;
        return;
      }
      throw err;
    }

    return;
  }

  // Task 6.1: Assign lobby slot BEFORE upsertContestant so position is correct.
  // Look up existing contestant id (or generate a new one) to assign the slot first.
  const existingRow = db.prepare('SELECT id FROM contestants WHERE key_id = ?').get(keyId) as { id: string } | undefined;
  const preAssignId = existingRow?.id ?? uuidv4();

  let initialPosition: Position;
  try {
    initialPosition = locationManager.assignLobbySlot(preAssignId);
  } catch (err: unknown) {
    const e = err as { code?: string };
    if (e.code === 'LOBBY_FULL') {
      sendError(ws, 'LOBBY_FULL', '大厅已满，无法连接');
      ws.close(1008, 'LOBBY_FULL');
      return;
    }
    throw err;
  }

  // Register/update contestant in DB with the correct lobby slot position.
  // upsertContestant uses the same id for existing contestants; for new ones it generates
  // a new UUID — but since we pre-looked up the id above, preAssignId matches existing.id
  // or is a fresh UUID that upsertContestant will also use (we pass it via the insert path).
  // For new contestants, we insert directly with preAssignId to keep ids in sync.
  let contestant: Contestant;
  if (existingRow) {
    contestant = upsertContestant(keyId, contestantName, initialPosition, defaultZone.id);
  } else {
    // Insert new contestant with the pre-assigned id so it matches the lobby slot
    const now = Date.now();
    db.prepare(`
      INSERT INTO contestants (id, key_id, name, status, position_x, position_y, current_zone_id, energy, installed_skills, attributes, connected_at)
      VALUES (?, ?, ?, 'online', ?, ?, ?, 100, '[]', '{}', ?)
    `).run(preAssignId, keyId, contestantName, initialPosition.x, initialPosition.y, defaultZone.id, now);
    contestant = {
      id: preAssignId,
      keyId,
      name: contestantName,
      status: 'online',
      position: initialPosition,
      currentZoneId: defaultZone.id,
      energy: 100,
      installedSkills: [],
      attributes: {},
      connectedAt: now,
    };
  }

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

  // Task 6.3: Push current phase to newly connected contestant (Requirement 13.6)
  phaseManager.pushCurrentPhaseToAgent(contestant.id).catch((err: unknown) => {
    console.error('[WS] pushCurrentPhaseToAgent error:', err);
  });
}

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------

export function setupWebSocket(server: http.Server): WebSocketServer {
  // Clean up stale online/timeout contestants on server startup
  // (all connections are lost when server restarts)
  console.log('[WS] Cleaning up stale online contestants from previous session...');
  const staleCount = db.prepare(`
    UPDATE contestants SET status = 'offline', disconnected_at = ? WHERE status IN ('online', 'timeout')
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
        // Task 6.4: Get location state BEFORE releasing (releaseSlot removes the state)
        const locationState = locationManager.getState(client.contestantId);

        // Task 6.4: Determine partner BEFORE releasing (releaseSlot clears room occupancy)
        let partnerId: string | null = null;
        if (locationState && locationState.locationState !== 'lobby') {
          const roomMatch = locationState.locationState.match(/^room_(\d+)$/);
          if (roomMatch) {
            const roomId = parseInt(roomMatch[1], 10);
            const occupancy = locationManager.getRoomOccupancy(roomId);
            // Partner is whichever slot is NOT the disconnecting agent
            if (occupancy.slotA === client.contestantId) {
              partnerId = occupancy.slotB;
            } else if (occupancy.slotB === client.contestantId) {
              partnerId = occupancy.slotA;
            }
          }
        }

        connections.delete(client.contestantId);
        heartbeatMonitor.unregister(client.contestantId);

        // Task 6.4: Release the slot after removing from connections
        locationManager.releaseSlot(client.contestantId);

        // Task 6.4: If agent was in a room, notify the partner
        if (locationState && locationState.locationState !== 'lobby' && partnerId) {
          const roomMatch = locationState.locationState.match(/^room_(\d+)$/);
          if (roomMatch) {
            const roomId = parseInt(roomMatch[1], 10);
            const partnerWs = connections.get(partnerId);
            if (partnerWs) {
              sendEvent(partnerWs, {
                type: 'room.partner_left',
                payload: { room_id: roomId, contestant_id: client.contestantId },
                timestamp: Date.now(),
              });
            }
          }
        }

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
    try {
      ws.send(JSON.stringify(event));
    } catch (err) {
      console.error('[WS] sendEvent error:', err);
    }
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
  const key = (event as { payload?: { zoneId?: string } }).payload && typeof (event as { payload?: { zoneId?: string } }).payload === 'object'
    ? ((event as { payload: { zoneId?: string } }).payload.zoneId ?? '__global__')
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

// Delta compression: track last sent zone state per zoneId
const _lastZoneState: Map<string, string> = new Map();

/**
 * Broadcast collision event immediately (latency-sensitive).
 * Requirements: 3, 4, 5, 10
 */
export function broadcastCollisionEvent(
  zoneId: string,
  botId: string,
  collisionType: 'bot' | 'wall',
  targetId: string | undefined,
  position: { x: number; y: number },
): void {
  broadcast({
    type: 'collision.event',
    payload: { zoneId, botId, collisionType, targetId, position },
    timestamp: Date.now(),
  });
}

/**
 * Broadcast only the changed bot position (incremental sync).
 * Requirements: 6
 */
export function broadcastBotPositionDelta(
  zoneId: string,
  botId: string,
  position: { x: number; y: number },
): void {
  broadcast({
    type: 'zone.bot_position',
    payload: { zoneId, botId, position },
    timestamp: Date.now(),
  });
}
