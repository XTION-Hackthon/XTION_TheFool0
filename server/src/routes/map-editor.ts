// =============================================================================
// XTION_TheFool0 — Map Editor API 路由
// Requirements: 6, 7
// =============================================================================

import { Router, type Request, type Response } from 'express';
import { mapEditorManager } from '../modules/map-editor-manager';
import type { Wall, SpawnPoint } from '../types';

export const mapEditorRouter = Router();

// ---------------------------------------------------------------------------
// POST /api/map-editor/rooms/:id/config — 保存房间配置
// Body: { walls, spawnPoints, bounds?, capacity? }
// ---------------------------------------------------------------------------

mapEditorRouter.post('/rooms/:id/config', async (req: Request, res: Response): Promise<void> => {
  try {
    const roomId = req.params['id'] as string;
    const { walls, spawnPoints, bounds, capacity } = req.body as {
      walls?: Wall[];
      spawnPoints?: SpawnPoint[];
      bounds?: { x1: number; y1: number; x2: number; y2: number };
      capacity?: number;
    };

    if (!Array.isArray(walls) || !Array.isArray(spawnPoints)) {
      res.status(400).json({ error: { code: 'INVALID_PARAMS', message: 'walls 和 spawnPoints 必须为数组' } });
      return;
    }

    // Validate bounds if provided
    if (bounds !== undefined) {
      if (
        typeof bounds !== 'object' ||
        typeof bounds.x1 !== 'number' || typeof bounds.y1 !== 'number' ||
        typeof bounds.x2 !== 'number' || typeof bounds.y2 !== 'number' ||
        !Number.isFinite(bounds.x1) || !Number.isFinite(bounds.y1) ||
        !Number.isFinite(bounds.x2) || !Number.isFinite(bounds.y2)
      ) {
        res.status(400).json({ error: { code: 'INVALID_PARAMS', message: 'bounds 必须包含有限数字类型的 x1, y1, x2, y2' } });
        return;
      }
    }

    // Validate capacity if provided
    if (capacity !== undefined && (typeof capacity !== 'number' || capacity < 1 || !Number.isFinite(capacity))) {
      res.status(400).json({ error: { code: 'INVALID_PARAMS', message: 'capacity 必须为正整数' } });
      return;
    }

    const config = { roomId, walls, spawnPoints, bounds, capacity };

    const validation = mapEditorManager.validateConfiguration(config);
    if (!validation.valid) {
      res.status(400).json({ error: { code: 'VALIDATION_ERROR', message: '配置验证失败', errors: validation.errors } });
      return;
    }

    mapEditorManager.saveRoomConfiguration(roomId, config);

    // Return the new version number from history
    const history = mapEditorManager.getConfigurationHistory(roomId);
    const version = history.length > 0 ? history[0].version : 1;

    res.status(200).json({ success: true, version });
  } catch (err) {
    res.status(500).json({ error: { code: 'INTERNAL_ERROR', message: (err as Error).message } });
  }
});

// ---------------------------------------------------------------------------
// GET /api/map-editor/rooms/:id/config — 获取房间配置
// ---------------------------------------------------------------------------

mapEditorRouter.get('/rooms/:id/config', async (req: Request, res: Response): Promise<void> => {
  try {
    const roomId = req.params['id'] as string;
    const config = mapEditorManager.loadRoomConfiguration(roomId);
    res.status(200).json(config);
  } catch (err) {
    const msg = (err as Error).message;
    if (msg.includes('No configuration found')) {
      res.status(404).json({ error: { code: 'CONFIG_NOT_FOUND', message: msg } });
    } else {
      res.status(500).json({ error: { code: 'INTERNAL_ERROR', message: msg } });
    }
  }
});

// ---------------------------------------------------------------------------
// GET /api/map-editor/rooms/:id/config/history — 获取配置历史
// ---------------------------------------------------------------------------

mapEditorRouter.get('/rooms/:id/config/history', async (req: Request, res: Response): Promise<void> => {
  try {
    const roomId = req.params['id'] as string;
    const history = mapEditorManager.getConfigurationHistory(roomId);
    res.status(200).json(history);
  } catch (err) {
    res.status(500).json({ error: { code: 'INTERNAL_ERROR', message: (err as Error).message } });
  }
});

// ---------------------------------------------------------------------------
// POST /api/map-editor/rooms/:id/config/rollback — 回滚配置
// Body: { versionId }
// ---------------------------------------------------------------------------

mapEditorRouter.post('/rooms/:id/config/rollback', async (req: Request, res: Response): Promise<void> => {
  try {
    const roomId = req.params['id'] as string;
    const { versionId } = req.body as { versionId?: string };

    if (!versionId || typeof versionId !== 'string') {
      res.status(400).json({ error: { code: 'INVALID_PARAMS', message: 'versionId 不能为空' } });
      return;
    }

    mapEditorManager.rollbackConfiguration(roomId, versionId);
    res.status(200).json({ success: true });
  } catch (err) {
    const msg = (err as Error).message;
    if (msg.includes('not found')) {
      res.status(404).json({ error: { code: 'VERSION_NOT_FOUND', message: msg } });
    } else {
      res.status(500).json({ error: { code: 'INTERNAL_ERROR', message: msg } });
    }
  }
});
