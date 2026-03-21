import { afterEach, describe, expect, it, vi } from 'vitest';
import { authManager } from '../../modules/auth-manager';
import { db } from '../../db';
import { docDistributor } from '../../modules/doc-distributor';
import { handleMessage, type ClientContext } from '../../ws';

function makeMockWs() {
  const sentRaw: string[] = [];
  const ws = {
    OPEN: 1,
    readyState: 1,
    send: vi.fn((payload: string) => {
      sentRaw.push(payload);
    }),
    close: vi.fn(),
  };
  return { ws, sentRaw };
}

function nextTick(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('WebSocket runtime regressions', () => {
  it('allows Human_Viewer read-only auth and sends world.state', async () => {
    vi.spyOn(authManager, 'validateKey').mockResolvedValue({
      valid: true,
      contestantId: 'viewer-contestant',
      keyId: 'viewer-key-id',
      role: 'Human_Viewer',
    });

    const { ws, sentRaw } = makeMockWs();
    const registerSpy = vi.fn();
    const client: ClientContext = { ws: ws as unknown as ClientContext['ws'], contestantId: null, role: null };

    handleMessage(client, { type: 'auth', payload: { key: 'viewer-key' } }, registerSpy);
    await nextTick();

    expect(client.role).toBe('Human_Viewer');
    expect(registerSpy).not.toHaveBeenCalled();
    expect(ws.close).not.toHaveBeenCalled();

    const events = sentRaw.map((raw) => JSON.parse(raw) as { type: string });
    expect(events.some((event) => event.type === 'world.state')).toBe(true);
  });

  it('rejects Human_Viewer gameplay commands with FORBIDDEN_ROLE', () => {
    const { ws, sentRaw } = makeMockWs();
    const client: ClientContext = {
      ws: ws as unknown as ClientContext['ws'],
      contestantId: null,
      role: 'Human_Viewer',
    };

    handleMessage(client, { type: 'move', payload: { x: 1, y: 2 } }, () => {
      throw new Error('read-only role should not register contestant');
    });

    expect(sentRaw.length).toBe(1);
    const event = JSON.parse(sentRaw[0] as string) as {
      type: string;
      payload?: { error?: { code?: string } };
    };
    expect(event.type).toBe('error');
    expect(event.payload?.error?.code).toBe('FORBIDDEN_ROLE');
  });

  it('keeps position/current_zone_id when an existing contestant reconnects', async () => {
    const suffix = Date.now();
    const keyId = 'ws-key-' + suffix;
    const keyValue = 'ws-secret-' + suffix;
    const contestantId = 'ws-contestant-' + suffix;
    const zoneId = 'zone-preserved-' + suffix;
    const posX = 321;
    const posY = 654;

    const keyColumns = db.prepare('PRAGMA table_info(keys)').all() as Array<{ name: string }>;
    const hasRoleColumn = keyColumns.some((col) => col.name === 'role');
    if (hasRoleColumn) {
      db.prepare(
        'INSERT INTO keys (id, key, contestant_name, role, status, created_at) VALUES (?, ?, ?, ?, ?, ?)',
      ).run(keyId, keyValue, 'ReconnectAgent', 'Agent_Player', 'active', suffix);
    } else {
      db.prepare(
        'INSERT INTO keys (id, key, contestant_name, status, created_at) VALUES (?, ?, ?, ?, ?)',
      ).run(keyId, keyValue, 'ReconnectAgent', 'active', suffix);
    }

    db.prepare(`
      INSERT INTO contestants (
        id, key_id, name, status, position_x, position_y, current_zone_id, energy, installed_skills, attributes, disconnected_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(contestantId, keyId, 'ReconnectAgent', 'offline', posX, posY, zoneId, 100, '[]', '{}', suffix - 10_000);

    vi.spyOn(authManager, 'validateKey').mockResolvedValue({
      valid: true,
      contestantId,
      keyId,
      role: 'Agent_Player',
    });
    vi.spyOn(docDistributor, 'pushMandatoryDocuments').mockResolvedValue(undefined);

    const { ws } = makeMockWs();
    const registerSpy = vi.fn();
    const client: ClientContext = { ws: ws as unknown as ClientContext['ws'], contestantId: null, role: null };

    handleMessage(client, { type: 'auth', payload: { key: keyValue } }, registerSpy);
    await nextTick();

    const row = db.prepare(
      'SELECT status, position_x, position_y, current_zone_id FROM contestants WHERE id = ?',
    ).get(contestantId) as {
      status: string;
      position_x: number;
      position_y: number;
      current_zone_id: string | null;
    };

    expect(registerSpy).toHaveBeenCalledWith(contestantId);
    expect(row.status).toBe('online');
    expect(row.position_x).toBe(posX);
    expect(row.position_y).toBe(posY);
    expect(row.current_zone_id).toBe(zoneId);

    db.prepare('DELETE FROM contestants WHERE id = ?').run(contestantId);
    db.prepare('DELETE FROM keys WHERE id = ?').run(keyId);
  });
});
