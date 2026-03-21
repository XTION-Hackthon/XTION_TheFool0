/**
 * MapEditor — Visual map editor for room walls, spawn points, and doorways.
 * Requirements: 6, 9.1, 9.2, 9.3, 9.4, 9.5, 9.6, 9.7, 3.5
 */

import { useEffect, useRef, useState } from 'react';
import { useEditorStore } from '../stores/editorStore';
import type { Wall, SpawnPoint, Room } from '../stores/roomStore';
import type { Doorway } from '../stores/doorwayStore';

// ─── Props ────────────────────────────────────────────────────────────────────

export interface MapEditorProps {
  roomId: string;
  apiBaseUrl: string;
  authToken: string;
  /** All rooms in the world map (needed for doorway shared-boundary detection) */
  rooms?: Room[];
  onClose?: () => void;
}

// ─── Constants ────────────────────────────────────────────────────────────────

const CANVAS_W = 600;
const CANVAS_H = 400;
const WALL_COLOR = 'rgba(100, 150, 255, 0.6)';
const SPAWN_COLOR = 'rgba(100, 255, 100, 0.8)';
const SPAWN_RADIUS = 8;
const SELECTED_BORDER = 'rgba(255, 220, 0, 0.9)';
const DOORWAY_COLOR = 'rgba(255, 180, 50, 0.85)';
const DOORWAY_DASH: number[] = [6, 4];
const MIN_DOORWAY_WIDTH = 32; // bot collision box width
const SHARED_BOUNDARY_TOLERANCE = 8; // px tolerance for clicking near a shared boundary

// ─── Styles ───────────────────────────────────────────────────────────────────

const containerStyle: React.CSSProperties = {
  position: 'fixed',
  inset: 0,
  background: 'rgba(0,0,0,0.75)',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  zIndex: 100,
};

const panelStyle: React.CSSProperties = {
  background: '#1a1a2e',
  border: '1px solid rgba(100,150,255,0.4)',
  borderRadius: 8,
  padding: 16,
  display: 'flex',
  flexDirection: 'column',
  gap: 12,
  maxWidth: 800,
  width: '100%',
  color: '#e0e8ff',
  fontFamily: 'monospace',
};

const toolbarStyle: React.CSSProperties = {
  display: 'flex',
  gap: 8,
  alignItems: 'center',
};

const btnBase: React.CSSProperties = {
  padding: '4px 12px',
  borderRadius: 4,
  border: '1px solid rgba(100,150,255,0.5)',
  background: 'rgba(30,40,80,0.8)',
  color: '#c0d0ff',
  cursor: 'pointer',
  fontSize: 13,
};

const btnActive: React.CSSProperties = {
  ...btnBase,
  background: 'rgba(100,150,255,0.35)',
  borderColor: 'rgba(100,150,255,0.9)',
  color: '#fff',
};

const btnDoorwayActive: React.CSSProperties = {
  ...btnBase,
  background: 'rgba(255,180,50,0.3)',
  borderColor: 'rgba(255,180,50,0.9)',
  color: '#ffcc66',
};

const bodyStyle: React.CSSProperties = {
  display: 'flex',
  gap: 12,
};

const canvasStyle: React.CSSProperties = {
  border: '1px solid rgba(100,150,255,0.3)',
  borderRadius: 4,
  cursor: 'crosshair',
  background: '#0d0d1a',
  flexShrink: 0,
};

const canvasOverlapStyle: React.CSSProperties = {
  ...canvasStyle,
  border: '2px solid rgba(255,60,60,0.9)',
  boxShadow: '0 0 8px rgba(255,60,60,0.5)',
};

const propPanelStyle: React.CSSProperties = {
  flex: 1,
  background: 'rgba(10,10,30,0.6)',
  border: '1px solid rgba(100,150,255,0.2)',
  borderRadius: 4,
  padding: 12,
  fontSize: 13,
  minWidth: 160,
};

const inputStyle: React.CSSProperties = {
  width: '100%',
  background: 'rgba(20,30,60,0.8)',
  border: '1px solid rgba(100,150,255,0.3)',
  borderRadius: 3,
  color: '#c0d0ff',
  padding: '2px 6px',
  fontSize: 12,
  boxSizing: 'border-box',
};

const errorStyle: React.CSSProperties = {
  color: '#ff8080',
  fontSize: 12,
  marginTop: 4,
};

const warningStyle: React.CSSProperties = {
  color: '#ffcc44',
  fontSize: 12,
  marginTop: 4,
  background: 'rgba(255,200,0,0.08)',
  border: '1px solid rgba(255,200,0,0.3)',
  borderRadius: 3,
  padding: '4px 6px',
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Check if two room bounds overlap (AABB).
 * Requirements: 1.4, 9.7
 */
function boundsOverlap(
  a: { x1: number; y1: number; x2: number; y2: number },
  b: { x1: number; y1: number; x2: number; y2: number }
): boolean {
  return a.x1 < b.x2 && a.x2 > b.x1 && a.y1 < b.y2 && a.y2 > b.y1;
}

/**
 * Detect if a canvas click position is near a shared boundary between two rooms.
 * Returns the shared boundary info if found, or null.
 * Requirements: 9.3
 */
interface SharedBoundary {
  roomA: Room;
  roomB: Room;
  /** 'vertical' = shared left/right edge, 'horizontal' = shared top/bottom edge */
  orientation: 'vertical' | 'horizontal';
  /** The x or y coordinate of the shared edge line */
  edgeCoord: number;
  /** The range along the perpendicular axis where the rooms overlap */
  rangeMin: number;
  rangeMax: number;
}

function findSharedBoundaryAtPoint(
  canvasX: number,
  canvasY: number,
  rooms: Room[],
  canvasW: number,
  canvasH: number,
  worldBounds: { x1: number; y1: number; x2: number; y2: number }
): SharedBoundary | null {
  // Map canvas coords to world coords
  const scaleX = (worldBounds.x2 - worldBounds.x1) / canvasW;
  const scaleY = (worldBounds.y2 - worldBounds.y1) / canvasH;
  const wx = worldBounds.x1 + canvasX * scaleX;
  const wy = worldBounds.y1 + canvasY * scaleY;
  const tolX = SHARED_BOUNDARY_TOLERANCE * scaleX;
  const tolY = SHARED_BOUNDARY_TOLERANCE * scaleY;

  for (let i = 0; i < rooms.length; i++) {
    for (let j = i + 1; j < rooms.length; j++) {
      const a = rooms[i];
      const b = rooms[j];
      if (!a.bounds || !b.bounds) continue;
      const ab = a.bounds;
      const bb = b.bounds;

      // Check vertical shared boundary: a.x2 ≈ b.x1 or b.x2 ≈ a.x1
      const vertEdge =
        Math.abs(ab.x2 - bb.x1) < tolX ? ab.x2 :
        Math.abs(bb.x2 - ab.x1) < tolX ? bb.x2 : null;

      if (vertEdge !== null && Math.abs(wx - vertEdge) < tolX) {
        const rangeMin = Math.max(ab.y1, bb.y1);
        const rangeMax = Math.min(ab.y2, bb.y2);
        if (rangeMax > rangeMin && wy >= rangeMin - tolY && wy <= rangeMax + tolY) {
          return { roomA: a, roomB: b, orientation: 'vertical', edgeCoord: vertEdge, rangeMin, rangeMax };
        }
      }

      // Check horizontal shared boundary: a.y2 ≈ b.y1 or b.y2 ≈ a.y1
      const horizEdge =
        Math.abs(ab.y2 - bb.y1) < tolY ? ab.y2 :
        Math.abs(bb.y2 - ab.y1) < tolY ? bb.y2 : null;

      if (horizEdge !== null && Math.abs(wy - horizEdge) < tolY) {
        const rangeMin = Math.max(ab.x1, bb.x1);
        const rangeMax = Math.min(ab.x2, bb.x2);
        if (rangeMax > rangeMin && wx >= rangeMin - tolX && wx <= rangeMax + tolX) {
          return { roomA: a, roomB: b, orientation: 'horizontal', edgeCoord: horizEdge, rangeMin, rangeMax };
        }
      }
    }
  }
  return null;
}

/** Convert world coordinate to canvas coordinate */
function worldToCanvas(
  wx: number, wy: number,
  canvasW: number, canvasH: number,
  worldBounds: { x1: number; y1: number; x2: number; y2: number }
): { cx: number; cy: number } {
  const scaleX = canvasW / (worldBounds.x2 - worldBounds.x1);
  const scaleY = canvasH / (worldBounds.y2 - worldBounds.y1);
  return {
    cx: (wx - worldBounds.x1) * scaleX,
    cy: (wy - worldBounds.y1) * scaleY,
  };
}

// ─── Doorway Panel ────────────────────────────────────────────────────────────

interface DoorwayPanelProps {
  boundary: SharedBoundary;
  onConfirm: (doorway: Omit<Doorway, 'id' | 'createdAt'>) => void;
  onCancel: () => void;
  clickWorldX: number;
  clickWorldY: number;
}

function DoorwayPanel({ boundary, onConfirm, onCancel, clickWorldX, clickWorldY }: DoorwayPanelProps) {
  const [width, setWidth] = useState(64);

  const x = boundary.orientation === 'vertical' ? boundary.edgeCoord : clickWorldX;
  const y = boundary.orientation === 'horizontal' ? boundary.edgeCoord : clickWorldY;
  // For vertical boundaries the doorway height spans the opening; for horizontal, width spans it
  const actualHeight = boundary.orientation === 'horizontal' ? width : 8;

  const isTooNarrow = width < MIN_DOORWAY_WIDTH;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      <div style={{ color: '#ffcc66', fontWeight: 700, fontSize: 12 }}>新建门洞</div>
      <div style={{ fontSize: 11, color: '#8090c0' }}>
        房间 A: <span style={{ color: '#c0d0ff' }}>{boundary.roomA.name || boundary.roomA.id}</span>
      </div>
      <div style={{ fontSize: 11, color: '#8090c0' }}>
        房间 B: <span style={{ color: '#c0d0ff' }}>{boundary.roomB.name || boundary.roomB.id}</span>
      </div>
      <div style={{ fontSize: 11, color: '#8090c0' }}>
        位置: <span style={{ color: '#c0d0ff' }}>({Math.round(x)}, {Math.round(y)})</span>
      </div>
      <label style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
        <span style={{ color: '#8090c0', fontSize: 11 }}>宽度 (px)</span>
        <input
          type="number"
          style={inputStyle}
          value={width}
          min={1}
          onChange={(e) => setWidth(Number(e.target.value))}
        />
      </label>
      {isTooNarrow && (
        <div style={warningStyle}>
          ⚠ 门洞宽度小于 {MIN_DOORWAY_WIDTH}px，bot 可能无法通过
        </div>
      )}
      <div style={{ display: 'flex', gap: 6, marginTop: 4 }}>
        <button
          style={{ ...btnBase, fontSize: 12, padding: '3px 10px', background: 'rgba(255,180,50,0.2)', borderColor: 'rgba(255,180,50,0.6)', color: '#ffcc66' }}
          onClick={() =>
            onConfirm({
              roomAId: boundary.roomA.id,
              roomBId: boundary.roomB.id,
              x,
              y,
              width,
              height: boundary.orientation === 'horizontal' ? width : actualHeight,
            })
          }
        >
          确认
        </button>
        <button style={{ ...btnBase, fontSize: 12, padding: '3px 10px' }} onClick={onCancel}>
          取消
        </button>
      </div>
    </div>
  );
}

// ─── Component ────────────────────────────────────────────────────────────────

export function MapEditor({ roomId, apiBaseUrl, authToken, rooms = [], onClose }: MapEditorProps) {
  const {
    walls,
    spawnPoints,
    doorways,
    selectedTool,
    selectedObjectId,
    validationErrors,
    isDirty,
    startEditing,
    addWall,
    addSpawnPoint,
    addDoorway,
    removeDoorway,
    updateDoorway,
    updateWall,
    setSelectedTool,
    setSelectedObject,
    saveConfiguration,
  } = useEditorStore();

  const canvasRef = useRef<HTMLCanvasElement>(null);
  const dragStart = useRef<{ x: number; y: number } | null>(null);
  const [saveStatus, setSaveStatus] = useState<string | null>(null);

  // Doorway placement state
  const [pendingBoundary, setPendingBoundary] = useState<SharedBoundary | null>(null);
  const [pendingClickWorld, setPendingClickWorld] = useState<{ x: number; y: number } | null>(null);
  const [selectedDoorwayId, setSelectedDoorwayId] = useState<string | null>(null);

  // Compute world bounds from all rooms (or fall back to canvas size)
  const worldBounds = (() => {
    if (rooms.length === 0) return { x1: 0, y1: 0, x2: CANVAS_W, y2: CANVAS_H };
    let x1 = Infinity, y1 = Infinity, x2 = -Infinity, y2 = -Infinity;
    for (const r of rooms) {
      if (!r.bounds) continue;
      x1 = Math.min(x1, r.bounds.x1);
      y1 = Math.min(y1, r.bounds.y1);
      x2 = Math.max(x2, r.bounds.x2);
      y2 = Math.max(y2, r.bounds.y2);
    }
    if (!isFinite(x1)) return { x1: 0, y1: 0, x2: CANVAS_W, y2: CANVAS_H };
    return { x1, y1, x2, y2 };
  })();

  // Check for room boundary overlaps (req 9.7)
  const hasRoomOverlap = (() => {
    for (let i = 0; i < rooms.length; i++) {
      for (let j = i + 1; j < rooms.length; j++) {
        const a = rooms[i].bounds;
        const b = rooms[j].bounds;
        if (a && b && boundsOverlap(a, b)) return true;
      }
    }
    return false;
  })();

  // Start editing this room on mount
  useEffect(() => {
    startEditing(roomId);
  }, [roomId, startEditing]);

  // Redraw canvas whenever state changes
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    ctx.clearRect(0, 0, CANVAS_W, CANVAS_H);

    // Draw grid
    ctx.strokeStyle = 'rgba(60,80,140,0.3)';
    ctx.lineWidth = 0.5;
    for (let x = 0; x <= CANVAS_W; x += 40) {
      ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, CANVAS_H); ctx.stroke();
    }
    for (let y = 0; y <= CANVAS_H; y += 40) {
      ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(CANVAS_W, y); ctx.stroke();
    }

    // Draw room bounds (if provided)
    for (const room of rooms) {
      if (!room.bounds) continue;
      const { cx: rx1, cy: ry1 } = worldToCanvas(room.bounds.x1, room.bounds.y1, CANVAS_W, CANVAS_H, worldBounds);
      const { cx: rx2, cy: ry2 } = worldToCanvas(room.bounds.x2, room.bounds.y2, CANVAS_W, CANVAS_H, worldBounds);
      ctx.strokeStyle = 'rgba(80,120,200,0.4)';
      ctx.lineWidth = 1;
      ctx.setLineDash([]);
      ctx.strokeRect(rx1, ry1, rx2 - rx1, ry2 - ry1);
      ctx.fillStyle = 'rgba(80,120,200,0.06)';
      ctx.fillRect(rx1, ry1, rx2 - rx1, ry2 - ry1);
      // Room label
      ctx.fillStyle = 'rgba(120,160,255,0.6)';
      ctx.font = '10px monospace';
      ctx.fillText(room.name || room.id, rx1 + 4, ry1 + 12);
    }

    // Draw walls
    for (const wall of walls) {
      ctx.fillStyle = WALL_COLOR;
      ctx.fillRect(wall.x, wall.y, wall.width, wall.height);
      if (wall.id === selectedObjectId) {
        ctx.strokeStyle = SELECTED_BORDER;
        ctx.lineWidth = 2;
        ctx.setLineDash([]);
        ctx.strokeRect(wall.x, wall.y, wall.width, wall.height);
      }
    }

    // Draw spawn points
    for (const sp of spawnPoints) {
      ctx.beginPath();
      ctx.arc(sp.x, sp.y, SPAWN_RADIUS, 0, Math.PI * 2);
      ctx.fillStyle = SPAWN_COLOR;
      ctx.fill();
      if (sp.id === selectedObjectId) {
        ctx.strokeStyle = SELECTED_BORDER;
        ctx.lineWidth = 2;
        ctx.setLineDash([]);
        ctx.stroke();
      }
    }

    // Draw doorways — dashed highlight (req 9.6)
    for (const dw of doorways) {
      const { cx, cy } = worldToCanvas(dw.x, dw.y, CANVAS_W, CANVAS_H, worldBounds);
      const scaleX = CANVAS_W / (worldBounds.x2 - worldBounds.x1);
      const scaleY = CANVAS_H / (worldBounds.y2 - worldBounds.y1);
      const cw = dw.width * scaleX;
      const ch = dw.height * scaleY;

      ctx.save();
      ctx.strokeStyle = dw.id === selectedDoorwayId ? SELECTED_BORDER : DOORWAY_COLOR;
      ctx.lineWidth = dw.id === selectedDoorwayId ? 2.5 : 2;
      ctx.setLineDash(DOORWAY_DASH);
      ctx.strokeRect(cx - cw / 2, cy - ch / 2, cw, ch);
      ctx.fillStyle = 'rgba(255,180,50,0.15)';
      ctx.fillRect(cx - cw / 2, cy - ch / 2, cw, ch);
      ctx.restore();
    }

    ctx.setLineDash([]);
  }, [walls, spawnPoints, doorways, selectedObjectId, selectedDoorwayId, rooms, worldBounds]);

  // ─── Canvas event helpers ──────────────────────────────────────────────────

  function getCanvasPos(e: React.MouseEvent<HTMLCanvasElement>) {
    const rect = canvasRef.current!.getBoundingClientRect();
    return { x: Math.round(e.clientX - rect.left), y: Math.round(e.clientY - rect.top) };
  }

  function canvasToWorld(cx: number, cy: number) {
    const scaleX = (worldBounds.x2 - worldBounds.x1) / CANVAS_W;
    const scaleY = (worldBounds.y2 - worldBounds.y1) / CANVAS_H;
    return { x: worldBounds.x1 + cx * scaleX, y: worldBounds.y1 + cy * scaleY };
  }

  function handleMouseDown(e: React.MouseEvent<HTMLCanvasElement>) {
    if (selectedTool === 'wall') {
      dragStart.current = getCanvasPos(e);
    }
  }

  function handleMouseUp(e: React.MouseEvent<HTMLCanvasElement>) {
    const pos = getCanvasPos(e);

    if (selectedTool === 'wall' && dragStart.current) {
      const x = Math.min(dragStart.current.x, pos.x);
      const y = Math.min(dragStart.current.y, pos.y);
      const width = Math.abs(pos.x - dragStart.current.x);
      const height = Math.abs(pos.y - dragStart.current.y);
      if (width > 2 && height > 2) {
        const wall: Wall = { id: `wall_${Date.now()}`, roomId, x, y, width, height, rotation: 0 };
        addWall(wall);
        setSelectedObject(wall.id);
      }
      dragStart.current = null;
      return;
    }

    if (selectedTool === 'spawn') {
      const sp: SpawnPoint = { id: `spawn_${Date.now()}`, roomId, x: pos.x, y: pos.y, isAvailable: true };
      addSpawnPoint(sp);
      setSelectedObject(sp.id);
      return;
    }

    // Doorway tool: detect shared boundary click (req 9.3)
    if (selectedTool === 'doorway') {
      const boundary = findSharedBoundaryAtPoint(pos.x, pos.y, rooms, CANVAS_W, CANVAS_H, worldBounds);
      if (boundary) {
        const worldPos = canvasToWorld(pos.x, pos.y);
        setPendingBoundary(boundary);
        setPendingClickWorld(worldPos);
        setSelectedDoorwayId(null);
      }
      return;
    }

    if (selectedTool === 'select') {
      // Hit-test doorways first
      for (const dw of doorways) {
        const { cx, cy } = worldToCanvas(dw.x, dw.y, CANVAS_W, CANVAS_H, worldBounds);
        const scaleX = CANVAS_W / (worldBounds.x2 - worldBounds.x1);
        const scaleY = CANVAS_H / (worldBounds.y2 - worldBounds.y1);
        const hw = (dw.width * scaleX) / 2 + 4;
        const hh = (dw.height * scaleY) / 2 + 4;
        if (pos.x >= cx - hw && pos.x <= cx + hw && pos.y >= cy - hh && pos.y <= cy + hh) {
          setSelectedDoorwayId(dw.id);
          setSelectedObject(null);
          return;
        }
      }
      setSelectedDoorwayId(null);

      // Hit-test spawn points first (smaller targets)
      for (const sp of spawnPoints) {
        const dx = sp.x - pos.x, dy = sp.y - pos.y;
        if (Math.sqrt(dx * dx + dy * dy) <= SPAWN_RADIUS + 2) {
          setSelectedObject(sp.id);
          return;
        }
      }
      // Hit-test walls
      for (const wall of walls) {
        if (pos.x >= wall.x && pos.x <= wall.x + wall.width &&
            pos.y >= wall.y && pos.y <= wall.y + wall.height) {
          setSelectedObject(wall.id);
          return;
        }
      }
      setSelectedObject(null);
    }
  }

  // ─── Doorway confirm/cancel ────────────────────────────────────────────────

  function handleDoorwayConfirm(config: Omit<Doorway, 'id' | 'createdAt'>) {
    const doorway: Doorway = {
      id: `doorway_${Date.now()}`,
      createdAt: new Date().toISOString(),
      ...config,
    };
    addDoorway(doorway);
    setPendingBoundary(null);
    setPendingClickWorld(null);
    setSelectedDoorwayId(doorway.id);
  }

  // ─── Save ──────────────────────────────────────────────────────────────────

  async function handleSave() {
    if (hasRoomOverlap) return; // blocked by overlap warning
    setSaveStatus('Saving…');
    const result = await saveConfiguration(apiBaseUrl, authToken);
    if (result.success) {
      setSaveStatus(`Saved (v${result.version ?? '?'})`);
    } else {
      setSaveStatus(`Error: ${(result.errors ?? []).join(', ')}`);
    }
    setTimeout(() => setSaveStatus(null), 3000);
  }

  // ─── Selected object ───────────────────────────────────────────────────────

  const selectedWall = walls.find((w) => w.id === selectedObjectId) ?? null;
  const selectedSpawn = spawnPoints.find((s) => s.id === selectedObjectId) ?? null;
  const selectedDoorway = doorways.find((d) => d.id === selectedDoorwayId) ?? null;

  // ─── Render ────────────────────────────────────────────────────────────────

  return (
    <div style={containerStyle}>
      <div style={panelStyle}>
        {/* Header */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <span style={{ fontWeight: 700, fontSize: 15 }}>地图编辑器 — {roomId}</span>
          {onClose && (
            <button style={btnBase} onClick={onClose}>✕ 关闭</button>
          )}
        </div>

        {/* Room overlap warning banner (req 9.7) */}
        {hasRoomOverlap && (
          <div style={{ background: 'rgba(255,40,40,0.12)', border: '1px solid rgba(255,60,60,0.7)', borderRadius: 4, padding: '6px 10px', color: '#ff8080', fontSize: 12 }}>
            ⛔ 检测到房间边界重叠，请调整房间位置后再保存
          </div>
        )}

        {/* Toolbar */}
        <div style={toolbarStyle}>
          <span style={{ fontSize: 12, color: '#8090c0' }}>工具：</span>
          {(['select', 'wall', 'spawn'] as const).map((tool) => (
            <button
              key={tool}
              style={selectedTool === tool ? btnActive : btnBase}
              onClick={() => { setSelectedTool(tool); setPendingBoundary(null); }}
            >
              {tool === 'select' ? '选择' : tool === 'wall' ? '墙体' : '出生点'}
            </button>
          ))}
          {/* Doorway tool button (req 9.1) */}
          <button
            style={selectedTool === 'doorway' ? btnDoorwayActive : btnBase}
            onClick={() => { setSelectedTool('doorway'); setPendingBoundary(null); }}
            title="点击两个相邻房间的共享边界放置门洞"
          >
            🚪 门洞
          </button>
          <div style={{ flex: 1 }} />
          <button
            style={{ ...btnBase, opacity: (!isDirty || hasRoomOverlap) ? 0.5 : 1 }}
            onClick={handleSave}
            disabled={!isDirty || hasRoomOverlap}
            title={hasRoomOverlap ? '房间重叠，无法保存' : undefined}
          >
            💾 保存
          </button>
          {saveStatus && <span style={{ fontSize: 12, color: '#80c0ff' }}>{saveStatus}</span>}
        </div>

        {/* Body: canvas + property panel */}
        <div style={bodyStyle}>
          <canvas
            ref={canvasRef}
            width={CANVAS_W}
            height={CANVAS_H}
            style={hasRoomOverlap ? canvasOverlapStyle : canvasStyle}
            onMouseDown={handleMouseDown}
            onMouseUp={handleMouseUp}
          />

          {/* Property panel */}
          <div style={propPanelStyle}>
            <div style={{ fontWeight: 700, marginBottom: 8, color: '#a0b8ff' }}>属性</div>

            {/* Doorway placement panel (req 9.3, 9.4) */}
            {pendingBoundary && pendingClickWorld && (
              <DoorwayPanel
                boundary={pendingBoundary}
                clickWorldX={pendingClickWorld.x}
                clickWorldY={pendingClickWorld.y}
                onConfirm={handleDoorwayConfirm}
                onCancel={() => { setPendingBoundary(null); setPendingClickWorld(null); }}
              />
            )}

            {/* Selected doorway properties (req 9.4) */}
            {!pendingBoundary && selectedDoorway && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                <div style={{ color: '#ffcc66', fontSize: 11 }}>门洞 {selectedDoorway.id.slice(-6)}</div>
                <div style={{ fontSize: 11, color: '#8090c0' }}>
                  房间 A: <span style={{ color: '#c0d0ff' }}>{selectedDoorway.roomAId}</span>
                </div>
                <div style={{ fontSize: 11, color: '#8090c0' }}>
                  房间 B: <span style={{ color: '#c0d0ff' }}>{selectedDoorway.roomBId}</span>
                </div>
                {(['x', 'y', 'width', 'height'] as const).map((field) => (
                  <label key={field} style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                    <span style={{ color: '#8090c0', fontSize: 11 }}>{field}</span>
                    <input
                      type="number"
                      style={inputStyle}
                      value={selectedDoorway[field]}
                      onChange={(e) =>
                        updateDoorway(selectedDoorway.id, { [field]: Number(e.target.value) })
                      }
                    />
                  </label>
                ))}
                {/* Width warning (req 3.5, 9.4) */}
                {selectedDoorway.width < MIN_DOORWAY_WIDTH && (
                  <div style={warningStyle}>
                    ⚠ 门洞宽度小于 {MIN_DOORWAY_WIDTH}px，bot 可能无法通过
                  </div>
                )}
                <button
                  style={{ ...btnBase, fontSize: 11, padding: '3px 8px', marginTop: 4, borderColor: 'rgba(255,80,80,0.5)', color: '#ff8080' }}
                  onClick={() => { removeDoorway(selectedDoorway.id); setSelectedDoorwayId(null); }}
                >
                  🗑 删除门洞
                </button>
              </div>
            )}

            {selectedWall && !pendingBoundary && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                <div style={{ color: '#7090d0', fontSize: 11 }}>墙体 {selectedWall.id.slice(-6)}</div>
                {(['x', 'y', 'width', 'height'] as const).map((field) => (
                  <label key={field} style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                    <span style={{ color: '#8090c0', fontSize: 11 }}>{field}</span>
                    <input
                      type="number"
                      style={inputStyle}
                      value={selectedWall[field]}
                      onChange={(e) =>
                        updateWall(selectedWall.id, { [field]: Number(e.target.value) })
                      }
                    />
                  </label>
                ))}
              </div>
            )}

            {selectedSpawn && !pendingBoundary && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                <div style={{ color: '#70d090', fontSize: 11 }}>出生点 {selectedSpawn.id.slice(-6)}</div>
                {(['x', 'y'] as const).map((field) => (
                  <label key={field} style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                    <span style={{ color: '#8090c0', fontSize: 11 }}>{field}</span>
                    <input
                      type="number"
                      style={inputStyle}
                      value={selectedSpawn[field]}
                      readOnly
                    />
                  </label>
                ))}
              </div>
            )}

            {!selectedWall && !selectedSpawn && !selectedDoorway && !pendingBoundary && (
              <div style={{ color: '#506080', fontSize: 12 }}>
                {selectedTool === 'wall' && '拖拽画布绘制墙体'}
                {selectedTool === 'spawn' && '点击画布放置出生点'}
                {selectedTool === 'select' && '点击对象以选中'}
                {selectedTool === 'doorway' && '点击两个相邻房间的共享边界放置门洞'}
              </div>
            )}

            {/* Validation errors */}
            {validationErrors.length > 0 && (
              <div style={{ marginTop: 12 }}>
                <div style={{ color: '#ff8080', fontSize: 11, fontWeight: 700 }}>验证错误</div>
                {validationErrors.map((err, i) => (
                  <div key={i} style={errorStyle}>• {err}</div>
                ))}
              </div>
            )}

            {/* Summary */}
            <div style={{ marginTop: 'auto', paddingTop: 12, borderTop: '1px solid rgba(100,150,255,0.15)', fontSize: 11, color: '#506080' }}>
              <div>墙体：{walls.length}</div>
              <div>出生点：{spawnPoints.length}</div>
              <div>门洞：{doorways.length}</div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

export default MapEditor;
