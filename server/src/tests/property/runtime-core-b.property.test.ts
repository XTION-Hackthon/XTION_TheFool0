import { afterEach, describe, expect, it, vi } from 'vitest';
import request from 'supertest';
import { app } from '../../app';
import { authManager } from '../../modules/auth-manager';
import { heartbeatMonitor } from '../../modules/heartbeat-monitor';
import { rateLimiter } from '../../modules/rate-limiter';
import { db } from '../../db';

describe('Core runtime regressions (Subagent B scope)', () => {
  afterEach(() => {
    rateLimiter.resetAll();
    vi.restoreAllMocks();
  });

  it('returns scoped /api/messages for Agent_Player and full audit view for Admin', async () => {
    const suffix = Date.now();
    const talkOwnId = 'talk-own-' + suffix;
    const talkRecvId = 'talk-recv-' + suffix;
    const talkOtherId = 'talk-other-' + suffix;
    const broadcastId = 'broadcast-' + suffix;

    db.prepare('INSERT INTO talk_messages (id, sender_id, receiver_ids, content, zone_id, timestamp) VALUES (?, ?, ?, ?, ?, ?)')
      .run(talkOwnId, 'agent-contestant', JSON.stringify(['other-1']), 'own talk', 'zone-1', suffix + 1);
    db.prepare('INSERT INTO talk_messages (id, sender_id, receiver_ids, content, zone_id, timestamp) VALUES (?, ?, ?, ?, ?, ?)')
      .run(talkRecvId, 'other-2', JSON.stringify(['agent-contestant']), 'recv talk', 'zone-1', suffix + 2);
    db.prepare('INSERT INTO talk_messages (id, sender_id, receiver_ids, content, zone_id, timestamp) VALUES (?, ?, ?, ?, ?, ?)')
      .run(talkOtherId, 'other-3', JSON.stringify(['other-9']), 'other talk', 'zone-1', suffix + 3);
    db.prepare('INSERT INTO broadcast_messages (id, sender_id, content, timestamp) VALUES (?, ?, ?, ?)')
      .run(broadcastId, 'other-4', 'hello all', suffix + 4);

    vi.spyOn(authManager, 'validateKey').mockImplementation(async (key: string) => {
      if (key === 'admin-key') {
        return { valid: true, contestantId: 'admin-1', keyId: 'admin-key-id', role: 'Admin' };
      }
      return { valid: true, contestantId: 'agent-contestant', keyId: 'agent-key-id', role: 'Agent_Player' };
    });

    const agentRes = await request(app)
      .get('/api/messages?page=1&page_size=20')
      .set('Authorization', 'Bearer agent-key');

    expect(agentRes.status).toBe(200);
    const agentMessageIds = (agentRes.body.messages as Array<{ id: string }>).map((m) => m.id);
    expect(agentMessageIds).toContain(talkOwnId);
    expect(agentMessageIds).toContain(talkRecvId);
    expect(agentMessageIds).toContain(broadcastId);
    expect(agentMessageIds).not.toContain(talkOtherId);

    const adminRes = await request(app)
      .get('/api/messages?page=1&page_size=20')
      .set('Authorization', 'Bearer admin-key');

    expect(adminRes.status).toBe(200);
    const adminMessageIds = (adminRes.body.messages as Array<{ id: string }>).map((m) => m.id);
    expect(adminMessageIds).toContain(talkOwnId);
    expect(adminMessageIds).toContain(talkRecvId);
    expect(adminMessageIds).toContain(talkOtherId);
    expect(adminMessageIds).toContain(broadcastId);

    db.prepare('DELETE FROM talk_messages WHERE id IN (?, ?, ?)').run(talkOwnId, talkRecvId, talkOtherId);
    db.prepare('DELETE FROM broadcast_messages WHERE id = ?').run(broadcastId);
  });

  it('keeps heartbeat history queryable from DB after unregister/disconnect', async () => {
    const contestantId = 'heartbeat-contestant-' + Date.now();
    const recordId = 'heartbeat-record-' + Date.now();

    db.prepare('INSERT INTO heartbeat_records (id, contestant_id, timestamp, cpu_load, memory_usage, response_latency) VALUES (?, ?, ?, ?, ?, ?)')
      .run(recordId, contestantId, Date.now(), 10, 20, 30);
    heartbeatMonitor.unregister(contestantId);

    vi.spyOn(authManager, 'validateKey').mockResolvedValue({
      valid: true,
      contestantId: 'admin-1',
      keyId: 'admin-key-id',
      role: 'Admin',
    });

    const res = await request(app)
      .get('/api/admin/contestants/' + contestantId + '/heartbeat-history?limit=1')
      .set('Authorization', 'Bearer admin-key');

    expect(res.status).toBe(200);
    expect(res.body.contestantId).toBe(contestantId);
    expect(Array.isArray(res.body.history)).toBe(true);
    expect(res.body.history.length).toBe(1);
    expect(res.body.history[0].contestantId).toBe(contestantId);

    db.prepare('DELETE FROM heartbeat_records WHERE id = ?').run(recordId);
  });

  it('rejects Human_Viewer on GET /api/skills/:id/install', async () => {
    vi.spyOn(authManager, 'validateKey').mockResolvedValue({
      valid: true,
      contestantId: 'viewer-contestant',
      keyId: 'viewer-key-id',
      role: 'Human_Viewer',
    });

    const res = await request(app)
      .get('/api/skills/skill-1/install')
      .set('Authorization', 'Bearer viewer-key');

    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('FORBIDDEN_ROLE');
  });

  it('applies global rate limit on authenticated business routes', async () => {
    vi.spyOn(authManager, 'validateKey').mockResolvedValue({
      valid: true,
      contestantId: 'agent-contestant',
      keyId: 'agent-key-id',
      role: 'Agent_Player',
    });

    for (let i = 0; i < 60; i++) {
      const ok = await request(app)
        .get('/api/messages')
        .set('Authorization', 'Bearer agent-key');
      expect(ok.status).toBe(200);
    }

    const blocked = await request(app)
      .get('/api/messages')
      .set('Authorization', 'Bearer agent-key');

    expect(blocked.status).toBe(429);
    expect(blocked.body.error.code).toBe('API_RATE_LIMITED');
  });

  it('keeps /api/auth/me exempt from global rate limit', async () => {
    vi.spyOn(authManager, 'validateKey').mockResolvedValue({
      valid: true,
      contestantId: 'agent-contestant',
      keyId: 'agent-key-id',
      role: 'Agent_Player',
    });

    for (let i = 0; i < 70; i++) {
      const res = await request(app)
        .get('/api/auth/me')
        .set('Authorization', 'Bearer agent-key');
      expect(res.status).toBe(200);
      expect(res.body.role).toBe('Agent_Player');
    }
  });
});
