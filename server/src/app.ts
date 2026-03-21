// =============================================================================
// XTION_TheFool0 — Express 应用配置
// Requirements: 8.1, 8.10
// =============================================================================

import express, { type Request, type Response, type NextFunction } from 'express';
import cors from 'cors';
import type { ErrorResponse } from './types/index';
import { adminKeysRouter } from './routes/admin-keys';
import { adminZonesRouter } from './routes/admin-zones';
import { adminMoveRouter } from './routes/admin-move';
import { talkRouter } from './routes/talk';
import { broadcastRouter } from './routes/broadcast';
import { moveRouter } from './routes/move';
import { heartbeatRouter } from './routes/heartbeat';
import { adminHeartbeatRouter } from './routes/admin-heartbeat';
import { adminSkillsRouter } from './routes/admin-skills';
import { adminMapRouter } from './routes/admin-map';
import { skillsRouter } from './routes/skills';
import { docsRouter, adminDocsRouter } from './routes/docs';
import { eventsRouter } from './routes/events';
import { interactionRouter } from './routes/interaction';
import { statusRouter } from './routes/status';
import { adminMonitorRouter } from './routes/admin-monitor';
import { authRouter } from './routes/auth';
import { authMiddleware, requireRole } from './middleware/auth';
import { rateLimitMiddleware } from './modules/rate-limiter';

export const app = express();

// ---------------------------------------------------------------------------
// Middleware
// ---------------------------------------------------------------------------

app.use(cors());
app.use(express.json());

// ---------------------------------------------------------------------------
// API Docs endpoint — OpenAPI summary
// Requirements: 8.12
// ---------------------------------------------------------------------------

app.get('/api/docs', (_req: Request, res: Response) => {
  res.json({
    openapi: '3.0.0',
    info: { title: 'XTION_TheFool0 OpenClaw API', version: '1.0.0' },
    paths: {
      '/api/talk': { post: { summary: '向同 Zone 内的 Contestant 发送消息', tags: ['Agent'] } },
      '/api/broadcast': { post: { summary: '向所有在线 Contestant 广播消息', tags: ['Agent'] } },
      '/api/move': { post: { summary: '移动到指定坐标或 Zone', tags: ['Agent'] } },
      '/api/heartbeat': { post: { summary: '发送心跳', tags: ['Agent'] } },
      '/api/skills': { get: { summary: '获取可用 Skill 列表', tags: ['Agent'] } },
      '/api/skills/{id}/install': { get: { summary: '安装 Skill', tags: ['Agent'] } },
      '/api/status/me': { get: { summary: '查询自身状态', tags: ['Agent'] } },
      '/api/status/{id}': { get: { summary: '查询其他 Contestant 公开状态', tags: ['Agent'] } },
      '/api/contestants': { get: { summary: '获取在线 Contestant 列表', tags: ['Agent'] } },
      '/api/zones': { get: { summary: '获取所有 Zone 信息', tags: ['Agent'] } },
      '/api/zones/{id}': { get: { summary: '获取 Zone 详情', tags: ['Agent'] } },
      '/api/world': { get: { summary: '获取 World 概览', tags: ['Agent'] } },
      '/api/messages': { get: { summary: '获取消息历史', tags: ['Agent'] } },
      '/api/events': { get: { summary: '查询事件历史', tags: ['Agent'] } },
      '/api/barrage': { post: { summary: '发送弹幕', tags: ['Audience'] } },
      '/api/contestants/{id}/vote': { post: { summary: '点赞/踩', tags: ['Audience'] } },
      '/api/audience-feedback': { get: { summary: '观众互动数据汇总', tags: ['Audience'] } },
      '/api/admin/keys': { post: { summary: '生成 Key', tags: ['Admin'] }, get: { summary: '获取 Key 列表', tags: ['Admin'] } },
      '/api/admin/map': { get: { summary: '获取地图配置', tags: ['Admin'] }, put: { summary: '更新地图配置', tags: ['Admin'] } },
      '/api/admin/skills': { get: { summary: '获取 Skill 文档列表', tags: ['Admin'] }, post: { summary: '上传 Skill 文档', tags: ['Admin'] } },
      '/api/admin/monitor': { get: { summary: '平台运行状态概览', tags: ['Admin'] } },
    },
  });
});



app.get('/health', (_req: Request, res: Response) => {
  res.json({ status: 'ok', timestamp: Date.now() });
});

// ---------------------------------------------------------------------------
// Routes
// ---------------------------------------------------------------------------

app.use('/api/admin/keys', authMiddleware, rateLimitMiddleware, requireRole('Admin'), adminKeysRouter);
app.use('/api/admin', authMiddleware, rateLimitMiddleware, requireRole('Admin'), adminZonesRouter);
app.use('/api/admin', authMiddleware, rateLimitMiddleware, requireRole('Admin'), adminMoveRouter);
app.use('/api/talk', authMiddleware, rateLimitMiddleware, requireRole('Admin', 'Agent_Player'), talkRouter);
app.use('/api/broadcast', authMiddleware, rateLimitMiddleware, requireRole('Admin', 'Agent_Player'), broadcastRouter);
app.use('/api/move', authMiddleware, rateLimitMiddleware, moveRouter);
app.use('/api/heartbeat', authMiddleware, rateLimitMiddleware, heartbeatRouter);
app.use('/api/admin', authMiddleware, rateLimitMiddleware, requireRole('Admin'), adminHeartbeatRouter);
app.use('/api/admin/skills', authMiddleware, rateLimitMiddleware, requireRole('Admin'), adminSkillsRouter);
app.use('/api/admin', authMiddleware, rateLimitMiddleware, requireRole('Admin'), adminMapRouter);
app.use('/api/skills', authMiddleware, rateLimitMiddleware, skillsRouter);
app.use('/api/docs', authMiddleware, rateLimitMiddleware, docsRouter);
app.use('/api/admin/docs', authMiddleware, rateLimitMiddleware, requireRole('Admin'), adminDocsRouter);
app.use('/api/events', authMiddleware, rateLimitMiddleware, eventsRouter);
app.use('/api', interactionRouter);
app.use('/api', authMiddleware, rateLimitMiddleware, statusRouter);
app.use('/api/admin', authMiddleware, rateLimitMiddleware, requireRole('Admin'), adminMonitorRouter);
app.use('/api/auth', authRouter);

// ---------------------------------------------------------------------------
// Unified error handler — { "error": { "code": "...", "message": "..." } }
// Requirements: 8.10
// ---------------------------------------------------------------------------

// eslint-disable-next-line @typescript-eslint/no-unused-vars
export function errorHandler(
  err: Error & { statusCode?: number; code?: string },
  _req: Request,
  res: Response,
  _next: NextFunction,
): void {
  const statusCode = err.statusCode ?? 500;
  const code = err.code ?? 'SYS_INTERNAL_ERROR';
  const message = err.message || '内部服务器错误';

  const body: ErrorResponse = {
    error: { code, message },
  };

  res.status(statusCode).json(body);
}

app.use(errorHandler);
