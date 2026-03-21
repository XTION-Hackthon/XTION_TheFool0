// =============================================================================
// XTION_TheFool0 — InteractionManager 模块
// Requirements: 10.1, 10.2, 10.3, 10.5
// =============================================================================

import type { Database as DatabaseType } from 'better-sqlite3';
import { v4 as uuidv4 } from 'uuid';
import { db as globalDb } from '../db';
import { connections, sendEvent, broadcast } from '../ws';
import type {
  IInteractionManager,
  BarrageMessage,
  BroadcastMessage,
  ViewerInteractionSummary,
  ServerEvent,
} from '../types';
import type { WebSocket } from 'ws';

// ---------------------------------------------------------------------------
// InteractionManagerClass — injectable for testing
// ---------------------------------------------------------------------------

export class InteractionManagerClass implements IInteractionManager {
  private db: DatabaseType;
  private connectionsMap: Map<string, WebSocket>;
  private broadcastFn: (event: ServerEvent, exclude?: string) => void;

  constructor(
    db: DatabaseType,
    connectionsMap?: Map<string, WebSocket>,
    broadcastFn?: (event: ServerEvent, exclude?: string) => void,
  ) {
    this.db = db;
    this.connectionsMap = connectionsMap ?? new Map();
    this.broadcastFn = broadcastFn ?? broadcast;
  }

  /**
   * 发送弹幕 — 持久化并广播给所有在线 Contestant
   * Requirements: 10.1, 10.2
   */
  async sendBarrage(viewerId: string, content: string): Promise<BarrageMessage> {
    if (!content || content.trim() === '') {
      throw Object.assign(new Error('弹幕内容不能为空'), {
        code: 'INVALID_PARAM',
        statusCode: 400,
      });
    }

    const id = uuidv4();
    const timestamp = Date.now();

    this.db.prepare(`
      INSERT INTO barrage_messages (id, viewer_id, content, timestamp)
      VALUES (?, ?, ?, ?)
    `).run(id, viewerId, content.trim(), timestamp);

    const msg: BarrageMessage = { id, viewerId, content: content.trim(), timestamp };

    // Broadcast to all online contestants
    this.broadcastFn({
      type: 'barrage',
      payload: msg,
      timestamp,
    });

    return msg;
  }

  /**
   * 点赞/踩 — 持久化并推送 vote.update 事件
   * Requirements: 10.3
   */
  async vote(viewerId: string, contestantId: string, type: 'like' | 'dislike'): Promise<void> {
    const id = uuidv4();
    const timestamp = Date.now();

    this.db.prepare(`
      INSERT INTO vote_records (id, contestant_id, viewer_id, type, timestamp)
      VALUES (?, ?, ?, ?, ?)
    `).run(id, contestantId, viewerId, type, timestamp);

    const votes = await this.getVotes(contestantId);

    // Notify all online contestants of vote update
    this.broadcastFn({
      type: 'vote.update',
      payload: { contestantId, ...votes },
      timestamp,
    });
  }

  /**
   * 获取投票统计
   * Requirements: 10.3
   */
  async getVotes(contestantId: string): Promise<{ likes: number; dislikes: number }> {
    const likes = (this.db.prepare(
      "SELECT COUNT(*) as cnt FROM vote_records WHERE contestant_id = ? AND type = 'like'",
    ).get(contestantId) as { cnt: number }).cnt;

    const dislikes = (this.db.prepare(
      "SELECT COUNT(*) as cnt FROM vote_records WHERE contestant_id = ? AND type = 'dislike'",
    ).get(contestantId) as { cnt: number }).cnt;

    return { likes, dislikes };
  }

  /**
   * 观众互动数据汇总
   * Requirements: 10.5
   */
  async getAudienceFeedback(contestantId?: string): Promise<ViewerInteractionSummary> {
    const barrageCount = (this.db.prepare(
      'SELECT COUNT(*) as cnt FROM barrage_messages',
    ).get() as { cnt: number }).cnt;

    let likeCount = 0;
    let dislikeCount = 0;

    if (contestantId) {
      const votes = await this.getVotes(contestantId);
      likeCount = votes.likes;
      dislikeCount = votes.dislikes;
    } else {
      likeCount = (this.db.prepare(
        "SELECT COUNT(*) as cnt FROM vote_records WHERE type = 'like'",
      ).get() as { cnt: number }).cnt;
      dislikeCount = (this.db.prepare(
        "SELECT COUNT(*) as cnt FROM vote_records WHERE type = 'dislike'",
      ).get() as { cnt: number }).cnt;
    }

    const recentRows = this.db.prepare(
      'SELECT id, viewer_id, content, timestamp FROM barrage_messages ORDER BY timestamp DESC LIMIT 10',
    ).all() as Array<{ id: string; viewer_id: string; content: string; timestamp: number }>;

    const recentBarrages: BarrageMessage[] = recentRows.reverse().map(r => ({
      id: r.id,
      viewerId: r.viewer_id,
      content: r.content,
      timestamp: r.timestamp,
    }));

    const recentBroadcastRows = this.db.prepare(
      'SELECT id, sender_id, content, timestamp FROM broadcast_messages ORDER BY timestamp DESC LIMIT 10',
    ).all() as Array<{ id: string; sender_id: string; content: string; timestamp: number }>;

    const recentBroadcasts: BroadcastMessage[] = recentBroadcastRows.reverse().map((row) => ({
      id: row.id,
      senderId: row.sender_id,
      content: row.content,
      timestamp: row.timestamp,
    }));

    return { barrageCount, likeCount, dislikeCount, recentBarrages, recentBroadcasts };
  }
}

// ---------------------------------------------------------------------------
// Singleton
// ---------------------------------------------------------------------------

export const interactionManager = new InteractionManagerClass(globalDb, connections, broadcast);
