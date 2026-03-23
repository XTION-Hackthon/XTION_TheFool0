# 核心运行时业务逻辑修复 Bugfix Design

## Overview

本设计文档针对 4 个通过动态真实服务测试发现的高危运行时核心业务逻辑问题，提供系统化的修复方案。这些问题直接破坏了系统的核心功能：

1. **Bug 1: 移动主链路断裂** - 客户端验证通过后不调用 `/api/move`，导致服务端状态完全不同步
2. **Bug 2: 身份归属可被冒用** - 认证层允许未建立 contestant 的 key 冒用其他玩家的身份标识
3. **Bug 3: 观战主链路只拿首帧** - Agent_Viewer 只收到初始 `world.state`，不接收后续世界变化事件
4. **Bug 4: Bot 显示依赖 WebSocket 认证** - REST join 不创建 contestant，导致 Bot 不显示

修复策略采用最小化侵入原则，针对每个 bug 的根本原因进行精确修复，同时确保不影响现有正常功能。

## Glossary

- **Bug_Condition (C)**: 触发 bug 的条件集合
- **Property (P)**: bug 修复后应满足的正确行为属性
- **Preservation**: 修复过程中必须保持不变的现有行为
- **handleBotMovement**: `client/src/game/GameScene.ts` 中的客户端移动处理函数
- **validate-move**: `/api/collision/validate-move` 服务端碰撞验证接口
- **move API**: `/api/move` 服务端移动同步接口
- **authMiddleware**: `server/src/middleware/auth.ts` 中的认证中间件
- **contestant**: 数据库中的玩家实体记录，关联到 `keys.id`
- **Agent_Viewer**: 观察者角色，只读权限，不能发送游戏指令
- **WebSocket 认证**: 通过 `auth` 消息类型完成的 WebSocket 连接认证流程
- **room_bots**: 数据库表，记录房间中的 bot 成员关系


## Bug Details

### Bug 1: 移动主链路断裂，服务端状态不同步

#### Fault Condition

客户端在收到 `POST /api/collision/validate-move` 的 `{"valid":true}` 响应后，只更新本地 `roomStore` 状态，不调用 `/api/move` 接口同步服务端状态。这导致服务端的 `contestants` 表中的 `position_x` 和 `position_y` 字段保持旧值，其他玩家通过 `/api/status/:id` 查询时获取到过时的位置信息。

**Formal Specification:**
```
FUNCTION isBugCondition_Bug1(input)
  INPUT: input of type { validateMoveResponse: { valid: boolean }, moveAPICalled: boolean }
  OUTPUT: boolean
  
  RETURN input.validateMoveResponse.valid == true
         AND input.moveAPICalled == false
END FUNCTION
```

#### Examples

- **场景 1**: 玩家 A 从 (100, 100) 移动到 (150, 150)，客户端调用 `validate-move` 返回 `{"valid":true}`，客户端本地更新位置为 (150, 150)，但不调用 `/api/move`。玩家 B 查询玩家 A 的状态，服务端返回位置仍为 (100, 100)。
- **场景 2**: 玩家 A 连续移动 5 次，每次都只验证不同步，服务端位置始终停留在初始位置，而客户端显示已移动到最终位置。
- **场景 3**: 玩家 A 移动后断开连接，重新连接时服务端推送的初始位置是旧位置，导致玩家 A 被"拉回"到移动前的位置。

### Bug 2: 核心身份归属可在运行时被冒用

#### Fault Condition

认证中间件 `authMiddleware` 在验证 key 时，如果 key 有效但尚未建立 `contestants` 记录（`validateKey` 返回 `contestantId: null`），则允许请求通过。此时，恶意客户端可以在请求 body 中指定其他玩家的 `senderId` 或 `contestant_id`，从而冒用其他玩家的身份修改服务端状态。

**Formal Specification:**
```
FUNCTION isBugCondition_Bug2(input)
  INPUT: input of type { keyValid: boolean, contestantExists: boolean, bodyContestantId: string, authenticatedContestantId: string | null }
  OUTPUT: boolean
  
  RETURN input.keyValid == true
         AND input.contestantExists == false
         AND input.bodyContestantId != null
         AND input.bodyContestantId != input.authenticatedContestantId
END FUNCTION
```

#### Examples

- **场景 1**: 攻击者使用新 Agent_Player key（尚未建立 contestant），发送 `POST /api/move` 请求，body 中指定 `senderId: "victim-contestant-id"`，服务端接受请求并修改受害者的位置。
- **场景 2**: 攻击者使用新 key 发送 `POST /api/broadcast` 请求，body 中指定其他玩家的 `senderId`，冒充该玩家发送广播消息。
- **场景 3**: 攻击者使用新 key 加入房间，body 中指定其他玩家的 `contestant_id`，导致房间记录中出现错误的成员关系。


### Bug 3: 观战主链路只拿首帧，不拿后续世界变化

#### Fault Condition

WebSocket 服务器在处理 Agent_Viewer 的 `auth` 消息时，只发送初始 `world.state` 事件，不将该连接注册到 `connections` Map 中。后续的世界变化事件（如 `contestant.join`、`contestant.leave`、`room.bot_position` 等）通过 `broadcast()` 函数发送，但由于 Agent_Viewer 的连接未注册，这些事件不会被发送给观察者。

**Formal Specification:**
```
FUNCTION isBugCondition_Bug3(input)
  INPUT: input of type { role: Role, worldStateReceived: boolean, connectionRegistered: boolean, subsequentEventsReceived: boolean }
  OUTPUT: boolean
  
  RETURN input.role == 'Agent_Viewer'
         AND input.worldStateReceived == true
         AND input.connectionRegistered == false
         AND input.subsequentEventsReceived == false
END FUNCTION
```

#### Examples

- **场景 1**: Agent_Viewer 连接并认证成功，收到初始 `world.state` 包含 3 个在线玩家。随后玩家 A 移动到新位置，Agent_Viewer 不收到 `room.bot_position` 事件，观战视图中玩家 A 位置保持不变。
- **场景 2**: Agent_Viewer 连接后，新玩家 B 加入游戏，服务端广播 `contestant.join` 事件，但 Agent_Viewer 不收到该事件，观战视图中不显示玩家 B。
- **场景 3**: Agent_Viewer 连接后，玩家 C 离开游戏，服务端广播 `contestant.leave` 事件，但 Agent_Viewer 不收到该事件，观战视图中玩家 C 仍然显示为在线。

### Bug 4: Bot 显示依赖 WebSocket 认证，REST join 不创建 contestant

#### Fault Condition

客户端通过 REST API `POST /api/rooms/:id/join` 加入房间时，服务端使用 `req.contestantId`（由 `authMiddleware` 设置）作为 `botId` 写入 `room_bots` 表。但如果该 key 尚未完成 WebSocket 认证，`contestants` 表中不存在对应记录，导致 `req.contestantId` 实际上是 `keys.id` 而非真实的 `contestant.id`。渲染器只渲染 `gameStore.contestants` 中的记录，因此通过 REST join 但未完成 WS 认证的玩家不显示在场景中。

**Formal Specification:**
```
FUNCTION isBugCondition_Bug4(input)
  INPUT: input of type { joinMethod: 'REST' | 'WebSocket', contestantExists: boolean, roomBotsRecordCreated: boolean, botRendered: boolean }
  OUTPUT: boolean
  
  RETURN input.joinMethod == 'REST'
         AND input.contestantExists == false
         AND input.roomBotsRecordCreated == true
         AND input.botRendered == false
END FUNCTION
```

#### Examples

- **场景 1**: Agent_Player 使用有效 key 调用 `POST /api/rooms/room-1/join`，服务端将 `keys.id` 写入 `room_bots` 表，但 `contestants` 表中无记录。客户端渲染器查询 `gameStore.contestants` 为空，房间中不显示该 Bot。
- **场景 2**: Agent_Player 先通过 REST join 房间，然后建立 WebSocket 连接并认证，此时 `contestants` 记录被创建，但 `room_bots` 表中的 `bot_id` 仍是 `keys.id`，导致数据不一致。
- **场景 3**: 多个 Agent_Player 通过 REST join 同一房间，服务端 `room_bots` 表中有多条记录，但客户端渲染器只显示已完成 WebSocket 认证的玩家，其他玩家"隐身"。


## Expected Behavior

### Preservation Requirements

**Unchanged Behaviors:**

**Bug 1 相关:**
- 当 `validate-move` 返回 `{"valid":false}` 时，客户端必须继续拒绝该移动，不更新本地或服务端状态
- 移动操作因其他原因失败（如网络错误、服务器错误）时，必须保持原有的错误处理逻辑
- 服务端 `/api/move` 接口的碰撞检测、跨房间验证、广播逻辑必须保持不变

**Bug 2 相关:**
- 使用有效 Agent_Player key 且 contestant 已建立的合法请求，必须继续正常处理
- 认证层对已建立 contestant 的请求的处理逻辑必须保持不变
- Admin 角色的权限和行为必须保持不变

**Bug 3 相关:**
- Agent_Player 建立 WebSocket 连接时，必须继续发送初始 `world.state` 并注册连接以接收后续事件
- 世界状态变化时，必须继续将事件广播给所有已连接的 Agent_Player
- Agent_Viewer 不能发送游戏指令（move、talk、broadcast、heartbeat）的限制必须保持不变

**Bug 4 相关:**
- 客户端通过 WebSocket 认证并完成世界同步时，必须继续创建或更新 `contestants` 记录并正常显示 Bot
- 渲染器显示已通过 WebSocket 认证的玩家时，必须继续正常渲染这些玩家的 sprite
- 房间容量检查、spawn point 分配逻辑必须保持不变

**Scope:**
所有不涉及上述 4 个 bug 条件的输入和操作应完全不受修复影响。这包括：
- 正常的移动、广播、心跳等游戏指令
- Admin 角色的所有操作
- Human_Viewer 角色的行为
- 房间管理、碰撞检测、寻路等其他系统功能


## Hypothesized Root Cause

### Bug 1: 移动主链路断裂

基于代码分析，根本原因是：

1. **客户端逻辑缺失**: `client/src/game/GameScene.ts` 中的 `handleBotMovement` 函数在后端验证通过后，只调用 `useRoomStore.getState().updateBotPosition()` 更新本地状态，缺少调用 `/api/move` 接口的逻辑。

2. **设计假设错误**: 原设计假设 `validate-move` 接口会同时完成验证和状态同步，但实际上该接口只负责验证，不修改服务端状态。

3. **测试覆盖不足**: 单元测试只验证了客户端本地状态更新，未验证服务端状态同步，导致该问题在集成测试前未被发现。

### Bug 2: 身份归属可被冒用

基于代码分析，根本原因是：

1. **认证中间件逻辑漏洞**: `server/src/middleware/auth.ts` 中的 `authMiddleware` 在 `validateKey` 返回 `contestantId: null` 时，仍然允许请求通过，只设置 `req.keyId` 和 `req.role`，不设置 `req.contestantId`。

2. **路由层回退逻辑不安全**: `server/src/routes/move.ts` 等路由使用 `getContestantFromRequest` 函数，在 `req.contestantId` 为空时回退到 `req.body.senderId`，允许客户端指定任意 contestant ID。

3. **缺少身份一致性验证**: 系统未验证请求 body 中的身份标识（`senderId`、`contestant_id`）是否与认证 key 关联的 contestant 匹配。

### Bug 3: 观战主链路只拿首帧

基于代码分析，根本原因是：

1. **连接注册逻辑缺失**: `server/src/ws.ts` 中的 `handleAuth` 函数在处理 Agent_Viewer 角色时，发送 `world.state` 后直接 `return`，不调用 `registerContestant()`，导致连接未被添加到 `connections` Map。

2. **广播机制设计限制**: `broadcast()` 函数只遍历 `connections` Map 中的连接，未注册的连接无法接收任何广播事件。

3. **角色权限设计不完整**: 原设计正确地限制了 Agent_Viewer 不能发送游戏指令，但错误地假设观察者不需要接收世界变化事件。

### Bug 4: Bot 显示依赖 WebSocket 认证

基于代码分析，根本原因是：

1. **REST join 不创建 contestant**: `server/src/routes/rooms.ts` 中的 `POST /:id/join` 路由直接使用 `req.contestantId` 作为 `botId`，但如果 key 未完成 WebSocket 认证，`req.contestantId` 可能为 `undefined` 或 `keys.id`，不是真实的 `contestant.id`。

2. **认证中间件设计不一致**: `authMiddleware` 在 contestant 不存在时设置 `req.contestantId = undefined`，但路由层假设该字段始终有效。

3. **渲染器数据源单一**: 客户端渲染器只从 `gameStore.contestants` 读取数据，该数据源只包含已完成 WebSocket 认证的玩家，不包含仅通过 REST join 的玩家。

4. **数据一致性缺失**: `room_bots` 表和 `contestants` 表之间缺少外键约束和一致性保证，允许 `bot_id` 指向不存在的 contestant 记录。


## Correctness Properties

Property 1: Fault Condition - Bug 1 移动同步

_For any_ 客户端移动操作，当 `POST /api/collision/validate-move` 返回 `{"valid":true}` 时，修复后的客户端 SHALL 随后调用 `POST /api/move` 接口同步服务端状态，使得其他玩家通过 `/api/status/:id` 查询时能够获取到最新位置。

**Validates: Requirements 2.1, 2.2, 2.3**

Property 2: Fault Condition - Bug 2 身份验证

_For any_ 使用"key 已认证但 contestant 尚未建立"的请求，当请求 body 中包含 `senderId` 或 `contestant_id` 字段时，修复后的认证层 SHALL 验证该字段是否与认证 key 关联的 contestant 匹配，不匹配则拒绝请求并返回 401/403 错误。

**Validates: Requirements 2.4, 2.5**

Property 3: Fault Condition - Bug 3 观战事件推送

_For any_ Agent_Viewer 建立 WebSocket 连接并完成认证后，修复后的服务端 SHALL 将该连接注册到广播系统，使得后续的世界变化事件（`contestant.join`、`contestant.leave`、`room.bot_position` 等）能够被推送给该观察者。

**Validates: Requirements 2.6, 2.7**

Property 4: Fault Condition - Bug 4 REST join 创建 contestant

_For any_ 客户端通过 REST API `POST /api/rooms/:id/join` 加入房间时，修复后的服务端 SHALL 在 `contestants` 表中创建或更新记录（如果尚不存在），并将真实的 `contestant.id` 写入 `room_bots` 表，使得渲染器能够显示该 Bot。

**Validates: Requirements 2.8, 2.9**

Property 5: Preservation - Bug 1 错误处理

_For any_ 移动操作，当 `validate-move` 返回 `{"valid":false}` 或发生其他错误时，修复后的客户端 SHALL 产生与原客户端完全相同的行为，保持原有的错误处理逻辑。

**Validates: Requirements 3.1, 3.2**

Property 6: Preservation - Bug 2 合法请求

_For any_ 使用有效 Agent_Player key 且 contestant 已建立的合法请求，修复后的认证层 SHALL 产生与原认证层完全相同的行为，允许请求通过并正常执行。

**Validates: Requirements 3.3, 3.4**

Property 7: Preservation - Bug 3 Agent_Player 行为

_For any_ Agent_Player 建立 WebSocket 连接时，修复后的服务端 SHALL 产生与原服务端完全相同的行为，发送初始 `world.state` 并注册连接以接收后续事件。

**Validates: Requirements 3.5, 3.6**

Property 8: Preservation - Bug 4 WebSocket 认证流程

_For any_ 客户端通过 WebSocket 认证并完成世界同步时，修复后的服务端 SHALL 产生与原服务端完全相同的行为，创建或更新 `contestants` 记录并正常显示 Bot。

**Validates: Requirements 3.7, 3.8**


## Fix Implementation

### Bug 1: 移动主链路断裂

假设根本原因分析正确：

**File**: `client/src/game/GameScene.ts`

**Function**: `handleBotMovement`

**Specific Changes**:

1. **添加 `/api/move` 调用**: 在后端验证通过后（步骤 7 之后），添加调用 `/api/move` 接口的逻辑
   - 构造请求 body: `{ target: { x: targetPos.x, y: targetPos.y } }`
   - 使用 `authToken` 进行认证
   - 处理响应：成功时更新本地状态，失败时回滚本地状态并返回错误

2. **错误处理增强**: 如果 `/api/move` 调用失败，回滚步骤 8 中的本地状态更新
   - 调用 `useRoomStore.getState().updateBotPosition()` 恢复到移动前的位置
   - 返回错误信息给调用者

3. **保持原有逻辑**: 步骤 1-7（客户端验证、后端验证）保持不变，确保 Preservation 要求

**Pseudocode**:
```typescript
// After step 7 (backend validation passed)
if (backendValid) {
  // NEW: Call /api/move to sync server state
  try {
    const moveResponse = await fetch(`${apiBaseUrl}/api/move`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${authToken}`,
      },
      body: JSON.stringify({ target: { x: targetPos.x, y: targetPos.y } }),
    });

    if (!moveResponse.ok) {
      // Rollback local state update
      const currentBot = useRoomStore.getState().rooms[currentRoomId].bots.find(b => b.id === botId);
      if (currentBot) {
        useRoomStore.getState().updateBotPosition(currentRoomId, botId, currentBot.position);
      }
      return { success: false, error: 'Failed to sync server state' };
    }
  } catch (err) {
    // Rollback local state update
    const currentBot = useRoomStore.getState().rooms[currentRoomId].bots.find(b => b.id === botId);
    if (currentBot) {
      useRoomStore.getState().updateBotPosition(currentRoomId, botId, currentBot.position);
    }
    return { success: false, error: 'Network error during server sync' };
  }

  // Step 8: Update bot position in roomStore (existing logic)
  useRoomStore.getState().updateBotPosition(currentRoomId, botId, targetPos);
  return { success: true };
}
```

### Bug 2: 身份归属可被冒用

假设根本原因分析正确：

**File**: `server/src/middleware/auth.ts`

**Function**: `authMiddleware`

**Specific Changes**:

1. **拒绝无 contestant 的请求**: 当 `validateKey` 返回 `contestantId: null` 时，返回 401 错误，不允许请求通过
   - 错误码: `AUTH_NO_CONTESTANT`
   - 错误消息: "Key 有效但尚未建立 contestant 记录，请先完成 WebSocket 认证"

2. **移除路由层回退逻辑**: 删除 `server/src/routes/move.ts`、`server/src/routes/broadcast.ts` 等路由中的 `getContestantFromRequest` 函数，直接使用 `req.contestantId`
   - 如果 `req.contestantId` 为空，返回 401 错误（但由于步骤 1 的修改，这种情况不应发生）

3. **保持 Admin 权限**: Admin 角色的请求不受影响，因为 Admin 通常不需要 contestant 记录

**Pseudocode**:
```typescript
// In authMiddleware
const result = await authManager.validateKey(key);
if (!result.valid || !result.keyId) {
  return next(httpError(401, 'AUTH_INVALID_KEY', 'Key 无效或已被吊销'));
}

// NEW: Reject requests without contestant (except Admin)
if (!result.contestantId && result.role !== 'Admin') {
  return next(httpError(401, 'AUTH_NO_CONTESTANT', 'Key 有效但尚未建立 contestant 记录，请先完成 WebSocket 认证'));
}

req.contestantId = result.contestantId;
req.keyId = result.keyId;
req.role = result.role ?? 'Agent_Player';
next();
```


### Bug 3: 观战主链路只拿首帧

假设根本原因分析正确：

**File**: `server/src/ws.ts`

**Function**: `handleAuth`

**Specific Changes**:

1. **注册 Agent_Viewer 连接**: 在发送 `world.state` 后，将 Agent_Viewer 的连接添加到 `connections` Map
   - 使用特殊的 contestant ID 格式（如 `viewer-${keyId}`）作为 Map key
   - 或者创建一个新的 `viewerConnections` Map 专门存储观察者连接

2. **修改广播逻辑**: 更新 `broadcast()` 函数，使其同时遍历 `connections` 和 `viewerConnections`（如果使用独立 Map）
   - 或者在 `connections` Map 中统一管理，通过 contestant ID 前缀区分角色

3. **保持权限限制**: Agent_Viewer 仍然不能发送游戏指令，`handleMessage` 中的拦截逻辑保持不变

**Pseudocode**:
```typescript
// In handleAuth, for Agent_Viewer role
if (role === 'Agent_Viewer') {
  const zones = getAllZones();
  const mapDims = getMapDimensions();
  const onlineContestants = getAllOnlineContestants();

  const worldStatePayload = {
    map: { width: mapDims.width, height: mapDims.height, zones },
    contestants: onlineContestants.map((c) => ({
      id: c.id,
      name: c.name,
      position: c.position,
      zone: c.currentZoneId,
      status: c.status,
    })),
  };

  sendEvent(ws, {
    type: 'world.state',
    payload: worldStatePayload,
    timestamp: Date.now(),
  });

  // NEW: Register viewer connection for subsequent broadcasts
  const viewerId = `viewer-${keyId}`;
  client.contestantId = viewerId;
  connections.set(viewerId, ws);

  return;
}
```

**Alternative Approach** (使用独立 Map):
```typescript
// Add new Map at module level
export const viewerConnections = new Map<string, WebSocket>();

// In handleAuth, for Agent_Viewer role
if (role === 'Agent_Viewer') {
  // ... send world.state ...

  // Register viewer connection
  const viewerId = `viewer-${keyId}`;
  viewerConnections.set(viewerId, ws);
  return;
}

// Update broadcast() function
export function broadcast(event: ServerEvent, exclude?: string): void {
  // Broadcast to contestants
  for (const [id, ws] of connections) {
    if (exclude && id === exclude) continue;
    sendEvent(ws, event);
  }
  // Broadcast to viewers
  for (const [id, ws] of viewerConnections) {
    if (exclude && id === exclude) continue;
    sendEvent(ws, event);
  }
}
```

### Bug 4: Bot 显示依赖 WebSocket 认证

假设根本原因分析正确：

**File**: `server/src/routes/rooms.ts`

**Function**: `POST /:id/join`

**Specific Changes**:

1. **在 join 时创建 contestant**: 在 `POST /:id/join` 路由中，如果 `req.contestantId` 为空或不存在于 `contestants` 表，则创建一个新的 contestant 记录
   - 使用 `req.keyId` 作为 `key_id`
   - 从 `keys` 表读取 `contestant_name` 作为 `name`
   - 使用 `position` 参数或分配的 spawn point 作为初始位置
   - 设置 `status = 'online'`

2. **确保 `req.contestantId` 有效**: 在调用 `roomManager.addBotToRoom()` 前，确保 `req.contestantId` 是真实的 `contestant.id`
   - 如果步骤 1 创建了新 contestant，更新 `req.contestantId` 为新创建的 ID

3. **保持 WebSocket 认证流程**: WebSocket 认证时的 `upsertContestant` 逻辑保持不变，如果 contestant 已存在则更新状态

**Pseudocode**:
```typescript
// In POST /:id/join route
roomsMemberRouter.post('/:id/join', async (req: Request, res: Response): Promise<void> => {
  try {
    let botId = (req as any).contestantId as string | undefined;
    const keyId = (req as any).keyId as string;

    // NEW: Create contestant if not exists
    if (!botId) {
      const keyRow = db.prepare('SELECT contestant_name FROM keys WHERE id = ?').get(keyId) as { contestant_name: string } | undefined;
      const contestantName = keyRow?.contestant_name ?? 'Unknown';

      const { position } = req.body as { position?: { x: number; y: number } };
      let resolvedPosition = position;

      // Allocate spawn point if no position provided
      if (!resolvedPosition) {
        const spawnPoint = roomManager.allocateSpawnPoint(req.params['id'] as string);
        if (spawnPoint) {
          resolvedPosition = { x: spawnPoint.x, y: spawnPoint.y };
        } else {
          resolvedPosition = { x: 0, y: 0 }; // Fallback
        }
      }

      // Create contestant record
      const contestantId = uuidv4();
      db.prepare(`
        INSERT INTO contestants (id, key_id, name, status, position_x, position_y, current_zone_id, energy, installed_skills, attributes, connected_at)
        VALUES (?, ?, ?, 'online', ?, ?, NULL, 100, '[]', '{}', ?)
      `).run(contestantId, keyId, contestantName, resolvedPosition.x, resolvedPosition.y, Date.now());

      botId = contestantId;
      (req as any).contestantId = contestantId;
    }

    // ... existing join logic ...
  } catch (err) {
    // ... error handling ...
  }
});
```


## Testing Strategy

### Validation Approach

测试策略遵循两阶段方法：首先在未修复代码上运行探索性测试以暴露 bug 的具体表现形式和反例，然后在修复后的代码上运行修复验证和保持性验证测试。

### Exploratory Fault Condition Checking

**Goal**: 在实施修复前，在未修复代码上运行测试以暴露反例，确认或反驳根本原因分析。如果反驳，需要重新假设根本原因。

#### Bug 1: 移动主链路断裂

**Test Plan**: 编写集成测试，模拟客户端移动操作，监控 `/api/move` 接口是否被调用。在未修复代码上运行，预期观察到 `/api/move` 未被调用。

**Test Cases**:
1. **单次移动测试**: 客户端调用 `handleBotMovement`，验证通过后检查是否调用 `/api/move`（未修复代码上将失败）
2. **连续移动测试**: 客户端连续移动 5 次，检查服务端位置是否与客户端一致（未修复代码上将失败）
3. **跨客户端查询测试**: 客户端 A 移动后，客户端 B 查询 A 的状态，检查位置是否为最新（未修复代码上将失败）
4. **重连测试**: 客户端移动后断开连接，重新连接时检查服务端推送的位置是否为最新（未修复代码上将失败）

**Expected Counterexamples**:
- `/api/move` 接口未被调用
- 服务端 `contestants` 表中的位置字段未更新
- 其他客户端查询到的位置是旧位置

#### Bug 2: 身份归属可被冒用

**Test Plan**: 编写安全测试，使用新 Agent_Player key（未建立 contestant）发送请求，body 中指定其他玩家的 `senderId`。在未修复代码上运行，预期观察到请求被接受并修改了其他玩家的状态。

**Test Cases**:
1. **冒用移动测试**: 新 key 发送 `POST /api/move`，body 中指定受害者的 `senderId`（未修复代码上将成功）
2. **冒用广播测试**: 新 key 发送 `POST /api/broadcast`，body 中指定受害者的 `senderId`（未修复代码上将成功）
3. **冒用加入房间测试**: 新 key 发送 `POST /api/rooms/:id/join`，body 中指定受害者的 `contestant_id`（未修复代码上将成功）
4. **合法请求测试**: 已建立 contestant 的 key 发送请求，body 中指定自己的 `senderId`（未修复代码上将成功，修复后也应成功）

**Expected Counterexamples**:
- 新 key 能够修改其他玩家的服务端状态
- 认证层未验证 body 中的身份标识与 key 的匹配性
- 可能的原因：`authMiddleware` 允许无 contestant 的请求通过，路由层回退到 body 中的 `senderId`

#### Bug 3: 观战主链路只拿首帧

**Test Plan**: 编写 WebSocket 集成测试，Agent_Viewer 连接并认证后，触发世界变化事件（如玩家移动、加入、离开），检查 Agent_Viewer 是否收到这些事件。在未修复代码上运行，预期观察到 Agent_Viewer 只收到初始 `world.state`，不收到后续事件。

**Test Cases**:
1. **玩家移动事件测试**: Agent_Viewer 连接后，Agent_Player 移动，检查 Agent_Viewer 是否收到 `room.bot_position` 事件（未修复代码上将失败）
2. **玩家加入事件测试**: Agent_Viewer 连接后，新 Agent_Player 加入，检查 Agent_Viewer 是否收到 `contestant.join` 事件（未修复代码上将失败）
3. **玩家离开事件测试**: Agent_Viewer 连接后，Agent_Player 离开，检查 Agent_Viewer 是否收到 `contestant.leave` 事件（未修复代码上将失败）
4. **Agent_Player 对比测试**: Agent_Player 连接后，触发相同事件，检查是否收到（未修复代码上将成功，作为对照组）

**Expected Counterexamples**:
- Agent_Viewer 只收到初始 `world.state`，不收到后续广播事件
- `connections` Map 中不包含 Agent_Viewer 的连接
- 可能的原因：`handleAuth` 中 Agent_Viewer 分支未调用 `registerContestant()`

#### Bug 4: Bot 显示依赖 WebSocket 认证

**Test Plan**: 编写集成测试，客户端通过 REST API 加入房间（不先完成 WebSocket 认证），检查 `contestants` 表和 `room_bots` 表的记录，以及客户端渲染器是否显示该 Bot。在未修复代码上运行，预期观察到 `contestants` 表无记录，`room_bots` 表中 `bot_id` 是 `keys.id`，渲染器不显示 Bot。

**Test Cases**:
1. **REST join 无 contestant 测试**: 新 key 调用 `POST /api/rooms/:id/join`，检查 `contestants` 表是否有记录（未修复代码上将失败）
2. **room_bots 记录测试**: REST join 后，检查 `room_bots` 表中的 `bot_id` 是否为真实的 `contestant.id`（未修复代码上将失败）
3. **渲染器显示测试**: REST join 后，检查客户端渲染器是否显示该 Bot（未修复代码上将失败）
4. **WebSocket 认证对比测试**: 先完成 WebSocket 认证再 REST join，检查是否正常显示（未修复代码上将成功，作为对照组）

**Expected Counterexamples**:
- REST join 不创建 `contestants` 记录
- `room_bots` 表中的 `bot_id` 是 `keys.id` 而非 `contestant.id`
- 渲染器不显示仅通过 REST join 的 Bot
- 可能的原因：`POST /:id/join` 路由未创建 contestant，直接使用 `req.contestantId`（可能为空或 `keys.id`）


### Fix Checking

**Goal**: 验证对于所有触发 bug 条件的输入，修复后的函数产生预期的正确行为。

#### Bug 1: 移动同步验证

**Pseudocode:**
```
FOR ALL input WHERE isBugCondition_Bug1(input) DO
  result := handleBotMovement_fixed(input)
  ASSERT result.moveAPICalled == true
  ASSERT serverState.position == clientState.position
END FOR
```

**Test Cases**:
1. 单次移动后验证服务端位置与客户端一致
2. 连续移动后验证服务端位置与客户端一致
3. 跨客户端查询验证位置同步
4. 重连后验证服务端推送的位置是最新的

#### Bug 2: 身份验证

**Pseudocode:**
```
FOR ALL input WHERE isBugCondition_Bug2(input) DO
  result := authMiddleware_fixed(input)
  ASSERT result.statusCode == 401 OR result.statusCode == 403
  ASSERT result.error.code == 'AUTH_NO_CONTESTANT'
END FOR
```

**Test Cases**:
1. 新 key 冒用其他玩家 `senderId` 发送 `/api/move` 请求，验证返回 401 错误
2. 新 key 冒用其他玩家 `senderId` 发送 `/api/broadcast` 请求，验证返回 401 错误
3. 新 key 冒用其他玩家 `contestant_id` 发送 `/api/rooms/:id/join` 请求，验证返回 401 错误

#### Bug 3: 观战事件推送

**Pseudocode:**
```
FOR ALL input WHERE isBugCondition_Bug3(input) DO
  result := handleAuth_fixed(input)
  ASSERT result.connectionRegistered == true
  ASSERT result.subsequentEventsReceived == true
END FOR
```

**Test Cases**:
1. Agent_Viewer 连接后，玩家移动，验证 Agent_Viewer 收到 `room.bot_position` 事件
2. Agent_Viewer 连接后，新玩家加入，验证 Agent_Viewer 收到 `contestant.join` 事件
3. Agent_Viewer 连接后，玩家离开，验证 Agent_Viewer 收到 `contestant.leave` 事件

#### Bug 4: REST join 创建 contestant

**Pseudocode:**
```
FOR ALL input WHERE isBugCondition_Bug4(input) DO
  result := roomsJoin_fixed(input)
  ASSERT result.contestantExists == true
  ASSERT result.roomBotsRecordValid == true
  ASSERT result.botRendered == true
END FOR
```

**Test Cases**:
1. 新 key 通过 REST join 房间，验证 `contestants` 表中有记录
2. 验证 `room_bots` 表中的 `bot_id` 是真实的 `contestant.id`
3. 验证客户端渲染器显示该 Bot

### Preservation Checking

**Goal**: 验证对于所有不触发 bug 条件的输入，修复后的函数产生与原函数完全相同的结果。

#### Bug 1: 移动错误处理保持

**Pseudocode:**
```
FOR ALL input WHERE NOT isBugCondition_Bug1(input) DO
  ASSERT handleBotMovement_original(input) = handleBotMovement_fixed(input)
END FOR
```

**Testing Approach**: 属性测试推荐用于保持性检查，因为：
- 自动生成大量测试用例覆盖输入域
- 捕获手动单元测试可能遗漏的边缘情况
- 提供强保证：对于所有非 bug 输入，行为保持不变

**Test Plan**: 观察未修复代码上的错误处理行为，然后编写属性测试捕获该行为。

**Test Cases**:
1. `validate-move` 返回 `{"valid":false}` 时，验证客户端拒绝移动
2. 网络错误时，验证客户端返回错误信息
3. 服务器错误时，验证客户端返回错误信息

#### Bug 2: 合法请求保持

**Pseudocode:**
```
FOR ALL input WHERE NOT isBugCondition_Bug2(input) DO
  ASSERT authMiddleware_original(input) = authMiddleware_fixed(input)
END FOR
```

**Test Cases**:
1. 已建立 contestant 的 key 发送请求，body 中指定自己的 `senderId`，验证请求通过
2. Admin 角色发送请求，验证请求通过（无需 contestant）
3. 正常的移动、广播、心跳等操作，验证行为不变

#### Bug 3: Agent_Player 行为保持

**Pseudocode:**
```
FOR ALL input WHERE NOT isBugCondition_Bug3(input) DO
  ASSERT handleAuth_original(input) = handleAuth_fixed(input)
END FOR
```

**Test Cases**:
1. Agent_Player 连接并认证，验证收到 `world.state` 和后续事件
2. Agent_Viewer 不能发送游戏指令的限制保持不变
3. 世界状态变化时，Agent_Player 继续收到广播事件

#### Bug 4: WebSocket 认证流程保持

**Pseudocode:**
```
FOR ALL input WHERE NOT isBugCondition_Bug4(input) DO
  ASSERT roomsJoin_original(input) = roomsJoin_fixed(input)
END FOR
```

**Test Cases**:
1. 先完成 WebSocket 认证再 REST join，验证行为不变
2. 渲染器显示已通过 WebSocket 认证的玩家，验证行为不变
3. 房间容量检查、spawn point 分配逻辑保持不变


### Unit Tests

#### Bug 1: 移动主链路断裂
- 测试 `handleBotMovement` 在验证通过后调用 `/api/move` 接口
- 测试 `/api/move` 调用失败时的回滚逻辑
- 测试 `validate-move` 返回 `false` 时不调用 `/api/move`
- 测试网络错误时的错误处理

#### Bug 2: 身份归属可被冒用
- 测试 `authMiddleware` 拒绝无 contestant 的非 Admin 请求
- 测试 `authMiddleware` 允许有 contestant 的请求通过
- 测试 `authMiddleware` 允许 Admin 请求通过（无需 contestant）
- 测试路由层直接使用 `req.contestantId`，不回退到 body

#### Bug 3: 观战主链路只拿首帧
- 测试 `handleAuth` 为 Agent_Viewer 注册连接
- 测试 `broadcast()` 函数将事件发送给 Agent_Viewer
- 测试 Agent_Viewer 不能发送游戏指令的限制
- 测试 Agent_Player 继续正常接收广播事件

#### Bug 4: Bot 显示依赖 WebSocket 认证
- 测试 `POST /:id/join` 在 contestant 不存在时创建记录
- 测试 `room_bots` 表中的 `bot_id` 是真实的 `contestant.id`
- 测试 WebSocket 认证时的 `upsertContestant` 逻辑保持不变
- 测试渲染器能够显示通过 REST join 的 Bot

### Property-Based Tests

#### Bug 1: 移动同步属性测试
- 生成随机移动序列，验证每次移动后服务端位置与客户端一致
- 生成随机错误场景（网络错误、服务器错误），验证错误处理保持不变
- 生成随机跨客户端查询场景，验证位置同步正确性

#### Bug 2: 身份验证属性测试
- 生成随机 key 状态（有/无 contestant）和请求 body（匹配/不匹配 `senderId`），验证认证逻辑正确性
- 生成随机合法请求，验证行为保持不变
- 生成随机 Admin 请求，验证权限保持不变

#### Bug 3: 观战事件推送属性测试
- 生成随机世界变化事件序列，验证 Agent_Viewer 接收所有事件
- 生成随机 Agent_Player 连接场景，验证行为保持不变
- 生成随机游戏指令，验证 Agent_Viewer 不能发送的限制保持不变

#### Bug 4: REST join 创建 contestant 属性测试
- 生成随机 join 场景（有/无 contestant、有/无 position），验证 contestant 创建逻辑正确性
- 生成随机 WebSocket 认证场景，验证行为保持不变
- 生成随机房间配置，验证容量检查和 spawn point 分配保持不变

### Integration Tests

#### Bug 1: 移动主链路断裂
- 完整的客户端-服务端移动流程测试：客户端移动 → 验证 → 同步 → 查询
- 多客户端场景测试：客户端 A 移动，客户端 B 查询，验证位置一致
- 重连场景测试：移动后断开连接，重新连接时验证位置正确

#### Bug 2: 身份归属可被冒用
- 完整的认证流程测试：新 key → 尝试冒用 → 被拒绝
- 合法请求流程测试：已建立 contestant 的 key → 正常操作 → 成功
- Admin 权限测试：Admin key → 各种操作 → 成功

#### Bug 3: 观战主链路只拿首帧
- 完整的观战流程测试：Agent_Viewer 连接 → 接收初始状态 → 接收后续事件
- 多事件场景测试：玩家加入、移动、离开，验证 Agent_Viewer 接收所有事件
- Agent_Player 对比测试：验证 Agent_Player 行为保持不变

#### Bug 4: Bot 显示依赖 WebSocket 认证
- 完整的 REST join 流程测试：新 key → REST join → 验证 contestant 创建 → 验证渲染
- WebSocket 认证流程测试：先 WebSocket 认证 → REST join → 验证行为不变
- 混合场景测试：部分玩家 REST join，部分玩家 WebSocket 认证，验证所有玩家都显示

