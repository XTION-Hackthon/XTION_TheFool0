import { afterEach, describe, expect, it, vi } from 'vitest';
import request from 'supertest';
import { app } from '../../app';
import { authManager } from '../../modules/auth-manager';
import { interactionManager } from '../../modules/interaction-manager';
import { eventLogger } from '../../modules/event-logger';
import { heartbeatMonitor } from '../../modules/heartbeat-monitor';
import { rateLimiter } from '../../modules/rate-limiter';
import { db } from '../../db';

describe('Route contract regressions', () => {
  afterEach(() => {
    rateLimiter.resetAll();
    vi.restoreAllMocks();
  });

  it('accepts viewerId on POST /api/barrage for compatibility', async () => {
    vi.spyOn(authManager, 'validateKey').mockResolvedValue({
      valid: true,
      contestantId: 'viewer-contestant',
      keyId: 'viewer-key-id',
      role: 'Human_Viewer',
    });

    const sendBarrageSpy = vi.spyOn(interactionManager, 'sendBarrage').mockResolvedValue({
      id: 'barrage-1',
      viewerId: 'viewer-123',
      content: 'hello',
      timestamp: Date.now(),
    });

    const res = await request(app)
      .post('/api/barrage')
      .set('Authorization', 'Bearer viewer-key')
      .send({ viewerId: 'viewer-123', content: 'hello' });

    expect(res.status).toBe(201);
    expect(sendBarrageSpy).toHaveBeenCalledWith('viewer-123', 'hello');
  });

  it('keeps rejecting Human_Viewer on GET /api/messages', async () => {
    vi.spyOn(authManager, 'validateKey').mockResolvedValue({
      valid: true,
      contestantId: 'viewer-contestant',
      keyId: 'viewer-key-id',
      role: 'Human_Viewer',
    });

    const res = await request(app)
      .get('/api/messages')
      .set('Authorization', 'Bearer viewer-key');

    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('FORBIDDEN_ROLE');
  });

  it('serves event history on /api/events instead of /api', async () => {
    vi.spyOn(authManager, 'validateKey').mockResolvedValue({
      valid: true,
      contestantId: 'viewer-contestant',
      keyId: 'viewer-key-id',
      role: 'Agent_Viewer',
    });

    const querySpy = vi.spyOn(eventLogger, 'query').mockResolvedValue({
      events: [],
      total: 0,
    });

    const okRes = await request(app)
      .get('/api/events')
      .set('Authorization', 'Bearer viewer-key');
    expect(okRes.status).toBe(200);
    expect(querySpy).toHaveBeenCalledOnce();

    const wrongRes = await request(app)
      .get('/api')
      .set('Authorization', 'Bearer viewer-key');
    expect(wrongRes.status).toBe(404);
  });

  it('blocks Agent_Viewer from POST /api/broadcast before handler logic runs', async () => {
    vi.spyOn(authManager, 'validateKey').mockResolvedValue({
      valid: true,
      contestantId: 'viewer-contestant',
      keyId: 'viewer-key-id',
      role: 'Agent_Viewer',
    });

    const res = await request(app)
      .post('/api/broadcast')
      .set('Authorization', 'Bearer viewer-key')
      .send({ senderId: 'spoofed-contestant', message: 'should fail' });

    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('FORBIDDEN_ROLE');
  });

  it('accepts legacy snake_case heartbeat payload without contestant_id/timestamp', async () => {
    vi.spyOn(authManager, 'validateKey').mockResolvedValue({
      valid: true,
      contestantId: 'agent-contestant',
      keyId: 'agent-key-id',
      role: 'Agent_Player',
    });

    const realPrepare = db.prepare.bind(db);
    vi.spyOn(db, 'prepare').mockImplementation(((sql: string) => {
      if (sql.includes('SELECT id, name, status FROM contestants WHERE id = ?')) {
        return {
          get: () => ({ id: 'agent-contestant', name: 'Agent', status: 'online' }),
        } as ReturnType<typeof realPrepare>;
      }
      return realPrepare(sql);
    }) as typeof db.prepare);

    const heartbeatSpy = vi.spyOn(heartbeatMonitor, 'onHeartbeat').mockImplementation(() => {});

    const res = await request(app)
      .post('/api/heartbeat')
      .set('Authorization', 'Bearer agent-key')
      .send({
        payload: {
          cpu_load: 12,
          memory_usage: 34,
          response_latency_ms: 56,
        },
      });

    expect(res.status).toBe(200);
    expect(heartbeatSpy).toHaveBeenCalledWith('agent-contestant', {
      cpuLoad: 12,
      memoryUsage: 34,
      responseLatency: 56,
    });
  });

  it('rate limits Human_Viewer barrage after 10 requests per minute', async () => {
    vi.spyOn(authManager, 'validateKey').mockResolvedValue({
      valid: true,
      contestantId: 'viewer-contestant',
      keyId: 'viewer-key-id',
      role: 'Human_Viewer',
    });

    const sendBarrageSpy = vi.spyOn(interactionManager, 'sendBarrage').mockResolvedValue({
      id: 'barrage-1',
      viewerId: 'viewer-123',
      content: 'hello',
      timestamp: Date.now(),
    });

    for (let i = 0; i < 10; i++) {
      const res = await request(app)
        .post('/api/barrage')
        .set('Authorization', 'Bearer viewer-key')
        .send({ viewerId: 'viewer-123', content: 'hello-' + i });

      expect(res.status).toBe(201);
    }

    const blocked = await request(app)
      .post('/api/barrage')
      .set('Authorization', 'Bearer viewer-key')
      .send({ viewerId: 'viewer-123', content: 'hello-11' });

    expect(blocked.status).toBe(429);
    expect(blocked.body.error.code).toBe('API_RATE_LIMITED');
    expect(sendBarrageSpy).toHaveBeenCalledTimes(10);
  });
});
