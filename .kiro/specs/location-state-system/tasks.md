# 实现任务：位置状态系统

## 任务列表

- [x] 1. 数据层：新增类型定义与数据库表
  - [x] 1.1 在 `server/src/types/index.ts` 中新增 `LocationState`、`AgentLocationState`、`Invitation`、`PhaseConfig`、`ArchivedMessage` 类型
  - [x] 1.2 在 `server/src/db.ts` 的 `createTables()` 中新增 `invitations` 表和 `messages` 表
  - [x] 1.3 在 `server/src/db.ts` 的 `createIndexes()` 中为新表添加索引（`idx_invitations_inviter`、`idx_invitations_invitee`、`idx_invitations_status`、`idx_messages_sender`、`idx_messages_type`、`idx_messages_timestamp`）

- [x] 2. 实现 `LocationManager` 模块
  - [x] 2.1 创建 `server/src/modules/location-manager.ts`，定义硬编码坐标常量（`LOBBY_SLOTS` 20个、`ROOM_SLOTS` 8个房间、`AUDIENCE_SLOTS` 30个）
  - [x] 2.2 实现内存状态管理：`agentStates` Map、`lobbyOccupied` Set、`audienceOccupied` Set、`roomOccupancy` Map
  - [x] 2.3 实现 `assignLobbySlot(contestantId)`：遍历找第一个空闲槽位，满则抛出 `LOBBY_FULL` 错误
  - [x] 2.4 实现 `assignAudienceSlot(viewerId)`：遍历找第一个空闲观众席槽位，满则抛出 `AUDIENCE_FULL` 错误
  - [x] 2.5 实现 `releaseSlot(contestantId)`：释放该 Agent 占用的所有槽位（大厅或房间），若在房间内同时清除房间占用记录
  - [x] 2.6 实现 `enterRoom(inviterId, inviteeId, roomId)`：原子性地将双方状态更新为 `room_n`，分配 Slot_A 给邀请方、Slot_B 给被邀请方
  - [x] 2.7 实现 `leaveRoom(contestantId)`：将 Agent 状态更新为 `lobby`，释放房间槽位，重新分配大厅出生槽位，返回新坐标
  - [x] 2.8 实现 `findFreeRoom()`：返回第一个 slotA 和 slotB 均为 null 的房间号，无则返回 null
  - [x] 2.9 实现 `getState(contestantId)`、`getAllStates()`、`getRoomOccupancy(roomId)` 查询方法
  - [x] 2.10 导出单例 `locationManager`

- [x] 3. 实现 `InvitationManager` 模块
  - [x] 3.1 创建 `server/src/modules/invitation-manager.ts`
  - [x] 3.2 实现 `createInvitation(inviterId, inviteeId)`：校验双方均在 lobby、被邀请方角色为 `Agent_Player`、存在空闲房间；写入 `invitations` 表；设置 60s 超时 timer；通过 WebSocket 推送 `invitation.received` 事件给被邀请方
  - [x] 3.3 实现 `acceptInvitation(invitationId, inviteeId)`：校验邀请状态为 `pending`；再次调用 `findFreeRoom()`；调用 `locationManager.enterRoom()` 原子分配；更新邀请状态为 `accepted`；清除 timer；推送 `location.changed` 事件给双方及所有在线客户端；推送 `invitation.accepted` 事件给邀请方
  - [x] 3.4 实现 `rejectInvitation(invitationId, inviteeId)`：更新邀请状态为 `rejected`；清除 timer；推送 `invitation.rejected` 事件给邀请方
  - [x] 3.5 实现私有方法 `expireInvitation(invitationId)`：更新邀请状态为 `expired`；推送 `invitation.expired` 事件给双方
  - [x] 3.6 导出单例 `invitationManager`

- [x] 4. 实现 `PhaseManager` 模块
  - [x] 4.1 创建 `server/src/modules/phase-manager.ts`，硬编码 5 个阶段配置（`phase_1` 至 `phase_5`，含 `phaseId`、`phaseName`、`phasePrompt`、`skillDocNames`）
  - [x] 4.2 实现 `getPhases()`：返回所有阶段配置列表（仅 id 和 name）
  - [x] 4.3 实现 `getActivePhase()`：返回当前活跃阶段配置，初始为 null
  - [x] 4.4 实现 `activatePhase(phaseId, operatorId)`：设置 `activePhaseId`；异步向所有在线 `Agent_Player` 推送 `doc.mandatory` 事件（阶段提示词）和 `doc.update` 事件（关联 skill 文档）；记录 `phase.switched` 事件到 `EventLogger`
  - [x] 4.5 实现 `pushCurrentPhaseToAgent(contestantId)`：将当前活跃阶段的提示词和 skill 文档推送给指定 Agent（用于新连接时补推）
  - [x] 4.6 导出单例 `phaseManager`

- [x] 5. 新增路由文件
  - [x] 5.1 创建 `server/src/routes/location.ts`：实现 `GET /api/location/me`（返回自身位置状态和坐标）和 `GET /api/location/:id`（查询指定 Agent 位置状态，所有已认证用户可访问）
  - [x] 5.2 创建 `server/src/routes/invitation.ts`：实现 `POST /api/invitation`（发起邀请，仅 `Agent_Player`）、`POST /api/invitation/:id/accept`（接受邀请）、`POST /api/invitation/:id/reject`（拒绝邀请）
  - [x] 5.3 创建 `server/src/routes/leave-room.ts`：实现 `POST /api/leave-room`（离开私聊房间，仅 `Agent_Player`），调用 `locationManager.leaveRoom()`，推送 `room.partner_left` 事件给同房间对方，推送 `location.changed` 事件
  - [x] 5.4 创建 `server/src/routes/admin-location.ts`：实现 `GET /api/admin/location/all`（查询所有 Agent 位置状态）和 `GET /api/admin/rooms/:id`（查询指定房间占用情况），均需 Admin 权限
  - [x] 5.5 创建 `server/src/routes/admin-phase.ts`：实现 `GET /api/admin/phases`（查询所有阶段列表，Admin）和 `POST /api/admin/phases/:id/activate`（切换阶段，Admin）；实现 `GET /api/phases/current`（查询当前活跃阶段，所有已认证用户）
  - [x] 5.6 创建 `server/src/routes/messages.ts`：实现 `GET /api/admin/messages`，支持 `type`、`sender_id`、`from`、`to`、`page`、`pageSize` 查询参数，仅 Admin 可访问

- [x] 6. 修改 `ws.ts`：集成 LocationManager 和 PhaseManager
  - [x] 6.1 在 `handleAuth` 的 `Agent_Player` 分支中，替换 `getZoneCenterPosition()` 为 `locationManager.assignLobbySlot(contestant.id)`；若抛出 `LOBBY_FULL` 错误则关闭连接并返回对应错误码
  - [x] 6.2 在 `handleAuth` 的 `Agent_Viewer` 分支中，调用 `locationManager.assignAudienceSlot(viewerId)`；若抛出 `AUDIENCE_FULL` 错误则关闭连接
  - [x] 6.3 在 `handleAuth` 的 `Agent_Player` 分支中，`pushMandatoryDocuments` 之后调用 `phaseManager.pushCurrentPhaseToAgent(contestant.id)`
  - [x] 6.4 在 `ws.on('close')` 处理中，调用 `locationManager.releaseSlot(contestantId)`；若 Agent 在房间内，向同房间对方推送 `room.partner_left` 事件
  - [x] 6.5 在 `disconnectContestant()` 函数中同样调用 `locationManager.releaseSlot(contestantId)`

- [x] 7. 修改 `app.ts`：注册新路由，废弃 `/api/move`
  - [x] 7.1 导入并注册 `locationRouter`、`invitationRouter`、`leaveRoomRouter`、`adminLocationRouter`、`adminPhaseRouter`、`messagesRouter`
  - [x] 7.2 将 `/api/move` 路由替换为返回 `410 Gone` 的响应，提示 Agent 使用新的邀请接口

- [x] 8. 消息存档集成
  - [x] 8.1 修改 `server/src/routes/broadcast.ts`：在广播成功后，额外写入 `messages` 表（`type='broadcast'`、`sender_id`、`content`、`timestamp`）
  - [x] 8.2 修改 `server/src/routes/talk.ts`（或新建房间内私聊路由）：在私聊消息发送成功后，写入 `messages` 表（`type='private'`、`sender_id`、`receiver_id`、`room_id`、`content`、`timestamp`）；校验发送方和接收方均在同一房间内

- [x] 9. 属性测试（Property-Based Testing）
  - [x] 9.1 创建 `server/src/tests/property/location-slot-uniqueness.property.test.ts`：验证任意时刻同一大厅槽位不被两个 Agent 同时占用
  - [x] 9.2 创建 `server/src/tests/property/room-capacity.property.test.ts`：验证任意房间占用人数 ≤ 2
  - [x] 9.3 创建 `server/src/tests/property/location-state-consistency.property.test.ts`：验证 Agent 的 `locationState` 与其 `slot` 坐标始终对应正确的硬编码坐标
  - [x] 9.4 创建 `server/src/tests/property/invitation-atomicity.property.test.ts`：验证接受邀请后双方状态要么都变为 `room_n`，要么都保持 `lobby`
  - [x] 9.5 创建 `server/src/tests/property/slot-release.property.test.ts`：验证 Agent 断开连接后其占用的所有槽位均被释放
  - [x] 9.6 创建 `server/src/tests/property/phase-push.property.test.ts`：验证阶段切换后所有在线 `Agent_Player` 均收到 `doc.mandatory` 事件且内容与配置一致
