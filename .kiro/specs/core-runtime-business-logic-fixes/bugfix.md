# Bugfix Requirements Document

## Introduction

本文档定义了 4 个通过动态真实服务测试发现的高危运行时核心业务逻辑问题的修复需求。这些问题直接破坏了系统的核心功能，包括移动同步、身份认证、观战更新和 Bot 显示。修复这些问题对于确保系统的核心业务逻辑正确性和安全性至关重要。

## Bug Analysis

### Current Behavior (Defect)

#### Bug 1: 移动主链路断裂，服务端状态不同步

1.1 WHEN 客户端调用 `POST /api/collision/validate-move` 并收到 `{"valid":true}` 响应 THEN 系统只在客户端本地更新位置，不调用 `/api/move` 接口，导致服务端状态完全不同步

1.2 WHEN 其他玩家查询移动玩家的状态（通过 `/api/status/:id`）THEN 系统返回的位置是移动前的旧位置，而不是移动后的新位置

1.3 WHEN 客户端执行移动操作 THEN 系统不通过正式广播链通知其他玩家，导致其他玩家看不到该玩家的移动

#### Bug 2: 核心身份归属可在运行时被冒用

1.4 WHEN 使用一个"还没有 contestant 记录"的新 Agent_Player key 发送请求，并在 body 中指定其他玩家的 `senderId` 或 `contestant_id` THEN 系统接受该请求并修改被冒用玩家的服务端状态

1.5 WHEN 认证层处理一个"key 已认证但 contestant 尚未建立"的请求 THEN 系统允许该请求通过，不验证 body 中的身份标识是否与认证 key 匹配

#### Bug 3: 观战主链路只拿首帧，不拿后续世界变化

1.6 WHEN Agent_Viewer 建立 WebSocket 连接 THEN 系统只发送初始 `world.state`，不发送后续的世界变化事件（如 `contestant.join`、移动、离开等）

1.7 WHEN 有新玩家加入或现有玩家执行操作 THEN 系统不将这些事件广播给已连接的 Agent_Viewer，导致观战视图快速过时

#### Bug 4: Bot 显示依赖 WebSocket 认证，REST join 不创建 contestant

1.8 WHEN 客户端通过 REST API 加入房间（`/api/rooms/:id/join`）但未先完成 WebSocket 认证 THEN 系统将 `keys.id`（而非真实的 `contestant.id`）写入 `room_bots` 表

1.9 WHEN 渲染器尝试显示房间中的 Bot THEN 系统只渲染 `gameStore.contestants` 中的记录，导致通过 REST join 但未完成 WS 认证的玩家不显示在场景中

### Expected Behavior (Correct)

#### Bug 1: 移动主链路断裂，服务端状态不同步

2.1 WHEN 客户端调用 `POST /api/collision/validate-move` 并收到 `{"valid":true}` 响应 THEN 系统 SHALL 随后调用 `/api/move` 接口以同步服务端状态

2.2 WHEN 其他玩家查询移动玩家的状态（通过 `/api/status/:id`）THEN 系统 SHALL 返回移动后的最新位置

2.3 WHEN 客户端执行移动操作 THEN 系统 SHALL 通过正式广播链通知所有相关玩家，使其他玩家能够看到该玩家的移动

#### Bug 2: 核心身份归属可在运行时被冒用

2.4 WHEN 使用一个"还没有 contestant 记录"的新 Agent_Player key 发送请求，并在 body 中指定其他玩家的 `senderId` 或 `contestant_id` THEN 系统 SHALL 拒绝该请求并返回 401/403 错误

2.5 WHEN 认证层处理一个"key 已认证但 contestant 尚未建立"的请求 THEN 系统 SHALL 验证 body 中的身份标识是否与认证 key 匹配，不匹配则拒绝请求

#### Bug 3: 观战主链路只拿首帧，不拿后续世界变化

2.6 WHEN Agent_Viewer 建立 WebSocket 连接 THEN 系统 SHALL 发送初始 `world.state` 并注册该连接以接收后续的世界变化事件

2.7 WHEN 有新玩家加入或现有玩家执行操作 THEN 系统 SHALL 将这些事件广播给所有已连接的 Agent_Viewer，保持观战视图实时更新

#### Bug 4: Bot 显示依赖 WebSocket 认证，REST join 不创建 contestant

2.8 WHEN 客户端通过 REST API 加入房间（`/api/rooms/:id/join`）THEN 系统 SHALL 创建或更新 `contestants` 记录，并将真实的 `contestant.id` 写入 `room_bots` 表

2.9 WHEN 渲染器尝试显示房间中的 Bot THEN 系统 SHALL 显示所有通过 REST join 的玩家，无论其是否完成 WebSocket 认证

### Unchanged Behavior (Regression Prevention)

#### Bug 1: 移动主链路断裂，服务端状态不同步

3.1 WHEN 客户端调用 `POST /api/collision/validate-move` 并收到 `{"valid":false}` 响应 THEN 系统 SHALL CONTINUE TO 拒绝该移动，不更新客户端或服务端状态

3.2 WHEN 移动操作因其他原因失败（如网络错误、服务器错误）THEN 系统 SHALL CONTINUE TO 保持原有的错误处理逻辑

#### Bug 2: 核心身份归属可在运行时被冒用

3.3 WHEN 使用有效的 Agent_Player key 发送请求，并在 body 中指定与该 key 关联的自己的 `senderId` 或 `contestant_id` THEN 系统 SHALL CONTINUE TO 接受该请求并正常处理

3.4 WHEN 认证层处理一个"key 已认证且 contestant 已建立"的合法请求 THEN 系统 SHALL CONTINUE TO 允许该请求通过并正常执行

#### Bug 3: 观战主链路只拿首帧，不拿后续世界变化

3.5 WHEN Agent_Player 建立 WebSocket 连接 THEN 系统 SHALL CONTINUE TO 发送初始 `world.state` 并注册该连接以接收后续的世界变化事件

3.6 WHEN 世界状态发生变化 THEN 系统 SHALL CONTINUE TO 将事件广播给所有已连接的 Agent_Player

#### Bug 4: Bot 显示依赖 WebSocket 认证，REST join 不创建 contestant

3.7 WHEN 客户端通过 WebSocket 认证并完成世界同步 THEN 系统 SHALL CONTINUE TO 创建或更新 `contestants` 记录并正常显示 Bot

3.8 WHEN 渲染器显示已通过 WebSocket 认证的玩家 THEN 系统 SHALL CONTINUE TO 正常渲染这些玩家的 sprite
