/**
 * AdminPanel — Admin management interface.
 *
 * Tabs:
 *   - Keys: generate, view, revoke, regenerate (Req 1.2)
 *   - Zones: create, edit, delete zones + Zone_Type management (Req 2.3, 2.5, 11.3)
 *   - Skills: upload, edit, view, delete, version management (Req 7.4)
 *   - Docs: edit RULES.md / MESSAGING.md (Req 12.4)
 *   - Heartbeat: configure interval/timeout (Req 9.5)
 *   - Map: background image, zone visual style (Req 2.9)
 *   - Monitor: platform status overview (Req 13.6)
 *
 * Requirements: 1.2, 2.3, 2.5, 2.9, 7.4, 9.5, 11.3, 12.4, 13.6
 */

import { useEffect, useState, useCallback } from 'react';
import { useUiStore } from '../stores/uiStore';
import { apiClient } from '../services/api-client';
import type { Key, Zone, ZoneType, SkillDocument, HeartbeatConfig } from '../../../server/src/types/index';

// ─── Shared styles ────────────────────────────────────────────────────────────

const inputStyle: React.CSSProperties = {
  background: 'rgba(255,255,255,0.07)', border: '1px solid rgba(120,180,255,0.3)',
  borderRadius: 6, color: '#e5e7eb', padding: '6px 10px', fontSize: 12, width: '100%', boxSizing: 'border-box',
};

const btnStyle = (variant: 'primary' | 'danger' | 'ghost' = 'primary'): React.CSSProperties => ({
  padding: '5px 12px', borderRadius: 6, fontSize: 12, fontWeight: 600, cursor: 'pointer',
  border: variant === 'ghost' ? '1px solid rgba(120,180,255,0.3)' : 'none',
  background: variant === 'primary' ? 'rgba(120,180,255,0.2)' : variant === 'danger' ? 'rgba(248,113,113,0.2)' : 'transparent',
  color: variant === 'primary' ? '#7ec8ff' : variant === 'danger' ? '#f87171' : '#9ca3af',
});

const labelStyle: React.CSSProperties = { color: '#9ca3af', fontSize: 11, marginBottom: 3, display: 'block' };

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return <div style={{ marginBottom: 10 }}><label style={labelStyle}>{label}</label>{children}</div>;
}

function SectionTitle({ children }: { children: React.ReactNode }) {
  return <div style={{ color: '#7ec8ff', fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 1, marginBottom: 8, marginTop: 16 }}>{children}</div>;
}

// ─── Keys Tab ─────────────────────────────────────────────────────────────────

function KeysTab() {
  const [keys, setKeys] = useState<Key[]>([]);
  const [newName, setNewName] = useState('');
  const [newRole, setNewRole] = useState<Key['role']>('Agent_Player');
  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    try {
      const data = await apiClient.get<Key[]>('/api/admin/keys');
      setKeys(data);
    } catch { /* ignore */ }
  }, []);

  useEffect(() => { load(); }, [load]);

  const generate = async () => {
    if (!newName.trim()) return;
    setLoading(true);
    try {
      await apiClient.post('/api/admin/keys', { name: newName, role: newRole });
      setNewName('');
      setNewRole('Agent_Player');
      await load();
    } finally {
      setLoading(false);
    }
  };

  const revoke = async (id: string) => {
    try { await apiClient.delete(`/api/admin/keys/${id}`); } catch { /* ignore */ }
    await load();
  };

  const regenerate = async (id: string) => {
    try { await apiClient.post(`/api/admin/keys/${id}/regenerate`); } catch { /* ignore */ }
    await load();
  };

  return (
    <div>
      <SectionTitle>生成新 Key</SectionTitle>
      <div style={{ display: 'flex', gap: 8, marginBottom: 16 }}>
        <input style={{ ...inputStyle, flex: 1 }} placeholder="选手名称" value={newName} onChange={(e) => setNewName(e.target.value)} />
        <select style={{ ...inputStyle, width: 160 }} value={newRole} onChange={(e) => setNewRole(e.target.value as Key['role'])}>
          <option value="Admin">Admin</option>
          <option value="Agent_Player">Agent_Player</option>
          <option value="Human_Viewer">Human_Viewer</option>
          <option value="Agent_Viewer">Agent_Viewer</option>
        </select>
        <button style={btnStyle('primary')} onClick={generate} disabled={loading}>生成</button>
      </div>
      <SectionTitle>Key 列表</SectionTitle>
      {keys.map((k) => (
        <div key={k.id} style={{ background: 'rgba(255,255,255,0.04)', borderRadius: 8, padding: '8px 12px', marginBottom: 6, fontSize: 11 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <div>
              <span style={{ color: '#e5e7eb', fontWeight: 600 }}>{k.contestantName}</span>
              <span style={{ color: k.status === 'active' ? '#4ade80' : '#f87171', marginLeft: 8 }}>{k.status}</span>
              <span style={{ color: '#a78bfa', marginLeft: 8 }}>{k.role}</span>
            </div>
            <div style={{ display: 'flex', gap: 6 }}>
              <button style={btnStyle('ghost')} onClick={() => regenerate(k.id)}>重新生成</button>
              {k.status === 'active' && <button style={btnStyle('danger')} onClick={() => revoke(k.id)}>吊销</button>}
            </div>
          </div>
          <div style={{ color: '#6b7280', marginTop: 4, fontFamily: 'monospace', wordBreak: 'break-all' }}>{k.key}</div>
        </div>
      ))}
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
      setZones(zData);
      setZoneTypes(ztData);
    } catch { /* ignore */ }
  }, []);

  useEffect(() => { load(); }, [load]);

  const save = async () => {
    if (!editing) return;
    try {
      if (editing.id) {
        await apiClient.put(`/api/admin/zones/${editing.id}`, editing);
      } else {
        await apiClient.post('/api/admin/zones', editing);
      }
    } catch { /* ignore */ }
    setEditing(null);
    await load();
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
    setNewTypeName(''); setNewTypeDesc('');
    await load();
  };

  return (
    <div>
      <SectionTitle>Zone 列表</SectionTitle>
      {zones.map((z) => (
        <div key={z.id} style={{ background: 'rgba(255,255,255,0.04)', borderRadius: 8, padding: '8px 12px', marginBottom: 6, fontSize: 11 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <div>
              <span style={{ color: '#e5e7eb', fontWeight: 600 }}>{z.name}</span>
              <span style={{ color: '#a78bfa', marginLeft: 8 }}>{zoneTypes.find((t) => t.id === z.zoneTypeId)?.name ?? z.zoneTypeId}</span>
            </div>
            <div style={{ display: 'flex', gap: 6 }}>
              <button style={btnStyle('ghost')} onClick={() => setEditing({ ...z })}>编辑</button>
              <button style={btnStyle('danger')} onClick={() => deleteZone(z.id)}>删除</button>
            </div>
          </div>
          <div style={{ color: '#6b7280', marginTop: 2 }}>
            ({z.bounds.x1},{z.bounds.y1}) → ({z.bounds.x2},{z.bounds.y2})
          </div>
        </div>
      ))}
      <button style={{ ...btnStyle('primary'), marginTop: 8 }} onClick={() => setEditing({ name: '', zoneTypeId: zoneTypes[0]?.id ?? '', bounds: { x1: 0, y1: 0, x2: 100, y2: 100 }, style: { fillColor: '#1e3a5f', borderColor: '#3b82f6', opacity: 0.5 } })}>
        + 新建 Zone
      </button>

      {editing && (
        <div style={{ background: 'rgba(120,180,255,0.08)', border: '1px solid rgba(120,180,255,0.3)', borderRadius: 8, padding: 12, marginTop: 12 }}>
          <Field label="名称"><input style={inputStyle} value={editing.name ?? ''} onChange={(e) => setEditing({ ...editing, name: e.target.value })} /></Field>
          <Field label="Zone_Type">
            <select style={inputStyle} value={editing.zoneTypeId ?? ''} onChange={(e) => setEditing({ ...editing, zoneTypeId: e.target.value })}>
              {zoneTypes.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
            </select>
          </Field>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr 1fr', gap: 6 }}>
            {(['x1', 'y1', 'x2', 'y2'] as const).map((k) => (
              <Field key={k} label={k}>
                <input style={inputStyle} type="number" value={editing.bounds?.[k] ?? 0}
                  onChange={(e) => setEditing({ ...editing, bounds: { ...(editing.bounds ?? { x1: 0, y1: 0, x2: 0, y2: 0 }), [k]: Number(e.target.value) } })} />
              </Field>
            ))}
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <button style={btnStyle('primary')} onClick={save}>保存</button>
            <button style={btnStyle('ghost')} onClick={() => setEditing(null)}>取消</button>
          </div>
        </div>
      )}

      <SectionTitle>Zone_Type 管理</SectionTitle>
      {zoneTypes.map((t) => (
        <div key={t.id} style={{ background: 'rgba(255,255,255,0.04)', borderRadius: 6, padding: '6px 10px', marginBottom: 4, fontSize: 11, display: 'flex', justifyContent: 'space-between' }}>
          <span style={{ color: '#e5e7eb' }}>{t.name}</span>
          <span style={{ color: t.isBuiltin ? '#6b7280' : '#a78bfa' }}>{t.isBuiltin ? '内置' : '自定义'}</span>
        </div>
      ))}
      <div style={{ display: 'flex', gap: 6, marginTop: 8 }}>
        <input style={{ ...inputStyle, flex: 1 }} placeholder="类型名称" value={newTypeName} onChange={(e) => setNewTypeName(e.target.value)} />
        <input style={{ ...inputStyle, flex: 2 }} placeholder="描述" value={newTypeDesc} onChange={(e) => setNewTypeDesc(e.target.value)} />
        <button style={btnStyle('primary')} onClick={createZoneType}>创建</button>
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
    try {
      const data = await apiClient.get<SkillDocument[]>('/api/admin/skills');
      setSkills(data);
    } catch { /* ignore */ }
  }, []);

  useEffect(() => { load(); }, [load]);

  const upload = async () => {
    if (!content.trim()) return;
    try { await apiClient.post('/api/admin/skills', { content }); } catch { /* ignore */ }
    setContent('');
    await load();
  };

  const update = async (id: string) => {
    try { await apiClient.put(`/api/admin/skills/${id}`, { content }); } catch { /* ignore */ }
    setEditingId(null);
    setContent('');
    await load();
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
    setShowVersions(null);
    await load();
  };

  return (
    <div>
      <SectionTitle>Skill 文档列表</SectionTitle>
      {skills.map((s) => (
        <div key={s.id} style={{ background: 'rgba(255,255,255,0.04)', borderRadius: 8, padding: '8px 12px', marginBottom: 6, fontSize: 11 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <div>
              <span style={{ color: '#e5e7eb', fontWeight: 600 }}>{s.metadata.name}</span>
              <span style={{ color: '#6b7280', marginLeft: 6 }}>v{s.metadata.version}</span>
              {s.isDefault && <span style={{ color: '#facc15', marginLeft: 6 }}>内置</span>}
            </div>
            <div style={{ display: 'flex', gap: 6 }}>
              <button
                style={btnStyle('ghost')}
                onClick={() => {
                  setEditingId(s.id);
                  setContent((s as SkillDocument & { content?: string }).content ?? s.markdownContent);
                }}
              >
                编辑
              </button>
              <button style={btnStyle('ghost')} onClick={() => loadVersions(s.id)}>版本</button>
              {!s.isDefault && <button style={btnStyle('danger')} onClick={() => deleteSkill(s.id)}>删除</button>}
            </div>
          </div>
          <div style={{ color: '#9ca3af', marginTop: 2 }}>{s.metadata.description}</div>

          {showVersions === s.id && (
            <div style={{ marginTop: 8, background: 'rgba(0,0,0,0.3)', borderRadius: 6, padding: 8 }}>
              <div style={{ color: '#7ec8ff', fontSize: 10, marginBottom: 4 }}>版本历史</div>
              {versions.map((v) => (
                <div key={v.version} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '3px 0' }}>
                  <span style={{ color: '#e5e7eb' }}>v{v.version}</span>
                  <span style={{ color: '#6b7280' }}>{new Date(v.createdAt).toLocaleDateString()}</span>
                  <button style={btnStyle('ghost')} onClick={() => rollback(s.id, v.version)}>回滚</button>
                </div>
              ))}
              <button style={{ ...btnStyle('ghost'), marginTop: 4 }} onClick={() => setShowVersions(null)}>关闭</button>
            </div>
          )}
        </div>
      ))}

      <SectionTitle>{editingId ? '编辑 Skill 文档' : '上传新 Skill 文档'}</SectionTitle>
      <textarea
        style={{ ...inputStyle, height: 160, resize: 'vertical', fontFamily: 'monospace' }}
        placeholder="粘贴 SKILL.md 内容（需包含 YAML front matter）"
        value={content}
        onChange={(e) => setContent(e.target.value)}
      />
      <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
        {editingId ? (
          <>
            <button style={btnStyle('primary')} onClick={() => update(editingId)}>保存更新</button>
            <button style={btnStyle('ghost')} onClick={() => { setEditingId(null); setContent(''); }}>取消</button>
          </>
        ) : (
          <button style={btnStyle('primary')} onClick={upload}>上传</button>
        )}
      </div>
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
    try { await apiClient.put(`/api/admin/docs/${selectedDoc}`, { content }); } catch { /* ignore */ }
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  };

  return (
    <div>
      <div style={{ display: 'flex', gap: 6, marginBottom: 12 }}>
        {PLATFORM_DOCS.map((d) => (
          <button key={d} style={{ ...btnStyle(selectedDoc === d ? 'primary' : 'ghost'), flex: 1 }} onClick={() => setSelectedDoc(d)}>{d}</button>
        ))}
      </div>
      <textarea
        style={{ ...inputStyle, height: 300, resize: 'vertical', fontFamily: 'monospace', fontSize: 11 }}
        value={content}
        onChange={(e) => setContent(e.target.value)}
      />
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 8 }}>
        <button style={btnStyle('primary')} onClick={save}>保存并通知</button>
        {saved && <span style={{ color: '#4ade80', fontSize: 12 }}>✓ 已保存，已通知在线选手</span>}
      </div>
    </div>
  );
}

// ─── Heartbeat Config Tab ─────────────────────────────────────────────────────

function HeartbeatConfigTab() {
  const [config, setConfig] = useState<HeartbeatConfig>({ interval: 10, timeout: 30 });
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    apiClient.get<HeartbeatConfig>('/api/admin/heartbeat/config')
      .then((d) => setConfig(d))
      .catch(() => { /* ignore */ });
  }, []);

  const save = async () => {
    try { await apiClient.put('/api/admin/heartbeat/config', config); } catch { /* ignore */ }
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  };

  return (
    <div>
      <SectionTitle>心跳配置</SectionTitle>
      <Field label={`心跳间隔 (秒) — 当前: ${config.interval}s`}>
        <input style={inputStyle} type="range" min={1} max={30} step={1} value={config.interval}
          onChange={(e) => setConfig({ ...config, interval: Number(e.target.value) })} />
      </Field>
      <Field label={`心跳超时 (秒) — 当前: ${config.timeout}s`}>
        <input style={inputStyle} type="range" min={3} max={120} step={1} value={config.timeout}
          onChange={(e) => setConfig({ ...config, timeout: Number(e.target.value) })} />
      </Field>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <button style={btnStyle('primary')} onClick={save}>保存</button>
        {saved && <span style={{ color: '#4ade80', fontSize: 12 }}>✓ 已保存</span>}
      </div>
    </div>
  );
}

// ─── Map Config Tab ───────────────────────────────────────────────────────────

function MapConfigTab() {
  const [bgImage, setBgImage] = useState('');
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    apiClient.get<{ backgroundImage?: string | null }>('/api/admin/map')
      .then((data) => setBgImage(data.backgroundImage ?? ''))
      .catch(() => { /* ignore */ });
  }, []);

  const save = async () => {
    try { await apiClient.put('/api/admin/map', { backgroundImage: bgImage }); } catch { /* ignore */ }
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  };

  return (
    <div>
      <SectionTitle>地图配置</SectionTitle>
      <Field label="背景图片 URL">
        <input style={inputStyle} placeholder="https://..." value={bgImage} onChange={(e) => setBgImage(e.target.value)} />
      </Field>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <button style={btnStyle('primary')} onClick={save}>保存</button>
        {saved && <span style={{ color: '#4ade80', fontSize: 12 }}>✓ 已保存</span>}
      </div>
      <div style={{ color: '#6b7280', fontSize: 11, marginTop: 12 }}>
        Zone 视觉样式可在 Zone 管理中编辑各 Zone 的 style 字段。
      </div>
    </div>
  );
}

// ─── Monitor Tab ──────────────────────────────────────────────────────────────

interface MonitorData {
  onlineCount: number;
  zonePopulation: Array<{
    zoneId?: string;
    zoneName?: string;
    zone_id?: string;
    zone_name?: string;
    count: number;
  }>;
  recentApiCallsPerMinute: number;
  heartbeatAnomalies: Array<{
    contestantId: string;
    healthStatus?: string;
  }>;
}

interface LegacyMonitorData {
  onlineCount: number;
  zoneDistribution?: Record<string, number>;
  apiCallRate?: number;
  heartbeatAnomalies?: string[];
}

function normalizeMonitorData(raw: MonitorData | LegacyMonitorData): MonitorData {
  const legacy = raw as LegacyMonitorData;
  const normalizedZonePopulation = Array.isArray((raw as MonitorData).zonePopulation)
    ? (raw as MonitorData).zonePopulation
    : Object.entries(legacy.zoneDistribution ?? {}).map(([zoneName, count]) => ({
      zoneName,
      count,
    }));

  const normalizedAnomalies = Array.isArray((raw as MonitorData).heartbeatAnomalies)
    ? (raw as MonitorData).heartbeatAnomalies.map((item) => {
      if (typeof item === 'string') {
        return { contestantId: item };
      }
      return item;
    })
    : [];

  return {
    onlineCount: raw.onlineCount ?? 0,
    zonePopulation: normalizedZonePopulation,
    recentApiCallsPerMinute: (raw as MonitorData).recentApiCallsPerMinute ?? legacy.apiCallRate ?? 0,
    heartbeatAnomalies: normalizedAnomalies,
  };
}

function MonitorTab() {
  const [data, setData] = useState<MonitorData | null>(null);

  const load = useCallback(async () => {
    try {
      const raw = await apiClient.get<MonitorData | LegacyMonitorData>('/api/admin/monitor');
      setData(normalizeMonitorData(raw));
    } catch { /* ignore */ }
  }, []);

  useEffect(() => {
    load();
    const interval = setInterval(load, 5000);
    return () => clearInterval(interval);
  }, [load]);

  if (!data) return <div style={{ color: '#6b7280', fontSize: 12, padding: 16 }}>加载中…</div>;

  return (
    <div>
      <SectionTitle>平台概览</SectionTitle>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginBottom: 12 }}>
        <div style={{ background: 'rgba(74,222,128,0.1)', border: '1px solid rgba(74,222,128,0.3)', borderRadius: 8, padding: 12, textAlign: 'center' }}>
          <div style={{ color: '#4ade80', fontSize: 24, fontWeight: 700 }}>{data.onlineCount}</div>
          <div style={{ color: '#9ca3af', fontSize: 11 }}>在线选手</div>
        </div>
        <div style={{ background: 'rgba(120,180,255,0.1)', border: '1px solid rgba(120,180,255,0.3)', borderRadius: 8, padding: 12, textAlign: 'center' }}>
          <div style={{ color: '#7ec8ff', fontSize: 24, fontWeight: 700 }}>{data.recentApiCallsPerMinute}</div>
          <div style={{ color: '#9ca3af', fontSize: 11 }}>API 调用/分钟</div>
        </div>
      </div>

      <SectionTitle>Zone 人数分布</SectionTitle>
      {data.zonePopulation.map((zone) => {
        const zoneKey = zone.zoneId ?? zone.zone_id ?? zone.zoneName ?? zone.zone_name ?? 'unknown';
        const zoneLabel = zone.zoneName ?? zone.zone_name ?? zone.zoneId ?? zone.zone_id ?? 'Unknown Zone';
        return (
          <div key={zoneKey} style={{ display: 'flex', justifyContent: 'space-between', padding: '4px 0', fontSize: 12, borderBottom: '1px solid rgba(255,255,255,0.05)' }}>
            <span style={{ color: '#e5e7eb' }}>{zoneLabel}</span>
            <span style={{ color: '#7ec8ff' }}>{zone.count} 人</span>
          </div>
        );
      })}

      {data.heartbeatAnomalies.length > 0 && (
        <>
          <SectionTitle>心跳异常</SectionTitle>
          {data.heartbeatAnomalies.map((item) => (
            <div key={item.contestantId} style={{ color: '#f87171', fontSize: 11, padding: '3px 0' }}>
              ⚠ {item.contestantId}
              {item.healthStatus ? ` (${item.healthStatus})` : ''}
            </div>
          ))}
        </>
      )}

      <button style={{ ...btnStyle('ghost'), marginTop: 12 }} onClick={load}>刷新</button>
    </div>
  );
}

// ─── Main AdminPanel ──────────────────────────────────────────────────────────

type TabId = 'keys' | 'zones' | 'skills' | 'docs' | 'heartbeat' | 'map' | 'monitor';

const TABS: { id: TabId; label: string }[] = [
  { id: 'keys', label: '🔑 Keys' },
  { id: 'zones', label: '🗺 Zones' },
  { id: 'skills', label: '📄 Skills' },
  { id: 'docs', label: '📋 文档' },
  { id: 'heartbeat', label: '💓 心跳' },
  { id: 'map', label: '🖼 地图' },
  { id: 'monitor', label: '📊 监控' },
];

export function AdminPanel() {
  const showAdmin = useUiStore((s) => s.showAdminPanel);
  const setShowAdmin = useUiStore((s) => s.setShowAdminPanel);
  const [activeTab, setActiveTab] = useState<TabId>('keys');

  return (
    <>
      {/* Toggle button */}
      <button
        onClick={() => setShowAdmin(!showAdmin)}
        style={{
          position: 'fixed', top: 16, right: 16,
          background: showAdmin ? 'rgba(120,180,255,0.2)' : 'rgba(15,15,30,0.9)',
          border: '1px solid rgba(120,180,255,0.4)', borderRadius: 8,
          color: '#7ec8ff', padding: '8px 14px', cursor: 'pointer',
          fontSize: 13, fontWeight: 600, zIndex: 300,
          boxShadow: '0 4px 12px rgba(0,0,0,0.4)',
        }}
      >
        ⚙ 管理
      </button>

      {showAdmin && (
        <div
          style={{
            position: 'fixed', top: 0, left: 0, bottom: 0, width: 380,
            background: 'rgba(10, 10, 25, 0.98)',
            border: '1px solid rgba(120,180,255,0.2)',
            borderLeft: 'none', zIndex: 250,
            display: 'flex', flexDirection: 'column',
            boxShadow: '4px 0 24px rgba(0,0,0,0.6)',
            backdropFilter: 'blur(12px)',
          }}
        >
          {/* Header */}
          <div style={{ padding: '16px 16px 0', borderBottom: '1px solid rgba(255,255,255,0.08)' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
              <span style={{ color: '#f0f9ff', fontSize: 15, fontWeight: 700 }}>⚙ 管理面板</span>
              <button onClick={() => setShowAdmin(false)} style={{ background: 'none', border: 'none', color: '#6b7280', cursor: 'pointer', fontSize: 18 }}>×</button>
            </div>
            {/* Tabs */}
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, paddingBottom: 12 }}>
              {TABS.map((t) => (
                <button
                  key={t.id}
                  onClick={() => setActiveTab(t.id)}
                  style={{
                    padding: '4px 10px', borderRadius: 6, fontSize: 11, fontWeight: 600, cursor: 'pointer',
                    border: 'none',
                    background: activeTab === t.id ? 'rgba(120,180,255,0.25)' : 'rgba(255,255,255,0.05)',
                    color: activeTab === t.id ? '#7ec8ff' : '#9ca3af',
                  }}
                >
                  {t.label}
                </button>
              ))}
            </div>
          </div>

          {/* Tab content */}
          <div style={{ flex: 1, overflowY: 'auto', padding: 16 }}>
            {activeTab === 'keys' && <KeysTab />}
            {activeTab === 'zones' && <ZonesTab />}
            {activeTab === 'skills' && <SkillsTab />}
            {activeTab === 'docs' && <DocsTab />}
            {activeTab === 'heartbeat' && <HeartbeatConfigTab />}
            {activeTab === 'map' && <MapConfigTab />}
            {activeTab === 'monitor' && <MonitorTab />}
          </div>
        </div>
      )}
    </>
  );
}

export default AdminPanel;
