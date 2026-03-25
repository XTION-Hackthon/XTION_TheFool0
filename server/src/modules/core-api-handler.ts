// =============================================================================
// XTION_TheFool0 — CoreAPIHandler 模块
// Requirements: 3.1, 3.2, 3.3, 3.4, 3.5, 3.6, 3.7, 3.8
// =============================================================================

import { v4 as uuidv4 } from 'uuid';
import { db } from '../db';
import { worldManager } from './world-manager';
import { rateLimiter } from './rate-limiter';
import { connections, sendEvent, broadcast } from '../ws';
import type {
  ICoreAPIHandler,
  TalkParams,
  TalkResult,
  BroadcastParams,
  BroadcastResult,
  MoveParams,
  MoveResult,
  Position,
  ServerEvent,
} from '../types';

// =============================================================================
// Error classes
// =============================================================================

export class APIError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly statusCode: number = 400,
  ) {
    super(message);
    this.name = 'APIError';
  }
}

// =============================================================================
// CoreAPIHandler Implementation
// =============================================================================

class CoreAPIHandler implements ICoreAPIHandler {
  // ---------------------------------------------------------------------------
  // Talk
  // ---------------------------------------------------------------------------

  /**
   * 处理 Talk 请求
   * Requirements: 3.1, 3.2, 3.3, 3.4, 3.5, 3.6, 3.7, 3.8
   */
  async handleTalk(params: TalkParams): Promise<TalkResult> {
    const { senderId, targetIds, message } = params;

    // 1. 检查 Zone_Rule 是否允许 Talk API
    if (!worldManager.isAPIAllowed(senderId, 'talk')) {
      throw new APIError('API_ZONE_RESTRICTED', '当前区域不允许使用 Talk API', 403);
    }

    // 2. 检查 Energy（为 0 时禁止 Talk）
    // Requirements: 11.7
    const energy = worldManager.getEnergy(senderId);
    if (energy <= 0) {
      throw new APIError('API_ENERGY_DEPLETED', '精力耗尽，无法发送消息（请移动到休息区恢复精力）', 403);
    }

    // 2. 获取发送者所在 Zone
    const senderZone = worldManager.getZoneAt(await worldManager.getPosition(senderId));
    if (!senderZone) {
      throw new APIError('API_ZONE_RESTRICTED', '发送者不在任何 Zone 内', 403);
    }

    // 3. 验证所有接收者在同一 Zone
    // Requirements: 3.1, 3.4, 3.5
    for (const targetId of targetIds) {
      const targetPos = await worldManager.getPosition(targetId).catch(() => null);
      if (!targetPos) {
        throw new APIError('API_ZONE_RESTRICTED', `目标 Contestant 不存在或未在线: ${targetId}`, 403);
      }
      const targetZone = worldManager.getZoneAt(targetPos);
      if (!targetZone || targetZone.id !== senderZone.id) {
        throw new APIError('API_ZONE_RESTRICTED', '目标不在同一区域，无法发送消息', 403);
      }
    }

    // 4. 检查 Zone_Rule 中的 Talk 频率限制
    // Requirements: 3.6, 3.7, 3.8
    const rule = worldManager.getApplicableRules(senderId);
    const talkRateLimit = rule.rateLimits['talk'];
    if (talkRateLimit !== undefined && talkRateLimit > 0) {
      const allowed = rateLimiter.checkTalkLimit(senderId, talkRateLimit);
      if (!allowed) {
        throw new APIError('API_RATE_LIMITED', `Talk 频率超过限制（当前区域每分钟最多 ${talkRateLimit} 次）`, 429);
      }
    }
    // Social 区 rateLimits 为空对象，无限制

    // 5. 持久化消息
    // Requirements: 3.3
    const messageId = uuidv4();
    const timestamp = Date.now();

    db.prepare(`
      INSERT INTO talk_messages (id, sender_id, receiver_ids, content, zone_id, timestamp)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(messageId, senderId, JSON.stringify(targetIds), message, senderZone.id, timestamp);

    // 6. 通过 WebSocket 推送 talk.message 事件给接收者
    // Requirements: 3.2
    const event: ServerEvent = {
      type: 'talk.message',
      payload: {
        messageId,
        senderId,
        message,
        zoneId: senderZone.id,
        timestamp,
      },
      timestamp,
    };

    for (const targetId of targetIds) {
      const ws = connections.get(targetId);
      if (ws) {
        sendEvent(ws, event);
      }
    }

    // Work 区 Talk 扣减 Energy
    // Requirements: 11.5
    const talkRule = worldManager.getApplicableRules(senderId);
    const talkWorkEffect = talkRule.attributeEffects.find(
      (e) => e.attribute === 'energy' && e.type === 'consume' && e.trigger === 'on_api_call',
    );
    if (talkWorkEffect) {
      const newEnergy = await worldManager.modifyEnergy(senderId, -talkWorkEffect.rate);
      const senderWs = connections.get(senderId);
      if (senderWs) {
        sendEvent(senderWs, {
          type: 'energy.update',
          payload: {
            contestantId: senderId,
            energy: newEnergy,
            delta: -talkWorkEffect.rate,
            reason: 'talk_in_work_zone',
          },
          timestamp,
        });
      }
    }

    return { messageId, timestamp };
  }

  // ---------------------------------------------------------------------------
  // Broadcast
  // Requirements: 4.1, 4.2, 4.4, 4.5
  // ---------------------------------------------------------------------------

  /**
   * 处理 Broadcast 请求：向 World 中所有在线 Contestant 投递消息
   * Requirements: 4.1, 4.2, 4.4, 4.5
   */
  async handleBroadcast(params: BroadcastParams): Promise<BroadcastResult> {
    const { senderId, message } = params;

    // 1. 检查 Zone_Rule 是否允许 Broadcast API
    if (!worldManager.isAPIAllowed(senderId, 'broadcast')) {
      throw new APIError('API_ZONE_RESTRICTED', '当前区域不允许使用 Broadcast API', 403);
    }

    // 2. 检查 Energy（为 0 时禁止 Broadcast）
    // Requirements: 11.7
    const energy = worldManager.getEnergy(senderId);
    if (energy <= 0) {
      throw new APIError('API_ENERGY_DEPLETED', '精力耗尽，无法发送消息（请移动到休息区恢复精力）', 403);
    }

    // 3. 应用 Broadcast 频率限制
    // Requirements: 4.5
    const allowed = rateLimiter.checkBroadcastLimit(senderId);
    if (!allowed) {
      throw new APIError(
        'API_BROADCAST_LIMITED',
        'Broadcast 频率超过限制，请稍后再试',
        429,
      );
    }

    // 4. 持久化消息到 broadcast_messages 表
    // Requirements: 4.4
    const messageId = uuidv4();
    const timestamp = Date.now();

    db.prepare(`
      INSERT INTO broadcast_messages (id, sender_id, content, timestamp)
      VALUES (?, ?, ?, ?)
    `).run(messageId, senderId, message, timestamp);

    // 5. 推送 broadcast.message 事件给所有在线 Contestant
    // Requirements: 4.1, 4.2
    const event: ServerEvent = {
      type: 'broadcast.message',
      payload: {
        messageId,
        senderId,
        message,
        timestamp,
      },
      timestamp,
    };

    let recipientCount = 0;
    for (const [recipientId, ws] of connections) {
      // isSelf: true when the recipient is the sender — helps Agent avoid self-reply loops
      sendEvent(ws, {
        ...event,
        payload: { ...event.payload as object, isSelf: recipientId === senderId },
      });
      recipientCount++;
    }

    // Work 区 Broadcast 扣减 Energy
    // Requirements: 11.5
    const bcRule = worldManager.getApplicableRules(senderId);
    const bcWorkEffect = bcRule.attributeEffects.find(
      (e) => e.attribute === 'energy' && e.type === 'consume' && e.trigger === 'on_api_call',
    );
    if (bcWorkEffect) {
      const newEnergy = await worldManager.modifyEnergy(senderId, -bcWorkEffect.rate);
      const senderWs = connections.get(senderId);
      if (senderWs) {
        sendEvent(senderWs, {
          type: 'energy.update',
          payload: {
            contestantId: senderId,
            energy: newEnergy,
            delta: -bcWorkEffect.rate,
            reason: 'broadcast_in_work_zone',
          },
          timestamp,
        });
      }
    }

    return { messageId, recipientCount, timestamp };
  }

  // ---------------------------------------------------------------------------
  // Move
  // Requirements: 5.1, 5.2, 5.4, 5.5, 5.7, 11.5
  // ---------------------------------------------------------------------------

  /**
   * 处理 Move 请求
   * - 支持目标 Position {x, y} 或 Zone ID {zoneId}（移动到 Zone 中心）
   * - 边界检查：超出 Map 范围返回 400
   * - Zone 进入限制检查：accessRestriction 验证
   * - 更新 Position，检测 Zone 切换
   * - Zone 切换时推送 zone.rule.update 给本人
   * - 通知原 Zone 和目标 Zone 中的 Contestant contestant.move 事件
   * - 若新 Zone 为 Work 区，扣减 Energy 并推送 energy.update
   */
  async handleMove(params: MoveParams): Promise<MoveResult> {
    const { contestantId, target } = params;

    // 1. 解析目标坐标
    let targetPosition: Position;

    if ('zoneId' in target) {
      // 目标为 Zone ID → 移动到 Zone 中心
      const targetZone = worldManager.getZoneById(target.zoneId);
      if (!targetZone) {
        throw new APIError('WORLD_ZONE_NOT_FOUND', `Zone 不存在: ${target.zoneId}`, 404);
      }
      targetPosition = worldManager.getZoneCenter(targetZone);
    } else {
      targetPosition = target;
    }

    // 2. 边界检查
    // Requirements: 5.4
    const { width, height } = worldManager.getMapDimensions();
    if (
      targetPosition.x < 0 ||
      targetPosition.x >= width ||
      targetPosition.y < 0 ||
      targetPosition.y >= height
    ) {
      throw new APIError('API_MOVE_OUT_OF_BOUNDS', '目标位置超出地图范围', 400);
    }

    // 3. 获取旧 Zone
    const oldPosition = await worldManager.getPosition(contestantId);
    const oldZone = worldManager.getZoneAt(oldPosition);

    // 4. 计算目标 Zone
    const newZone = worldManager.getZoneAt(targetPosition);

    // 5. Zone 进入限制检查
    // Requirements: 5.5
    if (newZone?.accessRestriction && newZone.accessRestriction.length > 0) {
      if (!newZone.accessRestriction.includes(contestantId)) {
        throw new APIError('API_ZONE_RESTRICTED', '无权进入该区域', 403);
      }
    }

    // 6. 更新 Position
    // Requirements: 5.1, 5.2
    await worldManager.setPosition(contestantId, targetPosition);

    const timestamp = Date.now();
    const newZoneId = newZone?.id ?? null;

    // 7. 检测 Zone 切换
    const zoneChanged = oldZone?.id !== newZoneId;

    // 8. 通知原 Zone 和目标 Zone 中的 Contestant contestant.move 事件
    // Requirements: 5.2
    const moveEvent: ServerEvent = {
      type: 'contestant.move',
      payload: {
        contestantId,
        oldPosition,
        newPosition: targetPosition,
        oldZoneId: oldZone?.id ?? null,
        newZoneId,
        timestamp,
      },
      timestamp,
    };

    const notifiedIds = new Set<string>();

    // Notify contestants in old zone
    if (oldZone) {
      for (const id of worldManager.getContestantsInZone(oldZone.id)) {
        if (!notifiedIds.has(id)) {
          const ws = connections.get(id);
          if (ws) sendEvent(ws, moveEvent);
          notifiedIds.add(id);
        }
      }
    }

    // Notify contestants in new zone (including the mover themselves)
    if (newZone) {
      for (const id of worldManager.getContestantsInZone(newZone.id)) {
        if (!notifiedIds.has(id)) {
          const ws = connections.get(id);
          if (ws) sendEvent(ws, moveEvent);
          notifiedIds.add(id);
        }
      }
    }

    // Also notify the mover if not already notified
    if (!notifiedIds.has(contestantId)) {
      const ws = connections.get(contestantId);
      if (ws) sendEvent(ws, moveEvent);
      notifiedIds.add(contestantId);
    }

    // Broadcast to all other connections not yet notified (Admin, viewers, etc.)
    for (const [id, ws] of connections) {
      if (!notifiedIds.has(id)) {
        sendEvent(ws, moveEvent);
      }
    }

    // 9. Zone 切换时推送 zone.rule.update 给本人
    // Requirements: 5.7
    if (zoneChanged && newZone) {
      const newRule = worldManager.getApplicableRules(contestantId);
      const ws = connections.get(contestantId);
      if (ws) {
        sendEvent(ws, {
          type: 'zone.rule.update',
          payload: {
            zoneId: newZone.id,
            zoneName: newZone.name,
            zoneTypeId: newZone.zoneTypeId,
            rule: newRule,
          },
          timestamp,
        });
      }
    }

    // 10. Work 区 API 调用后扣减 Energy，推送 energy.update
    // Requirements: 11.5
    if (newZone) {
      const newRule = worldManager.getApplicableRules(contestantId);
      const workEffect = newRule.attributeEffects.find(
        (e) => e.attribute === 'energy' && e.type === 'consume' && e.trigger === 'on_api_call',
      );
      if (workEffect) {
        const newEnergy = await worldManager.modifyEnergy(contestantId, -workEffect.rate);
        const ws = connections.get(contestantId);
        if (ws) {
          sendEvent(ws, {
            type: 'energy.update',
            payload: {
              contestantId,
              energy: newEnergy,
              delta: -workEffect.rate,
              reason: 'move_in_work_zone',
            },
            timestamp,
          });
        }
      }
    }

    return { newPosition: targetPosition, newZoneId, timestamp };
  }
}

// =============================================================================
// Singleton Export
// =============================================================================

export const coreAPIHandler = new CoreAPIHandler();
