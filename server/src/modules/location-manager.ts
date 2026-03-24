import type { Position, AgentLocationState, LocationState } from '../types/index.js';

// =============================================================================
// Hardcoded coordinate constants
// =============================================================================

// 20 lobby spawn slots
const LOBBY_SLOTS: Position[] = [
  { x: 820, y: 440 }, // Spawn_Slot_1
  { x: 860, y: 440 }, // Spawn_Slot_2
  { x: 900, y: 440 }, // Spawn_Slot_3
  { x: 940, y: 440 }, // Spawn_Slot_4
  { x: 980, y: 440 }, // Spawn_Slot_5
  { x: 820, y: 540 }, // Spawn_Slot_6
  { x: 860, y: 540 }, // Spawn_Slot_7
  { x: 900, y: 540 }, // Spawn_Slot_8
  { x: 940, y: 540 }, // Spawn_Slot_9
  { x: 980, y: 540 }, // Spawn_Slot_10
  { x: 1020, y: 440 }, // Spawn_Slot_11
  { x: 1060, y: 440 }, // Spawn_Slot_12
  { x: 1100, y: 440 }, // Spawn_Slot_13
  { x: 1140, y: 440 }, // Spawn_Slot_14
  { x: 1180, y: 440 }, // Spawn_Slot_15
  { x: 1020, y: 540 }, // Spawn_Slot_16
  { x: 1060, y: 540 }, // Spawn_Slot_17
  { x: 1100, y: 540 }, // Spawn_Slot_18
  { x: 1140, y: 540 }, // Spawn_Slot_19
  { x: 1180, y: 540 }, // Spawn_Slot_20
];

// 8 private rooms, each with [Slot_A, Slot_B]
const ROOM_SLOTS: Record<number, [Position, Position]> = {
  1: [{ x: 340, y: 700 },  { x: 440, y: 700 }],
  2: [{ x: 340, y: 900 },  { x: 440, y: 900 }],   // placeholder coords
  3: [{ x: 340, y: 1100 }, { x: 440, y: 1100 }],  // placeholder coords
  4: [{ x: 640, y: 700 },  { x: 740, y: 700 }],   // placeholder coords
  5: [{ x: 640, y: 900 },  { x: 740, y: 900 }],   // placeholder coords
  6: [{ x: 640, y: 1100 }, { x: 740, y: 1100 }],  // placeholder coords
  7: [{ x: 940, y: 700 },  { x: 1040, y: 700 }],  // placeholder coords
  8: [{ x: 940, y: 900 },  { x: 1040, y: 900 }],  // placeholder coords
};

// 30 audience slots: 6 cols (x: 10-60) × 5 rows (y: 10-50)
const AUDIENCE_SLOTS: Position[] = [10, 20, 30, 40, 50].flatMap(y =>
  [10, 20, 30, 40, 50, 60].map(x => ({ x, y }))
);

// =============================================================================
// LocationManager class
// =============================================================================

class LocationManagerClass {
  // In-memory state
  private agentStates = new Map<string, AgentLocationState>();
  private lobbyOccupied = new Set<number>();       // occupied lobby slot indices
  private audienceOccupied = new Set<number>();    // occupied audience slot indices
  private roomOccupancy = new Map<number, { slotA: string | null; slotB: string | null }>();

  constructor() {
    // Initialize all 8 rooms as empty
    for (let i = 1; i <= 8; i++) {
      this.roomOccupancy.set(i, { slotA: null, slotB: null });
    }
  }

  // ---------------------------------------------------------------------------
  // assignLobbySlot: find first free lobby slot, throw LOBBY_FULL if none
  // ---------------------------------------------------------------------------
  assignLobbySlot(contestantId: string): Position {
    for (let i = 0; i < LOBBY_SLOTS.length; i++) {
      if (!this.lobbyOccupied.has(i)) {
        this.lobbyOccupied.add(i);
        const slot = LOBBY_SLOTS[i];
        this.agentStates.set(contestantId, {
          contestantId,
          locationState: 'lobby',
          slot,
          slotIndex: i,
        });
        return slot;
      }
    }
    const err = new Error('Lobby is full') as Error & { code: string };
    err.code = 'LOBBY_FULL';
    throw err;
  }

  // ---------------------------------------------------------------------------
  // assignAudienceSlot: find first free audience slot, throw AUDIENCE_FULL if none
  // ---------------------------------------------------------------------------
  assignAudienceSlot(viewerId: string): Position {
    for (let i = 0; i < AUDIENCE_SLOTS.length; i++) {
      if (!this.audienceOccupied.has(i)) {
        this.audienceOccupied.add(i);
        const slot = AUDIENCE_SLOTS[i];
        this.agentStates.set(viewerId, {
          contestantId: viewerId,
          locationState: 'lobby', // viewers use lobby state as their base
          slot,
          slotIndex: i,
        });
        return slot;
      }
    }
    const err = new Error('Audience area is full') as Error & { code: string };
    err.code = 'AUDIENCE_FULL';
    throw err;
  }

  // ---------------------------------------------------------------------------
  // releaseSlot: release all slots occupied by this agent
  // ---------------------------------------------------------------------------
  releaseSlot(contestantId: string): void {
    const state = this.agentStates.get(contestantId);
    if (!state) return;

    if (state.locationState === 'lobby') {
      this.lobbyOccupied.delete(state.slotIndex);
    } else {
      // Agent is in a room — determine which room and slot
      const roomId = this._getRoomIdFromState(state.locationState);
      if (roomId !== null) {
        const occupancy = this.roomOccupancy.get(roomId);
        if (occupancy) {
          if (occupancy.slotA === contestantId) occupancy.slotA = null;
          if (occupancy.slotB === contestantId) occupancy.slotB = null;
        }
      }
    }

    this.agentStates.delete(contestantId);
  }

  // ---------------------------------------------------------------------------
  // enterRoom: atomically move both agents into a room
  // ---------------------------------------------------------------------------
  enterRoom(inviterId: string, inviteeId: string, roomId: number): void {
    const slots = ROOM_SLOTS[roomId];
    if (!slots) {
      const err = new Error(`Invalid room id: ${roomId}`) as Error & { code: string };
      err.code = 'INVALID_ROOM';
      throw err;
    }

    const [slotA, slotB] = slots;
    const locationState: LocationState = `room_${roomId}`;

    // Release inviter's lobby slot if present
    const inviterState = this.agentStates.get(inviterId);
    if (inviterState && inviterState.locationState === 'lobby') {
      this.lobbyOccupied.delete(inviterState.slotIndex);
    }

    // Release invitee's lobby slot if present
    const inviteeState = this.agentStates.get(inviteeId);
    if (inviteeState && inviteeState.locationState === 'lobby') {
      this.lobbyOccupied.delete(inviteeState.slotIndex);
    }

    // Assign room slots atomically
    this.roomOccupancy.set(roomId, { slotA: inviterId, slotB: inviteeId });

    this.agentStates.set(inviterId, {
      contestantId: inviterId,
      locationState,
      slot: slotA,
      slotIndex: 0, // 0 = Slot_A
    });

    this.agentStates.set(inviteeId, {
      contestantId: inviteeId,
      locationState,
      slot: slotB,
      slotIndex: 1, // 1 = Slot_B
    });
  }

  // ---------------------------------------------------------------------------
  // leaveRoom: move agent back to lobby, return new lobby coordinates
  // ---------------------------------------------------------------------------
  leaveRoom(contestantId: string): Position {
    const state = this.agentStates.get(contestantId);
    if (!state || state.locationState === 'lobby') {
      const err = new Error('Agent is not in a room') as Error & { code: string };
      err.code = 'AGENT_NOT_IN_ROOM';
      throw err;
    }

    // Release room slot
    const roomId = this._getRoomIdFromState(state.locationState);
    if (roomId !== null) {
      const occupancy = this.roomOccupancy.get(roomId);
      if (occupancy) {
        if (occupancy.slotA === contestantId) occupancy.slotA = null;
        if (occupancy.slotB === contestantId) occupancy.slotB = null;
      }
    }

    // Assign a new lobby slot
    return this.assignLobbySlot(contestantId);
  }

  // ---------------------------------------------------------------------------
  // findFreeRoom: return first room where both slots are null
  // ---------------------------------------------------------------------------
  findFreeRoom(): number | null {
    for (let i = 1; i <= 8; i++) {
      const occupancy = this.roomOccupancy.get(i);
      if (occupancy && occupancy.slotA === null && occupancy.slotB === null) {
        return i;
      }
    }
    return null;
  }

  // ---------------------------------------------------------------------------
  // Query methods
  // ---------------------------------------------------------------------------
  getState(contestantId: string): AgentLocationState | null {
    return this.agentStates.get(contestantId) ?? null;
  }

  getAllStates(): AgentLocationState[] {
    return Array.from(this.agentStates.values());
  }

  getRoomOccupancy(roomId: number): { slotA: string | null; slotB: string | null } {
    return this.roomOccupancy.get(roomId) ?? { slotA: null, slotB: null };
  }

  // ---------------------------------------------------------------------------
  // Private helpers
  // ---------------------------------------------------------------------------
  private _getRoomIdFromState(locationState: LocationState): number | null {
    if (locationState === 'lobby') return null;
    const match = locationState.match(/^room_(\d+)$/);
    return match ? parseInt(match[1], 10) : null;
  }
}

// Export singleton
export const locationManager = new LocationManagerClass();

// Export class and constants for testing
export { LocationManagerClass, LOBBY_SLOTS, ROOM_SLOTS, AUDIENCE_SLOTS };
