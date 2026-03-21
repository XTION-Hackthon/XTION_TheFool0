/**
 * map-editor-example.tsx
 * 地图编辑器使用示例
 * Requirements: 6
 *
 * 演示：嵌入 MapEditor 组件、通过 API 保存/加载/回滚配置
 */

import { useState, useEffect } from 'react';
import { MapEditor } from '../client/src/components/MapEditor';

// ─── 配置 ─────────────────────────────────────────────────────────────────────

const API_BASE = 'http://localhost:3000';
const TOKEN = 'your-api-token-here';

const headers = {
  'Content-Type': 'application/json',
  Authorization: `Bearer ${TOKEN}`,
};

// ─── 示例 1：在管理页面中嵌入 MapEditor 组件 ─────────────────────────────────

export function MapEditorExample() {
  const [roomId, setRoomId] = useState<string | null>(null);
  const [rooms, setRooms] = useState<Array<{ id: string; name: string }>>([]);
  const [editing, setEditing] = useState(false);

  // 加载房间列表
  useEffect(() => {
    fetch(`${API_BASE}/api/rooms`, { headers })
      .then((r) => r.json())
      .then(setRooms)
      .catch(console.error);
  }, []);

  return (
    <div style={{ padding: 24, fontFamily: 'monospace', color: '#e0e8ff', background: '#0d0d1a', minHeight: '100vh' }}>
      <h2>地图编辑器示例</h2>

      {/* 房间选择 */}
      <div style={{ marginBottom: 16 }}>
        <label>选择房间：</label>
        <select
          value={roomId ?? ''}
          onChange={(e) => setRoomId(e.target.value || null)}
          style={{ marginLeft: 8, background: '#1a1a2e', color: '#c0d0ff', border: '1px solid rgba(100,150,255,0.4)', padding: '4px 8px' }}
        >
          <option value="">-- 请选择 --</option>
          {rooms.map((r) => (
            <option key={r.id} value={r.id}>{r.name}</option>
          ))}
        </select>
      </div>

      {/* 打开编辑器按钮 */}
      <button
        disabled={!roomId}
        onClick={() => setEditing(true)}
        style={{ padding: '6px 16px', cursor: roomId ? 'pointer' : 'not-allowed', background: 'rgba(100,150,255,0.2)', color: '#c0d0ff', border: '1px solid rgba(100,150,255,0.5)', borderRadius: 4 }}
      >
        打开地图编辑器
      </button>

      {/* MapEditor 组件 */}
      {editing && roomId && (
        <MapEditor
          roomId={roomId}
          apiBaseUrl={API_BASE}
          authToken={TOKEN}
          onClose={() => setEditing(false)}
        />
      )}

      {/* API 示例面板 */}
      <ApiExamples />
    </div>
  );
}

// ─── 示例 2：通过 API 保存配置 ────────────────────────────────────────────────

async function saveConfigExample(roomId: string) {
  const config = {
    walls: [
      // 上边界墙
      { id: 'wall-top', roomId, x: 0, y: 0, width: 1280, height: 20, rotation: 0, createdAt: new Date().toISOString() },
      // 左边界墙
      { id: 'wall-left', roomId, x: 0, y: 0, width: 20, height: 720, rotation: 0, createdAt: new Date().toISOString() },
      // 中间隔断
      { id: 'wall-mid', roomId, x: 400, y: 100, width: 20, height: 300, rotation: 0, createdAt: new Date().toISOString() },
    ],
    spawnPoints: [
      { id: 'spawn-1', roomId, x: 100, y: 100, isAvailable: true, createdAt: new Date().toISOString() },
      { id: 'spawn-2', roomId, x: 600, y: 100, isAvailable: true, createdAt: new Date().toISOString() },
      { id: 'spawn-3', roomId, x: 100, y: 500, isAvailable: true, createdAt: new Date().toISOString() },
      { id: 'spawn-4', roomId, x: 600, y: 500, isAvailable: true, createdAt: new Date().toISOString() },
    ],
    bounds: { x1: 0, y1: 0, x2: 1280, y2: 720 },
  };

  const res = await fetch(`${API_BASE}/api/map-editor/rooms/${roomId}/config`, {
    method: 'POST',
    headers,
    body: JSON.stringify(config),
  });

  const { success, version } = await res.json();
  console.log(`配置已保存，版本号：${version}`);
  return version;
}

// ─── 示例 3：加载配置并显示摘要 ──────────────────────────────────────────────

async function loadConfigExample(roomId: string) {
  const res = await fetch(`${API_BASE}/api/map-editor/rooms/${roomId}/config`, { headers });

  if (res.status === 404) {
    console.log('该房间尚无配置');
    return null;
  }

  const config = await res.json();
  console.log(`已加载配置：${config.walls.length} 面墙，${config.spawnPoints.length} 个出生点`);
  return config;
}

// ─── 示例 4：查看历史版本并回滚 ──────────────────────────────────────────────

async function rollbackExample(roomId: string) {
  // 获取历史版本列表
  const history = await fetch(`${API_BASE}/api/map-editor/rooms/${roomId}/config/history`, { headers })
    .then((r) => r.json());

  console.log(`共 ${history.length} 个历史版本：`);
  history.forEach((v: { version: number; createdAt: string }) => {
    console.log(`  版本 ${v.version}，创建于 ${v.createdAt}`);
  });

  if (history.length < 2) {
    console.log('历史版本不足，无需回滚');
    return;
  }

  // 回滚到上一个版本
  const targetVersion = history[1]; // history[0] 是最新版本
  await fetch(`${API_BASE}/api/map-editor/rooms/${roomId}/config/rollback`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ versionId: targetVersion.id }),
  });

  console.log(`已回滚到版本 ${targetVersion.version}`);
}

// ─── API 示例面板组件 ─────────────────────────────────────────────────────────

function ApiExamples() {
  const [roomId, setRoomId] = useState('');
  const [log, setLog] = useState<string[]>([]);

  function appendLog(msg: string) {
    setLog((prev) => [...prev, msg]);
  }

  async function handleSave() {
    if (!roomId) return;
    const originalLog = console.log;
    console.log = (msg: string) => appendLog(msg);
    await saveConfigExample(roomId);
    console.log = originalLog;
  }

  async function handleLoad() {
    if (!roomId) return;
    const originalLog = console.log;
    console.log = (msg: string) => appendLog(msg);
    await loadConfigExample(roomId);
    console.log = originalLog;
  }

  async function handleRollback() {
    if (!roomId) return;
    const originalLog = console.log;
    console.log = (msg: string) => appendLog(msg);
    await rollbackExample(roomId);
    console.log = originalLog;
  }

  return (
    <div style={{ marginTop: 32, padding: 16, background: 'rgba(10,10,30,0.6)', border: '1px solid rgba(100,150,255,0.2)', borderRadius: 4 }}>
      <h3 style={{ marginTop: 0 }}>API 示例</h3>
      <div style={{ marginBottom: 12 }}>
        <label>房间 ID：</label>
        <input
          value={roomId}
          onChange={(e) => setRoomId(e.target.value)}
          placeholder="输入房间 ID"
          style={{ marginLeft: 8, background: '#1a1a2e', color: '#c0d0ff', border: '1px solid rgba(100,150,255,0.4)', padding: '4px 8px', width: 280 }}
        />
      </div>
      <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
        <button onClick={handleSave} style={{ padding: '4px 12px', cursor: 'pointer' }}>保存配置</button>
        <button onClick={handleLoad} style={{ padding: '4px 12px', cursor: 'pointer' }}>加载配置</button>
        <button onClick={handleRollback} style={{ padding: '4px 12px', cursor: 'pointer' }}>回滚配置</button>
      </div>
      <div style={{ fontFamily: 'monospace', fontSize: 12, color: '#80c0ff', maxHeight: 200, overflowY: 'auto' }}>
        {log.map((line, i) => <div key={i}>{line}</div>)}
      </div>
    </div>
  );
}

export default MapEditorExample;
