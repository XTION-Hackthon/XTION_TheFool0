/**
 * UIOverlay — React overlay rendered on top of the Phaser canvas.
 *
 * Implements:
 *   - Broadcast banner: latest broadcast at top of screen, auto-dismiss after 5 seconds (Req 6.6)
 *   - Barrage: messages scroll right-to-left at random vertical positions (Req 10.2)
 *
 * Requirements: 6.6, 10.2
 */

import { useEffect, useRef, useState } from 'react';
import { useMessageStore } from '../stores/messageStore';
import { useGameStore } from '../stores/gameStore';
import { useRoleStore } from '../stores/roleStore';
import type { BroadcastMessage, BarrageMessage } from '../../../server/src/types/index';

// ─── Types ────────────────────────────────────────────────────────────────────

interface TimedBroadcastMessage extends BroadcastMessage {
  expiresAt: number;
}

interface AnimatedBarrage extends BarrageMessage {
  top: number;   // random vertical position (%)
  key: string;   // unique render key
}

// ─── Constants ────────────────────────────────────────────────────────────────

const BROADCAST_TTL_MS = 5000;
const BARRAGE_SCROLL_DURATION_MS = 8000;

// ─── Styles ───────────────────────────────────────────────────────────────────

const overlayStyle: React.CSSProperties = {
  position: 'absolute',
  inset: 0,
  pointerEvents: 'none',
  overflow: 'hidden',
  zIndex: 10,
};

// ─── Broadcast Banner ─────────────────────────────────────────────────────────

function BroadcastBanner() {
  const broadcastMessages = useMessageStore((s) => s.broadcastMessages);
  const contestants = useGameStore((s) => s.contestants);
  const [current, setCurrent] = useState<TimedBroadcastMessage | null>(null);
  const seenIds = useRef(new Set<string>());

  useEffect(() => {
    if (broadcastMessages.length === 0) return;
    const latest = broadcastMessages[broadcastMessages.length - 1];
    if (seenIds.current.has(latest.id)) return;
    seenIds.current.add(latest.id);
    setCurrent({ ...latest, expiresAt: Date.now() + BROADCAST_TTL_MS });
  }, [broadcastMessages]);

  useEffect(() => {
    if (!current) return;
    const delay = Math.max(0, current.expiresAt - Date.now());
    const timer = setTimeout(() => setCurrent(null), delay + 50);
    return () => clearTimeout(timer);
  }, [current]);

  if (!current) return null;

  const sender = contestants.get(current.senderId);
  const senderName = sender?.name ?? current.senderId.slice(0, 8);

  return (
    <div
      style={{
        position: 'absolute',
        top: 0,
        left: 0,
        right: 0,
        padding: '10px 20px',
        background: 'linear-gradient(90deg, rgba(30,10,60,0.95) 0%, rgba(60,20,120,0.95) 50%, rgba(30,10,60,0.95) 100%)',
        borderBottom: '2px solid rgba(180, 120, 255, 0.7)',
        color: '#f0e0ff',
        fontSize: 15,
        fontWeight: 500,
        textAlign: 'center',
        animation: `broadcastSlideIn ${BROADCAST_TTL_MS}ms ease forwards`,
        boxShadow: '0 4px 16px rgba(120,0,200,0.3)',
        zIndex: 20,
      }}
    >
      <span style={{ color: '#d4a0ff', fontWeight: 700, marginRight: 8 }}>
        📢 {senderName}:
      </span>
      {current.content}
    </div>
  );
}

// ─── Barrage ──────────────────────────────────────────────────────────────────

function BarrageLayer() {
  const barrageMessages = useMessageStore((s) => s.barrageMessages);
  const [active, setActive] = useState<AnimatedBarrage[]>([]);
  const seenIds = useRef(new Set<string>());

  useEffect(() => {
    if (barrageMessages.length === 0) return;
    const latest = barrageMessages[barrageMessages.length - 1];
    if (seenIds.current.has(latest.id)) return;
    seenIds.current.add(latest.id);

    const animated: AnimatedBarrage = {
      ...latest,
      top: 10 + Math.random() * 75, // 10%–85% vertical
      key: `${latest.id}-${Date.now()}`,
    };

    setActive((prev) => [...prev, animated]);

    // Remove after animation completes
    setTimeout(() => {
      setActive((prev) => prev.filter((m) => m.key !== animated.key));
    }, BARRAGE_SCROLL_DURATION_MS + 200);
  }, [barrageMessages]);

  return (
    <>
      {active.map((msg) => (
        <div
          key={msg.key}
          style={{
            position: 'absolute',
            top: `${msg.top}%`,
            left: '100%',
            whiteSpace: 'nowrap',
            color: '#fff',
            fontSize: 16,
            fontWeight: 600,
            textShadow: '0 1px 4px rgba(0,0,0,0.8), 0 0 8px rgba(0,0,0,0.6)',
            animation: `barrageScroll ${BARRAGE_SCROLL_DURATION_MS}ms linear forwards`,
            pointerEvents: 'none',
          }}
        >
          {msg.content}
        </div>
      ))}
    </>
  );
}

// ─── CSS Keyframes (injected once) ────────────────────────────────────────────

const CSS_ID = 'ui-overlay-styles';

function injectStyles() {
  if (document.getElementById(CSS_ID)) return;
  const style = document.createElement('style');
  style.id = CSS_ID;
  style.textContent = `
    @keyframes broadcastSlideIn {
      0%   { opacity: 0; transform: translateY(-100%); }
      8%   { opacity: 1; transform: translateY(0); }
      80%  { opacity: 1; transform: translateY(0); }
      100% { opacity: 0; transform: translateY(-100%); }
    }

    @keyframes barrageScroll {
      from { transform: translateX(0); }
      to   { transform: translateX(calc(-100vw - 100%)); }
    }

    @keyframes hbFlash {
      0%, 100% { opacity: 0; }
      50%       { opacity: 1; }
    }
  `;
  document.head.appendChild(style);
}

// ─── Main Component ───────────────────────────────────────────────────────────

export function UIOverlay() {
  const role = useRoleStore((s) => s.role);

  useEffect(() => {
    injectStyles();
  }, []);

  // Talk rendering is handled by Phaser sprite speech bubbles.
  // Keep overlay focused on broadcast + barrage layers.
  // null (loading/unauthenticated): show nothing role-specific

  const showBroadcast = role !== null; // all authenticated roles see broadcasts
  const showBarrageLayer = role !== null; // all authenticated roles see incoming barrages

  return (
    <div style={overlayStyle}>
      {showBroadcast && <BroadcastBanner />}
      {showBarrageLayer && <BarrageLayer />}
    </div>
  );
}

export default UIOverlay;
