# 碰撞检测 API

基础路径：`/api/collision`

---

## 算法说明

碰撞检测使用 **AABB（轴对齐包围盒）** 算法。每个 bot 的碰撞箱默认为 32×32 像素，以 bot 中心坐标为基准。

两个矩形重叠条件：
```
|ax - bx| < (aw/2 + bw/2)  AND  |ay - by| < (ah/2 + bh/2)
```

空间索引使用 **Grid-based** 方案，网格单元大小为 64px，移动验证时仅检查相邻网格内的 bot。

---

## 接口列表

### POST /api/collision/validate-move — 验证移动

在 bot 实际移动前调用，检查目标位置是否存在碰撞。

**请求体**

```json
{
  "roomId": "room-uuid",
  "botId": "bot-001",
  "targetPos": { "x": 200, "y": 300 }
}
```

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `roomId` | `string` | 是 | 目标房间ID |
| `botId` | `string` | 是 | 移动的 bot ID |
| `targetPos` | `{ x: number, y: number }` | 是 | 目标位置（bot 中心坐标） |

**响应 200 — 移动合法**

```json
{
  "valid": true
}
```

**响应 200 — 与 bot 碰撞**

```json
{
  "valid": false,
  "error": "Movement blocked: collision with another bot",
  "collisionType": "bot",
  "collidedWith": "bot-002"
}
```

**响应 200 — 与墙体碰撞**

```json
{
  "valid": false,
  "error": "Movement blocked: collision with wall",
  "collisionType": "wall",
  "collidedWith": "wall-uuid"
}
```

| 字段 | 类型 | 说明 |
|------|------|------|
| `valid` | `boolean` | 移动是否合法 |
| `error` | `string?` | 碰撞原因描述 |
| `collisionType` | `"bot" \| "wall"?` | 碰撞类型 |
| `collidedWith` | `string?` | 碰撞对象的 ID |

**错误**

| 状态码 | 说明 |
|--------|------|
| 400 | 缺少必填参数或参数类型错误 |
| 500 | 服务器内部错误 |

> 检测到碰撞时，服务器会通过 WebSocket 广播 `collision:event` 事件。

---

### GET /api/collision/nearby-bots — 查询附近 bot

查询指定位置半径范围内的所有 bot。

**查询参数**

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `roomId` | `string` | 是 | 房间ID |
| `x` | `number` | 是 | 查询中心 X 坐标 |
| `y` | `number` | 是 | 查询中心 Y 坐标 |
| `radius` | `number` | 否 | 查询半径（默认 100px） |

**示例请求**

```
GET /api/collision/nearby-bots?roomId=room-uuid&x=200&y=300&radius=150
```

**响应 200**

```json
{
  "botIds": ["bot-001", "bot-003"]
}
```

**错误**

| 状态码 | 说明 |
|--------|------|
| 400 | 缺少 roomId、x、y，或 radius 不是正数 |
| 500 | 服务器内部错误 |

---

## WebSocket 推送事件

| 事件类型 | 触发时机 | payload |
|----------|----------|---------|
| `collision:event` | 检测到碰撞 | `{ roomId, botId, collisionType, collidedWith, position }` |

---

## 客户端碰撞系统

前端提供 `CollisionSystem` 类（`client/src/game/collision-system.ts`），可在 Phaser 场景中直接使用，无需网络请求：

```typescript
import { collisionSystem } from '../game/collision-system';

// 构建空间索引
collisionSystem.buildIndex(bots);

// 验证移动
const result = collisionSystem.validateMove(targetPos, bots, walls, myBotId);
if (result.hasCollision) {
  console.log(`碰撞类型: ${result.type}, 碰撞对象: ${result.targetId}`);
}

// 查询附近 bot
const nearby = collisionSystem.getNearbyBots(myPos, 100, bots);
```
