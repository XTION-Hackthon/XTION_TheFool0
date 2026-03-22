# Code Review Bugfixes — 需求文档

## 概述

基于全面代码审查发现的 18 个已确认 bug，涵盖并发安全、数据一致性、输入验证、错误处理等方面。按严重程度分为 Critical / High / Medium 三级。

## 已确认问题清单

### 🔴 Critical

1. **Energy 原子更新缺失** — `modifyEnergy` 使用 read-modify-write 模式，并发请求可导致 energy 超出 [0,100] 范围
2. **Room Membership 事务不完整** — `updateMembership` 事务只更新 `room_bots`，未同步 `contestants` 表
3. **HeartbeatMonitor 能量回复失败静默** — `applyRestZoneEnergyRegen` 中 `.catch()` 仅 log，客户端不知道更新失败

### 🟠 High

4. **Room Join 缺少事务保护** — `canJoinRoom` 和 `addBotToRoom` 之间无原子性，并发可超容量
5. **跨房间移动缺少门洞位置验证** — `validateCrossRoomMovement` 不验证目标位置是否在门洞范围内
6. **WebSocket sendEvent 缺少 try-catch** — `ws.send()` 可能在发送过程中抛异常
7. **Room bounds 可选但碰撞检测依赖** — PrivateRoom 无 bounds 时碰撞检测完全失效
8. **Zone Rule 冲突验证缺失** — `updateZoneRule` 不检查 allowedAPIs 和 forbiddenAPIs 交集

### 🟡 Medium

9. **Key 吊销后未断开 WebSocket** — `revokeKey` 不清理已连接的 contestant
10. **门洞缺少高度验证** — `validateDoorwayPlacement` 只验证 width >= 32，不验证 height
11. **Move 边界检查 off-by-one** — `handleMove` 用 `>` 而非 `>=`，允许 bot 站在地图边界外
12. **数据库缺少关键索引** — `contestants` 表缺少 `status` 和 `current_zone_id` 索引
13. **room_bots 缺少 bot_id 外键** — 无法级联删除，可能产生孤儿记录
