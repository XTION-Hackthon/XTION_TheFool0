# 碰撞检测使用指南

## 概述

碰撞检测系统使用 **AABB（轴对齐包围盒）** 算法，结合 **Grid-based 空间索引**（网格单元 128px）加速查询。每个 bot 的碰撞箱默认为 32×32 像素，以 bot 中心坐标为基准。

系统分为两层：
- **后端**：`CollisionManager` 负责权威验证，移动前调用 `POST /api/collision/validate-move`
- **前端**：`CollisionSystem` 类提供本地预测检测，减少不必要的网络请求

---

## 后端：移动验证

在 bot 实际移动前，调用验证接口：

```typescript
const res = await fetch('/api/collision/validate-move', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
  body: JSON.stringify({
    roomId: 'room-uuid',
    botId: 'bot-001',
    targetPos: { x: 200, y: 300 },
  }),
});

const result = await res.json();

if (!result.valid) {
  if (result.collisionType === 'bot') {
    console.log(`与 bot ${result.collidedWith} 碰撞，无法移动`);
  } else if (result.collisionType === 'wall') {
    console.log(`与墙体 ${result.collidedWith} 碰撞，请绕行`);
  }
} else {
  // 移动合法，更新位置
}
```

验证成功时，服务器会同时更新空间索引。检测到碰撞时，服务器通过 WebSocket 广播 `collision:event` 事件。

---

## 后端：查询附近 bot

```typescript
const res = await fetch(
  `/api/collision/nearby-bots?roomId=room-uuid&x=200&y=300&radius=150`,
  { headers: { Authorization: `Bearer ${token}` } }
);
const { botIds } = await res.json(); // ["bot-001", "bot-003"]
```

`radius` 默认为 100px，单位为像素。

---

## 前端：本地碰撞检测

`CollisionSystem`（`client/src/game/collision-system.ts`）提供客户端预测检测，适合在 Phaser 场景中使用：

```typescript
import { collisionSystem } from '../game/collision-system';

// 1. 构建空间索引（在 bot 列表变化时调用）
collisionSystem.buildIndex(bots);

// 2. 验证移动（bot-bot + bot-wall 综合检测）
const result = collisionSystem.validateMove(
  { x: 200, y: 300 },  // 目标位置
  bots,                 // 当前房间所有 bot
  walls,                // 当前房间所有墙体
  'bot-001'             // 排除自身
);

if (result.hasCollision) {
  console.log(`碰撞类型: ${result.type}`);         // 'bot' | 'wall'
  console.log(`碰撞对象 ID: ${result.targetId}`);
  console.log(`碰撞位置: `, result.targetPosition);
}

// 3. 单独检测 bot 碰撞
const botResult = collisionSystem.checkBotCollision({ x: 200, y: 300 }, bots, 'bot-001');

// 4. 单独检测墙体碰撞
const wallResult = collisionSystem.checkWallCollision({ x: 200, y: 300 }, walls);

// 5. 查询附近 bot
const nearby = collisionSystem.getNearbyBots({ x: 200, y: 300 }, 100, bots);
```

---

## 监听碰撞事件（WebSocket）

```typescript
ws.on('collision:event', ({ roomId, botId, collisionType, collidedWith, position }) => {
  console.log(`[${roomId}] ${botId} 与 ${collisionType} ${collidedWith} 碰撞于`, position);
  // 可在此触发动画、音效或路径重规划
});
```

---

## 碰撞响应建议

收到碰撞错误后，bot 可尝试替代移动方向：

```typescript
async function tryMove(botId: string, roomId: string, target: { x: number; y: number }) {
  const res = await fetch('/api/collision/validate-move', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ roomId, botId, targetPos: target }),
  });
  const result = await res.json();

  if (!result.valid) {
    // 尝试水平或垂直方向的替代位置
    const alternatives = [
      { x: target.x + 40, y: target.y },
      { x: target.x - 40, y: target.y },
      { x: target.x, y: target.y + 40 },
      { x: target.x, y: target.y - 40 },
    ];
    for (const alt of alternatives) {
      const altRes = await fetch('/api/collision/validate-move', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ roomId, botId, targetPos: alt }),
      });
      const altResult = await altRes.json();
      if (altResult.valid) {
        return alt; // 使用替代位置
      }
    }
    return null; // 所有方向均被阻挡
  }

  return target;
}
```

---

## 性能说明

| 指标 | 目标值 |
|------|--------|
| 碰撞检测延迟（100 个 bot） | < 10ms |
| 出生点分配延迟 | < 5ms |
| 空间索引更新（1000 个 bot） | < 20ms |

- 空间索引网格单元为 128px，移动验证时仅检查相邻网格内的 bot
- 后端对验证结果缓存 100ms，同一位置的重复查询直接命中缓存
- 前端 `CollisionSystem` 完全在内存中运行，无网络开销，适合高频预测

---

## 注意事项

- 碰撞检测仅在**同一房间**内的 bot 之间进行，不同房间的 bot 互不影响
- 墙体坐标 `x`、`y` 为左上角，碰撞检测时内部自动转换为中心坐标
- bot 离开房间时，其碰撞箱自动从空间索引中移除
