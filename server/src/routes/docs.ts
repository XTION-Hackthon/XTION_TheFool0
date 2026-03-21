// =============================================================================
// XTION_TheFool0 — 平台文档 API
// Requirements: 12.4, 12.5, 12.6
// =============================================================================

import { Router, type Request, type Response, type NextFunction } from 'express';
import { db } from '../db';
import { docDistributor } from '../modules/doc-distributor';
import { requireRole } from '../middleware/auth';

export const docsRouter = Router();

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
// GET /api/docs/:doc_name — 获取平台文档
// Requirements: 12.4, 12.6
// ---------------------------------------------------------------------------

docsRouter.get('/:doc_name', requireRole('Admin', 'Agent_Player', 'Agent_Viewer'), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const doc = await docDistributor.getPlatformDocument(req.params['doc_name'] as string);
    res.json(doc);
  } catch (err) {
    const e = err as Error & { code?: string };
    if (e.code === 'DOC_NOT_FOUND') return next(httpError(404, 'DOC_NOT_FOUND', e.message));
    next(err);
  }
});

// ---------------------------------------------------------------------------
// PUT /api/admin/docs/:doc_name — 管理员编辑平台文档
// Requirements: 12.5, 12.6
// ---------------------------------------------------------------------------

export const adminDocsRouter = Router();

adminDocsRouter.put('/:doc_name', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const content = extractMarkdownContent(req.body);
    if (!content) {
      return next(httpError(400, 'INVALID_PARAM', '参数 content 或 markdownContent 不能为空'));
    }

    const docName = req.params['doc_name'] as string;

    // Check doc exists
    const existing = db.prepare('SELECT id FROM platform_documents WHERE name = ?').get(docName) as
      | { id: string }
      | undefined;
    if (!existing) {
      return next(httpError(404, 'DOC_NOT_FOUND', `平台文档不存在: ${docName}`));
    }

    db.prepare(
      'UPDATE platform_documents SET markdown_content = ?, updated_at = ? WHERE name = ?',
    ).run(content, Date.now(), docName);

    // Notify all online contestants of the update
    await docDistributor.notifyDocumentUpdate(docName);

    const updated = await docDistributor.getPlatformDocument(docName);
    res.json(updated);
  } catch (err) {
    next(err);
  }
});
