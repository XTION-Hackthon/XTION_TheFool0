// =============================================================================
// XTION_TheFool0 — Express 应用配置
// Requirements: 8.1, 8.10
// =============================================================================

import express, { type Request, type Response, type NextFunction } from 'express';
import cors from 'cors';
import path from 'path';
import fs from 'fs';
import type { ErrorResponse } from './types/index';
import { adminKeysRouter } from './routes/admin-keys';
import { adminZonesRouter } from './routes/admin-zones';
import { adminMoveRouter } from './routes/admin-move';
import { talkRouter } from './routes/talk';
import { broadcastRouter } from './routes/broadcast';
import { heartbeatRouter } from './routes/heartbeat';
import { adminHeartbeatRouter } from './routes/admin-heartbeat';
import { adminSkillsRouter } from './routes/admin-skills';
import { skillsRouter } from './routes/skills';
import { docsRouter, adminDocsRouter } from './routes/docs';
import { eventsRouter } from './routes/events';
import { interactionRouter } from './routes/interaction';
import { statusRouter } from './routes/status';
import { adminMonitorRouter } from './routes/admin-monitor';
import { authRouter } from './routes/auth';
import { collisionRouter } from './routes/collision';
import { locationRouter } from './routes/location';
import { invitationRouter } from './routes/invitation';
import { leaveRoomRouter } from './routes/leave-room';
import { adminLocationRouter } from './routes/admin-location';
import { adminPhaseRouter, currentPhaseRouter } from './routes/admin-phase';
import { messagesRouter } from './routes/messages';
import { productRouter } from './routes/product';
import { hackathonRouter, adminHackathonRouter } from './routes/hackathon';
import { authMiddleware, requireRole } from './middleware/auth';

export const app = express();

// ---------------------------------------------------------------------------
// Middleware
// ---------------------------------------------------------------------------

app.use(cors());
app.use(express.json());

// ---------------------------------------------------------------------------
// Verbose request logger — logs every API request with identity info
// ---------------------------------------------------------------------------

app.use((req: Request, _res: Response, next: NextFunction) => {
  const authHeader = req.headers['authorization'] ?? req.headers['x-api-key'] ?? '';
  const keyHint = typeof authHeader === 'string' && authHeader.length > 8
    ? `${authHeader.slice(0, 8)}…`
    : (authHeader || '(none)');
  const bodyKeys = req.body && typeof req.body === 'object' ? Object.keys(req.body as object).join(',') : '';
  console.log(`[HTTP] ${req.method} ${req.path} | key=${keyHint} | body={${bodyKeys}}`);
  next();
});

// ---------------------------------------------------------------------------
// Static map assets — serve client/public/maps directly
// This ensures /maps/*.png works regardless of how Vite is started
// ---------------------------------------------------------------------------
const mapsDir = path.join(__dirname, '../../client/public/maps');
app.use('/maps', express.static(mapsDir));

// ---------------------------------------------------------------------------
// Skill Files — Direct HTTP endpoints for Markdown files
// Allows agents to fetch skill docs directly: GET /skill.md, /heartbeat.md, etc.
// ---------------------------------------------------------------------------

const skillsDir = path.join(__dirname, '../../skills');

app.get('/:filename.md', (req: Request, res: Response, next: NextFunction) => {
  const filename = req.params['filename'] as string;
  const allowedFiles = ['skill', 'heartbeat', 'messaging', 'rules', 'behavior-loop', 'openclaw-quickstart', 'product-collab', 'hackathon-script', 'act1-intro', 'act2-team', 'act3-product'];
  
  if (!allowedFiles.includes(filename)) {
    return next();
  }

  const filepath = path.join(skillsDir, `${filename}.md`);
  
  // Security: prevent directory traversal
  if (!filepath.startsWith(skillsDir)) {
    return res.status(403).json({ error: { code: 'FORBIDDEN', message: 'Access denied' } });
  }

  fs.readFile(filepath, 'utf-8', (err, data) => {
    if (err) {
      return res.status(404).json({ error: { code: 'FILE_NOT_FOUND', message: `Skill file not found: ${filename}.md` } });
    }
    res.type('text/markdown; charset=utf-8').send(data);
  });
});

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

app.use('/api/admin/keys', authMiddleware, requireRole('Admin'), adminKeysRouter);
app.use('/api/admin', authMiddleware, requireRole('Admin'), adminZonesRouter);
app.use('/api/admin', authMiddleware, requireRole('Admin'), adminMoveRouter);
app.use('/api/talk', authMiddleware, talkRouter);
app.use('/api/broadcast', authMiddleware, broadcastRouter);
app.use('/api/move', (_req: Request, res: Response) => {
  res.status(410).json({ error: { code: 'GONE', message: 'POST /api/move 已废弃。请使用新的邀请接口：POST /api/invitation' } });
});
app.use('/api/heartbeat', authMiddleware, heartbeatRouter);
app.use('/api/admin', authMiddleware, requireRole('Admin'), adminHeartbeatRouter);
app.use('/api/admin/skills', authMiddleware, requireRole('Admin'), adminSkillsRouter);
app.use('/api/skills', authMiddleware, skillsRouter);
app.use('/api/docs', authMiddleware, docsRouter);
app.use('/api/admin/docs', authMiddleware, requireRole('Admin'), adminDocsRouter);
app.use('/api', authMiddleware, eventsRouter);
app.use('/api', interactionRouter);
app.use('/api', authMiddleware, statusRouter);
app.use('/api/admin', authMiddleware, requireRole('Admin'), adminMonitorRouter);
app.use('/api/auth', authRouter);
app.use('/api/collision', authMiddleware, collisionRouter);
app.use('/api/location', authMiddleware, locationRouter);
app.use('/api/invitation', authMiddleware, invitationRouter);
app.use('/api/leave-room', authMiddleware, leaveRoomRouter);
app.use('/api/admin', authMiddleware, requireRole('Admin'), adminLocationRouter);
app.use('/api/admin', authMiddleware, requireRole('Admin'), adminPhaseRouter);
app.use('/api', authMiddleware, currentPhaseRouter);
app.use('/api/admin', authMiddleware, requireRole('Admin'), messagesRouter);
app.use('/api/product', authMiddleware, productRouter);
app.use('/api/hackathon', authMiddleware, hackathonRouter);
app.use('/api/admin', authMiddleware, requireRole('Admin'), adminHackathonRouter);

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
