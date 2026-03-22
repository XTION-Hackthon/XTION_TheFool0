# 架构集成层 Bugfix 设计文档

## Overview

本文档针对代码审查中发现的 7 个架构/集成层面 bug 设计修复方案。这些 bug 涵盖：房间写接口缺少角色权限校验（P0）、前端 botId 写死 'self'（P1）、切房只 join 不 leave（P1）、GameScene.loadRoom() 未被调用（P1）、服务重启清理不闭环（P1）、前端构建类型错误（P1）、AdminPanel/admin-keys 契约不一致（P2）。修复策略遵循最小变更原则，每个 bug 独立修复，互不干扰。

## Glossary

- **Bug_Condition (C)**: 触发 bug 的输入条件集合
- **Property (P)**: 在 bug 条件下的期望正确行为
- **Preservation**: 修复不应影响的现有行为
- **authMiddleware**: `server/src/middleware/auth.ts` 中验证 API Key 有效性并设置 `req.contestantId`、`req.role` 的中间件
- **requireRole**: `server/src/middleware/auth.ts` 中基于 `req.role` 进行角色权限检查的中间件工厂函数
- **roomsRouter**: `server/src/routes/rooms.ts` 中定义的房间 CRUD 和 join/leave 路由
- **addBotToRoom**: `server/src/modules/room-manager.ts` 中 RoomManager 的方法，将 bot 插入 room_bots 表
- **setupWebSocket**: `server/src/ws.ts` 中初始化 WebSocket 服务并执行启动清理的函数
- **GameScene.loadRoom**: `client/src/game/GameScene.ts` 中设置 currentRoomId 并标记房间脏位的方法
- **loadAndRenderWorld**: `client/src/game/GameScene.ts` 中获取房间/门洞数据并渲染世界的异步方法

## Bug Details

### Fault Condition

本次修复涉及 7 个独立的 fault condition，按优先级排列：

**Bug 1 (P0) — 房间写接口缺少 requireRole**

当任意角色（Agent_Player、Agent_Viewer、Human_Viewer）持有有效 API Key 调用 POST /api/rooms 或 DELETE /api/rooms/:id 时，系统仅通过 authMiddleware 验证 Key 有效性，不检查角色权限，允许非 Admin 用户创建/删除房间。同时 join/leave 接口直接信任请求体中的 botId，不验证是否属于当前用户。

**Formal Specification:**
```
FUNCTION isBugCondition_Bug1(input)
  INPUT: input of type { method, path, role, bodyBotId, reqContestantId }
  OUTPUT: boolean

  // 条件 A：非 Admin 调用写接口
  conditionA := (input.method = 'POST' AND input.path = '/api/rooms')
                OR (input.method = 'DELETE' AND input.path MATCHES '/api/rooms/:id')
                AND input.role != 'Admin'

  // 条件 B：join/leave 使用不属于自己的 botId
  conditionB := (input.path MATCHES '/api/rooms/:id/join' OR input.path MATCHES '/api/rooms/:id/leave')
                AND input.bodyBotId != input.reqContestantId

  RETURN conditionA OR conditionB
END FUNCTION
```

**Bug 2 (P1) — 前端 botId 写死 'self'**

当前端 RoomList 或 RoomManagementPanel 调用 join/leave 接口时，发送 `{ botId: 'self' }` 作为请求体，后端将字面值 'self' 存入 room_bots 表。

**Formal Specification:**
```
FUNCTION isBugCondition_Bug2(input)
  INPUT: input of type { source, botIdSent }
  OUTPUT: boolean

  RETURN input.source IN ['RoomList', 'RoomManagementPanel']
         AND input.botIdSent = 'self'
END FUNCTION
```

**Bug 3 (P1) — 切房只 join 不 leave**

当用户通过 RoomManagementPanel 的 onSwitchRoom 切换房间时，只调用新房间的 join，不调用旧房间的 leave。同时后端 addBotToRoom 只做同房去重，不清理其他房间的记录。

**Formal Specification:**
```
FUNCTION isBugCondition_Bug3(input)
  INPUT: input of type { action, currentRoomId, targetRoomId }
  OUTPUT: boolean

  RETURN input.action = 'switchRoom'
         AND input.currentRoomId IS NOT NULL
         AND input.currentRoomId != input.targetRoomId
END FUNCTION
```

**Bug 4 (P1) — GameScene.loadRoom() 没人调**

当 GameScene 完成 loadAndRenderWorld 后，不调用 loadRoom()，导致 currentRoomId 始终为 null，update() 提前返回。

**Formal Specification:**
```
FUNCTION isBugCondition_Bug4(input)
  INPUT: input of type { gameSceneState }
  OUTPUT: boolean

  RETURN input.gameSceneState.loadAndRenderWorldCompleted = true
         AND input.gameSceneState.currentRoomId = null
END FUNCTION
```

**Bug 5 (P1) — 服务重启清理不闭环**

当服务器重启时，setupWebSocket 只将 status='online' 的 contestants 标记为 offline，不处理 status='timeout' 的记录，也不清理 room_bots 表。

**Formal Specification:**
```
FUNCTION isBugCondition_Bug5(input)
  INPUT: input of type { serverEvent, dbState }
  OUTPUT: boolean

  RETURN input.serverEvent = 'restart'
         AND (input.dbState.hasTimeoutContestants = true
              OR input.dbState.hasOrphanRoomBots = true)
END FUNCTION
```

**Bug 6 (P1) — 前端构建失败**

当执行 `npx tsc --noEmit` 时，pathfinding-system.ts 中使用了未导入的 `Bot` 类型，`room.bounds` 可能为 undefined 但传给了要求 `Bounds` 的参数；room-graph-builder.ts 从不存在的 `../../types` 模块导入。

**Formal Specification:**
```
FUNCTION isBugCondition_Bug6(input)
  INPUT: input of type { file, errorCode }
  OUTPUT: boolean

  RETURN (input.file = 'pathfinding-system.ts' AND input.errorCode IN ['TS2304', 'TS2345'])
         OR (input.file = 'room-graph-builder.ts' AND input.errorCode = 'TS2307')
END FUNCTION
```

**Bug 7 (P2) — AdminPanel/admin-keys 契约不一致**

当 AdminPanel 的 KeysTab 调用 POST /api/admin/keys 时，前端发送 `{ contestantName: newName }`，后端期望 `{ name, role }`。且 UI 没有角色选择器。

**Formal Specification:**
```
FUNCTION isBugCondition_Bug7(input)
  INPUT: input of type { requestBody, expectedBody }
  OUTPUT: boolean

  RETURN input.requestBody HAS KEY 'contestantName'
         AND input.requestBody NOT HAS KEY 'name'
         AND input.requestBody NOT HAS KEY 'role'
END FUNCTION
```

### Examples

- Bug 1: Agent_Player 调用 `POST /api/rooms { name: "test", type: "MainHall" }` → 期望 403，实际 201
- Bug 1: 用户 A 调用 `POST /api/rooms/r1/join { botId: "user-B-id" }` → 期望拒绝或忽略 botId，实际将 user-B 加入房间
- Bug 2: RoomList 点击"加入" → 发送 `{ botId: 'self' }` → room_bots 表存入 bot_id='self'
- Bug 3: 用户在房间 A，点击切换到房间 B → 只调用 join B，不调用 leave A → bot 同时在 A 和 B
- Bug 4: GameScene 启动 → loadAndRenderWorld 完成 → currentRoomId 仍为 null → update() 空转
- Bug 5: heartbeat 标记 contestant 为 timeout → 服务器重启 → timeout 记录不被清理 → 僵尸状态
- Bug 6: `npx tsc --noEmit` → TS2304: Cannot find name 'Bot' in pathfinding-system.ts
- Bug 7: AdminPanel 点击"生成" → 发送 `{ contestantName: "test" }` → 后端返回 400

## Expected Behavior

### Preservation Requirements

**Unchanged Behaviors:**
- Admin 角色调用房间读接口（GET /api/rooms、GET /api/rooms/:id）正常返回数据
- Agent_Player 调用 join/leave 操控自己的 bot 正常执行并广播事件
- bot 加入已满房间时返回 ROOM_AT_CAPACITY 错误
- join 时提供 position 参数仍使用提供的位置
- GameScene 的 zoom/pan/resize 功能不受 loadRoom 修复影响
- 单个 contestant 正常断线通过 5 秒延迟 + markContestantOffline 正确清理
- heartbeat monitor 检测超时后正常关闭 WebSocket、更新状态、广播事件
- AdminPanel 其他 Tab（Zones、Skills、Docs、Heartbeat、Map、Monitor）正常工作
- Key 列表查询、吊销、重新生成接口正常工作
- pathfinding-system 的 findPath 和 findMultiRoomPath 运行时行为不变

**Scope:**
所有不涉及上述 7 个 bug 条件的输入应完全不受修复影响。

## Hypothesized Root Cause

### Bug 1: 房间写接口缺少 requireRole

**根因**: `app.ts` 中 roomsRouter 挂载为 `app.use('/api/rooms', authMiddleware, roomsRouter)`，只有 authMiddleware 没有 requireRole。所有路由（包括 POST / 和 DELETE /:id）对任何有效 Key 开放。join/leave 路由直接从 `req.body.botId` 取值，不使用 `req.contestantId`。

**代码位置**: `server/src/app.ts` 第 148 行，`server/src/routes/rooms.ts` join/leave 路由。

### Bug 2: 前端 botId 写死 'self'

**根因**: 前端组件 RoomList 和 RoomManagementPanel 通过 props 接收 `currentBotId`，但调用方传入的是硬编码的 `'self'` 字符串，而非从 world.state 的 self.id 获取的真实 contestantId。

**代码位置**: 调用 RoomList/RoomManagementPanel 的父组件中 `currentBotId` 的赋值处。

### Bug 3: 切房只 join 不 leave

**根因**: `onSwitchRoom` 回调只执行 join 新房间的 API 调用，缺少 leave 旧房间的调用。后端 `addBotToRoom` 只检查 `WHERE room_id = ? AND bot_id = ?`（同房去重），不清理该 bot 在其他房间的记录。

**代码位置**: `server/src/modules/room-manager.ts` addBotToRoom 方法第 256-260 行。

### Bug 4: GameScene.loadRoom() 没人调

**根因**: `loadAndRenderWorld` 方法获取房间列表并渲染世界后，没有调用 `loadRoom()` 设置 `currentRoomId`。`update()` 方法在 `!this.currentRoomId` 时提前返回，导致房间内容永远不渲染。

**代码位置**: `client/src/game/GameScene.ts` loadAndRenderWorld 方法末尾。

### Bug 5: 服务重启清理不闭环

**根因**: `setupWebSocket` 启动清理 SQL 为 `UPDATE contestants SET status = 'offline' WHERE status = 'online'`，只处理 online 状态，遗漏 timeout 状态。且没有清理 room_bots 表中的残留记录。

**代码位置**: `server/src/ws.ts` setupWebSocket 函数第 408-413 行。

### Bug 6: 前端构建失败

**根因**:
1. `pathfinding-system.ts` 使用 `Bot` 类型但未导入（grid-pathfinder.ts 从 `../../stores` 导入了 Bot，但 pathfinding-system.ts 没有）
2. `pathfinding-system.ts` 将 `room.bounds`（类型为 `{ x1; y1; x2; y2 } | undefined`）直接传给 `gridPathfinder.findPath` 的 `bounds: Bounds` 参数
3. `room-graph-builder.ts` 从 `../../types` 导入 Room 和 Doorway，但 `client/src/types` 模块不存在，应从 `../../stores` 导入

### Bug 7: AdminPanel/admin-keys 契约不一致

**根因**: KeysTab 的 `generate` 函数发送 `{ contestantName: newName }`，但后端 `POST /api/admin/keys` 期望 `{ name, role }`。字段名 `contestantName` vs `name` 不匹配，且缺少必需的 `role` 字段。UI 中没有角色选择器组件。

**代码位置**: `client/src/components/AdminPanel.tsx` KeysTab 函数第 68 行。

## Correctness Properties

Property 1: Fault Condition — 房间写接口权限控制

_For any_ HTTP 请求，当非 Admin 角色调用 POST /api/rooms 或 DELETE /api/rooms/:id 时，修复后的系统 SHALL 返回 403 Forbidden；当调用 join/leave 时，系统 SHALL 使用 req.contestantId 作为 botId，忽略请求体中的 botId。

**Validates: Requirements 2.1, 2.2**

Property 2: Preservation — 已有房间读接口和合法写操作

_For any_ 请求，当 Admin 角色调用房间写接口、或任意角色调用房间读接口时，修复后的系统 SHALL 产生与原系统相同的结果，保持所有现有功能不变。

**Validates: Requirements 3.1, 3.2, 3.3, 3.4**

Property 3: Fault Condition — 前端发送真实 contestantId

_For any_ 前端 join/leave 操作，修复后的系统 SHALL 发送当前用户的真实 contestantId（从 world.state 获取），而非硬编码的 'self'。

**Validates: Requirements 2.3**

Property 4: Fault Condition — 切房先 leave 后 join 且全局去重

_For any_ 房间切换操作，修复后的系统 SHALL 先调用旧房间的 leave 接口，再调用新房间的 join 接口；后端 addBotToRoom SHALL 在插入前清理该 bot 在其他房间的记录。

**Validates: Requirements 2.4, 2.5**

Property 5: Fault Condition — loadAndRenderWorld 后自动 loadRoom

_For any_ GameScene 启动流程，当 loadAndRenderWorld 成功获取房间列表后，系统 SHALL 自动调用 loadRoom() 加载第一个可用房间，使 currentRoomId 被正确设置。

**Validates: Requirements 2.6**

Property 6: Fault Condition — 服务重启完整清理

_For any_ 服务器重启事件，setupWebSocket SHALL 同时将 status='online' 和 status='timeout' 的 contestants 标记为 offline，并清空 room_bots 表中所有残留记录。

**Validates: Requirements 2.7**

Property 7: Preservation — 单 contestant 断线清理不受影响

_For any_ 单个 contestant 的正常断线事件，修复后的 markContestantOffline 和 5 秒延迟清理逻辑 SHALL 产生与原系统相同的行为。

**Validates: Requirements 3.6, 3.7**

Property 8: Fault Condition — 前端构建通过

_For any_ TypeScript 编译检查，修复后的 pathfinding-system.ts 和 room-graph-builder.ts SHALL 通过 `npx tsc --noEmit` 无错误，且运行时行为不变。

**Validates: Requirements 2.8**

Property 9: Fault Condition — AdminPanel Key 创建契约一致

_For any_ AdminPanel KeysTab 的 Key 创建操作，修复后的前端 SHALL 发送 `{ name, role }` 格式的请求体，并提供角色选择器 UI。

**Validates: Requirements 2.9, 2.10**

Property 10: Preservation — AdminPanel 其他功能和 Key 管理接口

_For any_ AdminPanel 其他 Tab 的操作，以及 Key 列表查询、吊销、重新生成操作，修复后的系统 SHALL 产生与原系统相同的行为。

**Validates: Requirements 3.8, 3.9, 3.10**

## Fix Implementation

### Changes Required


#### Bug 1: 房间写接口权限控制

**File**: `server/src/app.ts`

**Changes**:
1. 将 roomsRouter 的挂载拆分为两组：
   - 管理路由（POST /、PUT /:id、DELETE /:id）加 `requireRole('Admin')`
   - 读取路由（GET /、GET /:id）和成员路由（POST /:id/join、POST /:id/leave）保持 authMiddleware

**File**: `server/src/routes/rooms.ts`

**Changes**:
1. 将路由拆分为两个 Router：`roomsAdminRouter`（创建/更新/删除）和 `roomsMemberRouter`（读取/join/leave）
2. join 路由：使用 `req.contestantId` 替代 `req.body.botId`，忽略请求体中的 botId
3. leave 路由：同样使用 `req.contestantId` 替代 `req.body.botId`

#### Bug 2: 前端 botId 写死 'self'

**File**: 调用 RoomList/RoomManagementPanel 的父组件（需确认具体文件）

**Changes**:
1. 从 `useGameStore` 或 world.state 的 self 信息中获取真实 contestantId
2. 将真实 contestantId 传递给 RoomList 和 RoomManagementPanel 的 `currentBotId` prop

**注意**: 由于 Bug 1 修复后 join/leave 使用 req.contestantId，前端实际上不再需要发送 botId。但仍需修正 currentBotId prop 以确保 UI 中"你"的标识正确显示。

#### Bug 3: 切房先 leave 后 join + 全局去重

**File**: 调用 onSwitchRoom 的父组件

**Changes**:
1. onSwitchRoom 回调中，先调用 `POST /api/rooms/{currentRoomId}/leave`，再调用 `POST /api/rooms/{targetRoomId}/join`

**File**: `server/src/modules/room-manager.ts`

**Function**: `addBotToRoom`

**Changes**:
1. 在插入新 room_bots 记录前，先执行 `DELETE FROM room_bots WHERE bot_id = ? AND room_id != ?` 清理该 bot 在其他房间的记录
2. 这作为防御性措施，即使前端正确执行了 leave，后端也保证全局唯一

#### Bug 4: loadAndRenderWorld 后自动 loadRoom

**File**: `client/src/game/GameScene.ts`

**Function**: `loadAndRenderWorld`

**Changes**:
1. 在 loadAndRenderWorld 方法末尾（渲染完成后），从 roomStore 获取当前房间 ID 或第一个可用房间
2. 调用 `this.loadRoom(roomId)` 设置 currentRoomId

具体实现：
```typescript
// 在 loadAndRenderWorld 的 try 块末尾添加
const currentRoomId = useRoomStore.getState().currentRoomId;
const firstRoomId = currentRoomId ?? allRooms[0]?.id;
if (firstRoomId) {
  this.loadRoom(firstRoomId);
}
```

#### Bug 5: 服务重启完整清理

**File**: `server/src/ws.ts`

**Function**: `setupWebSocket`

**Changes**:
1. 将启动清理 SQL 从 `WHERE status = 'online'` 改为 `WHERE status IN ('online', 'timeout')`
2. 添加 `DELETE FROM room_bots` 清空所有残留的房间成员记录

具体实现：
```typescript
// 替换现有清理逻辑
const staleCount = db.prepare(`
  UPDATE contestants SET status = 'offline', disconnected_at = ?
  WHERE status IN ('online', 'timeout')
`).run(Date.now()).changes;

const roomBotsCount = db.prepare('DELETE FROM room_bots').run().changes;
```

#### Bug 6: 前端构建类型错误修复

**File**: `client/src/game/pathfinding-system.ts`

**Changes**:
1. 添加 `import type { Bot } from '../stores/roomStore'` 导入 Bot 类型
2. 将 `room.bounds` 传递给 gridPathfinder.findPath 时添加 undefined 检查，当 bounds 为 undefined 时使用默认值或提前返回

具体实现：
```typescript
// findPath 方法中
const bounds = room.bounds;
if (!bounds) return [start];

return this.gridPathfinder.findPath(start, goal, walls, doorwaysArray, bots, botId, bounds);
```

**File**: `client/src/game/pathfinding/room-graph-builder.ts`

**Changes**:
1. 将 `import type { Room, Doorway } from '../../types'` 改为 `import type { Room, Doorway } from '../../stores'`

#### Bug 7: AdminPanel Key 创建契约修正

**File**: `client/src/components/AdminPanel.tsx`

**Function**: `KeysTab`

**Changes**:
1. 添加 `role` 状态变量，默认值为 `'Agent_Player'`
2. 将 `apiClient.post('/api/admin/keys', { contestantName: newName })` 改为 `apiClient.post('/api/admin/keys', { name: newName, role })`
3. 在 UI 中添加角色选择器（`<select>`），包含 Admin、Agent_Player、Agent_Viewer、Human_Viewer 四个选项

## Testing Strategy

### Validation Approach

测试策略分两阶段：首先在未修复代码上运行探索性测试以确认 bug 存在，然后在修复后验证正确性和行为保持。

### Exploratory Fault Condition Checking

**Goal**: 在实施修复前，通过测试确认 bug 的存在并验证根因分析。

**Test Plan**: 编写针对每个 bug 的测试用例，在未修复代码上运行以观察失败模式。

**Test Cases**:
1. **权限测试**: 使用 Agent_Player Key 调用 POST /api/rooms，期望 201（bug 存在时）
2. **botId 测试**: 检查 join 请求体中 botId 是否为 'self'（bug 存在时为 true）
3. **切房测试**: 执行 switchRoom 后检查 room_bots 表，bot 应同时在两个房间（bug 存在时）
4. **loadRoom 测试**: GameScene 启动后检查 currentRoomId 是否为 null（bug 存在时为 null）
5. **重启清理测试**: 插入 timeout 状态记录后执行 setupWebSocket，检查是否被清理（bug 存在时不清理）
6. **类型检查测试**: 执行 tsc --noEmit，期望报错（bug 存在时）
7. **Key 创建测试**: 检查 KeysTab 发送的请求体格式（bug 存在时为 { contestantName }）

**Expected Counterexamples**:
- Agent_Player 成功创建房间（应被 403 拒绝）
- room_bots 表中出现 bot_id='self' 的记录
- bot 同时存在于多个房间的 room_bots 记录中
- timeout 状态的 contestants 在重启后仍为 timeout

### Fix Checking

**Goal**: 验证所有 bug 条件下，修复后的函数产生期望行为。

**Pseudocode:**
```
FOR ALL input WHERE isBugCondition(input) DO
  result := fixedFunction(input)
  ASSERT expectedBehavior(result)
END FOR
```

**具体验证**:
- Bug 1: 非 Admin 调用写接口 → 403；join/leave 使用 req.contestantId
- Bug 2: 前端发送真实 contestantId
- Bug 3: switchRoom 先 leave 后 join；addBotToRoom 清理其他房间记录
- Bug 4: loadAndRenderWorld 后 currentRoomId 不为 null
- Bug 5: 重启后 online 和 timeout 都变 offline，room_bots 被清空
- Bug 6: tsc --noEmit 通过
- Bug 7: KeysTab 发送 { name, role }

### Preservation Checking

**Goal**: 验证所有非 bug 条件下，修复后的函数与原函数行为一致。

**Pseudocode:**
```
FOR ALL input WHERE NOT isBugCondition(input) DO
  ASSERT originalFunction(input) = fixedFunction(input)
END FOR
```

**Testing Approach**: 属性基测试（PBT）适合保持性检查，因为它能自动生成大量测试用例覆盖输入域，捕获手动测试可能遗漏的边界情况。

**Test Plan**: 先在未修复代码上观察非 bug 输入的行为，然后编写 PBT 测试确保修复后行为不变。

**Test Cases**:
1. **Admin 写操作保持**: Admin 调用 POST /api/rooms 仍返回 201
2. **读接口保持**: GET /api/rooms 和 GET /api/rooms/:id 返回结果不变
3. **满员检查保持**: 房间满员时 join 仍返回 ROOM_AT_CAPACITY
4. **position 参数保持**: join 时提供 position 仍使用提供的位置
5. **断线清理保持**: 单 contestant 断线的 5 秒延迟清理逻辑不变
6. **寻路行为保持**: findPath 和 findMultiRoomPath 运行时结果不变
7. **其他 Tab 保持**: AdminPanel 其他 Tab 功能不受影响
8. **Key 管理保持**: GET/DELETE/POST regenerate 接口行为不变

### Unit Tests

- 测试 requireRole('Admin') 对 POST /api/rooms 和 DELETE /api/rooms/:id 的拦截
- 测试 join/leave 路由使用 req.contestantId 而非 req.body.botId
- 测试 addBotToRoom 的全局去重逻辑（插入前清理其他房间记录）
- 测试 setupWebSocket 清理 online 和 timeout 状态的 contestants
- 测试 setupWebSocket 清理 room_bots 表
- 测试 loadAndRenderWorld 完成后 currentRoomId 不为 null
- 测试 KeysTab 发送正确的请求体格式

### Property-Based Tests

- 生成随机角色和路由组合，验证权限控制的正确性
- 生成随机房间切换序列，验证 bot 在任意时刻只属于一个房间
- 生成随机 contestant 状态组合（online/timeout/offline），验证重启清理的完整性
- 生成随机房间配置和 bounds，验证寻路类型修复不改变运行时行为

### Integration Tests

- 完整流程：Admin 创建房间 → Agent_Player join → 切换房间 → leave → 验证 room_bots 一致性
- 完整流程：服务启动 → 清理残留 → WebSocket 连接 → 认证 → 加入房间 → 渲染
- 完整流程：AdminPanel 生成 Key（含角色选择）→ 验证 Key 可用 → 吊销 → 验证失效
- GameScene 启动流程：create → loadAndRenderWorld → loadRoom → update 正常渲染
