// =============================================================================
// XTION_TheFool0 — SkillDocManager 模块
// Requirements: 7.1, 7.2, 7.3, 7.4, 7.5, 7.6, 7.9, 7.11
// =============================================================================

import { v4 as uuidv4 } from 'uuid';
import matter from 'gray-matter';
import { db as defaultDb } from '../db';
import type { Database as DatabaseType } from 'better-sqlite3';
import type {
  ISkillDocManager,
  SkillDocument,
  SkillMetadata,
  DocumentVersion,
  ValidationResult,
} from '../types';

// ---------------------------------------------------------------------------
// Row types
// ---------------------------------------------------------------------------

interface SkillDocRow {
  id: string;
  name: string;
  version: string;
  description: string;
  homepage: string | null;
  author: string | null;
  tags: string;
  markdown_content: string;
  current_version: string;
  is_default: number;
  created_at: number;
  updated_at: number;
}

interface VersionRow {
  id: string;
  skill_doc_id: string;
  version: string;
  markdown_content: string;
  created_at: number;
  changelog: string | null;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function rowToDoc(row: SkillDocRow): SkillDocument {
  return {
    id: row.id,
    metadata: {
      name: row.name,
      version: row.version,
      description: row.description,
      homepage: row.homepage ?? undefined,
      author: row.author ?? undefined,
      tags: JSON.parse(row.tags) as string[],
    },
    markdownContent: row.markdown_content,
    currentVersion: row.current_version,
    isDefault: row.is_default === 1,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

// ---------------------------------------------------------------------------
// SkillDocManager
// ---------------------------------------------------------------------------

export class SkillDocManagerClass implements ISkillDocManager {
  private db: DatabaseType;

  constructor(db: DatabaseType = defaultDb) {
    this.db = db;
  }

  validateMetadata(content: string): ValidationResult {
    try {
      const { data } = matter(content);
      const errors: string[] = [];
      const check = (key: string) => {
        const v = data[key];
        return v !== undefined && v !== null && String(v).trim() !== '';
      };
      if (!check('name')) errors.push('缺少必填字段: name');
      if (!check('version')) errors.push('缺少必填字段: version');
      if (!check('description')) errors.push('缺少必填字段: description');
      return { valid: errors.length === 0, errors };
    } catch {
      return { valid: false, errors: ['无法解析 YAML front matter'] };
    }
  }

  async uploadDocument(markdownContent: string): Promise<SkillDocument> {
    const validation = this.validateMetadata(markdownContent);
    if (!validation.valid) {
      throw Object.assign(new Error(validation.errors.join('; ')), { code: 'DOC_INVALID_METADATA', statusCode: 400 });
    }

    const { data } = matter(markdownContent);
    const now = Date.now();
    const id = uuidv4();
    const version = String(data['version']);

    this.db.prepare(`
      INSERT INTO skill_documents (id, name, version, description, homepage, author, tags, markdown_content, current_version, is_default, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?)
    `).run(
      id, String(data['name']), version, String(data['description']),
      data['homepage'] ? String(data['homepage']) : null,
      data['author'] ? String(data['author']) : null,
      JSON.stringify(Array.isArray(data['tags']) ? data['tags'] : []),
      markdownContent, version, now, now,
    );

    this.db.prepare(`
      INSERT INTO document_versions (id, skill_doc_id, version, markdown_content, created_at, changelog)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(uuidv4(), id, version, markdownContent, now, null);

    return rowToDoc(this.db.prepare('SELECT * FROM skill_documents WHERE id = ?').get(id) as SkillDocRow);
  }

  async getDocument(docId: string): Promise<SkillDocument> {
    const row = this.db.prepare('SELECT * FROM skill_documents WHERE id = ?').get(docId) as SkillDocRow | undefined;
    if (!row) throw Object.assign(new Error(`Skill 文档不存在: ${docId}`), { code: 'DOC_NOT_FOUND', statusCode: 404 });
    return rowToDoc(row);
  }

  async updateDocument(docId: string, markdownContent: string): Promise<SkillDocument> {
    const existing = await this.getDocument(docId);
    const validation = this.validateMetadata(markdownContent);
    if (!validation.valid) {
      throw Object.assign(new Error(validation.errors.join('; ')), { code: 'DOC_INVALID_METADATA', statusCode: 400 });
    }

    const { data } = matter(markdownContent);
    const now = Date.now();
    const newVersion = String(data['version']);

    this.db.prepare(`
      UPDATE skill_documents SET name=?, version=?, description=?, homepage=?, author=?, tags=?,
        markdown_content=?, current_version=?, updated_at=? WHERE id=?
    `).run(
      String(data['name']), newVersion, String(data['description']),
      data['homepage'] ? String(data['homepage']) : null,
      data['author'] ? String(data['author']) : null,
      JSON.stringify(Array.isArray(data['tags']) ? data['tags'] : []),
      markdownContent, newVersion, now, docId,
    );

    if (newVersion !== existing.currentVersion) {
      this.db.prepare(`
        INSERT INTO document_versions (id, skill_doc_id, version, markdown_content, created_at, changelog)
        VALUES (?, ?, ?, ?, ?, ?)
      `).run(uuidv4(), docId, newVersion, markdownContent, now, null);
    }

    return rowToDoc(this.db.prepare('SELECT * FROM skill_documents WHERE id = ?').get(docId) as SkillDocRow);
  }

  async deleteDocument(docId: string): Promise<void> {
    await this.getDocument(docId);
    this.db.prepare('DELETE FROM skill_documents WHERE id = ?').run(docId);
  }

  async listSkillDocuments(): Promise<SkillDocument[]> {
    const rows = this.db.prepare('SELECT * FROM skill_documents ORDER BY updated_at DESC').all() as SkillDocRow[];
    return rows.map(rowToDoc);
  }

  async listDocuments(): Promise<SkillMetadata[]> {
    const rows = this.db.prepare('SELECT * FROM skill_documents ORDER BY updated_at DESC').all() as SkillDocRow[];
    return rows.map((r) => ({
      name: r.name,
      version: r.version,
      description: r.description,
      homepage: r.homepage ?? undefined,
      author: r.author ?? undefined,
      tags: JSON.parse(r.tags) as string[],
    }));
  }

  async getVersionHistory(docId: string): Promise<DocumentVersion[]> {
    await this.getDocument(docId);
    const rows = this.db.prepare(
      'SELECT * FROM document_versions WHERE skill_doc_id = ? ORDER BY created_at DESC',
    ).all(docId) as VersionRow[];
    return rows.map((r) => ({
      version: r.version,
      markdownContent: r.markdown_content,
      createdAt: r.created_at,
      changelog: r.changelog ?? undefined,
    }));
  }

  async rollbackToVersion(docId: string, version: string): Promise<SkillDocument> {
    const versionRow = this.db.prepare(
      'SELECT * FROM document_versions WHERE skill_doc_id = ? AND version = ?',
    ).get(docId, version) as VersionRow | undefined;

    if (!versionRow) {
      throw Object.assign(new Error(`版本不存在: ${version}`), { code: 'DOC_VERSION_NOT_FOUND', statusCode: 404 });
    }

    return this.updateDocument(docId, versionRow.markdown_content);
  }
}

// ---------------------------------------------------------------------------
// Singleton export
// ---------------------------------------------------------------------------

export const skillDocManager = new SkillDocManagerClass();
