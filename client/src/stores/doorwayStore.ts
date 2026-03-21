/**
 * doorwayStore — Doorway state management (Zustand)
 * Requirements: 4.6
 */

import { create } from 'zustand';

export interface Doorway {
  id: string;
  roomAId: string;
  roomBId: string;
  x: number;
  y: number;
  width: number;
  height: number;
  createdAt: string;
}

export interface DoorwayState {
  doorways: Record<string, Doorway>;
  setDoorways(doorways: Doorway[]): void;
  addDoorway(doorway: Doorway): void;
  removeDoorway(doorwayId: string): void;
  getDoorwaysByRoom(roomId: string): Doorway[];
}

export const useDoorwayStore = create<DoorwayState>((set, get) => ({
  doorways: {},

  setDoorways: (doorways) =>
    set(() => ({
      doorways: Object.fromEntries(doorways.map((d) => [d.id, d])),
    })),

  addDoorway: (doorway) =>
    set((state) => ({
      doorways: { ...state.doorways, [doorway.id]: doorway },
    })),

  removeDoorway: (doorwayId) =>
    set((state) => {
      const { [doorwayId]: _removed, ...rest } = state.doorways;
      return { doorways: rest };
    }),

  getDoorwaysByRoom: (roomId) => {
    const { doorways } = get();
    return Object.values(doorways).filter(
      (d) => d.roomAId === roomId || d.roomBId === roomId
    );
  },
}));
