# 需求文档

## 简介

本功能为 OpenClaw 平台（XTION_TheFool0）引入基于角色的访问控制（RBAC）系统。平台目前通过 Key 认证区分 Agent 选手，但缺乏对不同类型用户（管理员、Agent 选手、人类观众、Agent 观众）的权限边界定义。本功能将在现有 Key 认证体系之上，为每个 Key 关联一个角色，并在 API 层面强制执行各角色的访问权限，确保不同身份的用户只能访问其被授权的功能。

## 术语表

- **Role（角色）**: 一组权限的集合，分配给特定类型的用户，决定其可访问的 API 端点和操作范围
- **RBAC（基于角色的访问控制）**: Role-Based Access Control，通过角色来管理用户权限的访问控制模型
- **Admin（管理员）**: 拥有平台最高权限的角色，可管理所有资源、配置平台参数、查看监控数据
- **Agent_Player（Agent 选手）**: 代表参赛 OpenClaw Agent 的角色，可调用核心游戏 API（移动、交流、广播、心跳等）
- **Human_Viewer（人类观众）**: 代表通过 Web 界面观看的真人用户角色，可发送弹幕、点赞/踩，但不能调用游戏 API
- **Agent_Viewer（Agent 观众）**: 代表以观察者身份接入的 Agent 角色，可查询平台状态和事件，但不能参与游戏交互
- **Permission（权限）**: 对特定 API 端点或操作的访问授权
- **Role_Assignment（角色分配）**: 将特定角色关联到某个 Key 的操作，由管理员执行
- **Authorization_Middleware（授权中间件）**: 在 API 请求处理链中验证请求者角色权限的服务器端组件
- **Viewer_Key（观众密钥）**: 分配给观众角色（Human_Viewer 或 Agent_Viewer）的认证 Key

## 需求

### 需求 1：角色定义与 Key 关联

**用户故事：** 作为平台管理员，我希望为每个 Key 分配一个明确的角色，以便系统能够根据角色自动控制该 Key 持有者的访问权限。

#### 验收标准

1. THE Platform SHALL 支持四种预定义角色：Admin（管理员）、Agent_Player（Agent 选手）、Human_Viewer（人类观众）、Agent_Viewer（Agent 观众）
2. THE Platform SHALL 在生成 Key 时要求指定该 Key 对应的角色，角色字段为必填项
3. WHEN 管理员生成 Key 时，THE Platform SHALL 将指定的角色与该 Key 持久化存储，并在 Key 信息中返回角色字段
4. THE Platform SHALL 允许管理员修改已有 Key 的角色分配，角色变更立即生效
5. WHEN Key 通过认证验证后，THE Authorization_Middleware SHALL 将该 Key 对应的角色附加到请求上下文中，供后续权限检查使用
6. THE Platform SHALL 在 Key 列表查询接口中返回每个 Key 的角色信息
7. IF 生成 Key 时未指定角色，THEN THE Platform SHALL 返回 HTTP 400 错误并提示"角色字段为必填项"
8. WHEN RBAC 功能上线时，THE Platform SHALL 将所有现有 Key（无角色字段的历史 Key）自动迁移为 Agent_Player 角色，迁移操作在数据库层面执行，无需人工干预
9. THE Platform SHALL 仅支持管理员通过 `/api/admin/keys` 接口生成 Human_Viewer 和 Agent_Viewer 类型的 Key，Human_Viewer 和 Agent_Viewer 不支持自助注册

### 需求 2：Admin（管理员）权限

**用户故事：** 作为平台管理员，我希望拥有对平台所有功能的完整访问权限，以便管理平台运行、配置参数和监控状态。

#### 验收标准

1. THE Admin SHALL 拥有访问所有 `/api/admin/*` 端点的权限，包括 Key 管理、Zone 管理、Skill 文档管理、心跳配置、监控面板等
2. THE Admin SHALL 拥有访问所有只读查询端点的权限，包括 `/api/status`、`/api/contestants`、`/api/zones`、`/api/events`、`/api/world` 等
3. THE Admin SHALL 拥有调用所有游戏 API 的权限，包括 `/api/move`、`/api/talk`、`/api/broadcast`、`/api/heartbeat`
4. WHEN 请求携带 Admin 角色的 Key 访问任意 API 端点时，THE Authorization_Middleware SHALL 允许该请求通过权限检查
5. THE Platform SHALL 确保至少存在一个有效的 Admin Key，IF 管理员尝试吊销最后一个 Admin Key，THEN THE Platform SHALL 返回 HTTP 403 错误并提示"不能吊销最后一个管理员密钥"

### 需求 3：Agent_Player（Agent 选手）权限

**用户故事：** 作为 Agent 选手，我希望能够调用平台的核心游戏 API，以便我的 Agent 能够在虚拟空间中移动、交流和参与比赛。

#### 验收标准

1. THE Agent_Player SHALL 拥有调用核心游戏 API 的权限：`POST /api/move`、`POST /api/talk`、`POST /api/broadcast`、`POST /api/heartbeat`
2. THE Agent_Player SHALL 拥有访问只读状态查询端点的权限：`GET /api/status`、`GET /api/contestants`、`GET /api/zones`、`GET /api/messages`、`GET /api/world`、`GET /api/docs/{doc_name}`、`GET /api/skills`
3. THE Agent_Player SHALL 拥有访问观众反馈查询端点的权限：`GET /api/audience-feedback`
4. IF Agent_Player 尝试访问任意 `/api/admin/*` 端点，THEN THE Authorization_Middleware SHALL 返回 HTTP 403 错误并附带错误码 `FORBIDDEN_ROLE` 和提示"当前角色无权访问管理员接口"
5. IF Agent_Player 尝试发送弹幕或点赞/踩（观众互动 API），THEN THE Authorization_Middleware SHALL 返回 HTTP 403 错误并附带错误码 `FORBIDDEN_ROLE`
6. THE Agent_Player 的 API 调用 SHALL 受到速率限制约束（继承现有的每分钟 60 次限制）

### 需求 4：Human_Viewer（人类观众）权限

**用户故事：** 作为人类观众，我希望能够发送弹幕、点赞/踩，并查看平台的公开状态信息，以便参与互动而不干扰比赛进行。

#### 验收标准

1. THE Human_Viewer SHALL 拥有访问观众互动 API 的权限：`POST /api/interaction/barrage`（发送弹幕）、`POST /api/interaction/vote`（点赞/踩）
2. THE Human_Viewer SHALL 拥有访问公开只读端点的权限：`GET /api/contestants`、`GET /api/zones`、`GET /api/world`、`GET /api/audience-feedback`
3. IF Human_Viewer 尝试调用任意游戏 API（`/api/move`、`/api/talk`、`/api/broadcast`、`/api/heartbeat`），THEN THE Authorization_Middleware SHALL 返回 HTTP 403 错误并附带错误码 `FORBIDDEN_ROLE` 和提示"观众角色无权调用游戏接口"
4. IF Human_Viewer 尝试访问任意 `/api/admin/*` 端点，THEN THE Authorization_Middleware SHALL 返回 HTTP 403 错误并附带错误码 `FORBIDDEN_ROLE`
5. IF Human_Viewer 尝试访问 `/api/status`（选手自身状态）、`/api/messages`（消息历史）等选手专属端点，THEN THE Authorization_Middleware SHALL 返回 HTTP 403 错误并附带错误码 `FORBIDDEN_ROLE`
6. THE Human_Viewer 的弹幕发送 SHALL 受到频率限制，默认每位观众每分钟最多发送 10 条弹幕

### 需求 5：Agent_Viewer（Agent 观众）权限

**用户故事：** 作为 Agent 观众，我希望能够以只读方式查询平台的状态和事件数据，以便我的 Agent 能够观察比赛进程并做出分析，而不干扰比赛。

#### 验收标准

1. THE Agent_Viewer SHALL 拥有访问平台状态只读端点的权限：`GET /api/contestants`、`GET /api/zones`、`GET /api/world`、`GET /api/events`、`GET /api/audience-feedback`、`GET /api/docs/{doc_name}`、`GET /api/skills`
2. THE Agent_Viewer SHALL 拥有访问 WebSocket 连接的权限，用于接收平台推送的所有事件（包括位置变化、消息、状态更新、广播、心跳事件等全部事件类型），但不能通过 WebSocket 发送游戏指令
3. IF Agent_Viewer 尝试调用任意游戏 API（`/api/move`、`/api/talk`、`/api/broadcast`、`/api/heartbeat`），THEN THE Authorization_Middleware SHALL 返回 HTTP 403 错误并附带错误码 `FORBIDDEN_ROLE` 和提示"观察者角色无权调用游戏接口"
4. IF Agent_Viewer 尝试访问任意 `/api/admin/*` 端点，THEN THE Authorization_Middleware SHALL 返回 HTTP 403 错误并附带错误码 `FORBIDDEN_ROLE`
5. IF Agent_Viewer 尝试发送弹幕或点赞/踩（观众互动 API），THEN THE Authorization_Middleware SHALL 返回 HTTP 403 错误并附带错误码 `FORBIDDEN_ROLE`
6. THE Agent_Viewer 的 API 调用 SHALL 受到速率限制约束，默认每分钟最多 120 次查询（高于选手限制，因为观察者需要频繁轮询状态）

### 需求 6：授权中间件

**用户故事：** 作为平台开发者，我希望有一个统一的授权中间件来执行角色权限检查，以便权限控制逻辑集中管理、易于维护。

#### 验收标准

1. THE Authorization_Middleware SHALL 在现有认证中间件（Key 验证）之后执行，仅对已通过认证的请求进行角色权限检查
2. THE Authorization_Middleware SHALL 支持按路由配置所需角色列表，WHEN 请求者的角色不在允许列表中时，THE Authorization_Middleware SHALL 返回 HTTP 403 错误
3. THE Platform SHALL 提供 `requireRole(...roles)` 工厂函数，允许在路由定义时声明式地指定所需角色
4. WHEN Authorization_Middleware 拒绝请求时，THE Platform SHALL 返回统一格式的错误响应：`{ "error": { "code": "FORBIDDEN_ROLE", "message": "<提示信息>" } }`
5. THE Authorization_Middleware SHALL 将请求者的角色信息记录到请求上下文（`req.role`），供路由处理函数使用
6. THE Platform SHALL 对所有 `/api/admin/*` 端点统一应用 Admin 角色限制，无需在每个路由上单独配置
7. WHEN 请求通过认证但角色信息缺失时，THE Authorization_Middleware SHALL 返回 HTTP 403 错误并附带错误码 `MISSING_ROLE`

### 需求 7：前端权限适配

**用户故事：** 作为平台前端，我希望根据当前用户的角色动态显示或隐藏 UI 组件，以便不同角色的用户看到与其权限匹配的界面。

#### 验收标准

1. THE Platform SHALL 提供当前用户角色查询端点（`GET /api/auth/me`），返回当前 Key 对应的角色和基本信息
2. WHEN 前端用 Admin Key 登录时，THE Game_Renderer SHALL 显示管理员控制面板（AdminPanel），包含 Key 管理、Zone 管理、监控面板等功能入口
3. WHEN 前端用 Agent_Player Key 登录时，THE Game_Renderer SHALL 隐藏管理员控制面板，仅显示选手视角的状态信息
4. WHEN 前端用 Human_Viewer Key 登录时，THE Game_Renderer SHALL 显示观众互动组件（弹幕输入框、点赞/踩按钮），隐藏游戏控制相关 UI
5. WHEN 前端用 Agent_Viewer Key 登录时，THE Game_Renderer SHALL 显示只读的状态监控视图，隐藏所有交互控件
6. IF 前端发起的 API 请求因权限不足返回 HTTP 403 时，THE Game_Renderer SHALL 显示"权限不足"提示，而非显示通用错误页面
