// =============================================================================
// XTION_TheFool0 — AuthManager 模块
// Requirements: 1.1, 1.2, 1.3, 1.4
// =============================================================================

import crypto from 'crypto';
import { v4 as uuidv4 } from 'uuid';
import type { Database as DatabaseType } from 'better-sqlite3';
import { db as globalDb } from '../db';
import type { Key, IAuthManager, Role } from '../types';

// =============================================================================
// DB Row Type
// =============================================================================

const VALID_ROLES: Role[] = ['Admin', 'Agent_Player', 'Human_Viewer', 'Agent_Viewer'];

function createHttpError(statusCode: number, code: string, message: string): Error & { statusCode: number; code: string } {
  const err = new Error(message) as Error & { statusCode: number; code: string };
  err.statusCode = statusCode;
  err.code = code;
  return err;
}

interface KeyRow {
  id: string;
  key: string;
  contestant_name: string;
  role: Role;
  status: 'active' | 'revoked';
  created_at: number;
  revoked_at: number | null;
}

function rowToKey(row: KeyRow): Key {
  return {
    id: row.id,
    key: row.key,
    contestantName: row.contestant_name,
    role: row.role ?? 'Agent_Player',
    status: row.status,
    createdAt: row.created_at,
    ...(row.revoked_at != null ? { revokedAt: row.revoked_at } : {}),
  };
}

// =============================================================================
// AuthManager Implementation
// =============================================================================

export class AuthManagerClass implements IAuthManager {
  private db: DatabaseType;

  constructor(db: DatabaseType) {
    this.db = db;
  }

  /**
   * 生成新的 API Key（64字符 hex，≥32字符）
   * Requirements: 1.1, 1.2, 1.3, 1.7
   */
  async generateKey(contestantName: string, role: Role): Promise<Key> {
    if (role === undefined || role === null || (role as unknown) === '') {
      throw createHttpError(400, 'MISSING_ROLE_FIELD', '角色字段为必填项');
    }
    if (!VALID_ROLES.includes(role)) {
      throw createHttpError(400, 'INVALID_ROLE', `无效的角色值: ${role}，有效值为 ${VALID_ROLES.join(', ')}`);
    }

    const id = uuidv4();
    const key = crypto.randomBytes(32).toString('hex'); // 64 hex chars
    const now = Date.now();

    this.db.prepare(`
      INSERT INTO keys (id, key, contestant_name, role, status, created_at)
      VALUES (?, ?, ?, ?, 'active', ?)
    `).run(id, key, contestantName, role, now);

    return {
      id,
      key,
      contestantName,
      role,
      status: 'active',
      createdAt: now,
    };
  }

  /**
   * 验证 Key 是否有效（存在且状态为 active）
   * Requirements: 1.3, 1.4, 1.5
   */
  async validateKey(key: string): Promise<{ valid: boolean; contestantId?: string; keyId?: string; role?: Role }> {
    const row = this.db.prepare(`
      SELECT k.id as key_id, k.status, k.role, c.id as contestant_id
      FROM keys k
      LEFT JOIN contestants c ON c.key_id = k.id
      WHERE k.key = ?
    `).get(key) as { key_id: string; status: string; role: Role | null; contestant_id: string | null } | undefined;

    if (!row || row.status !== 'active') {
      return { valid: false };
    }

    return {
      valid: true,
      keyId: row.key_id,
      contestantId: row.contestant_id ?? row.key_id,
      role: row.role ?? 'Agent_Player',
    };
  }

  /**
   * 修改已有 Key 的角色
   * Requirements: 1.4
   */
  async updateKeyRole(keyId: string, role: Role): Promise<Key> {
    if (!VALID_ROLES.includes(role)) {
      throw createHttpError(400, 'INVALID_ROLE', `无效的角色值: ${role}，有效值为 ${VALID_ROLES.join(', ')}`);
    }

    const result = this.db.prepare(`
      UPDATE keys SET role = ? WHERE id = ?
    `).run(role, keyId);

    if (result.changes === 0) {
      throw new Error(`Key not found: ${keyId}`);
    }

    const row = this.db.prepare(`SELECT * FROM keys WHERE id = ?`).get(keyId) as KeyRow | undefined;
    if (!row) throw new Error(`Key not found: ${keyId}`);
    return rowToKey(row);
  }

  /**
   * 吊销 Key（将状态改为 revoked）
   * Requirements: 1.2, 2.5
   */
  async revokeKey(keyId: string): Promise<void> {
    // 检查目标 Key 是否为 Admin 角色
    const targetKey = this.db.prepare(`
      SELECT role FROM keys WHERE id = ? AND status = 'active'
    `).get(keyId) as { role: Role } | undefined;

    if (targetKey?.role === 'Admin') {
      // 查询当前 active 状态的 Admin Key 数量
      const adminCount = (this.db.prepare(`
        SELECT COUNT(*) as count FROM keys WHERE role = 'Admin' AND status = 'active'
      `).get() as { count: number }).count;

      if (adminCount === 1) {
        throw createHttpError(403, 'LAST_ADMIN_KEY', '不能吊销最后一个管理员密钥');
      }
    }

    const result = this.db.prepare(`
      UPDATE keys SET status = 'revoked', revoked_at = ? WHERE id = ? AND status = 'active'
    `).run(Date.now(), keyId);

    if (result.changes === 0) {
      throw new Error(`Key not found or already revoked: ${keyId}`);
    }
  }

  /**
   * 重新生成 Key（生成新的 key 字符串，保留 id 和 contestantName）
   * Requirements: 1.2
   */
  async regenerateKey(keyId: string): Promise<Key> {
    const existing = this.db.prepare(`
      SELECT * FROM keys WHERE id = ?
    `).get(keyId) as KeyRow | undefined;

    if (!existing) {
      throw new Error(`Key not found: ${keyId}`);
    }

    const newKey = crypto.randomBytes(32).toString('hex');
    const now = Date.now();

    this.db.prepare(`
      UPDATE keys SET key = ?, status = 'active', revoked_at = NULL, created_at = ? WHERE id = ?
    `).run(newKey, now, keyId);

    return {
      id: existing.id,
      key: newKey,
      contestantName: existing.contestant_name,
      role: existing.role ?? 'Agent_Player',
      status: 'active',
      createdAt: now,
    };
  }

  /**
   * 获取所有 Key 列表
   * Requirements: 1.2
   */
  async listKeys(): Promise<Key[]> {
    const rows = this.db.prepare(`
      SELECT * FROM keys ORDER BY created_at DESC
    `).all() as KeyRow[];

    return rows.map(rowToKey);
  }
}

// =============================================================================
// Singleton Export
// =============================================================================

export const authManager = new AuthManagerClass(globalDb);
