/**
 * ViewerInteraction — Audience interaction UI.
 *
 * Features:
 *   - Barrage input and send (Req 10.1)
 *   - Like / dislike buttons shown when a Sprite is selected (Req 10.3, 10.4)
 *
 * Requirements: 10.1, 10.3, 10.4
 */

import { useState } from 'react';
import { useUiStore } from '../stores/uiStore';
import { useGameStore } from '../stores/gameStore';
import { apiClient } from '../services/api-client';

// ─── Barrage Input ────────────────────────────────────────────────────────────

export function BarrageInput() {
  const [text, setText] = useState('');
  const [sending, setSending] = useState(false);

  const send = async () => {
    const trimmed = text.trim();
    if (!trimmed || sending) return;
    setSending(true);
    try {
      await apiClient.post('/api/barrage', {
        viewer_id: 'viewer-' + Math.random().toString(36).slice(2, 8),
        content: trimmed,
      });
      setText('');
    } catch {
      // ignore
    } finally {
      setSending(false);
    }
  };

  const handleKey = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); }
  };

  return (
    <div
      style={{
        position: 'fixed',
        bottom: 16,
        left: '50%',
        transform: 'translateX(-50%)',
        display: 'flex',
        gap: 8,
        zIndex: 150,
        background: 'rgba(15, 15, 30, 0.9)',
        border: '1px solid rgba(120, 180, 255, 0.3)',
        borderRadius: 24,
        padding: '6px 8px 6px 16px',
        boxShadow: '0 4px 16px rgba(0,0,0,0.5)',
        backdropFilter: 'blur(8px)',
        width: 'min(480px, calc(100vw - 200px))',
      }}
    >
      <input
        style={{
          flex: 1, background: 'none', border: 'none', outline: 'none',
          color: '#e5e7eb', fontSize: 13, fontFamily: 'sans-serif',
        }}
        placeholder="发送弹幕…"
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={handleKey}
        maxLength={100}
        aria-label="弹幕输入"
      />
      <button
        onClick={send}
        disabled={sending || !text.trim()}
        style={{
          background: text.trim() ? 'rgba(120,180,255,0.25)' : 'rgba(255,255,255,0.05)',
          border: '1px solid rgba(120,180,255,0.3)',
          borderRadius: 18,
          color: text.trim() ? '#7ec8ff' : '#6b7280',
          padding: '5px 16px',
          cursor: text.trim() ? 'pointer' : 'default',
          fontSize: 12,
          fontWeight: 600,
          transition: 'all 0.15s',
        }}
        aria-label="发送弹幕"
      >
        发送
      </button>
    </div>
  );
}

// ─── Vote Buttons (shown near selected contestant) ────────────────────────────

export function VoteButtons() {
  const selectedId = useUiStore((s) => s.selectedContestantId);
  const contestants = useGameStore((s) => s.contestants);
  const [votes, setVotes] = useState<{ likes: number; dislikes: number } | null>(null);
  const [voted, setVoted] = useState<'like' | 'dislike' | null>(null);

  const contestant = selectedId ? contestants.get(selectedId) : undefined;

  const handleVote = async (type: 'like' | 'dislike') => {
    if (!selectedId || voted) return;
    try {
      await apiClient.post(`/api/contestants/${selectedId}/vote`, {
        type,
        viewer_id: 'viewer-' + Math.random().toString(36).slice(2, 8),
      });
      setVoted(type);
      setVotes((prev) => prev ? {
        likes: type === 'like' ? prev.likes + 1 : prev.likes,
        dislikes: type === 'dislike' ? prev.dislikes + 1 : prev.dislikes,
      } : { likes: type === 'like' ? 1 : 0, dislikes: type === 'dislike' ? 1 : 0 });
    } catch {
      // ignore
    }
  };

  if (!contestant) return null;

  return (
    <div
      style={{
        position: 'fixed',
        top: 80,
        left: 16,
        background: 'rgba(15, 15, 30, 0.92)',
        border: '1px solid rgba(120, 180, 255, 0.25)',
        borderRadius: 10,
        padding: '10px 14px',
        zIndex: 100,
        boxShadow: '0 4px 16px rgba(0,0,0,0.5)',
        backdropFilter: 'blur(8px)',
        minWidth: 160,
      }}
    >
      <div style={{ color: '#9ca3af', fontSize: 11, marginBottom: 8 }}>
        为 <span style={{ color: '#e5e7eb', fontWeight: 600 }}>{contestant.name}</span> 投票
      </div>
      <div style={{ display: 'flex', gap: 8 }}>
        <button
          onClick={() => handleVote('like')}
          disabled={!!voted}
          style={{
            flex: 1, padding: '7px 0',
            background: voted === 'like' ? 'rgba(74,222,128,0.3)' : 'rgba(74,222,128,0.1)',
            border: `1px solid ${voted === 'like' ? 'rgba(74,222,128,0.7)' : 'rgba(74,222,128,0.3)'}`,
            borderRadius: 8, color: '#4ade80', cursor: voted ? 'default' : 'pointer',
            fontSize: 14, fontWeight: 700,
          }}
          aria-label="点赞"
        >
          👍 {votes?.likes ?? ''}
        </button>
        <button
          onClick={() => handleVote('dislike')}
          disabled={!!voted}
          style={{
            flex: 1, padding: '7px 0',
            background: voted === 'dislike' ? 'rgba(248,113,113,0.3)' : 'rgba(248,113,113,0.1)',
            border: `1px solid ${voted === 'dislike' ? 'rgba(248,113,113,0.7)' : 'rgba(248,113,113,0.3)'}`,
            borderRadius: 8, color: '#f87171', cursor: voted ? 'default' : 'pointer',
            fontSize: 14, fontWeight: 700,
          }}
          aria-label="踩"
        >
          👎 {votes?.dislikes ?? ''}
        </button>
      </div>
      {voted && <div style={{ color: '#4ade80', fontSize: 11, textAlign: 'center', marginTop: 6 }}>✓ 已投票</div>}
    </div>
  );
}
