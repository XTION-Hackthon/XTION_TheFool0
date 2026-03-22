# Code Review Bugfixes — 设计文档

## 修复策略

所有修复遵循最小改动原则，不改变现有 API 接口和数据结构，仅修复内部逻辑。

### 1. Energy 原子更新 (world-manager.ts)

将 `modifyEnergy` 从 read-modify-write 改为数据库级原子 UPDATE：
```sql
UPDATE contestants SET energy = MAX(0, MIN(100, energy + ?)) WHERE id = ?
```
写入后重新读取并刷新缓存。

### 2. Room Membership 事务补全 (room-membership-service.ts)

在现有事务中追加 `contestants` 表的 `position_x`, `position_y` 更新。

### 3. HeartbeatMonitor 能量回复重试 (heartbeat-monitor.ts)

在 `.catch()` 中标记失败，下一个 tick 重试。或改为同步调用（SQLite 是同步的）。

### 4. Room Join 事务化 (rooms.ts)

用 `db.transaction()` 包裹 `canJoinRoom` + `addBotToRoom`。

### 5. 跨房间移动门洞位置验证 (collision-manager.ts)

在 `validateCrossRoomMovement` 中调用已有的 `_isPositionInDoorway` 方法验证目标位置。

### 6. WebSocket sendEvent 防护 (ws.ts)

在 `sendEvent` 中加 try-catch。

### 7. PrivateRoom bounds 强制校验 (rooms.ts / room-manager.ts)

创建 PrivateRoom 时强制要求 bounds 字段。

### 8. Zone Rule 冲突检测 (world-manager.ts)

`updateZoneRule` 中检查 allowedAPIs ∩ forbiddenAPIs 是否为空。

### 9. Key 吊销连接清理 (auth-manager.ts + ws.ts)

`revokeKey` 后查找关联 contestant，断开 WebSocket 并标记 offline。

### 10. 门洞高度验证 (doorway-manager.ts)

`validateDoorwayPlacement` 中增加 `height >= 32` 检查。

### 11. Move 边界 off-by-one (core-api-handler.ts)

将 `> width` / `> height` 改为 `>= width` / `>= height`。

### 12. 数据库索引补充 (db.ts)

添加 `idx_contestants_status` 和 `idx_contestants_zone` 索引。

### 13. room_bots 外键约束 (db.ts)

由于 SQLite 不支持 ALTER TABLE ADD FOREIGN KEY，通过应用层在删除 contestant 时级联清理 room_bots。
