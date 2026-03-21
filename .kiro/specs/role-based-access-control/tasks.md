# 实现计划：基于角色的访问控制（RBAC）

## 概述

在现有 Bearer Token 认证体系之上叠加 RBAC 层。核心步骤：数据库迁移 → 类型扩展 → AuthManager 扩展 → 中间件扩展 → 路由配置 → WebSocket 角色验证 → 前端适配。

## 任务

- [x] 1. 数据库迁移：keys 表新增 role 字段
  - 在 `server/src/db.ts` 的 `initializeDatabase()` 中添加 `migrateAddRoleColumn()` 函数
  - 使用幂等的 `ALTER TABLE keys ADD COLUMN role TEXT NOT NULL DEFAULT 'Agent_Player'` 语句
  - 在 `initializeDatabase()` 末尾调用该迁移函数，确保服务启动时自动执行
  - 更新 `CREATE TABLE IF NOT EXISTS keys` 建表语句，加入 `role TEXT NOT NULL DEFAULT 'Agent_Player'` 字段
  - _需求：1.2, 1.3, 1.8_

- [x] 2. 类型定义扩展
  - [x] 2.1 在 `server/src/types/index.ts` 中新增 `Role` 类型和扩展 `Key` 接口
    - 导出 `Role` 类型：`'Admin' | 'Agent_Player' | 'Human_Viewer' | 'Agent_Viewer'`
    - 在 `Key` 接口中新增 `role: Role` 字段
    - 在 `IAuthManager` 接口中更新 `generateKey` 签名（新增 `role: Role` 参数）
    - 在 `IAuthManager` 接口中更新 `validateKey` 返回类型（新增 `role?: Role` 字段）
    - 在 `IAuthManager` 接口中新增 `updateKeyRole(keyId: string, role: Role): Promise<Key>` 方法
    - _需求：1.1, 1.4_

  - [x] 2.2 为类型定义编写属性测试（Property 1 的类型层验证）
    - **Property 1：角色持久化 Round-Trip**
    - **Validates: Requirements 1.1, 1.3, 1.5**

- [x] 3. AuthManager 扩展
  - [x] 3.1 修改 `server/src/modules/auth-manager.ts` 中的 `generateKey()` 方法
    - 新增 `role: Role` 参数（必填）
    - 在 SQL INSERT 语句中写入 `role` 字段
    - 在返回的 `Key` 对象中包含 `role` 字段
    - 若 `role` 不在有效枚举范围内，抛出 400 错误（错误码 `INVALID_ROLE`）
    - 若未提供 `role`，抛出 400 错误（错误码 `MISSING_ROLE_FIELD`）
    - _需求：1.2, 1.3, 1.7_

  - [x] 3.2 修改 `validateKey()` 方法，返回值新增 `role` 字段
    - 在 SQL SELECT 语句中查询 `role` 字段
    - 在返回对象中包含 `role?: Role`
    - 若数据库中 `role` 为 `NULL`，回退为 `'Agent_Player'`
    - _需求：1.5_

  - [x] 3.3 新增 `updateKeyRole()` 方法
    - 接收 `keyId: string` 和 `role: Role` 参数
    - 执行 `UPDATE keys SET role = ? WHERE id = ?`
    - 验证 `role` 值有效性，无效时抛出 400 错误（错误码 `INVALID_ROLE`）
    - 返回更新后的完整 `Key` 对象
    - _需求：1.4_

  - [x] 3.4 修改 `revokeKey()` 方法，新增最后一个 Admin Key 保护逻辑
    - 在执行吊销前，查询当前 `active` 状态的 `Admin` 角色 Key 数量
    - 若数量为 1 且目标 Key 正是该 Admin Key，抛出 403 错误（错误码 `LAST_ADMIN_KEY`，消息"不能吊销最后一个管理员密钥"）
    - _需求：2.5_

  - [x] 3.5 在 `server/src/tests/property/rbac.property.test.ts` 中编写 AuthManager 属性测试
    - **Property 1：角色持久化 Round-Trip** — `generateKey` 后 `validateKey` 返回相同 role
    - **Property 2：角色变更 Round-Trip** — `updateKeyRole` 后 `validateKey` 返回新 role
    - **Property 6：最后一个 Admin Key 保护** — 仅剩一个 Admin Key 时 `revokeKey` 返回 403
    - **Validates: Requirements 1.1, 1.3, 1.4, 1.5, 2.5**

- [x] 4. authMiddleware 扩展：设置 req.role 和 req.keyId
  - 在 `server/src/middleware/auth.ts` 中扩展 Express.Request 全局声明，新增 `keyId?: string` 和 `role?: Role`
  - 修改 `authMiddleware`：调用 `authManager.validateKey()` 后，将返回的 `keyId` 和 `role` 赋值到 `req.keyId` 和 `req.role`
  - 若 `role` 为 `NULL`（历史数据），回退为 `'Agent_Player'`
  - _需求：1.5, 6.1, 6.5_

- [x] 5. 实现 requireRole() 中间件工厂
  - 在 `server/src/middleware/auth.ts` 中新增 `requireRole(...roles: Role[]): RequestHandler` 函数
  - 若 `req.role` 不存在，调用 `next(httpError(403, 'MISSING_ROLE', '请求上下文缺少角色信息'))`
  - 若 `req.role` 不在 `roles` 列表中，调用 `next(httpError(403, 'FORBIDDEN_ROLE', ...))`
  - 否则调用 `next()`
  - 确保错误响应格式为 `{ "error": { "code": "...", "message": "..." } }`
  - _需求：6.2, 6.3, 6.4, 6.7_

  - [x] 5.1 在 `server/src/tests/property/rbac.property.test.ts` 中编写 requireRole 属性测试
    - **Property 4：requireRole 拒绝非授权角色** — 任意不在允许列表中的角色均返回 403 FORBIDDEN_ROLE
    - **Property 5：Admin 角色通过所有权限检查** — 含 Admin 的允许列表对 Admin 角色不返回 403
    - **Validates: Requirements 3.4, 3.5, 4.3, 4.4, 5.3, 5.4, 5.5, 6.2, 6.4, 2.1, 2.4**

- [x] 6. 新建 GET /api/auth/me 端点
  - 新建 `server/src/routes/auth.ts` 文件
  - 实现 `GET /me` 路由：使用 `authMiddleware`（不加 `requireRole`，所有已认证角色均可访问）
  - 返回 `{ keyId: req.keyId, role: req.role, contestantId: req.contestantId }`
  - 在 `server/src/index.ts`（或主路由文件）中挂载 `app.use('/api/auth', authRouter)`
  - _需求：7.1_

  - [x] 6.1 在 `server/src/tests/property/rbac.property.test.ts` 中编写 /api/auth/me 属性测试
    - **Property 8：/api/auth/me 返回正确角色** — 任意有效 Key 调用该端点，返回的 role 与数据库一致
    - **Validates: Requirements 7.1**

- [x] 7. 检查点 — 确保所有测试通过
  - 确保所有测试通过，如有问题请向用户提问。

- [x] 8. 各路由添加 requireRole 配置
  - [x] 8.1 在 `server/src/routes/move.ts` 中为 `POST /api/move` 添加 `requireRole('Admin', 'Agent_Player')`
    - _需求：2.3, 3.1_

  - [x] 8.2 在 `server/src/routes/heartbeat.ts` 中为 `POST /api/heartbeat` 添加 `requireRole('Admin', 'Agent_Player')`
    - _需求：2.3, 3.1_

  - [x] 8.3 在 `server/src/routes/interaction.ts` 中为 `POST /api/interaction/barrage` 和 `POST /api/interaction/vote` 添加 `requireRole('Admin', 'Human_Viewer')`
    - _需求：4.1_

  - [x] 8.4 在 `server/src/routes/status.ts` 中为 `GET /api/status` 添加 `requireRole('Admin', 'Agent_Player')`
    - _需求：3.2, 4.5, 5.5_

  - [x] 8.5 在 `server/src/routes/docs.ts` 中为 `GET /api/docs/:name` 添加 `requireRole('Admin', 'Agent_Player', 'Agent_Viewer')`
    - _需求：3.2, 5.1_

  - [x] 8.6 在 `server/src/routes/skills.ts` 中为 `GET /api/skills` 添加 `requireRole('Admin', 'Agent_Player', 'Agent_Viewer')`
    - _需求：3.2, 5.1_

  - [x] 8.7 在主路由文件中为所有 `/api/admin/*` 路由统一添加 `requireRole('Admin')`（在路由注册处配置，无需修改各 admin 路由文件）
    - _需求：2.1, 3.4, 4.4, 5.4, 6.6_

  - [x] 8.8 为只读公共端点（`GET /api/contestants`、`GET /api/zones`、`GET /api/world`、`GET /api/audience-feedback`）添加 `requireRole('Admin', 'Agent_Player', 'Human_Viewer', 'Agent_Viewer')`
    - _需求：3.2, 4.2, 5.1_

- [x] 9. admin-keys 路由更新
  - [x] 9.1 修改 `server/src/routes/admin-keys.ts` 中的 `POST /api/admin/keys` 处理器
    - 从请求体中读取 `role` 字段（必填）
    - 若缺少 `role`，返回 400（错误码 `MISSING_ROLE_FIELD`）
    - 将 `role` 传入 `authManager.generateKey(name, role)`
    - _需求：1.2, 1.3, 1.7, 1.9_

  - [x] 9.2 在 `server/src/routes/admin-keys.ts` 中新增 `PATCH /api/admin/keys/:id/role` 端点
    - 从请求体中读取 `role` 字段
    - 调用 `authManager.updateKeyRole(id, role)`
    - 返回更新后的 Key 对象
    - _需求：1.4_

  - [x] 9.3 确认 `GET /api/admin/keys` 响应中每个 Key 对象包含 `role` 字段
    - 检查 `listKeys()` 的 SQL 查询是否已包含 `role` 字段，必要时更新
    - _需求：1.6_

- [x] 10. WebSocket 角色验证
  - [x] 10.1 修改 `server/src/ws.ts` 中的 `handleAuth()` 函数
    - `validateKey()` 返回 `role` 后，将 `role` 存入连接上下文（`client.role`）
    - 若 `role === 'Human_Viewer'`，发送 `{ type: 'error', code: 'AUTH_ROLE_NOT_ALLOWED' }` 后关闭连接
    - 若 `role === 'Agent_Viewer'`，允许连接并推送 `world.state`，但标记为只读会话
    - _需求：5.2_

  - [x] 10.2 修改 `server/src/ws.ts` 中的 `handleMessage()` 函数
    - 对 `client.role === 'Agent_Viewer'` 的连接，拦截游戏指令类型消息（`move`、`talk`、`broadcast`、`heartbeat`）
    - 返回错误事件，不执行对应游戏逻辑
    - _需求：5.2_

  - [x] 10.3 在 `server/src/tests/property/rbac.property.test.ts` 中编写 WebSocket 角色验证属性测试
    - **Property 7：Agent_Viewer WebSocket 游戏指令拒绝** — 任意游戏指令类型消息均被拒绝
    - **Validates: Requirements 5.2**

- [x] 11. 检查点 — 确保所有测试通过
  - 确保所有测试通过，如有问题请向用户提问。

- [~] 12. 前端 roleStore
  - 新建 `client/src/stores/roleStore.ts`
  - 定义 `RoleState` 接口：`role: Role | null`、`keyId: string | null`、`contestantId: string | null`、`loading: boolean`、`fetchRole: () => Promise<void>`
  - 实现 `fetchRole()`：调用 `apiClient.get('/api/auth/me')`，成功后更新 store 状态
  - 在 `client/src/stores/index.ts` 中导出 `useRoleStore`
  - _需求：7.1_

- [x] 13. 前端条件渲染
  - [x] 13.1 修改 `client/src/App.tsx`
    - WebSocket 连接成功后调用 `useRoleStore.fetchRole()`
    - 根据 `role` 条件渲染：`Admin` 显示 `<AdminPanel />`，`Human_Viewer` 显示弹幕/投票组件，`Agent_Viewer` 显示只读视图
    - _需求：7.2, 7.3, 7.4, 7.5_

  - [x] 13.2 修改 `client/src/components/UIOverlay.tsx`
    - 接收 `role` prop 或从 `useRoleStore` 读取角色
    - 根据角色隐藏/显示对应 UI 组件（管理员控制面板、弹幕输入框、投票按钮等）
    - _需求：7.2, 7.3, 7.4, 7.5_

- [~] 14. 前端 403 错误处理
  - 修改 `client/src/services/api-client.ts` 中的 `handleResponse()` 函数
  - 当响应状态码为 403 时，通过 `uiStore.addNotification()` 显示"权限不足"提示
  - 不抛出未处理异常，保持 UI 稳定
  - _需求：7.6_

- [x] 15. 最终检查点 — 确保所有测试通过
  - 确保所有测试通过，如有问题请向用户提问。

## 备注

- 标有 `*` 的子任务为可选测试任务，可跳过以加快 MVP 进度
- 每个任务均引用具体需求条款，确保可追溯性
- 属性测试文件统一放在 `server/src/tests/property/rbac.property.test.ts`
- 检查点确保每个阶段的增量验证
- 数据库迁移使用幂等操作，服务重启安全
