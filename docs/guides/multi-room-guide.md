# 多房间系统使用指南

## 概述

多房间系统支持两种房间类型：
- **主大厅（MainHall）**：所有 bot 默认进入的广播房间，容量无限
- **私聊房间（PrivateRoom）**：最多容纳 2 个 bot 的私密房间，满员后自动拒绝新成员

---

## 快速开始

### 1. 创建房间

```typescript
// 创建主大厅
const res = await fetch('/api/rooms', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
  body: JSON.stringify({ name: 'MainHall', type: 'MainHall' }),
});
const mainHall = await res.json(); // { id, name, type, capacity, ... }

// 创建私聊房间
const privateRes = await fetch('/api/rooms', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
  body: JSON.stringify({ name: 'Room-A', type: 'PrivateRoom' }),
});
const privateRoom = await privateRes.json(); // capacity 默认为 2
```

### 2. Bot 加入房间

```typescript
// 加入主大厅（自动分配出生点）
const joinRes = await fetch(`/api/rooms/${mainHall.id}/join`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
  body: JSON.stringify({ botId: 'bot-001' }),
});
const { position, spawnPoint } = await joinRes.json();
// position: { x, y }  spawnPoint: { id, x, y }

// 加入时指定位置
await fetch(`/api/rooms/${mainHall.id}/join`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
  body: JSON.stringify({ botId: 'bot-002', position: { x: 200, y: 300 } }),
});
```

### 3. 查询房间状态

```typescript
// 获取所有房间（含当前人数）
const rooms = await fetch('/api/rooms', {
  headers: { Authorization: `Bearer ${token}` },
}).then((r) => r.json());

// 获取单个房间详情（含 bot 列表）
const detail = await fetch(`/api/rooms/${roomId}`, {
  headers: { Authorization: `Bearer ${token}` },
}).then((r) => r.json());
// detail.bots: [{ botId, positionX, positionY, joinedAt }, ...]
```

### 4. Bot 离开房间

```typescript
await fetch(`/api/rooms/${roomId}/leave`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
  body: JSON.stringify({ botId: 'bot-001' }),
});
```

---

## 前端状态管理（RoomStore）

`useRoomStore` 管理客户端的房间状态，与后端 API 配合使用：

```typescript
import { useRoomStore } from '../stores/roomStore';

function MyComponent() {
  const { rooms, currentRoomId, switchRoom, addBotToRoom, updateBotPosition } = useRoomStore();

  // 切换当前房间
  switchRoom(roomId);

  // 添加 bot 到本地状态
  addBotToRoom(roomId, {
    id: 'bot-001',
    name: 'Alice',
    position: { x: 150, y: 300 },
  });

  // 更新 bot 位置
  updateBotPosition(roomId, 'bot-001', { x: 200, y: 350 });

  // 从 API 同步房间列表
  const { setRooms } = useRoomStore();
  const apiRooms = await fetch('/api/rooms', { headers: { Authorization: `Bearer ${token}` } })
    .then((r) => r.json());
  setRooms(apiRooms);
}
```

---

## 房间容量管理

私聊房间满员时，`/api/rooms/:id/join` 返回 400 错误：

```typescript
const res = await fetch(`/api/rooms/${privateRoomId}/join`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
  body: JSON.stringify({ botId: 'bot-003' }),
});

if (res.status === 400) {
  const { code } = await res.json();
  if (code === 'ROOM_AT_CAPACITY') {
    console.log('房间已满，请等待或选择其他房间');
  }
}
```

在 UI 中展示容量状态：

```typescript
const rooms = await fetch('/api/rooms', { headers: { Authorization: `Bearer ${token}` } })
  .then((r) => r.json());

for (const room of rooms) {
  const isFull = room.currentCount >= room.capacity;
  console.log(`${room.name}: ${room.currentCount}/${room.capacity} ${isFull ? '(已满)' : '(可加入)'}`);
}
```

---

## 实时同步（WebSocket）

通过 WebSocket 监听房间事件，保持客户端状态与服务器同步：

```typescript
import { wsClient } from '../services/ws-client';
import { useRoomStore } from '../stores/roomStore';

const { addBotToRoom, removeBotFromRoom, updateRoom } = useRoomStore.getState();

wsClient.on('room:bot_joined', ({ roomId, botId, name, position }) => {
  addBotToRoom(roomId, { id: botId, name, position });
});

wsClient.on('room:bot_left', ({ roomId, botId }) => {
  removeBotFromRoom(roomId, botId);
});

wsClient.on('room:capacity', ({ roomId, currentCount }) => {
  updateRoom(roomId, { currentCount });
});

wsClient.on('room:spawn_assigned', ({ botId, roomId, spawnPoint }) => {
  updateBotPosition(roomId, botId, { x: spawnPoint.x, y: spawnPoint.y });
});
```

---

## 出生点分配

加入主大厅时，系统自动从可用出生点中随机分配一个，避免新 bot 与现有 bot 重叠：

```typescript
const { position, spawnPoint } = await fetch(`/api/rooms/${mainHallId}/join`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
  body: JSON.stringify({ botId: 'bot-001' }),
}).then((r) => r.json());

console.log(`Bot 出生于 (${position.x}, ${position.y})`);
// 出生点已确保与现有 bot 无碰撞（最多尝试 3 次）
```

如需为房间添加出生点，使用地图编辑器 API（参见[地图编辑器使用指南](./map-editor-guide.md)）。

---

## 房间切换流程

```
1. 调用 POST /api/rooms/:oldRoomId/leave  (botId)
2. 调用 POST /api/rooms/:newRoomId/join   (botId)
3. 更新前端 currentRoomId
4. 重新加载新房间的墙体和 bot 列表
```

```typescript
async function switchRoom(botId: string, fromRoomId: string, toRoomId: string, token: string) {
  await fetch(`/api/rooms/${fromRoomId}/leave`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ botId }),
  });

  const joinRes = await fetch(`/api/rooms/${toRoomId}/join`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ botId }),
  });

  const { position } = await joinRes.json();
  useRoomStore.getState().switchRoom(toRoomId);
  return position;
}
```

---

## 注意事项

- 主大厅始终存在，不可删除
- 私聊房间满员（2 人）后，新 bot 无法加入，需等待有人离开
- 不同房间的 bot 互不可见，消息也不会跨房间广播
- bot 离开房间时，其碰撞箱自动从空间索引中移除
