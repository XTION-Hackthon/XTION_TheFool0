// =============================================================================
// XTION_TheFool0 — Messages Archive API 路由
// GET /api/admin/messages
// Requirements: 12.3, 12.4, 12.5, 12.6
// =============================================================================

import { Router, type Request, type Response, type NextFunction } from 'express';
import { db } from '../db.js';
import type { ArchivedMessage, ErrorResponse } from '../types/index.js';

export const messagesRouter = Router();

// ---------------------------------------------------------------------------
// GET /api/admin/messages — 查询消息存档
// 支持 type、sender_id、from、to、page、pageSize 查询参数
// 仅 Admin 可访问（由 app.ts 中的 requireRole 中间件保证）
// Requirements: 12.3, 12.4, 12.5, 12.6
// ---------------------------------------------------------------------------

interface MessageRow {
  id: string;
  type: 'broadcast' | 'private';
  sender_id: string;
  receiver_id: string | null;
  room_id: number | null;
  content: string;
  timestamp: number;
}

messagesRouter.get('/messages', (req: Request, res: Response, next: NextFunction) => {
  try {
    const {
      type,
      sender_id,
      from,
      to,
      page = '1',
      pageSize = '20',
    } = req.query as Record<string, string | undefined>;

    // Parse and validate pagination
    const pageNum = Math.max(1, parseInt(page ?? '1', 10) || 1);
    const pageSizeNum = Math.min(100, Math.max(1, parseInt(pageSize ?? '20', 10) || 20));
    const offset = (pageNum - 1) * pageSizeNum;

    // Build WHERE clauses dynamically
    const conditions: string[] = [];
    const params: (string | number)[] = [];

    if (type === 'broadcast' || type === 'private') {
      conditions.push('type = ?');
      params.push(type);
    }

    if (sender_id) {
      conditions.push('sender_id = ?');
      params.push(sender_id);
    }

    if (from) {
      const fromTs = parseInt(from, 10);
      if (!isNaN(fromTs)) {
        conditions.push('timestamp >= ?');
        params.push(fromTs);
      }
    }

    if (to) {
      const toTs = parseInt(to, 10);
      if (!isNaN(toTs)) {
        conditions.push('timestamp <= ?');
        params.push(toTs);
      }
    }

    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

    // Count total matching rows
    const countRow = db.prepare(
      `SELECT COUNT(*) as cnt FROM messages ${whereClause}`,
    ).get(...params) as { cnt: number };
    const total = countRow.cnt;

    // Fetch paginated results
    const rows = db.prepare(
      `SELECT * FROM messages ${whereClause} ORDER BY timestamp DESC LIMIT ? OFFSET ?`,
    ).all(...params, pageSizeNum, offset) as MessageRow[];

    const messages: ArchivedMessage[] = rows.map((row) => ({
      id: row.id,
      type: row.type,
      senderId: row.sender_id,
      ...(row.receiver_id != null ? { receiverId: row.receiver_id } : {}),
      ...(row.room_id != null ? { roomId: row.room_id } : {}),
      content: row.content,
      timestamp: row.timestamp,
    }));

    res.status(200).json({
      messages,
      total,
      page: pageNum,
      pageSize: pageSizeNum,
    });
  } catch (err) {
    next(err);
  }
});
