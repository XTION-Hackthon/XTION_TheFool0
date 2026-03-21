import { afterEach, describe, expect, it, vi } from 'vitest';
import request from 'supertest';
import { app } from '../../app';
import { authManager } from '../../modules/auth-manager';
import { interactionManager } from '../../modules/interaction-manager';
import { eventLogger } from '../../modules/event-logger';

describe('Route contract regressions', () => {
  afterEach(() => {
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
});
