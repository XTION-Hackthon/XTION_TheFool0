// =============================================================================
// XTION_TheFool0 — 观众互动 API
// Requirements: 10.1, 10.3, 10.5
// =============================================================================

import { Router, type Request, type Response, type NextFunction } from 'express';
import { interactionManager } from '../modules/interaction-manager';
import { authMiddleware, requireRole } from '../middleware/auth';

export const interactionRouter = Router();

function httpError(statusCode: number, code: string, message: string) {
  const err = new Error(message) as Error & { statusCode: number; code: string };
  err.statusCode = statusCode;
  err.code = code;
  return err;
}

// ---------------------------------------------------------------------------
// POST /api/barrage — 发送弹幕
// Requirements: 10.1
// ---------------------------------------------------------------------------

interactionRouter.post('/barrage', authMiddleware, requireRole('Admin', 'Human_Viewer'), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { viewer_id, content } = req.body as { viewer_id?: string; content?: string };
    if (!viewer_id || !content) {
      return next(httpError(400, 'INVALID_PARAM', '参数 viewer_id 和 content 不能为空'));
    }
    const msg = await interactionManager.sendBarrage(viewer_id, content);
    res.status(201).json(msg);
  } catch (err) {
    next(err);
  }
});

// ---------------------------------------------------------------------------
// POST /api/contestants/:id/vote — 点赞/踩
// Requirements: 10.3
// ---------------------------------------------------------------------------

interactionRouter.post('/contestants/:id/vote', authMiddleware, requireRole('Admin', 'Human_Viewer'), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { viewer_id, type } = req.body as { viewer_id?: string; type?: string };
    if (!viewer_id || (type !== 'like' && type !== 'dislike')) {
      return next(httpError(400, 'INVALID_PARAM', '参数 viewer_id 和 type (like/dislike) 不能为空'));
    }
    await interactionManager.vote(viewer_id, req.params['id'] as string, type);
    res.status(204).end();
  } catch (err) {
    next(err);
  }
});

// ---------------------------------------------------------------------------
// GET /api/contestants/:id/votes — 获取投票统计
// Requirements: 10.3
// ---------------------------------------------------------------------------

interactionRouter.get('/contestants/:id/votes', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const votes = await interactionManager.getVotes(req.params['id'] as string);
    res.json(votes);
  } catch (err) {
    next(err);
  }
});

// ---------------------------------------------------------------------------
// GET /api/audience-feedback — 观众互动数据汇总
// Requirements: 10.5
// ---------------------------------------------------------------------------

interactionRouter.get('/audience-feedback', authMiddleware, requireRole('Admin', 'Agent_Player', 'Human_Viewer', 'Agent_Viewer'), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const contestantId = req.query['contestant_id'] as string | undefined;
    const feedback = await interactionManager.getAudienceFeedback(contestantId);
    res.json(feedback);
  } catch (err) {
    next(err);
  }
});
