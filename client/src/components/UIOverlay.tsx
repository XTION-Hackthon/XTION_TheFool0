/**
 * UIOverlay — React overlay rendered on top of the Phaser canvas.
 *
 * Implements:
 *   - Talk bubbles: last 5 talk messages, auto-dismiss after 4 seconds (Req 6.5)
 *   - Broadcast banner: latest broadcast at top of screen, auto-dismiss after 5 seconds (Req 6.6)
 *   - Barrage: messages scroll right-to-left at random vertical positions (Req 10.2)
 *
 * Requirements: 6.5, 6.6, 10.2
 */

import { useEffect, useRef, useState } from 'react';
import { useMessageStore } from '../stores/messageStore';
import { useGameStore } from '../stores/gameStore';
import { useRoleStore } from '../stores/roleStore';
import type { TalkMessage, BroadcastMessage, BarrageMessage } from '../../../server/src/types/index';

// ─── Types ────────────────────────────────────────────────────────────────────

interface TimedTalkMessage extends TalkMessage {
  expiresAt: number;
}

interface TimedBroadcastMessage extends BroadcastMessage {
  expiresAt: number;
}

interface AnimatedBarrage extends BarrageMessage {
  top: number;   // random vertical position (%)
  key: string;   // unique render key
}

// ─── Constants ────────────────────────────────────────────────────────────────

const TALK_TTL_MS = 4000;
const BROADCAST_TTL_MS = 5000;
const MAX_TALK_BUBBLES = 5;
const BARRAGE_SCROLL_DURATION_MS = 8000;

// ─── Styles ───────────────────────────────────────────────────────────────────

const overlayStyle: React.CSSProperties = {
  position: 'absolute',
  inset: 0,
  pointerEvents: 'none',
  overflow: 'hidden',
  zIndex: 10,
};

// ─── Talk Bubbles ─────────────────────────────────────────────────────────────

function TalkBubbles() {
  const talkMessages = useMessageStore((s) => s.talkMessages);
  const contestants = useGameStore((s) => s.contestants);
  const [visible, setVisible] = useState<TimedTalkMessage[]>([]);

  // Sync incoming messages into timed list
  const seenIds = useRef(new Set<string>());

  useEffect(() => {
    const latest = talkMessages.slice(-MAX_TALK_BUBBLES);
    const now = Date.now();
    const newOnes: TimedTalkMessage[] = [];

    for (const msg of latest) {
      if (!seenIds.current.has(msg.id)) {
        seenIds.current.add(msg.id);
        newOnes.push({ ...msg, expiresAt: now + TALK_TTL_MS });
      }
    }

    if (newOnes.length === 0) return;

    setVisible((prev) => {
      const combined = [...prev, ...newOnes];
      // Keep only the last MAX_TALK_BUBBLES
      return combined.slice(-MAX_TALK_BUBBLES);
    });
  }, [talkMessages]);

  // Tick: remove expired bubbles
  useEffect(() => {
    if (visible.length === 0) return;
    const earliest = Math.min(...visible.map((m) => m.expiresAt));
    const delay = Math.max(0, earliest - Date.now());
    const timer = setTimeout(() => {
      const now = Date.now();
      setVisible((prev) => prev.filter((m) => m.expiresAt > now));
    }, delay + 50);
    return () => clearTimeout(timer);
  }, [visible]);

  if (visible.length === 0) return null;

  return (
    <div
      style={{
        position: 'absolute',
        top: '50%',
        left: '50%',
        transform: 'translate(-50%, -50%)',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        gap: 6,
        maxWidth: 320,
      }}
    >
      {visible.map((msg) => {
        const sender = contestants.get(msg.senderId);
        const senderName = sender?.name ?? msg.senderId.slice(0, 8);
        return (
          <div
            key={msg.id}
            style={{
              background: 'rgba(20, 20, 40, 0.88)',
              border: '1px solid rgba(120, 180, 255, 0.5)',
              borderRadius: 12,
              padding: '6px 12px',
              color: '#e8f0ff',
              fontSize: 13,
              maxWidth: 300,
              wordBreak: 'break-word',
              animation: `talkFadeIn ${TALK_TTL_MS}ms ease forwards`,
              boxShadow: '0 2px 8px rgba(0,0,0,0.4)',
            }}
          >
            <span style={{ color: '#7ec8ff', fontWeight: 600, marginRight: 6 }}>
              {senderName}:
            </span>
            {msg.content}
          </div>
        );
      })}
    </div>
  );
}

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
    @keyframes talkFadeIn {
      0%   { opacity: 0; transform: translateY(6px); }
      10%  { opacity: 1; transform: translateY(0); }
      80%  { opacity: 1; }
      100% { opacity: 0; }
    }

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

  // Agent_Viewer: read-only view — show broadcast and barrage display but no talk bubbles
  // Human_Viewer: show barrage layer (incoming barrages scroll) + broadcast
  // Admin / Agent_Player: full display (talk bubbles, broadcast, barrage layer)
  // null (loading/unauthenticated): show nothing role-specific

  const showTalkBubbles = role === 'Admin' || role === 'Agent_Player';
  const showBroadcast = role !== null; // all authenticated roles see broadcasts
  const showBarrageLayer = role !== null; // all authenticated roles see incoming barrages

  return (
    <div style={overlayStyle}>
      {showBroadcast && <BroadcastBanner />}
      {showTalkBubbles && <TalkBubbles />}
      {showBarrageLayer && <BarrageLayer />}
    </div>
  );
}

export default UIOverlay;
