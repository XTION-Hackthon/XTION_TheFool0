// =============================================================================
// XTION_TheFool0 — 管理员 Skill 文档管理路由
// Requirements: 7.4, 7.6
// =============================================================================

import { Router, type Request, type Response, type NextFunction } from 'express';
import { skillDocManager } from '../modules/skill-doc-manager';

export const adminSkillsRouter = Router();

function httpError(statusCode: number, code: string, message: string) {
  const err = new Error(message) as Error & { statusCode: number; code: string };
  err.statusCode = statusCode;
  err.code = code;
  return err;
}

function extractMarkdownContent(body: unknown): string | null {
  const payload = body as { content?: unknown; markdownContent?: unknown };
  if (typeof payload.content === 'string' && payload.content.trim() !== '') {
    return payload.content;
  }
  if (typeof payload.markdownContent === 'string' && payload.markdownContent.trim() !== '') {
    return payload.markdownContent;
  }
  return null;
}

// ---------------------------------------------------------------------------
// GET /api/admin/skills — 获取所有 Skill 文档
// ---------------------------------------------------------------------------

adminSkillsRouter.get('/', async (_req: Request, res: Response, next: NextFunction) => {
  try {
    const docs = await skillDocManager.listSkillDocuments();
    res.json(docs);
  } catch (err) {
    next(err);
  }
});

// ---------------------------------------------------------------------------
// POST /api/admin/skills — 上传 SKILL.md
// Requirements: 7.4
// ---------------------------------------------------------------------------

adminSkillsRouter.post('/', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const content = extractMarkdownContent(req.body);
    if (!content) {
      return next(httpError(400, 'INVALID_PARAM', '参数 content 或 markdownContent 不能为空'));
    }
    const validation = skillDocManager.validateMetadata(content);
    if (!validation.valid) {
      return next(httpError(400, 'INVALID_METADATA', validation.errors.join('; ')));
    }
    const doc = await skillDocManager.uploadDocument(content);
    res.status(201).json(doc);
  } catch (err) {
    next(err);
  }
});

// ---------------------------------------------------------------------------
// PUT /api/admin/skills/:id — 编辑
// Requirements: 7.4
// ---------------------------------------------------------------------------

adminSkillsRouter.put('/:id', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const content = extractMarkdownContent(req.body);
    if (!content) {
      return next(httpError(400, 'INVALID_PARAM', '参数 content 或 markdownContent 不能为空'));
    }
    const doc = await skillDocManager.updateDocument(req.params['id'] as string, content);
    res.json(doc);
  } catch (err) {
    const e = err as Error & { code?: string };
    if (e.code === 'DOC_NOT_FOUND') return next(httpError(404, 'DOC_NOT_FOUND', e.message));
    next(err);
  }
});

// ---------------------------------------------------------------------------
// DELETE /api/admin/skills/:id — 删除
// Requirements: 7.4
// ---------------------------------------------------------------------------

adminSkillsRouter.delete('/:id', async (req: Request, res: Response, next: NextFunction) => {
  try {
    await skillDocManager.deleteDocument(req.params['id'] as string);
    res.status(204).end();
  } catch (err) {
    const e = err as Error & { code?: string };
    if (e.code === 'DOC_NOT_FOUND') return next(httpError(404, 'DOC_NOT_FOUND', e.message));
    next(err);
  }
});

// ---------------------------------------------------------------------------
// GET /api/admin/skills/:id/versions — 版本历史
// Requirements: 7.6
// ---------------------------------------------------------------------------

adminSkillsRouter.get('/:id/versions', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const history = await skillDocManager.getVersionHistory(req.params['id'] as string);
    res.json(history);
  } catch (err) {
    const e = err as Error & { code?: string };
    if (e.code === 'DOC_NOT_FOUND') return next(httpError(404, 'DOC_NOT_FOUND', e.message));
    next(err);
  }
});

// ---------------------------------------------------------------------------
// POST /api/admin/skills/:id/rollback/:version — 回滚
// Requirements: 7.6
// ---------------------------------------------------------------------------

adminSkillsRouter.post('/:id/rollback/:version', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const doc = await skillDocManager.rollbackToVersion(
      req.params['id'] as string,
      req.params['version'] as string,
    );
    res.json(doc);
  } catch (err) {
    const e = err as Error & { code?: string };
    if (e.code === 'DOC_NOT_FOUND' || e.code === 'VERSION_NOT_FOUND') {
      return next(httpError(404, e.code, e.message));
    }
    next(err);
  }
});
