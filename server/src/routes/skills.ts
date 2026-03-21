// =============================================================================
// XTION_TheFool0 — Agent Skill API
// Requirements: 7.7, 7.8
// =============================================================================

import { Router, type Request, type Response, type NextFunction } from 'express';
import { docDistributor } from '../modules/doc-distributor';
import { requireRole } from '../middleware/auth';

export const skillsRouter = Router();

function httpError(statusCode: number, code: string, message: string) {
  const err = new Error(message) as Error & { statusCode: number; code: string };
  err.statusCode = statusCode;
  err.code = code;
  return err;
}

// ---------------------------------------------------------------------------
// GET /api/skills — 获取可用 Skill 列表（Metadata 摘要）
// Requirements: 7.7
// ---------------------------------------------------------------------------

skillsRouter.get('/', requireRole('Admin', 'Agent_Player', 'Agent_Viewer'), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const contestantId = req.contestantId ?? (req.headers['x-contestant-id'] as string) ?? 'anonymous';
    const list = await docDistributor.listAvailableSkills(contestantId);
    res.json(list);
  } catch (err) {
    next(err);
  }
});

// ---------------------------------------------------------------------------
// GET /api/skills/:id/install — 安装 Skill（返回完整 Markdown）
// Requirements: 7.8
// ---------------------------------------------------------------------------

skillsRouter.get('/:id/install', requireRole('Admin', 'Agent_Player', 'Agent_Viewer'), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const contestantId = req.contestantId ?? (req.headers['x-contestant-id'] as string) ?? 'anonymous';
    const content = await docDistributor.installSkill(contestantId, req.params['id'] as string);
    res.type('text/markdown').send(content);
  } catch (err) {
    const e = err as Error & { code?: string };
    if (e.code === 'DOC_NOT_FOUND') return next(httpError(404, 'DOC_NOT_FOUND', e.message));
    next(err);
  }
});
