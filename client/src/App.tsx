/**
 * App — root React component
 * Initializes Zustand stores (WebSocket event wiring) and mounts the Phaser game.
 * Handles WebSocket connection setup with key authentication.
 * Requirements: 6.1, 6.5, 6.6, 6.10, 8.4, 8.5, 10.2
 */

import { useEffect, useRef, useState } from 'react';
import Phaser from 'phaser';
import { createGame } from './game';
import { initStores } from './stores';
import { useRoleStore } from './stores/roleStore';
import { wsClient } from './services/ws-client';
import { UIOverlay } from './components/UIOverlay';
import { AttributePanel } from './components/AttributePanel';
import { HeartbeatOverview } from './components/HeartbeatOverview';
import { AdminPanel } from './components/AdminPanel';
import { BarrageInput, VoteButtons } from './components/ViewerInteraction';
import { RoomList } from './components/RoomList';
import { RoomManagementPanel } from './components/RoomManagementPanel';
import { apiClient } from './services/api-client';
import { useDoorwayStore } from './stores/doorwayStore';
import type { Doorway } from './stores/doorwayStore';

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

/**
 * Fetch all doorways from the API and initialize the doorwayStore.
 * If no rooms exist yet, create a default layout: two rooms connected by a doorway.
 * Requirement: 7.5
 */
async function fetchDoorwaysAndInitLayout(): Promise<void> {
  try {
    // Fetch and initialize doorway store
    const doorways = await apiClient.get<Doorway[]>('/api/doorways');
    useDoorwayStore.getState().setDoorways(doorways);
  } catch (err) {
    console.error('[App] Failed to fetch doorways:', err);
  }

  try {
    // Check if any rooms exist; if not, create a default two-room layout with a doorway
    const rooms = await apiClient.get<Array<{ id: string }>>('/api/rooms');
    if (rooms.length === 0) {
      // Create Room A (left)
      const roomA = await apiClient.post<{ id: string }>('/api/rooms', {
        name: 'Room A',
        type: 'MainHall',
        capacity: 50,
        bounds: { x1: 0, y1: 0, x2: 800, y2: 600 },
      });
      // Create Room B (right, sharing the right wall of Room A)
      const roomB = await apiClient.post<{ id: string }>('/api/rooms', {
        name: 'Room B',
        type: 'PrivateRoom',
        capacity: 10,
        bounds: { x1: 800, y1: 0, x2: 1600, y2: 600 },
      });
      // Create a doorway on the shared boundary (x=800) between the two rooms
      const doorway = await apiClient.post<Doorway>('/api/doorways', {
        roomAId: roomA.id,
        roomBId: roomB.id,
        x: 800,
        y: 250,
        width: 100,
        height: 100,
      });
      useDoorwayStore.getState().addDoorway(doorway);
      console.log('[App] Default layout initialized: Room A ↔ Room B via doorway', doorway.id);
    }
  } catch (err) {
    console.error('[App] Failed to initialize default layout:', err);
  }
}

function App() {
  const containerRef = useRef<HTMLDivElement>(null);
  const gameRef = useRef<Phaser.Game | null>(null);
  const [key, setKey] = useState<string>(getStoredKey);
  const [inputKey, setInputKey] = useState('');
  const [connecting, setConnecting] = useState(false);
  const [connected, setConnected] = useState(false);
  const role = useRoleStore((s) => s.role);
  const fetchRole = useRoleStore((s) => s.fetchRole);

  // Connect WebSocket when key is available
  useEffect(() => {
    if (!key) return;

    setConnecting(true);
    const wsUrl = getWsUrl();
    wsClient.connect(wsUrl, key);

    const unsub = wsClient.onConnect(() => {
      setConnecting(false);
      setConnected(true);
      fetchRole();
      // Fetch doorways and initialize default layout after connection
      fetchDoorwaysAndInitLayout();
    });
    const unsubDisc = wsClient.onDisconnect(() => {
      setConnecting(false);
      setConnected(false);
    });

    return () => {
      unsub();
      unsubDisc();
      wsClient.disconnect();
    };
  }, [key, fetchRole]);

  // Mount Phaser game only after connected
  useEffect(() => {
    if (!connected || !containerRef.current || gameRef.current) return;

    gameRef.current = createGame(containerRef.current);

    return () => {
      gameRef.current?.destroy(true);
      gameRef.current = null;
    };
  }, [connected]);

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
      {/* Phaser canvas container */}
      <div ref={containerRef} style={{ width: '100%', height: '100%' }} />

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

      {/* React UI overlay — talk bubbles, broadcast banner, barrage */}
      <UIOverlay />
      {/* Attribute panel — shown when a Sprite is clicked */}
      <AttributePanel />
      {/* Vote buttons — shown when a Sprite is selected (Human_Viewer only) */}
      {role === 'Human_Viewer' && <VoteButtons />}
      {/* Heartbeat overview panel + flash alerts (Admin only) */}
      {role === 'Admin' && <HeartbeatOverview />}
      {/* Admin panel (Admin only) */}
      {role === 'Admin' && <AdminPanel />}
      {/* Barrage input (Human_Viewer only) */}
      {role === 'Human_Viewer' && <BarrageInput />}

      {/* Room list panel — shown when connected */}
      {connected && (
        <div style={{ position: 'absolute', top: 10, right: 10, zIndex: 50 }}>
          <RoomList
            currentBotId=""
            onJoinRoom={(roomId) => {
              apiClient.post(`/api/rooms/${roomId}/join`, { botId: 'self' }).catch((err) => {
                console.error('[App] join room error:', err);
              });
            }}
            onLeaveRoom={(roomId) => {
              apiClient.post(`/api/rooms/${roomId}/leave`, { botId: 'self' }).catch((err) => {
                console.error('[App] leave room error:', err);
              });
            }}
          />
        </div>
      )}

      {/* Room management panel — shown when connected */}
      {connected && (
        <div style={{ position: 'absolute', bottom: 10, right: 10, zIndex: 50 }}>
          <RoomManagementPanel
            currentBotId=""
            onSwitchRoom={(roomId) => {
              apiClient.post(`/api/rooms/${roomId}/join`, { botId: 'self' }).catch((err) => {
                console.error('[App] switch room error:', err);
              });
            }}
          />
        </div>
      )}
    </div>
  );
}

export default App;
