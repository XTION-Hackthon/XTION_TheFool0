/**
 * roomStore — Multi-room state management (Zustand)
 * Requirements: 1, 2, 9
 */

import { create } from 'zustand';

export interface Bot {
  id: string;
  name: string;
  position: { x: number; y: number };
  collisionBox?: { width: number; height: number };
}

export interface Wall {
  id: string;
  roomId: string;
  x: number;
  y: number;
  width: number;
  height: number;
  rotation: number;
}

export interface SpawnPoint {
  id: string;
  roomId: string;
  x: number;
  y: number;
  isAvailable: boolean;
}

export interface Room {
  id: string;
  name: string;
  type: 'MainHall' | 'PrivateRoom';
  capacity: number;
  currentCount: number;
  bots: Bot[];
  walls: Wall[];
  spawnPoints: SpawnPoint[];
  bounds?: { x1: number; y1: number; x2: number; y2: number };
}

export interface RoomState {
  rooms: Record<string, Room>;
  currentRoomId: string | null;

  // Room operations
  createRoom(config: {
    name: string;
    type: 'MainHall' | 'PrivateRoom';
    capacity?: number;
    bounds?: { x1: number; y1: number; x2: number; y2: number };
  }): string;
  deleteRoom(roomId: string): void;
  updateRoom(roomId: string, updates: Partial<Room>): void;
  switchRoom(roomId: string): void;

  // Bot management
  addBotToRoom(roomId: string, bot: Bot): void;
  removeBotFromRoom(roomId: string, botId: string): void;
  updateBotPosition(roomId: string, botId: string, position: { x: number; y: number }): void;

  // Sync from API
  setRooms(rooms: Room[]): void;
  setCurrentRoom(roomId: string): void;
}

let _roomIdCounter = 0;
function generateRoomId(): string {
  return `room_${Date.now()}_${++_roomIdCounter}`;
}

export const useRoomStore = create<RoomState>((set) => ({
  rooms: {},
  currentRoomId: null,

  createRoom: (config) => {
    const id = generateRoomId();
    const room: Room = {
      id,
      name: config.name,
      type: config.type,
      capacity: config.capacity ?? (config.type === 'MainHall' ? Infinity : 2),
      currentCount: 0,
      bots: [],
      walls: [],
      spawnPoints: [],
      ...(config.bounds ? { bounds: config.bounds } : {}),
    };
    set((state) => ({
      rooms: { ...state.rooms, [id]: room },
    }));
    return id;
  },

  deleteRoom: (roomId) =>
    set((state) => {
      const { [roomId]: _removed, ...rest } = state.rooms;
      return {
        rooms: rest,
        currentRoomId: state.currentRoomId === roomId ? null : state.currentRoomId,
      };
    }),

  updateRoom: (roomId, updates) =>
    set((state) => {
      const existing = state.rooms[roomId];
      if (!existing) return {};
      return {
        rooms: {
          ...state.rooms,
          [roomId]: { ...existing, ...updates },
        },
      };
    }),

  switchRoom: (roomId) =>
    set((state) => {
      if (!state.rooms[roomId]) return {};
      return { currentRoomId: roomId };
    }),

  addBotToRoom: (roomId, bot) =>
    set((state) => {
      const room = state.rooms[roomId];
      if (!room) return {};
      // Prevent duplicate bots
      if (room.bots.some((b) => b.id === bot.id)) return {};
      return {
        rooms: {
          ...state.rooms,
          [roomId]: {
            ...room,
            bots: [...room.bots, bot],
            currentCount: room.currentCount + 1,
          },
        },
      };
    }),

  removeBotFromRoom: (roomId, botId) =>
    set((state) => {
      const room = state.rooms[roomId];
      if (!room) return {};
      const filtered = room.bots.filter((b) => b.id !== botId);
      if (filtered.length === room.bots.length) return {};
      return {
        rooms: {
          ...state.rooms,
          [roomId]: {
            ...room,
            bots: filtered,
            currentCount: Math.max(0, room.currentCount - 1),
          },
        },
      };
    }),

  updateBotPosition: (roomId, botId, position) =>
    set((state) => {
      const room = state.rooms[roomId];
      if (!room) return {};
      const botIndex = room.bots.findIndex((b) => b.id === botId);
      if (botIndex === -1) return {};
      const updatedBots = [...room.bots];
      updatedBots[botIndex] = { ...updatedBots[botIndex], position };
      return {
        rooms: {
          ...state.rooms,
          [roomId]: { ...room, bots: updatedBots },
        },
      };
    }),

  setRooms: (rooms) =>
    set(() => ({
      rooms: Object.fromEntries(
        rooms.map((r) => [
          r.id,
          {
            ...r,
            bots: r.bots ?? [],
            walls: r.walls ?? [],
            spawnPoints: r.spawnPoints ?? [],
          },
        ])
      ),
    })),

  setCurrentRoom: (roomId) => set({ currentRoomId: roomId }),
}));
