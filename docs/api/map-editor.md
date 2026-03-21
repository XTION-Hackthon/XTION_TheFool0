# 地图编辑 API

基础路径：`/api/map-editor`

---

## 数据类型

### Wall

| 字段 | 类型 | 说明 |
|------|------|------|
| `id` | `string` | 墙体唯一ID |
| `roomId` | `string` | 所属房间ID |
| `x` | `number` | 左上角 X 坐标 |
| `y` | `number` | 左上角 Y 坐标 |
| `width` | `number` | 宽度（必须 > 0） |
| `height` | `number` | 高度（必须 > 0） |
| `rotation` | `number` | 旋转角度（度，默认 0） |
| `createdAt` | `string` | 创建时间 |

### SpawnPoint

| 字段 | 类型 | 说明 |
|------|------|------|
| `id` | `string` | 出生点唯一ID |
| `roomId` | `string` | 所属房间ID |
| `x` | `number` | X 坐标 |
| `y` | `number` | Y 坐标 |
| `isAvailable` | `boolean` | 是否可用 |
| `createdAt` | `string` | 创建时间 |

### RoomConfiguration

| 字段 | 类型 | 说明 |
|------|------|------|
| `roomId` | `string` | 房间ID |
| `walls` | `Wall[]` | 墙体列表 |
| `spawnPoints` | `SpawnPoint[]` | 出生点列表 |
| `bounds` | `{ x1, y1, x2, y2 }?` | 房间边界（可选） |
| `capacity` | `number?` | 房间容量（可选） |

---

## 接口列表

### POST /api/map-editor/rooms/:id/config — 保存房间配置

保存配置时自动递增版本号，并替换该房间的所有墙体和出生点。

**请求体**

```json
{
  "walls": [
    {
      "id": "wall-001",
      "roomId": "room-uuid",
      "x": 100,
      "y": 50,
      "width": 200,
      "height": 20,
      "rotation": 0,
      "createdAt": "2026-03-21T00:00:00.000Z"
    }
  ],
  "spawnPoints": [
    {
      "id": "spawn-001",
      "roomId": "room-uuid",
      "x": 300,
      "y": 400,
      "isAvailable": true,
      "createdAt": "2026-03-21T00:00:00.000Z"
    }
  ],
  "bounds": { "x1": 0, "y1": 0, "x2": 1280, "y2": 720 },
  "capacity": 2
}
```

| 字段 | 必填 | 说明 |
|------|------|------|
| `walls` | 是 | 墙体数组（可为空数组） |
| `spawnPoints` | 是 | 出生点数组（可为空数组） |
| `bounds` | 否 | 更新房间边界 |
| `capacity` | 否 | 更新房间容量 |

**响应 200**

```json
{
  "success": true,
  "version": 3
}
```

**错误**

| 状态码 | code | 说明 |
|--------|------|------|
| 400 | `INVALID_PARAMS` | walls 或 spawnPoints 不是数组 |
| 400 | `VALIDATION_ERROR` | 配置验证失败，`errors` 字段包含详细信息 |
| 500 | `INTERNAL_ERROR` | 服务器内部错误 |

**验证规则**

- 每个 Wall 的 `width` 和 `height` 必须 > 0，`x` 和 `y` 必须为有限数
- 每个 SpawnPoint 的 `x` 和 `y` 必须为有限数
- 若提供 `bounds`，则 `x2 > x1` 且 `y2 > y1`

---

### GET /api/map-editor/rooms/:id/config — 获取房间配置

返回该房间最新版本的配置。

**响应 200**

```json
{
  "roomId": "room-uuid",
  "walls": [...],
  "spawnPoints": [...],
  "bounds": { "x1": 0, "y1": 0, "x2": 1280, "y2": 720 }
}
```

**错误**

| 状态码 | code | 说明 |
|--------|------|------|
| 404 | `CONFIG_NOT_FOUND` | 该房间尚无配置 |
| 500 | `INTERNAL_ERROR` | 服务器内部错误 |

---

### GET /api/map-editor/rooms/:id/config/history — 获取配置历史

返回所有历史版本，按版本号降序排列（最新版本在前）。

**响应 200**

```json
[
  {
    "id": "config-uuid",
    "roomId": "room-uuid",
    "version": 3,
    "configJson": "{...}",
    "createdAt": "2026-03-21T00:00:00.000Z"
  },
  {
    "id": "config-uuid-2",
    "roomId": "room-uuid",
    "version": 2,
    "configJson": "{...}",
    "createdAt": "2026-03-20T00:00:00.000Z"
  }
]
```

---

### POST /api/map-editor/rooms/:id/config/rollback — 回滚配置

将指定历史版本重新保存为新版本（版本号递增）。

**请求体**

```json
{
  "versionId": "config-uuid-2"
}
```

| 字段 | 必填 | 说明 |
|------|------|------|
| `versionId` | 是 | 历史版本记录的 `id`（非版本号） |

**响应 200**

```json
{
  "success": true
}
```

**错误**

| 状态码 | code | 说明 |
|--------|------|------|
| 400 | `INVALID_PARAMS` | versionId 为空 |
| 404 | `VERSION_NOT_FOUND` | 版本记录不存在 |
| 500 | `INTERNAL_ERROR` | 服务器内部错误 |
