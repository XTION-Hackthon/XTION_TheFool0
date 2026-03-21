/**
 * HeartbeatOverview — Panel showing all contestants' heartbeat status.
 *
 * Features:
 *   - List of all contestants with heartbeat status, last heartbeat time, key payload metrics (Req 9.13)
 *   - Screen-edge flash alert when any contestant goes timeout/offline (Req 9.14)
 *
 * Requirements: 9.13, 9.14
 */

import { useEffect, useState, useRef } from 'react';
import { useGameStore } from '../stores/gameStore';
import { useUiStore } from '../stores/uiStore';
import { apiClient } from '../services/api-client';
import type { Contestant, HeartbeatRecord } from '../../../server/src/types/index';

// ─── Types ────────────────────────────────────────────────────────────────────

interface ContestantHbData {
  contestantId: string;
  name: string;
  status: Contestant['status'];
  lastTimestamp: number | null;
  cpuLoad: number | null;
  memoryUsage: number | null;
  responseLatency: number | null;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function hbStatusColor(status: Contestant['status']): string {
  switch (status) {
    case 'online': return '#4ade80';
    case 'busy': return '#facc15';
    case 'timeout': return '#f87171';
    case 'offline': return '#6b7280';
    default: return '#9ca3af';
  }
}

function hbStatusLabel(status: Contestant['status']): string {
  switch (status) {
    case 'online': return '正常';
    case 'busy': return '忙碌';
    case 'timeout': return '超时';
    case 'offline': return '离线';
    default: return status;
  }
}

function formatRelativeTime(ts: number | null): string {
  if (ts === null) return '—';
  const diff = Date.now() - ts;
  if (diff < 1000) return '刚刚';
  if (diff < 60000) return `${Math.floor(diff / 1000)}s 前`;
  return `${Math.floor(diff / 60000)}m 前`;
}

// ─── Flash Alert Overlay ──────────────────────────────────────────────────────

function FlashAlert() {
  const alerts = useUiStore((s) => s.heartbeatAlerts);
  const dismiss = useUiStore((s) => s.dismissHeartbeatAlert);
  const [visible, setVisible] = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (alerts.length === 0) return;
    setVisible(true);
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => {
      setVisible(false);
      alerts.forEach((a) => dismiss(a.contestantId));
    }, 3000);
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, [alerts, dismiss]);

  if (!visible || alerts.length === 0) return null;

  const latest = alerts[alerts.length - 1];

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        pointerEvents: 'none',
        zIndex: 9999,
        animation: 'hbFlash 0.5s ease-in-out 3',
      }}
    >
      {/* Edge flash borders */}
      <div style={{ position: 'absolute', inset: 0, border: '4px solid rgba(248, 113, 113, 0.8)', borderRadius: 0, pointerEvents: 'none' }} />
      {/* Alert badge */}
      <div
        style={{
          position: 'absolute',
          top: 16,
          left: '50%',
          transform: 'translateX(-50%)',
          background: 'rgba(220, 38, 38, 0.95)',
          color: '#fff',
          padding: '8px 20px',
          borderRadius: 8,
          fontSize: 14,
          fontWeight: 700,
          boxShadow: '0 4px 16px rgba(220,38,38,0.5)',
        }}
      >
        ⚠ 心跳告警：{latest.contestantId.slice(0, 8)}… 状态变为 {latest.status === 'timeout' ? '超时' : '离线'}
      </div>
    </div>
  );
}

// ─── Contestant Row ───────────────────────────────────────────────────────────

function ContestantRow({ data }: { data: ContestantHbData }) {
  const isAlert = data.status === 'timeout' || data.status === 'offline';
  return (
    <div
      style={{
        display: 'grid',
        gridTemplateColumns: '1fr 60px 70px 50px 50px 60px',
        gap: 4,
        padding: '6px 8px',
        borderRadius: 6,
        background: isAlert ? 'rgba(248, 113, 113, 0.08)' : 'rgba(255,255,255,0.03)',
        borderLeft: `3px solid ${hbStatusColor(data.status)}`,
        marginBottom: 4,
        fontSize: 11,
        alignItems: 'center',
      }}
    >
      <div style={{ color: '#e5e7eb', fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
        {data.name}
      </div>
      <div style={{ color: hbStatusColor(data.status), fontWeight: 600 }}>{hbStatusLabel(data.status)}</div>
      <div style={{ color: '#9ca3af' }}>{formatRelativeTime(data.lastTimestamp)}</div>
      <div style={{ color: '#fbbf24' }}>{data.cpuLoad !== null ? `${data.cpuLoad}%` : '—'}</div>
      <div style={{ color: '#60a5fa' }}>{data.memoryUsage !== null ? `${data.memoryUsage}%` : '—'}</div>
      <div style={{ color: '#a78bfa' }}>{data.responseLatency !== null ? `${data.responseLatency}ms` : '—'}</div>
    </div>
  );
}

// ─── Main Component ───────────────────────────────────────────────────────────

export function HeartbeatOverview() {
  const showOverview = useUiStore((s) => s.showHeartbeatOverview);
  const setShowOverview = useUiStore((s) => s.setShowHeartbeatOverview);
  const contestants = useGameStore((s) => s.contestants);

  const [hbData, setHbData] = useState<Map<string, ContestantHbData>>(new Map());

  // Poll heartbeat history for all contestants
  useEffect(() => {
    if (!showOverview) return;

    const fetchAll = async () => {
      const entries = Array.from(contestants.values());
      const results = await Promise.allSettled(
        entries.map(async (c) => {
          try {
            const data = await apiClient.get<{ contestantId: string; history: HeartbeatRecord[] }>(
              `/api/admin/contestants/${c.id}/heartbeat-history?limit=1`,
            );
            return { id: c.id, name: c.name, status: c.status, record: data.history?.[0] ?? null };
          } catch {
            return { id: c.id, name: c.name, status: c.status, record: null };
          }
        })
      );

      const next = new Map<string, ContestantHbData>();
      for (const r of results) {
        if (r.status === 'fulfilled') {
          const { id, name, status, record } = r.value;
          next.set(id, {
            contestantId: id,
            name,
            status,
            lastTimestamp: record?.timestamp ?? null,
            cpuLoad: record?.payload.cpuLoad ?? null,
            memoryUsage: record?.payload.memoryUsage ?? null,
            responseLatency: record?.payload.responseLatency ?? null,
          });
        }
      }
      setHbData(next);
    };

    fetchAll();
    const interval = setInterval(fetchAll, 5000);
    return () => clearInterval(interval);
  }, [showOverview, contestants]);

  // Keep status in sync with store (no extra fetch needed)
  useEffect(() => {
    setHbData((prev) => {
      const next = new Map(prev);
      for (const [id, c] of contestants) {
        const existing = next.get(id);
        if (existing) {
          next.set(id, { ...existing, status: c.status });
        }
      }
      return next;
    });
  }, [contestants]);

  const rows = Array.from(hbData.values()).sort((a, b) => {
    // Sort: timeout/offline first
    const priority = (s: Contestant['status']) => (s === 'timeout' ? 0 : s === 'offline' ? 1 : 2);
    return priority(a.status) - priority(b.status);
  });

  return (
    <>
      <FlashAlert />

      {/* Toggle button */}
      <button
        onClick={() => setShowOverview(!showOverview)}
        style={{
          position: 'fixed',
          bottom: 16,
          right: 16,
          background: showOverview ? 'rgba(120, 180, 255, 0.2)' : 'rgba(15, 15, 30, 0.9)',
          border: '1px solid rgba(120, 180, 255, 0.4)',
          borderRadius: 8,
          color: '#7ec8ff',
          padding: '8px 14px',
          cursor: 'pointer',
          fontSize: 13,
          fontWeight: 600,
          zIndex: 200,
          boxShadow: '0 4px 12px rgba(0,0,0,0.4)',
        }}
      >
        💓 心跳监控 {rows.filter((r) => r.status === 'timeout' || r.status === 'offline').length > 0
          ? `⚠ ${rows.filter((r) => r.status === 'timeout' || r.status === 'offline').length}`
          : ''}
      </button>

      {showOverview && (
        <div
          style={{
            position: 'fixed',
            bottom: 60,
            right: 16,
            width: 420,
            maxHeight: 400,
            background: 'rgba(15, 15, 30, 0.97)',
            border: '1px solid rgba(120, 180, 255, 0.3)',
            borderRadius: 12,
            padding: 16,
            zIndex: 200,
            boxShadow: '0 8px 32px rgba(0,0,0,0.6)',
            backdropFilter: 'blur(8px)',
            overflowY: 'auto',
          }}
        >
          <div style={{ color: '#7ec8ff', fontSize: 13, fontWeight: 700, marginBottom: 10 }}>
            💓 心跳概览 ({rows.length} 位选手)
          </div>

          {/* Column headers */}
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: '1fr 60px 70px 50px 50px 60px',
              gap: 4,
              padding: '0 8px 6px',
              fontSize: 10,
              color: '#6b7280',
              borderBottom: '1px solid rgba(255,255,255,0.1)',
              marginBottom: 6,
            }}
          >
            <div>名称</div>
            <div>状态</div>
            <div>最近心跳</div>
            <div>CPU</div>
            <div>内存</div>
            <div>延迟</div>
          </div>

          {rows.length === 0 ? (
            <div style={{ color: '#6b7280', fontSize: 12, textAlign: 'center', padding: 16 }}>暂无选手数据</div>
          ) : (
            rows.map((r) => <ContestantRow key={r.contestantId} data={r} />)
          )}
        </div>
      )}
    </>
  );
}

export default HeartbeatOverview;
