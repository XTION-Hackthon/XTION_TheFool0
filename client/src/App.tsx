/**
 * App — root React component
 * 首页：API Key 输入 → 验证角色 → Admin 进管理后台，其他角色进游戏界面
 */

import { useEffect, useRef, useState } from 'react';
import Phaser from 'phaser';
import { createGame } from './game';
import { initStores } from './stores';
import { useRoleStore } from './stores/roleStore';
import { wsClient } from './services/ws-client';
import { UIOverlay } from './components/UIOverlay';
import { AttributePanel } from './components/AttributePanel';
import { AdminDashboard } from './components/AdminDashboard.js';
import { BarrageInput, VoteButtons } from './components/ViewerInteraction';
import { apiClient } from './services/api-client';

initStores();

function getWsUrl(): string {
  const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  return `${proto}//${window.location.host}/ws`;
}

function getStoredKey(): string {
  const params = new URLSearchParams(window.location.search);
  const keyFromUrl = params.get('key');
  if (keyFromUrl) {
    localStorage.setItem('openclaw_key', keyFromUrl);
    return keyFromUrl;
  }
  return localStorage.getItem('openclaw_key') ?? '';
}

async function fetchInitialData(): Promise<void> {
  // Nothing to pre-fetch — world.state comes via WebSocket
}

// ─── Key Login Screen ─────────────────────────────────────────────────────────

function KeyLoginScreen({ onConnect }: { onConnect: (key: string) => void }) {
  const [inputKey, setInputKey] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const handleConnect = async () => {
    const k = inputKey.trim();
    if (!k) return;
    setLoading(true);
    setError('');
    try {
      // Validate key before connecting
      localStorage.setItem('openclaw_key', k);
      const me = await apiClient.get<{ role: string }>('/api/auth/me');
      if (!me?.role) throw new Error('无效的 API Key');
      onConnect(k);
    } catch {
      localStorage.removeItem('openclaw_key');
      setError('API Key 无效或无法连接服务器');
      setLoading(false);
    }
  };

  return (
    <div style={{
      display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
      width: '100vw', height: '100vh',
      background: 'linear-gradient(135deg, #0a0a1a 0%, #0d1b2a 50%, #0a0a1a 100%)',
      fontFamily: '"Segoe UI", system-ui, sans-serif',
    }}>
      {/* Logo area */}
      <div style={{ marginBottom: 48, textAlign: 'center' }}>
        <div style={{
          fontSize: 13, letterSpacing: 6, color: '#4a9eff', textTransform: 'uppercase',
          marginBottom: 12, fontWeight: 500,
        }}>XTION Platform</div>
        <div style={{ fontSize: 36, fontWeight: 800, color: '#f0f9ff', letterSpacing: 2 }}>
          TheFool<span style={{ color: '#4a9eff' }}>0</span>
        </div>
        <div style={{ color: '#4b5563', fontSize: 13, marginTop: 8 }}>
          输入您的 API Key 以接入平台
        </div>
      </div>

      {/* Card */}
      <div style={{
        background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(74,158,255,0.2)',
        borderRadius: 16, padding: '36px 40px', width: 400,
        boxShadow: '0 24px 64px rgba(0,0,0,0.5)',
      }}>
        <div style={{ marginBottom: 20 }}>
          <label style={{ display: 'block', color: '#9ca3af', fontSize: 12, marginBottom: 8, letterSpacing: 1 }}>
            API KEY
          </label>
          <input
            type="password"
            placeholder="sk-..."
            value={inputKey}
            onChange={(e) => setInputKey(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && handleConnect()}
            autoFocus
            style={{
              width: '100%', padding: '12px 16px', fontSize: 14,
              background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(74,158,255,0.25)',
              borderRadius: 10, color: '#f0f9ff', outline: 'none', boxSizing: 'border-box',
              transition: 'border-color 0.2s',
            }}
          />
        </div>

        {error && (
          <div style={{
            background: 'rgba(248,113,113,0.1)', border: '1px solid rgba(248,113,113,0.3)',
            borderRadius: 8, padding: '10px 14px', color: '#f87171', fontSize: 12, marginBottom: 16,
          }}>
            ⚠ {error}
          </div>
        )}

        <button
          onClick={handleConnect}
          disabled={loading || !inputKey.trim()}
          style={{
            width: '100%', padding: '13px', fontSize: 14, fontWeight: 600,
            background: loading || !inputKey.trim()
              ? 'rgba(74,158,255,0.2)'
              : 'linear-gradient(135deg, #2563eb, #4a9eff)',
            border: 'none', borderRadius: 10, color: '#fff',
            cursor: loading || !inputKey.trim() ? 'not-allowed' : 'pointer',
            transition: 'all 0.2s', letterSpacing: 0.5,
          }}
        >
          {loading ? '验证中…' : '连接平台'}
        </button>
      </div>

      <div style={{ color: '#1f2937', fontSize: 11, marginTop: 32 }}>
        XTION_TheFool0 · Powered by OpenClaw
      </div>
    </div>
  );
}

// ─── Game View (non-admin roles) ──────────────────────────────────────────────

function GameView() {
  const containerRef = useRef<HTMLDivElement>(null);
  const gameRef = useRef<Phaser.Game | null>(null);
  const [connecting, setConnecting] = useState(true);
  const [connected, setConnected] = useState(false);
  const role = useRoleStore((s) => s.role);
  const fetchRole = useRoleStore((s) => s.fetchRole);
  const key = localStorage.getItem('openclaw_key') ?? '';

  useEffect(() => {
    const wsUrl = getWsUrl();
    wsClient.connect(wsUrl, key);

    const unsub = wsClient.onConnect(() => {
      setConnecting(false);
      setConnected(true);
      fetchRole();
    });
    const unsubDisc = wsClient.onDisconnect(() => {
      setConnecting(false);
      setConnected(false);
    });

    return () => { unsub(); unsubDisc(); wsClient.disconnect(); };
  }, [key, fetchRole]);

  useEffect(() => {
    if (!connected || !containerRef.current || gameRef.current) return;
    gameRef.current = createGame(containerRef.current);
    return () => { gameRef.current?.destroy(true); gameRef.current = null; };
  }, [connected]);

  return (
    <div style={{ position: 'relative', width: '100vw', height: '100vh', overflow: 'hidden', background: '#1a1a2e' }}>
      <div ref={containerRef} style={{ width: '100%', height: '100%' }} />

      {connecting && (
        <div style={{
          position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center',
          background: 'rgba(0,0,0,0.7)', color: '#fff', fontSize: 16,
          fontFamily: 'system-ui, sans-serif', zIndex: 1000,
        }}>
          <div style={{ textAlign: 'center' }}>
            <div style={{ fontSize: 24, marginBottom: 12 }}>⟳</div>
            正在连接服务器…
          </div>
        </div>
      )}

      <UIOverlay />
      <AttributePanel />
      {role === 'Human_Viewer' && <VoteButtons />}
      {role === 'Human_Viewer' && <BarrageInput />}
    </div>
  );
}

// ─── Admin Game View (game + floating dashboard) ─────────────────────────────

function AdminGameView({ onLogout }: { onLogout: () => void }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const gameRef = useRef<Phaser.Game | null>(null);
  const [showPanel, setShowPanel] = useState(false);
  const key = localStorage.getItem('openclaw_key') ?? '';

  // Connect Admin as read-only WebSocket observer so gameStore gets populated
  useEffect(() => {
    const wsUrl = getWsUrl();
    wsClient.connect(wsUrl, key);
    return () => { wsClient.disconnect(); };
  }, [key]);

  useEffect(() => {
    // Small delay to ensure the container div is fully rendered and sized
    const timer = setTimeout(() => {
      if (containerRef.current && !gameRef.current) {
        gameRef.current = createGame(containerRef.current);
      }
    }, 50);
    return () => {
      clearTimeout(timer);
      gameRef.current?.destroy(true);
      gameRef.current = null;
    };
  }, []);

  return (
    <div style={{ position: 'relative', width: '100vw', height: '100vh', overflow: 'hidden', background: '#1a1a2e' }}>
      <div ref={containerRef} style={{ width: '100%', height: '100%' }} />

      {/* Toggle button */}
      <button
        onClick={() => setShowPanel((v) => !v)}
        style={{
          position: 'absolute', top: 12, right: 12, zIndex: 200,
          width: 44, height: 44, borderRadius: 12,
          background: showPanel ? 'rgba(74,158,255,0.25)' : 'rgba(0,0,0,0.6)',
          border: '1px solid rgba(74,158,255,0.4)',
          color: '#4a9eff', fontSize: 20, cursor: 'pointer',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          backdropFilter: 'blur(8px)', transition: 'all 0.2s',
        }}
        title={showPanel ? '关闭管理面板' : '打开管理面板'}
      >
        {showPanel ? '✕' : '⚙'}
      </button>

      {/* Floating panel overlay */}
      {showPanel && (
        <div style={{
          position: 'absolute', top: 12, right: 64, bottom: 12, zIndex: 160,
          width: 'min(680px, calc(100vw - 88px))',
          borderRadius: 16, overflow: 'hidden',
          border: '1px solid rgba(74,158,255,0.25)',
          boxShadow: '0 24px 80px rgba(0,0,0,0.6)',
          pointerEvents: 'auto',
        }}>
          <AdminDashboard onLogout={onLogout} />
        </div>
      )}
    </div>
  );
}

// ─── App Root ─────────────────────────────────────────────────────────────────

function App() {
  const [key, setKey] = useState<string>(getStoredKey);
  const [role, setRole] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  // If key already stored, fetch role on mount
  useEffect(() => {
    if (!key) return;
    setLoading(true);
    apiClient.get<{ role: string }>('/api/auth/me')
      .then((me) => setRole(me.role))
      .catch(() => {
        localStorage.removeItem('openclaw_key');
        setKey('');
      })
      .finally(() => setLoading(false));
  }, [key]);

  const handleConnect = (newKey: string) => {
    setKey(newKey);
    apiClient.get<{ role: string }>('/api/auth/me')
      .then((me) => setRole(me.role))
      .catch(() => { /* handled in login screen */ });
  };

  const handleLogout = () => {
    localStorage.removeItem('openclaw_key');
    setKey('');
    setRole(null);
    wsClient.disconnect();
  };

  if (!key || (!role && !loading)) {
    return <KeyLoginScreen onConnect={handleConnect} />;
  }

  if (loading) {
    return (
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        width: '100vw', height: '100vh', background: '#0a0a1a', color: '#4a9eff',
        fontSize: 16, fontFamily: 'system-ui, sans-serif',
      }}>
        正在验证身份…
      </div>
    );
  }

  if (role === 'Admin') {
    return <AdminGameView onLogout={handleLogout} />;
  }

  return <GameView />;
}

export default App;
