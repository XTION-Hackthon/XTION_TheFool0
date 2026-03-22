# Bugfix Requirements Document

## Introduction

本文档记录代码审查中发现的 7 个架构/集成层面的 bug。这些 bug 涵盖权限校验缺失、前后端契约不一致、房间切换逻辑不完整、渲染链断裂、服务重启清理不闭环、前端构建失败等问题。按优先级分为 P0（1 个）、P1（5 个）、P2（1 个）。

## Bug Analysis

### Current Behavior (Defect)

1.1 WHEN 持有任意有效 API Key 的用户调用房间写接口（POST /api/rooms、DELETE /api/rooms/:id、POST /api/rooms/:id/join、POST /api/rooms/:id/leave）THEN 系统仅通过 authMiddleware 验证 Key 有效性，不检查角色权限，任何角色（包括 Agent_Player、Agent_Viewer、Human_Viewer）都能创建/删除房间

1.2 WHEN 用户调用 POST /api/rooms/:id/join 或 POST /api/rooms/:id/leave THEN 系统直接信任请求体中的 botId 参数，不验证该 botId 是否属于当前认证用户（req.contestantId），允许任何用户操控其他用户的 bot

1.3 WHEN 前端 RoomList 或 RoomManagementPanel 调用 join/leave 接口 THEN 系统发送 `{ botId: 'self' }` 作为请求体，后端将字面值 'self' 存入 room_bots 表，该值永远无法匹配到真实的 contestantId，导致房间成员关系无效

1.4 WHEN 用户通过 RoomManagementPanel 的 onSwitchRoom 切换房间 THEN 系统只调用新房间的 join 接口，不调用旧房间的 leave 接口，导致 bot 在 room_bots 表中同时存在于多个房间的记录中

1.5 WHEN 后端 addBotToRoom 被调用 THEN 系统只检查 `SELECT id FROM room_bots WHERE room_id = ? AND bot_id = ?`（同房去重），不清理该 bot 在其他房间的记录，无法保证全局唯一房间归属

1.6 WHEN GameScene 创建完成后进入 update() 循环 THEN 由于 loadRoom() 从未被调用，this.currentRoomId 始终为 null，update() 在 `!this.currentRoomId` 处提前返回，房间内的 walls/spawnPoints/bots 永远不会被渲染

1.7 WHEN 服务器重启时 setupWebSocket 执行启动清理 THEN 系统只执行 `UPDATE contestants SET status = 'offline' WHERE status = 'online'`，不清理 room_bots 表中的残留记录，也不处理 status = 'timeout' 的 contestants

1.8 WHEN heartbeat monitor 将 contestant 标记为 timeout 状态后服务器重启 THEN 启动清理只处理 status = 'online' 的记录，status = 'timeout' 的 contestants 不会被清成 offline，导致这些 contestants 处于僵尸状态

1.9 WHEN 前端执行 `npx tsc --noEmit` 进行类型检查 THEN 编译报 4 个错误：pathfinding-system.ts 中 `Bot` 类型未定义（TS2304）、`room.bounds` 类型 `{ x1; y1; x2; y2 } | undefined` 不能赋值给 `Bounds`（TS2345）、room-graph-builder.ts 中 `../../types` 模块不存在（TS2307），前端无法构建

1.10 WHEN 前端 AdminPanel 的 KeysTab 调用 POST /api/admin/keys 生成新 Key THEN 前端发送 `{ contestantName: newName }`，但后端期望 `{ name, role }`，字段名不匹配且缺少 role 字段，请求必定返回 400 错误

1.11 WHEN 前端 AdminPanel 的 KeysTab 界面显示时 THEN UI 没有角色选择器，用户无法指定新 Key 的角色，即使修正字段名也无法提供必需的 role 参数

### Expected Behavior (Correct)

2.1 WHEN 用户调用房间创建（POST /api/rooms）和删除（DELETE /api/rooms/:id）接口 THEN 系统 SHALL 通过 requireRole 中间件限制仅 Admin 角色可以执行这些操作，其他角色返回 403

2.2 WHEN 用户调用 POST /api/rooms/:id/join 或 POST /api/rooms/:id/leave THEN 系统 SHALL 使用 req.contestantId（由 authMiddleware 设置）作为 botId，忽略或校验请求体中的 botId 参数，确保用户只能操控自己的 bot

2.3 WHEN 前端 RoomList 或 RoomManagementPanel 调用 join/leave 接口 THEN 系统 SHALL 发送当前用户的真实 contestantId（从 world.state 的 self.id 获取）作为 botId，或由后端自动使用 req.contestantId

2.4 WHEN 用户通过 onSwitchRoom 切换房间 THEN 系统 SHALL 先调用旧房间的 leave 接口移除 bot，再调用新房间的 join 接口加入 bot，确保 bot 在任意时刻只属于一个房间

2.5 WHEN addBotToRoom 被调用 THEN 系统 SHALL 在插入新的 room_bots 记录前，先删除该 bot 在其他房间的所有 room_bots 记录，保证全局唯一房间归属

2.6 WHEN GameScene 完成 loadAndRenderWorld 获取到房间列表后 THEN 系统 SHALL 自动调用 loadRoom() 加载第一个房间（或当前用户所在的房间），使 currentRoomId 被正确设置，update() 循环能正常渲染房间内容

2.7 WHEN 服务器重启时 setupWebSocket 执行启动清理 THEN 系统 SHALL 同时执行：(a) 将 status = 'online' 和 status = 'timeout' 的 contestants 都标记为 offline；(b) 清空 room_bots 表中所有残留记录

2.8 WHEN 前端执行 `npx tsc --noEmit` 进行类型检查 THEN 系统 SHALL 编译通过无错误：pathfinding-system.ts 正确导入 Bot 类型、room.bounds 类型正确处理 undefined 情况、room-graph-builder.ts 使用正确的导入路径

2.9 WHEN 前端 AdminPanel 的 KeysTab 调用 POST /api/admin/keys 生成新 Key THEN 系统 SHALL 发送 `{ name, role }` 格式的请求体，其中 name 为用户输入的选手名称，role 为用户从角色选择器中选择的角色值

2.10 WHEN 前端 AdminPanel 的 KeysTab 界面显示时 THEN 系统 SHALL 提供角色选择器（下拉框），包含所有可用角色选项（Admin、Agent_Player、Agent_Viewer、Human_Viewer），默认选中 Agent_Player

### Unchanged Behavior (Regression Prevention)

3.1 WHEN Admin 角色用户调用房间读接口（GET /api/rooms、GET /api/rooms/:id）THEN 系统 SHALL CONTINUE TO 正常返回房间列表和详情

3.2 WHEN Agent_Player 角色用户调用 join/leave 接口操控自己的 bot THEN 系统 SHALL CONTINUE TO 正常执行加入/离开房间操作并广播事件

3.3 WHEN bot 加入房间时房间已满员 THEN 系统 SHALL CONTINUE TO 返回 ROOM_AT_CAPACITY 错误

3.4 WHEN bot 加入房间时提供了 position 参数 THEN 系统 SHALL CONTINUE TO 使用提供的位置而非分配出生点

3.5 WHEN GameScene 的 zoom/pan/resize 功能被使用 THEN 系统 SHALL CONTINUE TO 正常工作，不受 loadRoom 修复影响

3.6 WHEN 单个 contestant 正常断线（WebSocket close）THEN 系统 SHALL CONTINUE TO 通过 5 秒延迟 + markContestantOffline 正确清理连接和 room_bots 记录

3.7 WHEN heartbeat monitor 检测到 contestant 超时并标记为 offline THEN 系统 SHALL CONTINUE TO 关闭 WebSocket、更新数据库状态、广播离线事件

3.8 WHEN AdminPanel 的其他 Tab（Zones、Skills、Docs、Heartbeat、Map、Monitor）被使用 THEN 系统 SHALL CONTINUE TO 正常工作，不受 KeysTab 修复影响

3.9 WHEN 已有的 Key 列表查询（GET /api/admin/keys）、吊销（DELETE）、重新生成（POST regenerate）接口被调用 THEN 系统 SHALL CONTINUE TO 正常工作

3.10 WHEN pathfinding-system 的 findPath 和 findMultiRoomPath 方法被调用 THEN 系统 SHALL CONTINUE TO 正确计算路径，类型修复不改变运行时行为
