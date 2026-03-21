/**
 * Pathfinding API routes
 * Provides pathfinding capabilities for agents
 */

import { Router, type Request, type Response } from 'express';
import { authMiddleware } from '../middleware/auth';

const router = Router();

/**
 * POST /api/pathfinding/move-to-target
 * 
 * 通过寻路系统移动 bot 到目标位置
 * 
 * Request body:
 * {
 *   botId: string,
 *   targetPos: { x: number, y: number },
 *   targetRoomId: string
 * }
 * 
 * Response:
 * {
 *   success: boolean,
 *   error?: string
 * }
 */
router.post('/move-to-target', authMiddleware, async (req: Request, res: Response) => {
  try {
    const { botId, targetPos, targetRoomId } = req.body as {
      botId?: string;
      targetPos?: { x: number; y: number };
      targetRoomId?: string;
    };

    // Validation
    if (!botId || !targetPos || !targetRoomId) {
      return res.status(400).json({
        success: false,
        error: 'Missing required fields: botId, targetPos, targetRoomId',
      });
    }

    if (typeof targetPos.x !== 'number' || typeof targetPos.y !== 'number') {
      return res.status(400).json({
        success: false,
        error: 'Invalid targetPos: must have numeric x and y',
      });
    }

    // Note: The actual pathfinding is done on the client side
    // This endpoint just validates the request and returns success
    // The client will execute the pathfinding and movement

    return res.json({
      success: true,
      message: 'Pathfinding request accepted. Client will execute movement.',
    });
  } catch (err) {
    console.error('[pathfinding] Error:', err);
    return res.status(500).json({
      success: false,
      error: 'Internal server error',
    });
  }
});

export default router;
