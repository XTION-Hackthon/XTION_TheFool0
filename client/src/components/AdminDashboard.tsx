/**
 * AdminDashboard — 全屏管理后台
 * 左侧导航 + 右侧内容区，包含：概览、Keys、Zones、房间、Skills、文档、心跳、事件日志
 */

import { useEffect, useState, useCallback } from 'react';
import { apiClient } from '../services/api-client';
import type { Key, Zone, ZoneType, SkillDocument, HeartbeatConfig } from '../types/admin';

// ─── Design tokens ────────────────────────────────────────────────────────────

const C = {
  bg: '#080c14',
  sidebar: '#0d1220',
  card: 'rgba(255,255,255,0.04)',
  border: 'rgba(74,158,255,0.15)',
  borderHover: 'rgba(74,158,255,0.4)',
  accent: '#4a9eff',
  accentDim: 'rgba(74,158,255,0.15)',
  text: '#e2e8f0',
  textMuted: '#64748b',
  textSub: '#94a3b8',
  green: '#22c55e',
  red: '#ef4444',
  yellow: '#f59e0b',
  purple: '#a78bfa',
};

const input: React.CSSProperties = {
  background: 'rgba(255,255,255,0.05)', border: `1px solid ${C.border}`,
  borderRadius: 8, color: C.text, padding: '9px 12px', fontSize: 13,
  width: '100%', boxSizing: 'border-box', outline: 'none',
  transition: 'border-color 0.2s',
};

const btn = (v: 'primary' | 'danger' | 'ghost' | 'success' = 'primary'): React.CSSProperties => ({
  padding: '8px 16px', borderRadius: 8, fontSize: 12, fontWeight: 600,
  cursor: 'pointer', border: 'none', transition: 'all 0.15s',
  background: v === 'primary' ? C.accentDim
    : v === 'danger' ? 'rgba(239,68,68,0.15)'
    : v === 'success' ? 'rgba(34,197,94,0.15)'
    : 'rgba(255,255,255,0.06)',
  color: v === 'primary' ? C.accent
    : v === 'danger' ? C.red
    : v === 'success' ? C.green
    : C.textSub,
});

function Card({ children, style }: { children: React.ReactNode; style?: React.CSSProperties }) {
  return (
    <div style={{
      background: C.card, border: `1px solid ${C.border}`,
      borderRadius: 12, padding: 20, ...style,
    }}>
      {children}
    </div>
  );
}

function SectionTitle({ children }: { children: React.ReactNode }) {
  return (
    <div style={{
      color: C.accent, fontSize: 11, fontWeight: 700, letterSpacing: 1.5,
      textTransform: 'uppercase', marginBottom: 12, marginTop: 20,
      paddingBottom: 6, borderBottom: `1px solid ${C.border}`,
    }}>
      {children}
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div style={{ marginBottom: 14 }}>
      <label style={{ display: 'block', color: C.textMuted, fontSize: 11, marginBottom: 6, letterSpacing: 0.5 }}>
        {label}
      </label>
      {children}
    </div>
  );
}

function Badge({ color, children }: { color: string; children: React.ReactNode }) {
  return (
    <span style={{
      display: 'inline-block', padding: '2px 8px', borderRadius: 20,
      fontSize: 11, fontWeight: 600,
      background: `${color}20`, color, border: `1px solid ${color}40`,
    }}>
      {children}
    </span>
  );
}

// ─── Stat Card ────────────────────────────────────────────────────────────────

function StatCard({ label, value, color, icon }: { label: string; value: string | number; color: string; icon: string }) {
  return (
    <div style={{
      background: `${color}0d`, border: `1px solid ${color}30`,
      borderRadius: 12, padding: '20px 24px',
      display: 'flex', alignItems: 'center', gap: 16,
    }}>
      <div style={{ fontSize: 28 }}>{icon}</div>
      <div>
        <div style={{ fontSize: 28, fontWeight: 800, color, lineHeight: 1 }}>{value}</div>
        <div style={{ color: C.textMuted, fontSize: 12, marginTop: 4 }}>{label}</div>
      </div>
    </div>
  );
}

// ─── Overview Tab ─────────────────────────────────────────────────────────────

interface MonitorData {
  onlineCount: number;
  zoneDistribution: Record<string, number>;
  apiCallRate: number;
  heartbeatAnomalies: string[];
}

function OverviewTab() {
  const [data, setData] = useState<MonitorData | null>(null);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);

  const load = useCallback(async () => {
    try {
      const d = await apiClient.get<MonitorData>('/api/admin/monitor');
      setData(d);
      setLastUpdated(new Date());
    } catch { /* ignore */ }
  }, []);

  useEffect(() => {
    load();
    const t = setInterval(load, 5000);
    return () => clearInterval(t);
  }, [load]);

  if (!data) return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: 200, color: C.textMuted }}>
      加载中…
    </div>
  );

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 24 }}>
        <div style={{ color: C.textMuted, fontSize: 12 }}>
          {lastUpdated ? `最后更新: ${lastUpdated.toLocaleTimeString()}` : ''}
        </div>
        <button style={btn('ghost')} onClick={load}>↻ 刷新</button>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 16, marginBottom: 24 }}>
        <StatCard label="在线选手" value={data.onlineCount} color={C.green} icon="👥" />
        <StatCard label="API 调用/分钟" value={data.apiCallRate} color={C.accent} icon="⚡" />
        <StatCard label="心跳异常" value={data.heartbeatAnomalies.length} color={data.heartbeatAnomalies.length > 0 ? C.red : C.green} icon="💓" />
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
        <Card>
          <div style={{ color: C.text, fontWeight: 600, marginBottom: 16 }}>Zone 人数分布</div>
          {!data.zoneDistribution || Object.keys(data.zoneDistribution).length === 0 ? (
            <div style={{ color: C.textMuted, fontSize: 13 }}>暂无数据</div>
          ) : (
            Object.entries(data.zoneDistribution).map(([zone, count]) => (
              <div key={zone} style={{
                display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                padding: '8px 0', borderBottom: `1px solid ${C.border}`, fontSize: 13,
              }}>
                <span style={{ color: C.textSub }}>{zone}</span>
                <span style={{ color: C.accent, fontWeight: 600 }}>{count} 人</span>
              </div>
            ))
          )}
        </Card>

        <Card>
          <div style={{ color: C.text, fontWeight: 600, marginBottom: 16 }}>心跳异常列表</div>
          {data.heartbeatAnomalies.length === 0 ? (
            <div style={{ color: C.green, fontSize: 13 }}>✓ 所有选手心跳正常</div>
          ) : (
            data.heartbeatAnomalies.map((id) => (
              <div key={id} style={{
                display: 'flex', alignItems: 'center', gap: 8,
                padding: '8px 0', borderBottom: `1px solid ${C.border}`, fontSize: 13,
              }}>
                <span style={{ color: C.red }}>⚠</span>
                <span style={{ color: C.textSub, fontFamily: 'monospace' }}>{id}</span>
              </div>
            ))
          )}
        </Card>
      </div>
    </div>
  );
}

// ─── Key Log Panel ────────────────────────────────────────────────────────────

interface KeyLogEvent {
  id: string;
  type: string;
  contestantId?: string;
  data: unknown;
  timestamp: number;
}

interface KeyLogData {
  key: { id: string; contestant_name: string; role: string; status: string };
  contestant: { id: string; name: string; status: string } | null;
  events: KeyLogEvent[];
  total: number;
}

const EVENT_TYPE_COLOR: Record<string, string> = {
  move: '#4a9eff',
  talk: '#22c55e',
  broadcast: '#a78bfa',
  heartbeat: '#f59e0b',
  heartbeat_timeout: '#ef4444',
  heartbeat_restored: '#22c55e',
  connect: '#22c55e',
  disconnect: '#ef4444',
  skill_install: '#f59e0b',
  invitation_sent: '#a78bfa',
  invitation_accepted: '#22c55e',
  invitation_rejected: '#ef4444',
};

function eventColor(type: string): string {
  return EVENT_TYPE_COLOR[type] ?? C.textSub;
}

function KeyLogPanel({ keyId, keyName, onClose }: { keyId: string; keyName: string; onClose: () => void }) {
  const [data, setData] = useState<KeyLogData | null>(null);
  const [page, setPage] = useState(0);
  const [typeFilter, setTypeFilter] = useState('');
  const [autoRefresh, setAutoRefresh] = useState(true);
  const PAGE_SIZE = 30;

  const load = useCallback(async () => {
    try {
      const params = new URLSearchParams({
        limit: String(PAGE_SIZE),
        offset: String(page * PAGE_SIZE),
        ...(typeFilter ? { type: typeFilter } : {}),
      });
      const d = await apiClient.get<KeyLogData>(`/api/admin/logs/${keyId}?${params}`);
      setData(d);
    } catch { /* ignore */ }
  }, [keyId, page, typeFilter]);

  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    if (!autoRefresh) return;
    const t = setInterval(load, 3000);
    return () => clearInterval(t);
  }, [autoRefresh, load]);

  const totalPages = data ? Math.ceil(data.total / PAGE_SIZE) : 0;

  return (
    <div style={{
      position: 'fixed', inset: 0, zIndex: 1000,
      background: 'rgba(0,0,0,0.7)', display: 'flex', alignItems: 'center', justifyContent: 'center',
    }} onClick={onClose}>
      <div style={{
        background: C.bg, border: `1px solid ${C.borderHover}`,
        borderRadius: 16, width: 'min(860px, 95vw)', maxHeight: '85vh',
        display: 'flex', flexDirection: 'column', overflow: 'hidden',
        boxShadow: '0 32px 80px rgba(0,0,0,0.8)',
      }} onClick={(e) => e.stopPropagation()}>
        {/* Header */}
        <div style={{
          padding: '16px 20px', borderBottom: `1px solid ${C.border}`,
          display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexShrink: 0,
        }}>
          <div>
            <div style={{ color: C.text, fontWeight: 700, fontSize: 15 }}>
              📋 {keyName} — 事件日志
            </div>
            {data?.contestant && (
              <div style={{ color: C.textMuted, fontSize: 12, marginTop: 4 }}>
                选手 ID: <code style={{ color: C.accent }}>{data.contestant.id}</code>
                &nbsp;·&nbsp;
                状态: <span style={{ color: data.contestant.status === 'online' ? C.green : C.red }}>
                  {data.contestant.status}
                </span>
                &nbsp;·&nbsp;共 {data.total} 条事件
              </div>
            )}
            {data && !data.contestant && (
              <div style={{ color: C.yellow, fontSize: 12, marginTop: 4 }}>⚠ 该 Key 尚未有选手连接记录</div>
            )}
          </div>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <button
              style={{ ...btn(autoRefresh ? 'success' : 'ghost'), fontSize: 11 }}
              onClick={() => setAutoRefresh(v => !v)}
            >
              {autoRefresh ? '⏸ 暂停刷新' : '▶ 自动刷新'}
            </button>
            <button style={btn('ghost')} onClick={load}>↻</button>
            <button style={btn('danger')} onClick={onClose}>✕</button>
          </div>
        </div>

        {/* Filter bar */}
        <div style={{ padding: '10px 20px', borderBottom: `1px solid ${C.border}`, flexShrink: 0, display: 'flex', gap: 10 }}>
          <input
            style={{ ...input, width: 200, fontSize: 12 }}
            placeholder="过滤事件类型 (move/talk/…)"
            value={typeFilter}
            onChange={(e) => { setTypeFilter(e.target.value); setPage(0); }}
          />
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
            {['move', 'talk', 'broadcast', 'heartbeat', 'connect', 'disconnect'].map(t => (
              <button
                key={t}
                style={{
                  ...btn(typeFilter === t ? 'primary' : 'ghost'),
                  padding: '4px 10px', fontSize: 11,
                }}
                onClick={() => { setTypeFilter(typeFilter === t ? '' : t); setPage(0); }}
              >
                {t}
              </button>
            ))}
          </div>
        </div>

        {/* Log list */}
        <div style={{ flex: 1, overflowY: 'auto', fontFamily: 'monospace', fontSize: 12 }}>
          {!data && (
            <div style={{ padding: 40, textAlign: 'center', color: C.textMuted }}>加载中…</div>
          )}
          {data?.events.length === 0 && (
            <div style={{ padding: 40, textAlign: 'center', color: C.textMuted }}>暂无事件记录</div>
          )}
          {data?.events.map((e) => (
            <div key={e.id} style={{
              display: 'grid', gridTemplateColumns: '150px 130px 1fr',
              gap: 12, padding: '7px 20px', borderBottom: `1px solid rgba(255,255,255,0.04)`,
              alignItems: 'start',
            }}>
              <span style={{ color: C.textMuted, fontSize: 11 }}>
                {new Date(e.timestamp).toLocaleTimeString('zh-CN', { hour12: false })}
                <br />
                <span style={{ fontSize: 10, opacity: 0.6 }}>
                  {new Date(e.timestamp).toLocaleDateString('zh-CN')}
                </span>
              </span>
              <span style={{
                display: 'inline-block', padding: '2px 8px', borderRadius: 20,
                fontSize: 11, fontWeight: 600, alignSelf: 'start',
                background: `${eventColor(e.type)}20`,
                color: eventColor(e.type),
                border: `1px solid ${eventColor(e.type)}40`,
              }}>
                {e.type}
              </span>
              <span style={{ color: C.textSub, wordBreak: 'break-all', lineHeight: 1.5 }}>
                {JSON.stringify(e.data)}
              </span>
            </div>
          ))}
        </div>

        {/* Pagination */}
        {totalPages > 1 && (
          <div style={{
            padding: '10px 20px', borderTop: `1px solid ${C.border}`,
            display: 'flex', gap: 8, justifyContent: 'center', flexShrink: 0,
          }}>
            <button style={btn('ghost')} disabled={page === 0} onClick={() => setPage(p => p - 1)}>← 上一页</button>
            <span style={{ color: C.textMuted, fontSize: 13, padding: '8px 12px' }}>
              {page + 1} / {totalPages}
            </span>
            <button style={btn('ghost')} disabled={page >= totalPages - 1} onClick={() => setPage(p => p + 1)}>下一页 →</button>
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Keys Tab ─────────────────────────────────────────────────────────────────

function KeysTab() {
  const [keys, setKeys] = useState<Key[]>([]);
  const [newName, setNewName] = useState('');
  const [newRole, setNewRole] = useState('Agent_Player');
  const [loading, setLoading] = useState(false);
  const [copied, setCopied] = useState<string | null>(null);
  const [logKey, setLogKey] = useState<{ id: string; name: string } | null>(null);

  const load = useCallback(async () => {
    try { setKeys(await apiClient.get<Key[]>('/api/admin/keys')); } catch { /* ignore */ }
  }, []);

  useEffect(() => { load(); }, [load]);

  const generate = async () => {
    if (!newName.trim()) return;
    setLoading(true);
    try {
      await apiClient.post('/api/admin/keys', { name: newName, role: newRole });
      setNewName('');
      await load();
    } finally { setLoading(false); }
  };

  const revoke = async (id: string) => {
    try { await apiClient.delete(`/api/admin/keys/${id}`); } catch { /* ignore */ }
    await load();
  };

  const regenerate = async (id: string) => {
    try { await apiClient.post(`/api/admin/keys/${id}/regenerate`); } catch { /* ignore */ }
    await load();
  };

  const copyKey = (key: string) => {
    navigator.clipboard.writeText(key).then(() => {
      setCopied(key);
      setTimeout(() => setCopied(null), 2000);
    });
  };

  const roleColor: Record<string, string> = {
    Admin: C.red, Agent_Player: C.accent, Agent_Viewer: C.purple, Human_Viewer: C.green,
  };

  return (
    <div>
      <Card style={{ marginBottom: 20 }}>
        <div style={{ color: C.text, fontWeight: 600, marginBottom: 16 }}>生成新 Key</div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr auto auto', gap: 10, alignItems: 'end' }}>
          <Field label="选手名称">
            <input style={input} placeholder="contestant-name" value={newName}
              onChange={(e) => setNewName(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && generate()} />
          </Field>
          <Field label="角色">
            <select style={{ ...input, width: 'auto' }} value={newRole} onChange={(e) => setNewRole(e.target.value)}>
              <option value="Admin">Admin</option>
              <option value="Agent_Player">Agent_Player</option>
              <option value="Agent_Viewer">Agent_Viewer</option>
              <option value="Human_Viewer">Human_Viewer</option>
            </select>
          </Field>
          <button style={{ ...btn('primary'), height: 38, marginBottom: 14 }} onClick={generate} disabled={loading}>
            {loading ? '生成中…' : '+ 生成'}
          </button>
        </div>
      </Card>

      <div style={{ color: C.textMuted, fontSize: 12, marginBottom: 12 }}>{keys.length} 个 Key</div>

      {keys.map((k) => (
        <div key={k.id} style={{
          background: C.card, border: `1px solid ${C.border}`, borderRadius: 10,
          padding: '14px 16px', marginBottom: 8,
        }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <span style={{ color: C.text, fontWeight: 600, fontSize: 14 }}>{k.contestantName}</span>
              <Badge color={roleColor[k.role] ?? C.textSub}>{k.role}</Badge>
              <Badge color={k.status === 'active' ? C.green : C.red}>{k.status}</Badge>
            </div>
            <div style={{ display: 'flex', gap: 6 }}>
              <button style={btn('ghost')} onClick={() => setLogKey({ id: k.id, name: k.contestantName })}>日志</button>
              <button style={btn('ghost')} onClick={() => regenerate(k.id)}>重新生成</button>
              {k.status === 'active' && <button style={btn('danger')} onClick={() => revoke(k.id)}>吊销</button>}
            </div>
          </div>
          <div style={{
            display: 'flex', alignItems: 'center', gap: 8,
            background: 'rgba(0,0,0,0.3)', borderRadius: 6, padding: '8px 12px',
          }}>
            <code style={{ flex: 1, color: C.textMuted, fontSize: 12, wordBreak: 'break-all' }}>{k.key}</code>
            <button style={{ ...btn('ghost'), padding: '4px 10px', fontSize: 11 }} onClick={() => copyKey(k.key)}>
              {copied === k.key ? '✓ 已复制' : '复制'}
            </button>
          </div>
        </div>
      ))}

      {logKey && (
        <KeyLogPanel
          keyId={logKey.id}
          keyName={logKey.name}
          onClose={() => setLogKey(null)}
        />
      )}
    </div>
  );
}

// ─── Zones Tab ────────────────────────────────────────────────────────────────

function ZonesTab() {
  const [zones, setZones] = useState<Zone[]>([]);
  const [zoneTypes, setZoneTypes] = useState<ZoneType[]>([]);
  const [editing, setEditing] = useState<Partial<Zone> | null>(null);
  const [newTypeName, setNewTypeName] = useState('');
  const [newTypeDesc, setNewTypeDesc] = useState('');

  const load = useCallback(async () => {
    try {
      const [zData, ztData] = await Promise.all([
        apiClient.get<Zone[]>('/api/admin/zones'),
        apiClient.get<ZoneType[]>('/api/admin/zone-types'),
      ]);
      setZones(zData); setZoneTypes(ztData);
    } catch { /* ignore */ }
  }, []);

  useEffect(() => { load(); }, [load]);

  const save = async () => {
    if (!editing) return;
    try {
      if (editing.id) await apiClient.put(`/api/admin/zones/${editing.id}`, editing);
      else await apiClient.post('/api/admin/zones', editing);
    } catch { /* ignore */ }
    setEditing(null); await load();
  };

  const deleteZone = async (id: string) => {
    try { await apiClient.delete(`/api/admin/zones/${id}`); } catch { /* ignore */ }
    await load();
  };

  const createZoneType = async () => {
    if (!newTypeName.trim()) return;
    try {
      await apiClient.post('/api/admin/zone-types', {
        name: newTypeName, description: newTypeDesc, isBuiltin: false,
        rule: { allowedAPIs: ['*'], forbiddenAPIs: [], rateLimits: {}, attributeEffects: [], customParams: {} },
      });
    } catch { /* ignore */ }
    setNewTypeName(''); setNewTypeDesc(''); await load();
  };

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
        <div style={{ color: C.textMuted, fontSize: 12 }}>{zones.length} 个 Zone</div>
        <button style={btn('primary')} onClick={() => setEditing({
          name: '', zoneTypeId: zoneTypes[0]?.id ?? '',
          bounds: { x1: 0, y1: 0, x2: 100, y2: 100 },
          style: { fillColor: '#1e3a5f', borderColor: '#3b82f6', opacity: 0.5 },
        })}>+ 新建 Zone</button>
      </div>

      {zones.map((z) => (
        <div key={z.id} style={{
          background: C.card, border: `1px solid ${C.border}`, borderRadius: 10,
          padding: '12px 16px', marginBottom: 8,
        }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <span style={{ color: C.text, fontWeight: 600 }}>{z.name}</span>
              <Badge color={C.purple}>{zoneTypes.find((t) => t.id === z.zoneTypeId)?.name ?? z.zoneTypeId}</Badge>
            </div>
            <div style={{ display: 'flex', gap: 6 }}>
              <button style={btn('ghost')} onClick={() => setEditing({ ...z })}>编辑</button>
              <button style={btn('danger')} onClick={() => deleteZone(z.id)}>删除</button>
            </div>
          </div>
          <div style={{ color: C.textMuted, fontSize: 12, marginTop: 6, fontFamily: 'monospace' }}>
            ({z.bounds.x1}, {z.bounds.y1}) → ({z.bounds.x2}, {z.bounds.y2})
          </div>
        </div>
      ))}

      {editing && (
        <Card style={{ marginTop: 16, border: `1px solid ${C.borderHover}` }}>
          <div style={{ color: C.text, fontWeight: 600, marginBottom: 16 }}>
            {editing.id ? '编辑 Zone' : '新建 Zone'}
          </div>
          <Field label="名称">
            <input style={input} value={editing.name ?? ''} onChange={(e) => setEditing({ ...editing, name: e.target.value })} />
          </Field>
          <Field label="Zone_Type">
            <select style={input} value={editing.zoneTypeId ?? ''} onChange={(e) => setEditing({ ...editing, zoneTypeId: e.target.value })}>
              {zoneTypes.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
            </select>
          </Field>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr 1fr', gap: 10 }}>
            {(['x1', 'y1', 'x2', 'y2'] as const).map((k) => (
              <Field key={k} label={k}>
                <input style={input} type="number" value={editing.bounds?.[k] ?? 0}
                  onChange={(e) => setEditing({ ...editing, bounds: { ...(editing.bounds ?? { x1: 0, y1: 0, x2: 0, y2: 0 }), [k]: Number(e.target.value) } })} />
              </Field>
            ))}
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <button style={btn('primary')} onClick={save}>保存</button>
            <button style={btn('ghost')} onClick={() => setEditing(null)}>取消</button>
          </div>
        </Card>
      )}

      <SectionTitle>Zone_Type 管理</SectionTitle>
      {zoneTypes.map((t) => (
        <div key={t.id} style={{
          display: 'flex', justifyContent: 'space-between', alignItems: 'center',
          padding: '10px 14px', background: C.card, border: `1px solid ${C.border}`,
          borderRadius: 8, marginBottom: 6, fontSize: 13,
        }}>
          <span style={{ color: C.text }}>{t.name}</span>
          <Badge color={t.isBuiltin ? C.textMuted : C.purple}>{t.isBuiltin ? '内置' : '自定义'}</Badge>
        </div>
      ))}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 2fr auto', gap: 10, marginTop: 12, alignItems: 'end' }}>
        <Field label="类型名称"><input style={input} placeholder="TypeName" value={newTypeName} onChange={(e) => setNewTypeName(e.target.value)} /></Field>
        <Field label="描述"><input style={input} placeholder="描述" value={newTypeDesc} onChange={(e) => setNewTypeDesc(e.target.value)} /></Field>
        <button style={{ ...btn('primary'), height: 38, marginBottom: 14 }} onClick={createZoneType}>创建</button>
      </div>
    </div>
  );
}

// ─── Skills Tab ───────────────────────────────────────────────────────────────

function SkillsTab() {
  const [skills, setSkills] = useState<SkillDocument[]>([]);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [content, setContent] = useState('');
  const [versions, setVersions] = useState<{ version: string; createdAt: number }[]>([]);
  const [showVersions, setShowVersions] = useState<string | null>(null);

  const load = useCallback(async () => {
    try { setSkills(await apiClient.get<SkillDocument[]>('/api/admin/skills')); } catch { /* ignore */ }
  }, []);

  useEffect(() => { load(); }, [load]);

  const upload = async () => {
    if (!content.trim()) return;
    try { await apiClient.post('/api/admin/skills', { markdownContent: content }); } catch { /* ignore */ }
    setContent(''); await load();
  };

  const update = async (id: string) => {
    try { await apiClient.put(`/api/admin/skills/${id}`, { markdownContent: content }); } catch { /* ignore */ }
    setEditingId(null); setContent(''); await load();
  };

  const deleteSkill = async (id: string) => {
    try { await apiClient.delete(`/api/admin/skills/${id}`); } catch { /* ignore */ }
    await load();
  };

  const loadVersions = async (id: string) => {
    try {
      const data = await apiClient.get<{ version: string; createdAt: number }[]>(`/api/admin/skills/${id}/versions`);
      setVersions(data);
    } catch { /* ignore */ }
    setShowVersions(id);
  };

  const rollback = async (id: string, version: string) => {
    try { await apiClient.post(`/api/admin/skills/${id}/rollback/${version}`); } catch { /* ignore */ }
    setShowVersions(null); await load();
  };

  return (
    <div>
      {skills.map((s) => (
        <div key={s.id} style={{
          background: C.card, border: `1px solid ${C.border}`, borderRadius: 10,
          padding: '14px 16px', marginBottom: 8,
        }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <span style={{ color: C.text, fontWeight: 600 }}>{s.metadata.name}</span>
              <Badge color={C.textMuted}>v{s.metadata.version}</Badge>
              {s.isDefault && <Badge color={C.yellow}>内置</Badge>}
            </div>
            <div style={{ display: 'flex', gap: 6 }}>
              <button style={btn('ghost')} onClick={() => { setEditingId(s.id); setContent(s.markdownContent); }}>编辑</button>
              <button style={btn('ghost')} onClick={() => loadVersions(s.id)}>版本历史</button>
              {!s.isDefault && <button style={btn('danger')} onClick={() => deleteSkill(s.id)}>删除</button>}
            </div>
          </div>
          <div style={{ color: C.textMuted, fontSize: 12, marginTop: 6 }}>{s.metadata.description}</div>

          {showVersions === s.id && (
            <div style={{ marginTop: 12, background: 'rgba(0,0,0,0.3)', borderRadius: 8, padding: 12 }}>
              <div style={{ color: C.accent, fontSize: 11, fontWeight: 700, marginBottom: 8 }}>版本历史</div>
              {versions.map((v) => (
                <div key={v.version} style={{
                  display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                  padding: '6px 0', borderBottom: `1px solid ${C.border}`, fontSize: 12,
                }}>
                  <span style={{ color: C.text }}>v{v.version}</span>
                  <span style={{ color: C.textMuted }}>{new Date(v.createdAt).toLocaleDateString()}</span>
                  <button style={{ ...btn('ghost'), padding: '4px 10px' }} onClick={() => rollback(s.id, v.version)}>回滚</button>
                </div>
              ))}
              <button style={{ ...btn('ghost'), marginTop: 8 }} onClick={() => setShowVersions(null)}>关闭</button>
            </div>
          )}
        </div>
      ))}

      <Card style={{ marginTop: 16 }}>
        <div style={{ color: C.text, fontWeight: 600, marginBottom: 12 }}>
          {editingId ? '编辑 Skill 文档' : '上传新 Skill 文档'}
        </div>
        <textarea
          style={{ ...input, height: 200, resize: 'vertical', fontFamily: 'monospace', fontSize: 12 }}
          placeholder="粘贴 SKILL.md 内容（需包含 YAML front matter）"
          value={content}
          onChange={(e) => setContent(e.target.value)}
        />
        <div style={{ display: 'flex', gap: 8, marginTop: 10 }}>
          {editingId ? (
            <>
              <button style={btn('primary')} onClick={() => update(editingId)}>保存更新</button>
              <button style={btn('ghost')} onClick={() => { setEditingId(null); setContent(''); }}>取消</button>
            </>
          ) : (
            <button style={btn('primary')} onClick={upload}>上传</button>
          )}
        </div>
      </Card>
    </div>
  );
}

// ─── Docs Tab ─────────────────────────────────────────────────────────────────

const PLATFORM_DOCS = ['RULES.md', 'MESSAGING.md', 'HEARTBEAT.md'] as const;

function DocsTab() {
  const [selectedDoc, setSelectedDoc] = useState<string>('RULES.md');
  const [content, setContent] = useState('');
  const [saved, setSaved] = useState(false);

  const load = useCallback(async (docName: string) => {
    try {
      const data = await apiClient.get<{ markdownContent: string }>(`/api/docs/${docName}`);
      setContent(data.markdownContent ?? '');
    } catch { /* ignore */ }
  }, []);

  useEffect(() => { load(selectedDoc); }, [selectedDoc, load]);

  const save = async () => {
    try { await apiClient.put(`/api/admin/docs/${selectedDoc}`, { markdownContent: content }); } catch { /* ignore */ }
    setSaved(true);
    setTimeout(() => setSaved(false), 2500);
  };

  return (
    <div>
      <div style={{ display: 'flex', gap: 8, marginBottom: 16 }}>
        {PLATFORM_DOCS.map((d) => (
          <button key={d} style={{
            ...btn(selectedDoc === d ? 'primary' : 'ghost'),
            flex: 1, padding: '10px',
          }} onClick={() => setSelectedDoc(d)}>{d}</button>
        ))}
      </div>
      <textarea
        style={{ ...input, height: 400, resize: 'vertical', fontFamily: 'monospace', fontSize: 12, lineHeight: 1.6 }}
        value={content}
        onChange={(e) => setContent(e.target.value)}
      />
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginTop: 12 }}>
        <button style={btn('primary')} onClick={save}>保存并通知选手</button>
        {saved && <span style={{ color: C.green, fontSize: 13 }}>✓ 已保存，已通知在线选手</span>}
      </div>
    </div>
  );
}

// ─── Heartbeat Tab ────────────────────────────────────────────────────────────

function HeartbeatTab() {
  const [config, setConfig] = useState<HeartbeatConfig>({ interval: 5000, timeout: 15000 });
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    apiClient.get<HeartbeatConfig>('/api/admin/heartbeat/config')
      .then((d) => setConfig(d)).catch(() => { /* ignore */ });
  }, []);

  const save = async () => {
    try { await apiClient.put('/api/admin/heartbeat/config', config); } catch { /* ignore */ }
    setSaved(true);
    setTimeout(() => setSaved(false), 2500);
  };

  return (
    <div>
      <Card>
        <div style={{ color: C.text, fontWeight: 600, marginBottom: 20 }}>心跳参数配置</div>

        <Field label={`心跳间隔 — ${config.interval / 1000}s (${config.interval}ms)`}>
          <input style={input} type="range" min={1000} max={30000} step={500} value={config.interval}
            onChange={(e) => setConfig({ ...config, interval: Number(e.target.value) })} />
          <div style={{ display: 'flex', justifyContent: 'space-between', color: C.textMuted, fontSize: 11, marginTop: 4 }}>
            <span>1s</span><span>30s</span>
          </div>
        </Field>

        <Field label={`心跳超时 — ${config.timeout / 1000}s (${config.timeout}ms)`}>
          <input style={input} type="range" min={3000} max={120000} step={1000} value={config.timeout}
            onChange={(e) => setConfig({ ...config, timeout: Number(e.target.value) })} />
          <div style={{ display: 'flex', justifyContent: 'space-between', color: C.textMuted, fontSize: 11, marginTop: 4 }}>
            <span>3s</span><span>120s</span>
          </div>
        </Field>

        <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginTop: 8 }}>
          <button style={btn('primary')} onClick={save}>保存配置</button>
          {saved && <span style={{ color: C.green, fontSize: 13 }}>✓ 已保存</span>}
        </div>
      </Card>
    </div>
  );
}

// ─── Event Log Tab ────────────────────────────────────────────────────────────

interface PlatformEvent {
  id: string;
  type: string;
  contestantId?: string;
  timestamp: number;
  data: unknown;
}

function EventLogTab() {
  const [events, setEvents] = useState<PlatformEvent[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(0);
  const [typeFilter, setTypeFilter] = useState('');
  const [keyFilter, setKeyFilter] = useState('');
  const [keys, setKeys] = useState<Key[]>([]);
  const PAGE_SIZE = 20;

  useEffect(() => {
    apiClient.get<Key[]>('/api/admin/keys').then(setKeys).catch(() => {});
  }, []);

  const load = useCallback(async () => {
    try {
      // If filtering by key, use the per-key log endpoint
      if (keyFilter) {
        const params = new URLSearchParams({
          limit: String(PAGE_SIZE),
          offset: String(page * PAGE_SIZE),
          ...(typeFilter ? { type: typeFilter } : {}),
        });
        const data = await apiClient.get<{ events: PlatformEvent[]; total: number }>(`/api/admin/logs/${keyFilter}?${params}`);
        setEvents(data.events);
        setTotal(data.total);
        return;
      }
      const params = new URLSearchParams({
        page: String(page + 1),
        page_size: String(PAGE_SIZE),
        ...(typeFilter ? { type: typeFilter } : {}),
      });
      const data = await apiClient.get<{ events: PlatformEvent[]; total: number }>(`/api/admin/events?${params}`);
      setEvents(data.events);
      setTotal(data.total);
    } catch { /* ignore */ }
  }, [page, typeFilter, keyFilter]);

  useEffect(() => { load(); }, [load]);

  const totalPages = Math.ceil(total / PAGE_SIZE);

  return (
    <div>
      <div style={{ display: 'flex', gap: 10, marginBottom: 16, alignItems: 'end', flexWrap: 'wrap' }}>
        <Field label="按 API Key 过滤">
          <select
            style={{ ...input, width: 200 }}
            value={keyFilter}
            onChange={(e) => { setKeyFilter(e.target.value); setPage(0); }}
          >
            <option value="">全部 Key</option>
            {keys.map((k) => (
              <option key={k.id} value={k.id}>{k.contestantName} ({k.role})</option>
            ))}
          </select>
        </Field>
        <Field label="事件类型过滤">
          <input style={{ ...input, width: 200 }} placeholder="move / talk / heartbeat…"
            value={typeFilter} onChange={(e) => { setTypeFilter(e.target.value); setPage(0); }} />
        </Field>
        <button style={{ ...btn('ghost'), height: 38, marginBottom: 14 }} onClick={load}>↻ 刷新</button>
      </div>

      <div style={{ color: C.textMuted, fontSize: 12, marginBottom: 10 }}>共 {total} 条事件</div>

      <div style={{ fontFamily: 'monospace', fontSize: 12 }}>
        {events.map((e) => (
          <div key={e.id} style={{
            display: 'grid', gridTemplateColumns: '160px 140px 1fr',
            gap: 12, padding: '8px 12px', borderBottom: `1px solid ${C.border}`,
            alignItems: 'center',
          }}>
            <span style={{ color: C.textMuted }}>{new Date(e.timestamp).toLocaleString()}</span>
            <span style={{
              display: 'inline-block', padding: '2px 8px', borderRadius: 20,
              fontSize: 11, fontWeight: 600,
              background: `${eventColor(e.type)}20`,
              color: eventColor(e.type),
              border: `1px solid ${eventColor(e.type)}40`,
            }}>{e.type}</span>
            <span style={{ color: C.textSub, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {e.contestantId && <span style={{ color: C.textMuted, marginRight: 8 }}>{e.contestantId}</span>}
              {JSON.stringify(e.data)}
            </span>
          </div>
        ))}
      </div>

      {totalPages > 1 && (
        <div style={{ display: 'flex', gap: 8, marginTop: 16, justifyContent: 'center' }}>
          <button style={btn('ghost')} disabled={page === 0} onClick={() => setPage(p => p - 1)}>← 上一页</button>
          <span style={{ color: C.textMuted, fontSize: 13, padding: '8px 12px' }}>
            {page + 1} / {totalPages}
          </span>
          <button style={btn('ghost')} disabled={page >= totalPages - 1} onClick={() => setPage(p => p + 1)}>下一页 →</button>
        </div>
      )}
    </div>
  );
}

// ─── Hackathon Tab ────────────────────────────────────────────────────────────

const ACT_LABELS: Record<number, { name: string; desc: string; emoji: string }> = {
  0: { name: '未开始', desc: '黑客松尚未开始', emoji: '⏸' },
  1: { name: '第一幕：自我介绍', desc: 'Agent 各自做一次自我介绍广播', emoji: '👋' },
  2: { name: '第二幕：破冰组队', desc: 'Agent 广播观点、私聊、组队', emoji: '🤝' },
  3: { name: '第三幕：协作产出', desc: 'Agent 讨论产品方向，协作写文档', emoji: '📝' },
};

function HackathonTab() {
  const [currentAct, setCurrentAct] = useState(0);
  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    try {
      const data = await apiClient.get<{ act: number }>('/api/hackathon/act');
      setCurrentAct(data.act);
    } catch { /* ignore */ }
  }, []);

  useEffect(() => { load(); }, [load]);

  const switchAct = async (act: number) => {
    setLoading(true);
    try {
      const data = await apiClient.post<{ act: number }>('/api/admin/hackathon/act', { act });
      setCurrentAct(data.act);
    } catch { /* ignore */ }
    setLoading(false);
  };

  return (
    <div>
      <Card style={{ marginBottom: 20 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 16 }}>
          <span style={{ fontSize: 28 }}>{ACT_LABELS[currentAct]?.emoji ?? '⏸'}</span>
          <div>
            <div style={{ color: C.text, fontWeight: 700, fontSize: 16 }}>
              当前：{ACT_LABELS[currentAct]?.name ?? '未知'}
            </div>
            <div style={{ color: C.textMuted, fontSize: 12, marginTop: 2 }}>
              {ACT_LABELS[currentAct]?.desc ?? ''}
            </div>
          </div>
        </div>
        <div style={{ color: C.textMuted, fontSize: 11, marginBottom: 4 }}>
          Agent 每次心跳会查询 <code style={{ color: C.accent }}>GET /api/hackathon/act</code>，
          然后 fetch 对应幕次的 skill 文件来执行。
        </div>
      </Card>

      <SectionTitle>切换幕次</SectionTitle>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
        {[0, 1, 2, 3].map((act) => {
          const info = ACT_LABELS[act]!;
          const isActive = currentAct === act;
          return (
            <div
              key={act}
              style={{
                background: isActive ? C.accentDim : C.card,
                border: `1px solid ${isActive ? C.accent : C.border}`,
                borderRadius: 12, padding: 16, cursor: loading ? 'wait' : 'pointer',
                transition: 'all 0.15s',
                opacity: loading ? 0.6 : 1,
              }}
              onClick={() => !loading && switchAct(act)}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 8 }}>
                <span style={{ fontSize: 22 }}>{info.emoji}</span>
                <span style={{
                  color: isActive ? C.accent : C.text,
                  fontWeight: 600, fontSize: 14,
                }}>
                  {info.name}
                </span>
                {isActive && (
                  <span style={{
                    background: `${C.green}20`, color: C.green,
                    padding: '2px 8px', borderRadius: 20, fontSize: 10, fontWeight: 600,
                  }}>
                    当前
                  </span>
                )}
              </div>
              <div style={{ color: C.textMuted, fontSize: 12 }}>{info.desc}</div>
              {act > 0 && (
                <div style={{ color: C.textSub, fontSize: 11, marginTop: 8, fontFamily: 'monospace' }}>
                  skill: act{act}-{act === 1 ? 'intro' : act === 2 ? 'team' : 'product'}.md
                </div>
              )}
            </div>
          );
        })}
      </div>

      <SectionTitle>Skill 文件预览</SectionTitle>
      <div style={{ color: C.textMuted, fontSize: 12, marginBottom: 12 }}>
        Agent 通过以下 URL 获取当前幕次的行为指令：
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        {[
          { act: 1, file: 'act1-intro.md', label: '第一幕' },
          { act: 2, file: 'act2-team.md', label: '第二幕' },
          { act: 3, file: 'act3-product.md', label: '第三幕' },
        ].map(({ act, file, label }) => (
          <div key={act} style={{
            display: 'flex', alignItems: 'center', gap: 10,
            padding: '8px 12px', background: C.card, border: `1px solid ${C.border}`,
            borderRadius: 8, fontSize: 12,
          }}>
            <span style={{ color: currentAct === act ? C.accent : C.textMuted, fontWeight: 600 }}>
              {label}
            </span>
            <code style={{ color: C.textSub, flex: 1 }}>
              http://localhost:3000/{file}
            </code>
            {currentAct === act && (
              <span style={{ color: C.green, fontSize: 11 }}>● 活跃</span>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

// ─── Product Doc Tab ──────────────────────────────────────────────────────────

function ProductDocTab() {
  const [content, setContent] = useState('');
  const [updatedAt, setUpdatedAt] = useState<number | null>(null);
  const [autoRefresh, setAutoRefresh] = useState(true);

  const load = useCallback(async () => {
    try {
      const data = await apiClient.get<{ content: string; updatedAt: number }>('/api/product');
      setContent(data.content);
      setUpdatedAt(data.updatedAt);
    } catch { /* ignore */ }
  }, []);

  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    if (!autoRefresh) return;
    const t = setInterval(load, 5000);
    return () => clearInterval(t);
  }, [autoRefresh, load]);

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
        <div style={{ color: C.textMuted, fontSize: 12 }}>
          {updatedAt ? `最后更新: ${new Date(updatedAt).toLocaleString('zh-CN')}` : ''}
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <button
            style={{ ...btn(autoRefresh ? 'success' : 'ghost'), fontSize: 11 }}
            onClick={() => setAutoRefresh(v => !v)}
          >
            {autoRefresh ? '⏸ 暂停自动刷新' : '▶ 自动刷新'}
          </button>
          <button style={btn('ghost')} onClick={load}>↻ 刷新</button>
        </div>
      </div>

      <Card style={{ padding: 0, overflow: 'hidden' }}>
        <div style={{
          padding: '10px 16px',
          borderBottom: `1px solid ${C.border}`,
          color: C.textMuted, fontSize: 11,
          display: 'flex', alignItems: 'center', gap: 8,
        }}>
          <span style={{ color: '#ff9f43', fontSize: 14 }}>🦞</span>
          <span>三只 AI 龙虾正在协作写这份产品文档 — 实时更新</span>
        </div>
        <pre style={{
          margin: 0, padding: '16px 20px',
          color: C.text, fontSize: 13, lineHeight: 1.7,
          fontFamily: '"Segoe UI", system-ui, sans-serif',
          whiteSpace: 'pre-wrap', wordBreak: 'break-word',
          minHeight: 400,
          overflowY: 'auto',
        }}>
          {content || <span style={{ color: C.textMuted }}>文档为空，等待 Agent 写入…</span>}
        </pre>
      </Card>
    </div>
  );
}

// ─── Broadcast History Tab ────────────────────────────────────────────────────

interface BroadcastRecord {
  id: string;
  senderId: string;
  senderName: string;
  content: string;
  timestamp: number;
}

function BroadcastHistoryTab() {
  const [messages, setMessages] = useState<BroadcastRecord[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(0);
  const [search, setSearch] = useState('');
  const PAGE_SIZE = 50;

  const load = useCallback(async () => {
    try {
      const params = new URLSearchParams({
        type: 'broadcast',
        page: String(page + 1),
        pageSize: String(PAGE_SIZE),
      });
      const data = await apiClient.get<{ messages: BroadcastRecord[]; total: number }>(
        `/api/admin/messages?${params}`
      );
      setMessages(data.messages);
      setTotal(data.total);
    } catch { /* ignore */ }
  }, [page]);

  useEffect(() => { load(); }, [load]);

  const totalPages = Math.ceil(total / PAGE_SIZE);

  const filtered = search.trim()
    ? messages.filter((m) =>
        m.content.toLowerCase().includes(search.toLowerCase()) ||
        m.senderName.toLowerCase().includes(search.toLowerCase())
      )
    : messages;

  return (
    <div>
      {/* 过滤栏 */}
      <div style={{ display: 'flex', gap: 10, marginBottom: 16, alignItems: 'end', flexWrap: 'wrap' }}>
        <Field label="关键词搜索">
          <input
            style={{ ...input, width: 260 }}
            placeholder="搜索消息内容或发送者…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </Field>
        <button style={{ ...btn('ghost'), height: 38, marginBottom: 14 }} onClick={load}>↻ 刷新</button>
      </div>

      <div style={{ color: C.textMuted, fontSize: 12, marginBottom: 10 }}>
        共 {total} 条广播{search ? `，当前页匹配 ${filtered.length} 条` : ''}
      </div>

      {/* 消息列表 */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        {filtered.length === 0 && (
          <div style={{ color: C.textMuted, textAlign: 'center', padding: '32px 0', fontSize: 13 }}>
            暂无广播记录
          </div>
        )}
        {filtered.map((msg) => (
          <div key={msg.id} style={{
            background: C.card,
            border: `1px solid ${C.border}`,
            borderRadius: 10,
            padding: '10px 14px',
            display: 'flex',
            flexDirection: 'column',
            gap: 4,
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <span style={{
                fontSize: 10, fontWeight: 700, padding: '2px 7px', borderRadius: 20,
                background: 'rgba(180,120,255,0.15)', color: '#d4a0ff',
                border: '1px solid rgba(180,120,255,0.3)', flexShrink: 0,
              }}>
                📢 广播
              </span>
              <span style={{ color: '#d4a0ff', fontWeight: 600, fontSize: 13 }}>
                {msg.senderName}
              </span>
              <span style={{ color: C.textMuted, fontSize: 11, marginLeft: 'auto' }}>
                {new Date(msg.timestamp).toLocaleString('zh-CN', {
                  month: '2-digit', day: '2-digit',
                  hour: '2-digit', minute: '2-digit', second: '2-digit',
                })}
              </span>
            </div>
            <div style={{
              color: C.text, fontSize: 13, lineHeight: 1.5,
              paddingLeft: 4, wordBreak: 'break-word',
            }}>
              {msg.content}
            </div>
          </div>
        ))}
      </div>

      {/* 分页 */}
      {totalPages > 1 && (
        <div style={{ display: 'flex', gap: 8, marginTop: 16, justifyContent: 'center', alignItems: 'center' }}>
          <button style={btn('ghost')} disabled={page === 0} onClick={() => setPage(p => p - 1)}>← 上一页</button>
          <span style={{ color: C.textMuted, fontSize: 13 }}>{page + 1} / {totalPages}</span>
          <button style={btn('ghost')} disabled={page >= totalPages - 1} onClick={() => setPage(p => p + 1)}>下一页 →</button>
        </div>
      )}
    </div>
  );
}

// ─── Navigation ───────────────────────────────────────────────────────────────

type NavId = 'overview' | 'hackathon' | 'keys' | 'zones' | 'skills' | 'docs' | 'heartbeat' | 'events' | 'broadcasts' | 'product';

const NAV: { id: NavId; icon: string; label: string }[] = [
  { id: 'overview', icon: '📊', label: '概览' },
  { id: 'hackathon', icon: '🎬', label: '幕次控制' },
  { id: 'product', icon: '🦞', label: '产品文档' },
  { id: 'broadcasts', icon: '📢', label: '广播历史' },
  { id: 'keys', icon: '🔑', label: 'API Keys' },
  { id: 'zones', icon: '🗺', label: 'Zones' },
  { id: 'skills', icon: '📄', label: 'Skills' },
  { id: 'docs', icon: '📋', label: '平台文档' },
  { id: 'heartbeat', icon: '💓', label: '心跳配置' },
  { id: 'events', icon: '📜', label: '事件日志' },
];

const PAGE_TITLES: Record<NavId, string> = {
  overview: '平台概览',
  hackathon: '🎬 黑客松幕次控制',
  product: '🦞 产品文档（Agent 协作）',
  broadcasts: '广播历史',
  keys: 'API Key 管理',
  zones: 'Zone 管理',
  skills: 'Skill 文档管理',
  docs: '平台文档编辑',
  heartbeat: '心跳配置',
  events: '事件日志',
};

// ─── AdminDashboard ───────────────────────────────────────────────────────────

export function AdminDashboard({ onLogout }: { onLogout: () => void }) {
  const [active, setActive] = useState<NavId>('overview');

  useEffect(() => {
    // Keep component alive for potential future clock display
    const t = setInterval(() => {}, 1000);
    return () => clearInterval(t);
  }, []);

  return (
    <div style={{
      display: 'flex', flexDirection: 'column', width: '100%', height: '100%', overflow: 'hidden',
      background: C.bg, fontFamily: '"Segoe UI", system-ui, sans-serif', color: C.text,
    }}>
      {/* Header */}
      <div style={{
        height: 56, borderBottom: `1px solid ${C.border}`,
        display: 'flex', alignItems: 'center', padding: '0 16px',
        background: 'rgba(255,255,255,0.02)', flexShrink: 0,
      }}>
        <div style={{ fontSize: 14, fontWeight: 700, color: C.text }}>
          {PAGE_TITLES[active]}
        </div>
      </div>

      {/* Main content */}
      <div style={{ flex: 1, display: 'flex', overflow: 'hidden' }}>
        {/* Sidebar nav */}
        <nav style={{
          width: 120, borderRight: `1px solid ${C.border}`,
          display: 'flex', flexDirection: 'column', padding: '8px',
          overflowY: 'auto', flexShrink: 0,
        }}>
          {NAV.map((n) => (
            <button
              key={n.id}
              onClick={() => setActive(n.id)}
              style={{
                display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4,
                width: '100%', padding: '8px', borderRadius: 8,
                border: 'none', cursor: 'pointer', marginBottom: 2,
                background: active === n.id ? C.accentDim : 'transparent',
                color: active === n.id ? C.accent : C.textSub,
                fontSize: 11, fontWeight: active === n.id ? 600 : 400,
                textAlign: 'center', transition: 'all 0.15s',
              }}
              title={n.label}
            >
              <span style={{ fontSize: 16 }}>{n.icon}</span>
              <span style={{ lineHeight: 1 }}>{n.label.split(' ')[0]}</span>
            </button>
          ))}
          <div style={{ flex: 1 }} />
          <button
            onClick={onLogout}
            style={{
              width: '100%', padding: '8px', borderRadius: 8, border: `1px solid ${C.border}`,
              background: 'transparent', color: C.textMuted, fontSize: 11, cursor: 'pointer',
              transition: 'all 0.15s',
            }}
            title="退出登录"
          >
            🚪
          </button>
        </nav>

        {/* Content area */}
        <div style={{ flex: 1, overflowY: 'auto', padding: 12 }}>
          {active === 'overview' && <OverviewTab />}
          {active === 'hackathon' && <HackathonTab />}
          {active === 'product' && <ProductDocTab />}
          {active === 'broadcasts' && <BroadcastHistoryTab />}
          {active === 'keys' && <KeysTab />}
          {active === 'zones' && <ZonesTab />}
          {active === 'skills' && <SkillsTab />}
          {active === 'docs' && <DocsTab />}
          {active === 'heartbeat' && <HeartbeatTab />}
          {active === 'events' && <EventLogTab />}
        </div>
      </div>
    </div>
  );
}

export default AdminDashboard;
