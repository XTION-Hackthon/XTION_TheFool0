// =============================================================================
// XTION_TheFool0 — InvitationManager 模块
// Requirements: 3, 4, 7
// =============================================================================

import { randomUUID } from 'crypto';
import { db } from '../db.js';
import { locationManager } from './location-manager.js';
import { connections, sendEvent, broadcast } from '../ws.js';
import type { Invitation } from '../types/index.js';

// =============================================================================
// DB row type
// =============================================================================

interface InvitationRow {
  id: string;
  inviter_id: string;
  invitee_id: string;
  status: 'pending' | 'accepted' | 'rejected' | 'expired';
  room_id: number | null;
  created_at: number;
  expires_at: number;
  responded_at: number | null;
}

function rowToInvitation(row: InvitationRow): Invitation {
  return {
    id: row.id,
    inviterId: row.inviter_id,
    inviteeId: row.invitee_id,
    status: row.status,
    ...(row.room_id != null ? { roomId: row.room_id } : {}),
    createdAt: row.created_at,
    expiresAt: row.expires_at,
    ...(row.responded_at != null ? { respondedAt: row.responded_at } : {}),
  };
}

function createError(code: string, message: string): Error & { code: string } {
  const err = new Error(message) as Error & { code: string };
  err.code = code;
  return err;
}

// =============================================================================
// InvitationManager class
// =============================================================================

class InvitationManagerClass {
  private pendingTimers = new Map<string, ReturnType<typeof setTimeout>>();

  // ---------------------------------------------------------------------------
  // createInvitation: validate, write to DB, set timer, push WS event
  // Requirements: 3.1–3.11
  // ---------------------------------------------------------------------------
  async createInvitation(inviterId: string, inviteeId: string): Promise<Invitation> {
    // Validate inviter is in lobby
    const inviterState = locationManager.getState(inviterId);
    if (!inviterState || inviterState.locationState !== 'lobby') {
      throw createError('INVITER_NOT_IN_LOBBY', '发起方不在大厅');
    }

    // Validate invitee is in lobby
    const inviteeState = locationManager.getState(inviteeId);
    if (!inviteeState || inviteeState.locationState !== 'lobby') {
      throw createError('INVITEE_NOT_IN_LOBBY', '被邀请方不在大厅');
    }

    // Validate invitee role is Agent_Player (query keys table via contestants)
    const inviteeKeyRow = db.prepare(`
      SELECT k.role FROM keys k
      INNER JOIN contestants c ON c.key_id = k.id
      WHERE c.id = ?
    `).get(inviteeId) as { role: string } | undefined;

    if (!inviteeKeyRow || inviteeKeyRow.role !== 'Agent_Player') {
      throw createError('INVITEE_NOT_CONTESTANT', '被邀请方不是 Agent_Player 角色');
    }

    // Validate there's a free room
    const freeRoom = locationManager.findFreeRoom();
    if (freeRoom === null) {
      throw createError('NO_ROOM_AVAILABLE', '当前没有空闲的私聊房间');
    }

    // Write invitation to DB
    const id = randomUUID();
    const now = Date.now();
    const expiresAt = now + 60000;

    db.prepare(`
      INSERT INTO invitations (id, inviter_id, invitee_id, status, created_at, expires_at)
      VALUES (?, ?, ?, 'pending', ?, ?)
    `).run(id, inviterId, inviteeId, now, expiresAt);

    // Set 60s expiry timer
    const timer = setTimeout(() => {
      this.expireInvitation(id);
    }, 60000);
    this.pendingTimers.set(id, timer);

    // Push invitation.received event to invitee via WebSocket
    const inviteeWs = connections.get(inviteeId);
    if (inviteeWs) {
      // Look up inviter name for the notification
      const inviterRow = db.prepare(`SELECT name FROM contestants WHERE id = ?`).get(inviterId) as { name: string } | undefined;
      sendEvent(inviteeWs, {
        type: 'invitation.received',
        payload: {
          invitation_id: id,
          inviter_id: inviterId,
          inviter_name: inviterRow?.name ?? inviterId,
          expires_at: expiresAt,
        },
        timestamp: now,
      });
    }

    const row = db.prepare(`SELECT * FROM invitations WHERE id = ?`).get(id) as InvitationRow;
    return rowToInvitation(row);
  }

  // ---------------------------------------------------------------------------
  // acceptInvitation: validate, find free room, enterRoom, update DB, push events
  // Requirements: 4.1–4.5, 4.7
  // ---------------------------------------------------------------------------
  async acceptInvitation(invitationId: string, inviteeId: string): Promise<{ roomId: number; slot: { x: number; y: number } }> {
    const row = db.prepare(`SELECT * FROM invitations WHERE id = ?`).get(invitationId) as InvitationRow | undefined;

    if (!row) {
      throw createError('INVITATION_NOT_FOUND', '邀请不存在');
    }

    if (row.status !== 'pending') {
      throw createError('INVITATION_NOT_PENDING', '邀请状态不是 pending');
    }

    if (row.invitee_id !== inviteeId) {
      throw createError('FORBIDDEN', '无权操作此邀请');
    }

    // Find free room again (prevent race condition)
    const roomId = locationManager.findFreeRoom();
    if (roomId === null) {
      throw createError('NO_ROOM_AVAILABLE', '当前没有空闲的私聊房间');
    }

    const inviterId = row.inviter_id;
    const now = Date.now();

    // Atomically move both agents into the room
    locationManager.enterRoom(inviterId, inviteeId, roomId);

    // Update invitation status
    db.prepare(`
      UPDATE invitations SET status = 'accepted', responded_at = ?, room_id = ? WHERE id = ?
    `).run(now, roomId, invitationId);

    // Clear the expiry timer
    const timer = this.pendingTimers.get(invitationId);
    if (timer) {
      clearTimeout(timer);
      this.pendingTimers.delete(invitationId);
    }

    // Get the invitee's new slot (Slot_B)
    const inviteeState = locationManager.getState(inviteeId);
    const inviterState = locationManager.getState(inviterId);

    // Broadcast location.changed for both agents to all online clients
    if (inviterState) {
      broadcast({
        type: 'location.changed',
        payload: {
          contestant_id: inviterId,
          location_state: inviterState.locationState,
          position: inviterState.slot,
        },
        timestamp: now,
      });
    }

    if (inviteeState) {
      broadcast({
        type: 'location.changed',
        payload: {
          contestant_id: inviteeId,
          location_state: inviteeState.locationState,
          position: inviteeState.slot,
        },
        timestamp: now,
      });
    }

    // Push invitation.accepted event to inviter
    const inviterWs = connections.get(inviterId);
    if (inviterWs) {
      sendEvent(inviterWs, {
        type: 'invitation.accepted',
        payload: { invitation_id: invitationId, room_id: roomId },
        timestamp: now,
      });
    }

    return {
      roomId,
      slot: inviteeState?.slot ?? { x: 0, y: 0 },
    };
  }

  // ---------------------------------------------------------------------------
  // rejectInvitation: validate, update DB, clear timer, push event to inviter
  // Requirements: 4.6
  // ---------------------------------------------------------------------------
  async rejectInvitation(invitationId: string, inviteeId: string): Promise<void> {
    const row = db.prepare(`SELECT * FROM invitations WHERE id = ?`).get(invitationId) as InvitationRow | undefined;

    if (!row) {
      throw createError('INVITATION_NOT_FOUND', '邀请不存在');
    }

    if (row.status !== 'pending') {
      throw createError('INVITATION_NOT_PENDING', '邀请状态不是 pending');
    }

    if (row.invitee_id !== inviteeId) {
      throw createError('FORBIDDEN', '无权操作此邀请');
    }

    const now = Date.now();

    // Update status to rejected
    db.prepare(`
      UPDATE invitations SET status = 'rejected', responded_at = ? WHERE id = ?
    `).run(now, invitationId);

    // Clear the expiry timer
    const timer = this.pendingTimers.get(invitationId);
    if (timer) {
      clearTimeout(timer);
      this.pendingTimers.delete(invitationId);
    }

    // Push invitation.rejected event to inviter
    const inviterWs = connections.get(row.inviter_id);
    if (inviterWs) {
      sendEvent(inviterWs, {
        type: 'invitation.rejected',
        payload: { invitation_id: invitationId },
        timestamp: now,
      });
    }
  }

  // ---------------------------------------------------------------------------
  // expireInvitation (private): update status, push event to both parties
  // Requirements: 3.11
  // ---------------------------------------------------------------------------
  private expireInvitation(invitationId: string): void {
    const row = db.prepare(`SELECT * FROM invitations WHERE id = ?`).get(invitationId) as InvitationRow | undefined;

    // Only expire if still pending
    if (!row || row.status !== 'pending') return;

    db.prepare(`
      UPDATE invitations SET status = 'expired' WHERE id = ?
    `).run(invitationId);

    this.pendingTimers.delete(invitationId);

    const now = Date.now();
    const payload = { invitation_id: invitationId };

    // Push invitation.expired to inviter
    const inviterWs = connections.get(row.inviter_id);
    if (inviterWs) {
      sendEvent(inviterWs, { type: 'invitation.expired', payload, timestamp: now });
    }

    // Push invitation.expired to invitee
    const inviteeWs = connections.get(row.invitee_id);
    if (inviteeWs) {
      sendEvent(inviteeWs, { type: 'invitation.expired', payload, timestamp: now });
    }
  }
}

// =============================================================================
// Singleton export
// =============================================================================

export const invitationManager = new InvitationManagerClass();
