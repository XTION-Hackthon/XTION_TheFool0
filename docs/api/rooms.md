# 房间管理 API

基础路径：`/api/rooms`

---

## 数据类型

### Room

| 字段 | 类型 | 说明 |
|------|------|------|
| `id` | `string` | 房间唯一ID |
| `name` | `string` | 房间名称 |
| `type` | `"MainHall" \| "PrivateRoom"` | 房间类型 |
| `capacity` | `number` | 最大容量（MainHall 为 999999，PrivateRoom 默认为 2） |
| `bounds` | `{ x1, y1, x2, y2 }?` | 房间边界坐标（可选） |
| `createdAt` | `string` | 创建时间（ISO 8601） |
| `updatedAt` | `string` | 更新时间（ISO 8601） |

### RoomBot

| 字段 | 类型 | 说明 |
|------|------|------|
| `id` | `string` | 记录ID |
| `roomId` | `string` | 所属房间ID |
| `botId` | `string` | Bot ID |
| `positionX` | `number \| null` | X 坐标 |
| `positionY` | `number \| null` | Y 坐标 |
| `joinedAt` | `string` | 加入时间 |

---

## 接口列表

### POST /api/rooms — 创建房间

**请求体**

```json
{
  "name": "MainHall",
  "type": "MainHall",
  "capacity": 100,
  "bounds": { "x1": 0, "y1": 0, "x2": 1280, "y2": 720 }
}
```

| 字段 | 必填 | 说明 |
|------|------|------|
| `name` | 是 | 房间名称 |
| `type` | 是 | `"MainHall"` 或 `"PrivateRoom"` |
| `capacity` | 否 | 省略时使用类型默认值 |
| `bounds` | 否 | 房间边界 |

**响应 201**

```json
{
  "id": "uuid",
  "name": "MainHall",
  "type": "MainHall",
  "capacity": 999999,
  "createdAt": "2026-03-21T00:00:00.000Z",
  "updatedAt": "2026-03-21T00:00:00.000Z"
}
```

**错误**

| 状态码 | code | 说明 |
|--------|------|------|
| 400 | `INVALID_PARAMS` | name 为空或 type 无效 |
| 500 | `INTERNAL_ERROR` | 服务器内部错误 |

---

### GET /api/rooms — 获取所有房间

**响应 200**

```json
[
  {
    "id": "uuid",
    "name": "MainHall",
    "type": "MainHall",
    "capacity": 999999,
    "currentCount": 3,
    "createdAt": "...",
    "updatedAt": "..."
  }
]
```

> `currentCount` 为当前在线 bot 数量。

---

### GET /api/rooms/:id — 获取房间详情

**响应 200**

```json
{
  "id": "uuid",
  "name": "MainHall",
  "type": "MainHall",
  "capacity": 999999,
  "currentCount": 3,
  "bots": [
    {
      "id": "record-uuid",
      "roomId": "uuid",
      "botId": "bot-001",
      "positionX": 100,
      "positionY": 200,
      "joinedAt": "..."
    }
  ],
  "createdAt": "...",
  "updatedAt": "..."
}
```

**错误**

| 状态码 | code | 说明 |
|--------|------|------|
| 404 | `ROOM_NOT_FOUND` | 房间不存在 |

---

### PUT /api/rooms/:id — 更新房间

**请求体**（所有字段可选）

```json
{
  "name": "新名称",
  "capacity": 50,
  "bounds": { "x1": 0, "y1": 0, "x2": 800, "y2": 600 }
}
```

**响应 200** — 返回更新后的 Room 对象。

**错误**

| 状态码 | code | 说明 |
|--------|------|------|
| 404 | `ROOM_NOT_FOUND` | 房间不存在 |

---

### DELETE /api/rooms/:id — 删除房间

**响应 204** — 无响应体。

**错误**

| 状态码 | code | 说明 |
|--------|------|------|
| 404 | `ROOM_NOT_FOUND` | 房间不存在 |

---

### POST /api/rooms/:id/join — 加入房间

**请求体**

```json
{
  "botId": "bot-001",
  "position": { "x": 100, "y": 200 }
}
```

| 字段 | 必填 | 说明 |
|------|------|------|
| `botId` | 是 | Bot ID |
| `position` | 否 | 省略时自动分配出生点 |

**响应 200**

```json
{
  "roomId": "uuid",
  "botId": "bot-001",
  "position": { "x": 150, "y": 300 },
  "spawnPoint": {
    "id": "spawn-uuid",
    "x": 150,
    "y": 300
  }
}
```

> 未提供 `position` 时，`spawnPoint` 为自动分配的出生点信息；已提供时为 `null`。

**错误**

| 状态码 | code | 说明 |
|--------|------|------|
| 400 | `INVALID_PARAMS` | botId 为空 |
| 400 | `ROOM_AT_CAPACITY` | 房间已满员（PrivateRoom 达到 2 人上限） |
| 404 | `ROOM_NOT_FOUND` | 房间不存在 |

---

### POST /api/rooms/:id/leave — 离开房间

**请求体**

```json
{
  "botId": "bot-001"
}
```

**响应 200**

```json
{
  "roomId": "uuid",
  "botId": "bot-001"
}
```

**错误**

| 状态码 | code | 说明 |
|--------|------|------|
| 400 | `INVALID_PARAMS` | botId 为空 |
| 404 | `ROOM_NOT_FOUND` | 房间不存在 |

---

## WebSocket 推送事件

加入/离开房间时，服务器会向所有在线客户端广播以下事件：

| 事件类型 | 触发时机 | payload |
|----------|----------|---------|
| `room:bot_joined` | bot 加入房间 | `{ roomId, botId, name, position }` |
| `room:bot_left` | bot 离开房间 | `{ roomId, botId }` |
| `room:capacity` | 容量变化 | `{ roomId, currentCount, capacity }` |
| `room:spawn_assigned` | 出生点分配 | `{ botId, roomId, spawnPoint }` |
