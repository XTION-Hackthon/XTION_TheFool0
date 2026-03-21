/**
 * App — root React component
 * Initializes Zustand stores (WebSocket event wiring) and mounts the Phaser game.
 * Handles WebSocket connection setup with key authentication.
 * Requirements: 6.1, 6.5, 6.6, 6.10, 8.4, 8.5, 10.2
 */

import { Suspense, lazy, useEffect, useState } from 'react';
import { initStores } from './stores';
import { useRoleStore } from './stores/roleStore';
import { useGameStore } from './stores/gameStore';
import { wsClient } from './services/ws-client';
import { apiClient } from './services/api-client';
import { UIOverlay } from './components/UIOverlay';
import { AttributePanel } from './components/AttributePanel';
import { BarrageInput, VoteButtons } from './components/ViewerInteraction';
import { useUiStore } from './stores/uiStore';
import { GameViewport } from './GameViewport';

const HeartbeatOverview = lazy(() => import('./components/HeartbeatOverview'));
const AdminPanel = lazy(() => import('./components/AdminPanel'));

// Initialize stores once (wires WebSocket events → Zustand)
initStores();

/**
 * Resolve the WebSocket URL.
 * In development (Vite proxy), use relative path /ws which proxies to ws://localhost:8080/ws.
 * In production, derive from window.location.
 */
function getWsUrl(): string {
  const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  return `${proto}//${window.location.host}/ws`;
}

/**
 * Read the API key from URL query params (?key=xxx) or localStorage.
 */
function getStoredKey(): string {
  const params = new URLSearchParams(window.location.search);
  const keyFromUrl = params.get('key');
  if (keyFromUrl) {
    localStorage.setItem('openclaw_key', keyFromUrl);
    return keyFromUrl;
  }
  return localStorage.getItem('openclaw_key') ?? '';
}

function App() {
  const [key, setKey] = useState<string>(getStoredKey);
  const [inputKey, setInputKey] = useState('');
  const [connecting, setConnecting] = useState(false);
  const role = useRoleStore((s) => s.role);
  const fetchRole = useRoleStore((s) => s.fetchRole);
  const resetRole = useRoleStore((s) => s.reset);
  const initWorldState = useGameStore((s) => s.initWorldState);
  const resetWorld = useGameStore((s) => s.reset);
  const notifications = useUiStore((s) => s.notifications);
  const dismissNotification = useUiStore((s) => s.dismissNotification);

  // Resolve role first, then only open WebSocket for roles that are allowed to use it.
  useEffect(() => {
    let active = true;
    let unsub = () => {};
    let unsubDisc = () => {};

    if (!key) {
      wsClient.disconnect();
      resetRole();
      resetWorld();
      setConnecting(false);
      return;
    }

    setConnecting(true);
    resetWorld();

    void (async () => {
      try {
        const roleInfo = await fetchRole();
        if (!active) return;

        if (!roleInfo) {
          setConnecting(false);
          wsClient.disconnect();
          resetWorld();
          return;
        }

        if (roleInfo.role === 'Human_Viewer') {
          const [world, contestants] = await Promise.all([
            apiClient.get<{ map: { width: number; height: number }; zones: Array<{ id: string; name: string; bounds: { x1: number; y1: number; x2: number; y2: number }; zoneTypeId: string; style: { fillColor: string; borderColor: string; opacity: number; icon?: string } }> }>('/api/world'),
            apiClient.get<Array<{ id: string; name: string; status: 'online' | 'offline' | 'busy' | 'timeout'; position: { x: number; y: number }; currentZoneId: string | null }>>('/api/contestants'),
          ]);
          if (!active) return;

          initWorldState({
            map: {
              width: world.map.width,
              height: world.map.height,
              defaultZoneId: world.zones[0]?.id ?? '',
              zones: world.zones,
            },
            zones: world.zones,
            contestants: contestants.map((contestant) => ({
              ...contestant,
              keyId: '',
              energy: 100,
              installedSkills: [],
              attributes: {},
            })),
          });
          wsClient.disconnect();
          setConnecting(false);
          return;
        }

        const wsUrl = getWsUrl();
        unsub = wsClient.onConnect(() => {
          setConnecting(false);
        });
        unsubDisc = wsClient.onDisconnect(() => setConnecting(false));
        wsClient.connect(wsUrl, key);
      } catch {
        if (!active) return;
        setConnecting(false);
        wsClient.disconnect();
        resetWorld();
      }
    })();

    return () => {
      active = false;
      unsub();
      unsubDisc();
      wsClient.disconnect();
    };
  }, [key, fetchRole, resetRole, initWorldState, resetWorld]);

  // Key entry screen — shown when no key is configured
  if (!key) {
    return (
      <div
        style={{
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          width: '100vw',
          height: '100vh',
          background: '#1a1a2e',
          color: '#fff',
          fontFamily: 'Arial, sans-serif',
          gap: 16,
        }}
      >
        <h2 style={{ margin: 0, fontSize: 24 }}>XTION_TheFool0</h2>
        <p style={{ margin: 0, color: '#aaa', fontSize: 14 }}>请输入您的 API Key 以接入平台</p>
        <input
          type="text"
          placeholder="API Key"
          value={inputKey}
          onChange={(e) => setInputKey(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && inputKey.trim()) {
              const k = inputKey.trim();
              localStorage.setItem('openclaw_key', k);
              setKey(k);
            }
          }}
          style={{
            padding: '10px 16px',
            fontSize: 14,
            borderRadius: 6,
            border: '1px solid #444',
            background: '#2a2a4e',
            color: '#fff',
            width: 320,
            outline: 'none',
          }}
        />
        <button
          onClick={() => {
            const k = inputKey.trim();
            if (k) {
              localStorage.setItem('openclaw_key', k);
              setKey(k);
            }
          }}
          style={{
            padding: '10px 24px',
            fontSize: 14,
            borderRadius: 6,
            border: 'none',
            background: '#4caf50',
            color: '#fff',
            cursor: 'pointer',
          }}
        >
          连接
        </button>
      </div>
    );
  }

  return (
    <div
      style={{
        position: 'relative',
        width: '100vw',
        height: '100vh',
        overflow: 'hidden',
        background: '#1a1a2e',
      }}
    >
      <GameViewport />

      {/* Connecting overlay */}
      {connecting && (
        <div
          style={{
            position: 'absolute',
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            background: 'rgba(0,0,0,0.6)',
            color: '#fff',
            fontSize: 18,
            fontFamily: 'Arial, sans-serif',
            zIndex: 1000,
          }}
        >
          正在连接服务器…
        </div>
      )}

      {notifications.map((notification, index) => (
        <div
          key={notification.id}
          onClick={() => dismissNotification(notification.id)}
          style={{
            position: 'absolute',
            top: 16 + index * 52,
            right: 16,
            minWidth: 180,
            padding: '10px 14px',
            borderRadius: 10,
            background: notification.type === 'error' ? 'rgba(180, 32, 32, 0.95)' : 'rgba(30, 30, 60, 0.95)',
            color: '#fff',
            fontSize: 13,
            fontFamily: 'Arial, sans-serif',
            zIndex: 1100,
            boxShadow: '0 4px 14px rgba(0,0,0,0.35)',
            cursor: 'pointer',
          }}
        >
          {notification.message}
        </div>
      ))}

      {/* React UI overlay — talk bubbles, broadcast banner, barrage */}
      <UIOverlay />
      {/* Attribute panel — shown when a Sprite is clicked */}
      <AttributePanel />
      {/* Vote buttons — shown when a Sprite is selected (Human_Viewer only) */}
      {role === 'Human_Viewer' && <VoteButtons />}
      {/* Heartbeat overview panel + flash alerts (Admin only) */}
      {role === 'Admin' && (
        <Suspense fallback={null}>
          <HeartbeatOverview />
        </Suspense>
      )}
      {/* Admin panel (Admin only) */}
      {role === 'Admin' && (
        <Suspense fallback={null}>
          <AdminPanel />
        </Suspense>
      )}
      {/* Barrage input (Human_Viewer only) */}
      {role === 'Human_Viewer' && <BarrageInput />}
    </div>
  );
}

export default App;
