// =============================================================================
// XTION_TheFool0 — 产品文档 API（Agent 可读写）
// =============================================================================

import { Router, type Request, type Response, type NextFunction } from 'express';
import { db } from '../db';

export const productRouter = Router();

const DOC_NAME = 'PRODUCT.md';

function httpError(statusCode: number, code: string, message: string) {
  const err = new Error(message) as Error & { statusCode: number; code: string };
  err.statusCode = statusCode;
  err.code = code;
  return err;
}

// ---------------------------------------------------------------------------
// GET /api/product — 获取产品文档（所有角色可读）
// ---------------------------------------------------------------------------

productRouter.get('/', (_req: Request, res: Response, next: NextFunction) => {
  try {
    const doc = db.prepare('SELECT markdown_content, updated_at FROM platform_documents WHERE name = ?').get(DOC_NAME) as
      | { markdown_content: string; updated_at: number }
      | undefined;

    if (!doc) {
      return next(httpError(404, 'DOC_NOT_FOUND', '产品文档尚未创建'));
    }

    res.json({ name: DOC_NAME, content: doc.markdown_content, updatedAt: doc.updated_at });
  } catch (err) {
    next(err);
  }
});

// ---------------------------------------------------------------------------
// PUT /api/product — 更新产品文档（Agent_Player 可写）
// ---------------------------------------------------------------------------

productRouter.put('/', (req: Request, res: Response, next: NextFunction) => {
  try {
    const { content, section, action } = req.body as {
      content?: string;
      section?: string;
      action?: 'append' | 'replace';
    };

    if (!content || typeof content !== 'string') {
      return next(httpError(400, 'INVALID_PARAM', '参数 content 不能为空'));
    }

    const existing = db.prepare('SELECT markdown_content FROM platform_documents WHERE name = ?').get(DOC_NAME) as
      | { markdown_content: string }
      | undefined;

    if (!existing) {
      return next(httpError(404, 'DOC_NOT_FOUND', '产品文档尚未初始化'));
    }

    let newContent: string;

    if (action === 'append' && section) {
      // 追加到指定章节，或在文档末尾追加
      const sectionHeader = `## ${section}`;
      if (existing.markdown_content.includes(sectionHeader)) {
        // 找到章节，在下一个 ## 之前插入
        const parts = existing.markdown_content.split(/(?=^## )/m);
        newContent = parts.map((part) => {
          if (part.startsWith(sectionHeader)) {
            return part.trimEnd() + '\n\n' + content + '\n';
          }
          return part;
        }).join('');
      } else {
        // 章节不存在，追加新章节
        newContent = existing.markdown_content.trimEnd() + `\n\n${sectionHeader}\n\n${content}\n`;
      }
    } else {
      // 默认：完整替换
      newContent = content;
    }

    db.prepare(
      'UPDATE platform_documents SET markdown_content = ?, updated_at = ? WHERE name = ?',
    ).run(newContent, Date.now(), DOC_NAME);

    res.json({ name: DOC_NAME, content: newContent, updatedAt: Date.now() });
  } catch (err) {
    next(err);
  }
});
