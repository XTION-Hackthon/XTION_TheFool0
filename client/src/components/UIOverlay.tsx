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
const MAX_CHAT_PANEL_MESSAGES = 200;

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

// ─── Broadcast Chat Panel ─────────────────────────────────────────────────────

interface ChatEntry {
  id: string;
  type: 'broadcast' | 'talk';
  senderName: string;
  content: string;
  timestamp: number;
}

function BroadcastChatPanel() {
  const broadcastMessages = useMessageStore((s) => s.broadcastMessages);
  const talkMessages = useMessageStore((s) => s.talkMessages);
  const contestants = useGameStore((s) => s.contestants);
  const [entries, setEntries] = useState<ChatEntry[]>([]);
  const [collapsed, setCollapsed] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);
  const seenIds = useRef(new Set<string>());

  // 合并广播和 talk 消息
  useEffect(() => {
    const newEntries: ChatEntry[] = [];

    for (const msg of broadcastMessages) {
      if (!seenIds.current.has(`b-${msg.id}`)) {
        seenIds.current.add(`b-${msg.id}`);
        const sender = contestants.get(msg.senderId);
        newEntries.push({
          id: `b-${msg.id}`,
          type: 'broadcast',
          senderName: sender?.name ?? msg.senderId.slice(0, 8),
          content: msg.content,
          timestamp: msg.timestamp,
        });
      }
    }

    for (const msg of talkMessages) {
      if (!seenIds.current.has(`t-${msg.id}`)) {
        seenIds.current.add(`t-${msg.id}`);
        const sender = contestants.get(msg.senderId);
        newEntries.push({
          id: `t-${msg.id}`,
          type: 'talk',
          senderName: sender?.name ?? msg.senderId.slice(0, 8),
          content: msg.content,
          timestamp: msg.timestamp,
        });
      }
    }

    if (newEntries.length === 0) return;

    setEntries((prev) => {
      const combined = [...prev, ...newEntries].sort((a, b) => a.timestamp - b.timestamp);
      return combined.slice(-MAX_CHAT_PANEL_MESSAGES);
    });
  }, [broadcastMessages, talkMessages, contestants]);

  // 新消息自动滚到底部
  useEffect(() => {
    if (!collapsed) {
      bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
    }
  }, [entries, collapsed]);

  return (
    <div
      style={{
        position: 'absolute',
        left: 12,
        bottom: 12,
        width: 280,
        maxHeight: collapsed ? 40 : 340,
        display: 'flex',
        flexDirection: 'column',
        background: 'rgba(8, 12, 28, 0.82)',
        border: '1px solid rgba(74, 158, 255, 0.25)',
        borderRadius: 12,
        overflow: 'hidden',
        backdropFilter: 'blur(8px)',
        boxShadow: '0 8px 32px rgba(0,0,0,0.5)',
        transition: 'max-height 0.25s ease',
        pointerEvents: 'auto',
        zIndex: 15,
      }}
    >
      {/* 标题栏 */}
      <div
        onClick={() => setCollapsed((v) => !v)}
        style={{
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          padding: '8px 12px',
          borderBottom: collapsed ? 'none' : '1px solid rgba(74,158,255,0.15)',
          cursor: 'pointer',
          userSelect: 'none',
          flexShrink: 0,
        }}
      >
        <span style={{ color: '#7ec8ff', fontSize: 12, fontWeight: 600, letterSpacing: 1 }}>
          📡 消息频道
        </span>
        <span style={{ color: '#4a9eff', fontSize: 11 }}>{collapsed ? '▲' : '▼'}</span>
      </div>

      {/* 消息列表 */}
      {!collapsed && (
        <div
          style={{
            flex: 1,
            overflowY: 'auto',
            padding: '6px 8px',
            display: 'flex',
            flexDirection: 'column',
            gap: 4,
          }}
        >
          {entries.length === 0 && (
            <div style={{ color: 'rgba(255,255,255,0.25)', fontSize: 11, textAlign: 'center', padding: '12px 0' }}>
              暂无消息
            </div>
          )}
          {entries.map((entry) => (
            <div key={entry.id} style={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                {/* 类型标签 */}
                <span style={{
                  fontSize: 9, fontWeight: 700, padding: '1px 5px', borderRadius: 4,
                  background: entry.type === 'broadcast' ? 'rgba(180,120,255,0.2)' : 'rgba(74,158,255,0.2)',
                  color: entry.type === 'broadcast' ? '#d4a0ff' : '#7ec8ff',
                  border: `1px solid ${entry.type === 'broadcast' ? 'rgba(180,120,255,0.4)' : 'rgba(74,158,255,0.3)'}`,
                  flexShrink: 0,
                }}>
                  {entry.type === 'broadcast' ? '广播' : '对话'}
                </span>
                {/* 发送者 */}
                <span style={{ color: entry.type === 'broadcast' ? '#d4a0ff' : '#7ec8ff', fontSize: 11, fontWeight: 600, flexShrink: 0 }}>
                  {entry.senderName}
                </span>
                {/* 时间 */}
                <span style={{ color: 'rgba(255,255,255,0.25)', fontSize: 10, marginLeft: 'auto', flexShrink: 0 }}>
                  {new Date(entry.timestamp).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
                </span>
              </div>
              {/* 内容 */}
              <div style={{
                color: 'rgba(240,240,255,0.9)', fontSize: 12,
                paddingLeft: 4, wordBreak: 'break-word', lineHeight: 1.4,
              }}>
                {entry.content}
              </div>
            </div>
          ))}
          <div ref={bottomRef} />
        </div>
      )}
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

  // Always render broadcast/barrage layers — they depend on WS messages, not role.
  // Talk bubbles only for Agent_Player and Admin (they participate in zone talk).
  const showTalkBubbles = role === 'Admin' || role === 'Agent_Player';

  return (
    <div style={overlayStyle}>
      <BroadcastBanner />
      {showTalkBubbles && <TalkBubbles />}
      <BarrageLayer />
      <BroadcastChatPanel />
    </div>
  );
}

export default UIOverlay;
