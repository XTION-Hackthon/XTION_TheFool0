// =============================================================================
// XTION_TheFool0 — RateLimiter 模块
// 滑动窗口速率限制算法（内存计数器）
// Requirements: 3.8, 4.5, 8.11
// =============================================================================

import type { Request, Response, NextFunction } from 'express';
import type { ErrorResponse, Role } from '../types';

// =============================================================================
// Constants
// =============================================================================

const WINDOW_MS = 60_000; // 1 分钟滑动窗口

// =============================================================================
// RateLimiter Class
// =============================================================================

class RateLimiter {
  /** 全局 API 限制：每位 Contestant 每分钟最多调用次数 */
  private globalLimit: number = 60;

  /** Broadcast 限制：每位 Contestant 每分钟最多广播次数 */
  private broadcastLimit: number = 5;

  /** 全局 API 请求时间戳记录：contestantId → 时间戳数组 */
  private globalTimestamps: Map<string, number[]> = new Map();

  /** Broadcast 请求时间戳记录：contestantId → 时间戳数组 */
  private broadcastTimestamps: Map<string, number[]> = new Map();

  /** Talk 请求时间戳记录：contestantId → 时间戳数组 */
  private talkTimestamps: Map<string, number[]> = new Map();

  /** Barrage 请求时间戳记录：contestantId → 时间戳数组 */
  private barrageTimestamps: Map<string, number[]> = new Map();

  // ---------------------------------------------------------------------------
  // Private helpers
  // ---------------------------------------------------------------------------

  /**
   * 滑动窗口检查：移除 1 分钟前的时间戳，然后检查是否超过限制
   * 若未超限，记录本次请求时间戳并返回 true；否则返回 false
   */
  private checkAndRecord(
    store: Map<string, number[]>,
    id: string,
    limit: number,
  ): boolean {
    const now = Date.now();
    const cutoff = now - WINDOW_MS;

    let timestamps = store.get(id);
    if (!timestamps) {
      timestamps = [];
      store.set(id, timestamps);
    }

    // 移除窗口外的旧时间戳
    const valid = timestamps.filter((t) => t > cutoff);

    if (valid.length >= limit) {
      // 超限：更新（清理旧的），但不记录本次
      store.set(id, valid);
      return false;
    }

    // 未超限：记录本次请求
    valid.push(now);
    store.set(id, valid);
    return true;
  }

  // ---------------------------------------------------------------------------
  // Public API
  // ---------------------------------------------------------------------------

  /**
   * 检查全局 API 速率限制
   * @returns true 表示允许，false 表示超限
   * Requirements: 8.11
   */
  checkGlobalLimit(contestantId: string): boolean {
    return this.checkAndRecord(this.globalTimestamps, contestantId, this.globalLimit);
  }

  /**
   * 基于调用方角色使用自定义全局限制
   */
  checkGlobalLimitWithLimit(contestantId: string, limit: number): boolean {
    return this.checkAndRecord(this.globalTimestamps, contestantId, limit);
  }

  /**
   * 检查 Broadcast 频率限制
   * @returns true 表示允许，false 表示超限
   * Requirements: 4.5
   */
  checkBroadcastLimit(contestantId: string): boolean {
    return this.checkAndRecord(this.broadcastTimestamps, contestantId, this.broadcastLimit);
  }

  /**
   * 检查 Talk 频率限制（按 Zone_Rule 配置）
   * @param limitPerMinute Zone_Rule 中配置的每分钟最大次数
   * @returns true 表示允许，false 表示超限
   * Requirements: 3.8
   */
  checkTalkLimit(contestantId: string, limitPerMinute: number): boolean {
    return this.checkAndRecord(this.talkTimestamps, contestantId, limitPerMinute);
  }

  /**
   * 设置全局 API 速率限制
   * Requirements: 8.11
   */
  setGlobalLimit(limit: number): void {
    this.globalLimit = limit;
  }

  /**
   * 设置 Broadcast 频率限制
   * Requirements: 4.5
   */
  setBroadcastLimit(limit: number): void {
    this.broadcastLimit = limit;
  }

  /**
   * 检查 Barrage 频率限制
   */
  checkBarrageLimit(contestantId: string, limitPerMinute: number): boolean {
    return this.checkAndRecord(this.barrageTimestamps, contestantId, limitPerMinute);
  }

  /**
   * 获取当前全局限制值（用于测试）
   */
  getGlobalLimit(): number {
    return this.globalLimit;
  }

  /**
   * 获取当前 Broadcast 限制值（用于测试）
   */
  getBroadcastLimit(): number {
    return this.broadcastLimit;
  }

  /**
   * 重置某个 Contestant 的所有计数器（用于测试）
   */
  reset(contestantId: string): void {
    this.globalTimestamps.delete(contestantId);
    this.broadcastTimestamps.delete(contestantId);
    this.talkTimestamps.delete(contestantId);
    this.barrageTimestamps.delete(contestantId);
  }

  /**
   * 重置所有计数器（用于测试）
   */
  resetAll(): void {
    this.globalTimestamps.clear();
    this.broadcastTimestamps.clear();
    this.talkTimestamps.clear();
    this.barrageTimestamps.clear();
  }
}

// =============================================================================
// Singleton Export
// =============================================================================

export const rateLimiter = new RateLimiter();

// =============================================================================
// Express 中间件
// Requirements: 8.11
// =============================================================================

/**
 * 全局 API 速率限制中间件
 * 从 req 中获取 contestantId（由认证中间件设置），检查全局限制
 * 超限返回 HTTP 429 + API_RATE_LIMITED 错误
 */
export function rateLimitMiddleware(
  req: Request & { contestantId?: string; role?: Role },
  res: Response,
  next: NextFunction,
): void {
  const contestantId = req.contestantId;
  const role = req.role;

  // 若未认证（无 contestantId），跳过速率限制（由认证中间件处理）
  if (!contestantId) {
    next();
    return;
  }

  if (role === 'Admin') {
    next();
    return;
  }

  const limit = role === 'Agent_Viewer' ? 120 : rateLimiter.getGlobalLimit();

  const allowed = rateLimiter.checkGlobalLimitWithLimit(contestantId, limit);

  if (!allowed) {
    const body: ErrorResponse = {
      error: {
        code: 'API_RATE_LIMITED',
        message: `请求频率超过限制，请稍后再试（每分钟最多 ${limit} 次）`,
      },
    };
    res.status(429).json(body);
    return;
  }

  next();
}

/**
 * Human_Viewer 弹幕发送限流：每分钟最多 10 条
 */
export function barrageRateLimitMiddleware(
  req: Request & { contestantId?: string; role?: Role },
  res: Response,
  next: NextFunction,
): void {
  const contestantId = req.contestantId;

  if (!contestantId || req.role === 'Admin') {
    next();
    return;
  }

  const allowed = rateLimiter.checkBarrageLimit(contestantId, 10);
  if (!allowed) {
    const body: ErrorResponse = {
      error: {
        code: 'API_RATE_LIMITED',
        message: '弹幕发送过于频繁，请稍后再试（每分钟最多 10 条）',
      },
    };
    res.status(429).json(body);
    return;
  }

  next();
}
