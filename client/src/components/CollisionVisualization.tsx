/**
 * CollisionVisualization — SVG overlay showing collision boxes, walls, obstacles, and collision events.
 * Requirements: 3, 4, 5
 */

import { useEffect, useRef, useState } from 'react';
import { useCollisionStore } from '../stores/collisionStore';
import { useZoneStore } from '../stores/zoneStore';

const BOT_BOX_SIZE = 20;
const FLASH_DURATION_MS = 1000;
const MAX_EVENT_LIST = 5;

interface CollisionVisualizationProps {
  width: number;
  height: number;
}

interface FlashEvent {
  id: string;
  x: number;
  y: number;
  expiresAt: number;
}

export function CollisionVisualization({ width, height }: CollisionVisualizationProps) {
  const walls = useZoneStore((s) => s.walls);
  const obstacles = useZoneStore((s) => s.obstacles);
  const collisions = useCollisionStore((s) => s.collisions);

  const [flashes, setFlashes] = useState<FlashEvent[]>([]);
  const seenEventIds = useRef(new Set<string>());

  // Track new collision events and create flash highlights
  useEffect(() => {
    const now = Date.now();
    const newFlashes: FlashEvent[] = [];

    for (const event of collisions) {
      const key = `${event.botId}-${event.timestamp}`;
      if (!seenEventIds.current.has(key)) {
        seenEventIds.current.add(key);
        newFlashes.push({
          id: key,
          x: event.position.x,
          y: event.position.y,
          expiresAt: now + FLASH_DURATION_MS,
        });
      }
    }

    if (newFlashes.length === 0) return;
    setFlashes((prev) => [...prev, ...newFlashes]);
  }, [collisions]);

  // Remove expired flashes
  useEffect(() => {
    if (flashes.length === 0) return;
    const earliest = Math.min(...flashes.map((f) => f.expiresAt));
    const delay = Math.max(0, earliest - Date.now());
    const timer = setTimeout(() => {
      const now = Date.now();
      setFlashes((prev) => prev.filter((f) => f.expiresAt > now));
    }, delay + 50);
    return () => clearTimeout(timer);
  }, [flashes]);

  const recentEvents = collisions.slice(0, MAX_EVENT_LIST);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      {/* SVG overlay */}
      <svg
        width={width}
        height={height}
        style={{
          display: 'block',
          background: 'rgba(0, 0, 0, 0.15)',
          border: '1px solid rgba(255, 255, 255, 0.2)',
          borderRadius: 4,
        }}
      >
        {/* Walls */}
        {walls.map((wall) => (
          <rect
            key={wall.id}
            x={wall.x}
            y={wall.y}
            width={wall.width}
            height={wall.height}
            fill="rgba(220, 50, 50, 0.35)"
            stroke="rgba(255, 80, 80, 0.8)"
            strokeWidth={1.5}
            transform={wall.rotation ? `rotate(${wall.rotation}, ${wall.x + wall.width / 2}, ${wall.y + wall.height / 2})` : undefined}
          />
        ))}

        {/* Obstacles */}
        {obstacles.map((obs) => (
          <rect
            key={obs.id}
            x={obs.x}
            y={obs.y}
            width={obs.width}
            height={obs.height}
            fill="rgba(180, 120, 40, 0.45)"
            stroke="rgba(220, 160, 60, 0.85)"
            strokeWidth={1.5}
          />
        ))}

        {/* Collision flash highlights */}
        {flashes.map((flash) => (
          <circle
            key={flash.id}
            cx={flash.x}
            cy={flash.y}
            r={BOT_BOX_SIZE}
            fill="rgba(255, 230, 0, 0.5)"
            stroke="rgba(255, 200, 0, 0.9)"
            strokeWidth={2}
            style={{ animation: `cvFlash ${FLASH_DURATION_MS}ms ease-out forwards` }}
          />
        ))}
      </svg>

      {/* Recent collision events list */}
      {recentEvents.length > 0 && (
        <div
          style={{
            background: 'rgba(10, 10, 30, 0.85)',
            border: '1px solid rgba(100, 140, 200, 0.4)',
            borderRadius: 4,
            padding: '6px 10px',
          }}
        >
          <div style={{ color: 'rgba(180, 200, 255, 0.7)', fontSize: 11, marginBottom: 4 }}>
            Recent Collisions
          </div>
          {recentEvents.map((event, i) => {
            const typeLabel = event.type === 'bot-bot' ? '🤖↔🤖' : '🤖↔🧱';
            const time = new Date(event.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
            return (
              <div
                key={`${event.botId}-${event.timestamp}-${i}`}
                style={{
                  display: 'flex',
                  gap: 8,
                  fontSize: 11,
                  color: 'rgba(220, 230, 255, 0.85)',
                  padding: '2px 0',
                  borderTop: i > 0 ? '1px solid rgba(80, 100, 160, 0.2)' : undefined,
                }}
              >
                <span>{typeLabel}</span>
                <span style={{ color: 'rgba(140, 190, 255, 0.9)', flex: 1 }}>{event.botId.slice(0, 8)}</span>
                <span style={{ color: 'rgba(160, 160, 200, 0.7)' }}>
                  ({Math.round(event.position.x)}, {Math.round(event.position.y)})
                </span>
                <span style={{ color: 'rgba(120, 140, 180, 0.6)' }}>{time}</span>
              </div>
            );
          })}
        </div>
      )}

      <style>{`
        @keyframes cvFlash {
          0%   { opacity: 0.9; }
          100% { opacity: 0; }
        }
      `}</style>
    </div>
  );
}

export default CollisionVisualization;
