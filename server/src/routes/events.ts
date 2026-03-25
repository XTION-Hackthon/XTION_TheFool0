// =============================================================================
// XTION_TheFool0 — 事件查询 API
// Requirements: 13.5
// =============================================================================

import { Router, type Request, type Response, type NextFunction } from 'express';
import { eventLogger } from '../modules/event-logger';
import type { EventType } from '../types';

export const eventsRouter = Router();

// ---------------------------------------------------------------------------
// GET /api/events — 查询事件历史（支持分页和类型过滤）
// Requirements: 13.5
// ---------------------------------------------------------------------------

eventsRouter.get('/events', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const type = req.query['type'] as EventType | undefined;
    const contestantId = req.query['contestant_id'] as string | undefined;
    const page = req.query['page'] ? parseInt(req.query['page'] as string, 10) : 1;
    const pageSize = req.query['page_size'] ? parseInt(req.query['page_size'] as string, 10) : 20;

    const result = await eventLogger.query({ type, contestantId, page, pageSize });
    res.json(result);
  } catch (err) {
    next(err);
  }
});
