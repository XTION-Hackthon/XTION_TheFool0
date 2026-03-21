// =============================================================================
// XTION_TheFool0 — Admin map config routes
// =============================================================================

import { Router, type Request, type Response, type NextFunction } from 'express';
import { adminMapConfigStore } from '../modules/admin-map-config';

export const adminMapRouter = Router();

function httpError(statusCode: number, code: string, message: string) {
  const err = new Error(message) as Error & { statusCode: number; code: string };
  err.statusCode = statusCode;
  err.code = code;
  return err;
}

adminMapRouter.get('/map', (_req: Request, res: Response, next: NextFunction) => {
  try {
    res.json(adminMapConfigStore.getConfig());
  } catch (err) {
    next(err);
  }
});

adminMapRouter.put('/map', (req: Request, res: Response, next: NextFunction) => {
  try {
    const payload = req.body as { backgroundImage?: unknown };
    if (!Object.prototype.hasOwnProperty.call(payload, 'backgroundImage')) {
      return next(httpError(400, 'INVALID_PARAM', '参数 backgroundImage 不能为空'));
    }

    const raw = payload.backgroundImage;
    if (raw !== null && typeof raw !== 'string') {
      return next(httpError(400, 'INVALID_PARAM', '参数 backgroundImage 必须是 string 或 null'));
    }

    const normalized = typeof raw === 'string' ? raw.trim() : raw;
    const backgroundImage = normalized === '' ? null : normalized;
    res.json(adminMapConfigStore.updateBackgroundImage(backgroundImage));
  } catch (err) {
    next(err);
  }
});
