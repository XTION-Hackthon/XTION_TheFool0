# Code Review Bugfixes — 任务列表

## 🔴 Critical Fixes

- [x] 1. Energy 原子更新
  - [x] 1.1 修改 `server/src/modules/world-manager.ts` 的 `modifyEnergy` 方法，使用 `UPDATE contestants SET energy = MAX(0, MIN(100, energy + ?)) WHERE id = ?` 替代 read-modify-write 模式，写入后重新读取并刷新 energyCache
  - [x] 1.2 验证现有 property test `server/src/tests/property/core-api.property.test.ts` 仍然通过

- [x] 2. Room Membership 事务补全
  - [x] 2.1 修改 `server/src/modules/room-membership-service.ts` 的 `updateMembership` 方法，在事务中追加 `db.prepare('UPDATE contestants SET position_x = ?, position_y = ? WHERE id = ?').run(newX, newY, botId)`
  - [x] 2.2 验证现有 property test `server/src/tests/property/movement-atomicity.property.test.ts` 仍然通过

- [x] 3. HeartbeatMonitor 能量回复错误处理
  - [x] 3.1 修改 `server/src/modules/heartbeat-monitor.ts` 的 `applyRestZoneEnergyRegen` 方法，将异步 `modifyEnergy` 改为同步调用模式（SQLite 本身是同步的，`modifyEnergy` 的 async 只是接口约定），或在 catch 中设置重试标记，下一个 tick 重试

## 🟠 High Fixes

- [x] 4. Room Join 事务化
  - [x] 4.1 修改 `server/src/routes/rooms.ts` 的 `POST /:id/join` handler，用 `db.transaction()` 包裹 `canJoinRoom` 检查和 `addBotToRoom` 调用，确保原子性
  - [x] 4.2 验证现有 property test `server/src/tests/property/room-capacity.property.test.ts` 仍然通过

- [x] 5. 跨房间移动门洞位置验证
  - [x] 5.1 修改 `server/src/modules/collision-manager.ts` 的 `validateCrossRoomMovement` 方法，在验证门洞连接和容量之后，调用 `doorwayManager.getDoorwayBetweenRooms(fromRoomId, toRoomId)` 获取门洞列表，然后用 `_isPositionInDoorway(targetPos.x, targetPos.y, doorways)` 验证目标位置是否在门洞范围内，不在则返回 `{ valid: false, error: 'Target position is not within a doorway' }`

- [x] 6. WebSocket sendEvent 防护
  - [x] 6.1 修改 `server/src/ws.ts` 的 `sendEvent` 函数，在 `ws.send()` 外层加 try-catch，catch 中 `console.error('[WS] sendEvent error:', err)`

- [x] 7. PrivateRoom bounds 强制校验
  - [x] 7.1 修改 `server/src/routes/rooms.ts` 的 `POST /` (创建房间) handler，当 `type === 'PrivateRoom'` 时校验 `bounds` 必须存在且 x1/y1/x2/y2 均为有限数字，否则返回 400
  - [x] 7.2 修改 `server/src/routes/rooms.ts` 的 `PUT /:id` (更新房间) handler，当更新后 type 为 PrivateRoom 时确保 bounds 存在

- [x] 8. Zone Rule 冲突检测
  - [x] 8.1 修改 `server/src/modules/world-manager.ts` 的 `updateZoneRule` 方法，在写入前检查 `rule.allowedAPIs` 和 `rule.forbiddenAPIs` 是否有交集，有则抛出错误

## 🟡 Medium Fixes

- [x] 9. Key 吊销连接清理
  - [x] 9.1 修改 `server/src/modules/auth-manager.ts` 的 `revokeKey` 方法，在吊销 key 后查询关联的 contestant，调用导出的 `disconnectContestant(contestantId)` 函数断开 WebSocket 并标记 offline
  - [x] 9.2 在 `server/src/ws.ts` 中导出 `disconnectContestant(contestantId: string)` 函数，该函数关闭 WebSocket 连接、从 connections map 中移除、更新 contestants 表状态为 offline

- [x] 10. 门洞高度验证
  - [x] 10.1 修改 `server/src/modules/doorway-manager.ts` 的 `validateDoorwayPlacement` 方法，在 width 验证之后增加 `if (config.height < 32)` 检查，push 错误信息 `Doorway height ${config.height} is less than minimum 32px (bot collision box size)`

- [x] 11. Move 边界 off-by-one 修复
  - [x] 11.1 修改 `server/src/modules/core-api-handler.ts` 的 `handleMove` 方法，将边界检查从 `targetPosition.x > width` 改为 `targetPosition.x >= width`，`targetPosition.y > height` 改为 `targetPosition.y >= height`

- [x] 12. 数据库索引补充
  - [x] 12.1 修改 `server/src/db.ts` 的 `createIndexes` 函数，添加 `CREATE INDEX IF NOT EXISTS idx_contestants_status ON contestants(status)` 和 `CREATE INDEX IF NOT EXISTS idx_contestants_zone ON contestants(current_zone_id)`

- [x] 13. room_bots 孤儿记录清理
  - [x] 13.1 修改 `server/src/ws.ts` 的 `markContestantOffline` 函数（或 disconnect 逻辑），在标记 contestant offline 时同时执行 `DELETE FROM room_bots WHERE bot_id = ?` 清理关联记录
