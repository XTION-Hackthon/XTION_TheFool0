/**
 * Store initialization — subscribes wsClient events to Zustand stores.
 * Call `initStores()` once at app startup (e.g. in main.tsx).
 *
 * Requirements: 6 (前端状态管理), 8.4, 8.5
 */

import { wsClient } from '../services/ws-client';
import { useGameStore } from './gameStore';
import { useMessageStore } from './messageStore';
import { useUiStore } from './uiStore';
import { useRoomStore } from './roomStore';
import { useCollisionStore } from './collisionStore';
import { useDoorwayStore } from './doorwayStore';
import type { Doorway } from './doorwayStore';
import { apiClient } from '../services/api-client';
import type { Contestant, Zone, TalkMessage, BroadcastMessage, BarrageMessage, GameMap } from '../../../server/src/types/index';

export { useGameStore } from './gameStore';
export { useMessageStore } from './messageStore';
export { useUiStore } from './uiStore';
export { useRoleStore } from './roleStore';
export type { Role } from './roleStore';
export { useRoomStore } from './roomStore';
export type { Room, Bot, Wall, SpawnPoint } from './roomStore';
export { useCollisionStore } from './collisionStore';
export type { CollisionBox, CollisionEvent, SpatialGrid } from './collisionStore';
export { useEditorStore } from './editorStore';
export type { EditorState } from './editorStore';
export { useDoorwayStore } from './doorwayStore';
export type { Doorway } from './doorwayStore';

let initialized = false;

/**
 * Normalize a partial contestant payload from the server into a full Contestant object.
 * The server sends a condensed shape for contestant.join / world.state contestants.
 */
function normalizeContestant(raw: Record<string, unknown>): Contestant {
  return {
    id: raw.id as string,
    keyId: (raw.keyId as string) ?? '',
    name: raw.name as string,
    status: (raw.status as Contestant['status']) ?? 'online',
    position: (raw.position as { x: number; y: number }) ?? { x: 0, y: 0 },
    currentZoneId: (raw.zone as string | null) ?? (raw.currentZoneId as string | null) ?? null,
    energy: (raw.energy as number) ?? 100,
    installedSkills: (raw.installedSkills as string[]) ?? [],
    attributes: (raw.attributes as Record<string, unknown>) ?? {},
    ...(raw.connectedAt != null ? { connectedAt: raw.connectedAt as number } : {}),
    ...(raw.disconnectedAt != null ? { disconnectedAt: raw.disconnectedAt as number } : {}),
  };
}

/**
 * Normalize the world.state payload from the server.
 *
 * Server sends:
 *   { map: { width, height, zones }, contestants: [...], self: {...} }
 *
 * Store expects:
 *   { map: GameMap, zones: Zone[], contestants: Contestant[], selfId? }
 */
function normalizeWorldState(raw: Record<string, unknown>): {
  map: GameMap;
  zones: Zone[];
  contestants: Contestant[];
  selfId?: string;
} {
  // Server may embed zones inside map or at top level
  const rawMap = raw.map as Record<string, unknown>;
  const zonesFromMap = (rawMap?.zones as Zone[] | undefined) ?? [];
  const zonesTopLevel = (raw.zones as Zone[] | undefined) ?? [];
  const zones: Zone[] = zonesTopLevel.length > 0 ? zonesTopLevel : zonesFromMap;

  const map: GameMap = {
    width: (rawMap?.width as number) ?? 1600,
    height: (rawMap?.height as number) ?? 900,
    defaultZoneId: (rawMap?.defaultZoneId as string) ?? (zones[0]?.id ?? ''),
    zones,
    ...(rawMap?.backgroundImage ? { backgroundImage: rawMap.backgroundImage as string } : {}),
  };

  const rawContestants = (raw.contestants as Array<Record<string, unknown>>) ?? [];
  const contestants = rawContestants.map(normalizeContestant);

  // Include self in contestants list if not already present
  const self = raw.self as Record<string, unknown> | undefined;
  let selfId: string | undefined;
  if (self?.id) {
    selfId = self.id as string;
    if (!contestants.find((c) => c.id === selfId)) {
      contestants.push(normalizeContestant(self));
    }
  }

  return { map, zones, contestants, selfId };
}

export function initStores(): void {
  if (initialized) return;
  initialized = true;

  // ── world.state ─────────────────────────────────────────────────────────────
  // Triggered after successful auth; initializes the full game world.
  wsClient.on('world.state', (payload) => {
    const normalized = normalizeWorldState(payload as Record<string, unknown>);
    useGameStore.getState().initWorldState(normalized);
  });

  // ── contestant.join ──────────────────────────────────────────────────────────
  // Server sends condensed shape: { id, name, position, zone, status }
  wsClient.on('contestant.join', (payload) => {
    const contestant = normalizeContestant(payload as Record<string, unknown>);
    useGameStore.getState().addContestant(contestant);
  });

  // ── contestant.leave ─────────────────────────────────────────────────────────
  // Server sends: { id, status }
  wsClient.on('contestant.leave', (payload) => {
    const p = payload as { id: string };
    useGameStore.getState().removeContestant(p.id);
  });

  // ── contestant.move ──────────────────────────────────────────────────────────
  // Server sends: { contestantId, newPosition, newZoneId } (from CoreAPIHandler)
  // or: { id, position, zoneId } (from admin-move)
  wsClient.on('contestant.move', (payload) => {
    const p = payload as {
      id?: string;
      contestantId?: string;
      position?: { x: number; y: number };
      newPosition?: { x: number; y: number };
      zoneId?: string | null;
      newZoneId?: string | null;
    };
    const id = p.id ?? p.contestantId ?? '';
    const position = p.position ?? p.newPosition ?? { x: 0, y: 0 };
    const zoneId = p.zoneId !== undefined ? p.zoneId : (p.newZoneId ?? null);
    if (id) {
      useGameStore.getState().updateContestantPosition(id, position, zoneId);
    }
  });

  // ── contestant.status ────────────────────────────────────────────────────────
  // Server sends: { id, status }
  wsClient.on('contestant.status', (payload) => {
    const p = payload as { id: string; status: Contestant['status'] };
    useGameStore.getState().updateContestantStatus(p.id, p.status);
  });

  // ── talk.message ─────────────────────────────────────────────────────────────
  // Server sends: { messageId, senderId, message, zoneId, timestamp }
  // TalkMessage type expects: { id, senderId, receiverIds, content, zoneId, timestamp }
  wsClient.on('talk.message', (payload) => {
    const p = payload as {
      messageId?: string;
      id?: string;
      senderId: string;
      message?: string;
      content?: string;
      receiverIds?: string[];
      zoneId: string;
      timestamp: number;
    };
    const msg: TalkMessage = {
      id: p.id ?? p.messageId ?? '',
      senderId: p.senderId,
      receiverIds: p.receiverIds ?? [],
      content: p.content ?? p.message ?? '',
      zoneId: p.zoneId,
      timestamp: p.timestamp,
    };
    useMessageStore.getState().addTalkMessage(msg);
  });

  // ── broadcast.message ────────────────────────────────────────────────────────
  // Server sends: { messageId, senderId, message, timestamp }
  // BroadcastMessage type expects: { id, senderId, content, timestamp }
  wsClient.on('broadcast.message', (payload) => {
    const p = payload as {
      messageId?: string;
      id?: string;
      senderId: string;
      message?: string;
      content?: string;
      timestamp: number;
    };
    const msg: BroadcastMessage = {
      id: p.id ?? p.messageId ?? '',
      senderId: p.senderId,
      content: p.content ?? p.message ?? '',
      timestamp: p.timestamp,
    };
    useMessageStore.getState().addBroadcastMessage(msg);
    // Show speech bubble on the sender's sprite
    if (msg.senderId && msg.content) {
      useGameStore.getState().setSpeechBubble(msg.senderId, msg.content, 6000);
    }
  });

  // ── barrage ──────────────────────────────────────────────────────────────────
  wsClient.on('barrage', (payload) => {
    useMessageStore.getState().addBarrageMessage(payload as BarrageMessage);
  });

  // ── vote.update ──────────────────────────────────────────────────────────────
  wsClient.on('vote.update', (payload) => {
    const p = payload as { contestantId: string; likes: number; dislikes: number };
    useGameStore.getState().updateVotes(p.contestantId, p.likes, p.dislikes);
  });

  // ── energy.update ────────────────────────────────────────────────────────────
  wsClient.on('energy.update', (payload) => {
    const p = payload as { contestantId: string; energy: number };
    useGameStore.getState().updateEnergy(p.contestantId, p.energy);
  });

  // ── zone.rule.update ─────────────────────────────────────────────────────────
  // Server sends: { zoneId, zoneName, zoneTypeId, rule } (from CoreAPIHandler)
  // or: { zone: Zone } (from admin zone updates)
  wsClient.on('zone.rule.update', (payload) => {
    const p = payload as {
      zone?: Zone;
      zoneId?: string;
      zoneName?: string;
      zoneTypeId?: string;
      rule?: unknown;
    };
    if (p.zone) {
      useGameStore.getState().updateZone(p.zone);
    } else if (p.zoneId) {
      // Partial zone update — update the zone in the store with new rule info
      const existingZone = useGameStore.getState().zones.get(p.zoneId);
      if (existingZone) {
        useGameStore.getState().updateZone({
          ...existingZone,
          ...(p.zoneName ? { name: p.zoneName } : {}),
          ...(p.zoneTypeId ? { zoneTypeId: p.zoneTypeId } : {}),
        });
      }
    }
  });

  // ── doc.update ───────────────────────────────────────────────────────────────
  wsClient.on('doc.update', (payload, timestamp) => {
    const p = payload as { docName: string };
    useUiStore.getState().addDocUpdateNotification({ docName: p.docName, timestamp });
  });

  // ── alert.heartbeat ──────────────────────────────────────────────────────────
  // Server sends: { id: contestantId, status: 'timeout'|'offline' }
  wsClient.on('alert.heartbeat', (payload, timestamp) => {
    const p = payload as { id?: string; contestantId?: string; status: 'timeout' | 'offline' };
    const contestantId = p.contestantId ?? p.id ?? '';
    if (!contestantId) return;
    useUiStore.getState().addHeartbeatAlert({ contestantId, status: p.status, timestamp });
    // Also update contestant status in game store
    useGameStore.getState().updateContestantStatus(contestantId, p.status);
  });

  // ── Connection state sync ────────────────────────────────────────────────────
  wsClient.onConnect(() => {
    useGameStore.getState().setConnected(true);

    // Fetch rooms from API on connection to populate roomStore
    apiClient.get<Array<{ id: string; name: string; type: 'MainHall' | 'PrivateRoom'; capacity: number; currentCount: number; bots: Array<{ botId: string; positionX: number; positionY: number }>; bounds?: { x1: number; y1: number; x2: number; y2: number } }>>('/api/rooms')
      .then((rooms) => {
        const mapped = rooms.map((r) => ({
          id: r.id,
          name: r.name,
          type: r.type,
          capacity: r.capacity,
          currentCount: r.currentCount ?? 0,
          bots: (r.bots ?? []).map((b: { botId: string; positionX: number; positionY: number }) => ({
            id: b.botId,
            name: b.botId,
            position: { x: b.positionX ?? 0, y: b.positionY ?? 0 },
          })),
          walls: [],
          spawnPoints: [],
          ...(r.bounds ? { bounds: r.bounds } : {}),
        }));
        useRoomStore.getState().setRooms(mapped);

        // Auto-select MainHall as current room
        const mainHall = mapped.find((r) => r.type === 'MainHall');
        if (mainHall) {
          useRoomStore.getState().setCurrentRoom(mainHall.id);
          useGameStore.getState().setCurrentRoomId(mainHall.id);
        }
      })
      .catch((err) => {
        console.error('[initStores] Failed to fetch rooms:', err);
      });
  });
  wsClient.onDisconnect(() => {
    // Reset world state on disconnect so stale contestants/zones don't persist
    useGameStore.getState().reset();
  });

  // ── room.botJoined — bot joined a room ──────────────────────────────────────
  wsClient.on('room.bot_joined', (payload) => {
    const p = payload as { roomId: string; botId: string; botName: string; position: { x: number; y: number } };
    useRoomStore.getState().addBotToRoom(p.roomId, {
      id: p.botId,
      name: p.botName || p.botId,
      position: p.position ?? { x: 0, y: 0 },
    });
  });

  // ── room.bot_left — bot left a room ─────────────────────────────────────────
  wsClient.on('room.bot_left', (payload) => {
    const p = payload as { roomId: string; botId: string };
    useRoomStore.getState().removeBotFromRoom(p.roomId, p.botId);
  });

  // ── room.capacity — room capacity update ────────────────────────────────────
  wsClient.on('room.capacity', (payload) => {
    const p = payload as { roomId: string; currentCount: number; capacity: number };
    useRoomStore.getState().updateRoom(p.roomId, {
      currentCount: p.currentCount,
      capacity: p.capacity,
    });
  });

  // ── collision.event — collision detected ────────────────────────────────────
  wsClient.on('collision.event', (payload) => {
    const p = payload as {
      roomId: string;
      botId: string;
      collisionType: 'bot' | 'wall';
      targetId?: string;
      position: { x: number; y: number };
    };
    useCollisionStore.getState().addCollisionEvent({
      type: p.collisionType === 'bot' ? 'bot-bot' : 'bot-wall',
      botId: p.botId,
      targetId: p.targetId,
      position: p.position,
      timestamp: Date.now(),
    });
  });

  // ── room.spawn_assigned — spawn point assigned ──────────────────────────────
  wsClient.on('room.spawn_assigned', (payload) => {
    const p = payload as {
      roomId: string;
      botId: string;
      spawnPoint: { id: string; x: number; y: number };
    };
    // Update bot position in room store to the assigned spawn point
    useRoomStore.getState().updateBotPosition(p.roomId, p.botId, {
      x: p.spawnPoint.x,
      y: p.spawnPoint.y,
    });
  });

  // ── room.bot_position — incremental bot position update ─────────────────────
  wsClient.on('room.bot_position', (payload) => {
    const p = payload as { roomId: string; botId: string; position: { x: number; y: number } };
    useRoomStore.getState().updateBotPosition(p.roomId, p.botId, p.position);
  });

  // ── batch.events — batched events ───────────────────────────────────────────
  wsClient.on('batch.events', (payload) => {
    const p = payload as { events: Array<{ type: string; payload: unknown; timestamp: number }> };
    if (p.events) {
      for (const event of p.events) {
        // Re-dispatch each batched event through the wsClient event system
        const listeners = (wsClient as unknown as { eventListeners: Map<string, Set<(payload: unknown, timestamp: number) => void>> }).eventListeners?.get(event.type);
        if (listeners) {
          for (const listener of listeners) {
            try {
              listener(event.payload, event.timestamp);
            } catch (err) {
              console.error(`[initStores] batch event dispatch error for "${event.type}":`, err);
            }
          }
        }
      }
    }
  });

  // ── room.membership_changed — bot moved between rooms ───────────────────────
  // Server sends: { botId, previousRoomId, newRoomId, position }
  wsClient.on('room.membership_changed', (payload) => {
    const p = payload as {
      botId: string;
      previousRoomId: string | null;
      newRoomId: string | null;
      position: { x: number; y: number };
    };
    if (p.newRoomId) {
      useGameStore.getState().setCurrentRoomId(p.newRoomId);
    }
    // Update bot position in roomStore for both old and new rooms
    if (p.previousRoomId) {
      useRoomStore.getState().removeBotFromRoom(p.previousRoomId, p.botId);
    }
    if (p.newRoomId) {
      useRoomStore.getState().addBotToRoom(p.newRoomId, {
        id: p.botId,
        name: p.botId,
        position: p.position ?? { x: 0, y: 0 },
      });
    }
  });

  // ── doorway.created — new doorway added ─────────────────────────────────────
  // Server sends: { doorway: Doorway }
  wsClient.on('doorway.created', (payload) => {
    const p = payload as { doorway: Doorway };
    useDoorwayStore.getState().addDoorway(p.doorway);
  });

  // ── doorway.deleted — doorway removed ───────────────────────────────────────
  // Server sends: { doorwayId: string }
  wsClient.on('doorway.deleted', (payload) => {
    const p = payload as { doorwayId: string };
    useDoorwayStore.getState().removeDoorway(p.doorwayId);
  });
}
