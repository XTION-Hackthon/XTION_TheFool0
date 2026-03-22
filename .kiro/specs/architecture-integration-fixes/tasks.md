# 实现计划

- [x] 1. 编写 Bug Condition 探索性测试（修复前）
  - **Property 1: Fault Condition** — 架构集成层 7 个 Bug 条件验证
  - **重要**: 此属性基测试必须在实施修复前编写
  - **目标**: 通过测试确认所有 bug 的存在，生成反例以理解根因
  - **Scoped PBT 方法**: 针对每个 bug 的具体失败条件编写属性测试
  - 测试文件: `server/src/tests/property/architecture-integration.property.test.ts`
  - Bug 1 (P0): 生成随机非 Admin 角色（Agent_Player/Agent_Viewer/Human_Viewer），调用 POST /api/rooms 和 DELETE /api/rooms/:id，断言应返回 403 但实际返回 201/204（确认 bug 存在）
  - Bug 1 (P0): 调用 POST /api/rooms/:id/join 时传入不属于自己的 botId，断言后端应拒绝但实际接受（确认 bug 存在）
  - Bug 3 (P1): 模拟 addBotToRoom 连续加入不同房间，断言 bot 应只在一个房间但实际在多个房间（确认 bug 存在）
  - Bug 5 (P1): 插入 status='timeout' 的 contestants 和 room_bots 记录后执行 setupWebSocket 清理，断言应被清理但实际未清理（确认 bug 存在）
  - Bug 6 (P1): 验证 pathfinding-system.ts 中 `Bot` 类型未定义、`room.bounds` 可能为 undefined 的类型错误存在
  - Bug 7 (P2): 验证 KeysTab 发送 `{ contestantName }` 而非 `{ name, role }` 的契约不一致
  - 在未修复代码上运行测试
  - **预期结果**: 测试失败（这是正确的——证明 bug 存在）
  - 记录发现的反例以理解根因
  - _Requirements: 1.1, 1.2, 1.3, 1.4, 1.5, 1.6, 1.7, 1.8, 1.9, 1.10, 1.11_

- [x] 2. 编写保持性属性测试（修复前）
  - **Property 2: Preservation** — 非 Bug 条件下的行为保持
  - **重要**: 遵循观察优先方法论
  - 测试文件: `server/src/tests/property/architecture-preservation.property.test.ts`
  - 观察: Admin 调用 POST /api/rooms 正常返回 201（保持）
  - 观察: GET /api/rooms 和 GET /api/rooms/:id 正常返回数据（保持）
  - 观察: 房间满员时 join 返回 ROOM_AT_CAPACITY（保持）
  - 观察: join 时提供 position 参数使用提供的位置（保持）
  - 观察: 单 contestant 断线的 5 秒延迟清理逻辑正常工作（保持）
  - 观察: findPath 和 findMultiRoomPath 运行时结果不变（保持）
  - 观察: AdminPanel 其他 Tab 功能不受影响（保持）
  - 观察: Key 列表查询、吊销、重新生成接口正常工作（保持）
  - 编写属性基测试捕获观察到的行为模式
  - 在未修复代码上运行测试
  - **预期结果**: 测试通过（确认基线行为）
  - _Requirements: 3.1, 3.2, 3.3, 3.4, 3.5, 3.6, 3.7, 3.8, 3.9, 3.10_

- [x] 3. Bug 1 (P0) 修复: 房间写接口权限控制 + join/leave 使用 req.contestantId

  - [x] 3.1 拆分 rooms 路由并添加 requireRole
    - 文件: `server/src/routes/rooms.ts`
    - 将 `roomsRouter` 拆分为两个 Router:
      - `roomsAdminRouter`: POST / (创建)、PUT /:id (更新)、DELETE /:id (删除)
      - `roomsMemberRouter`: GET / (列表)、GET /:id (详情)、POST /:id/join、POST /:id/leave
    - 导出 `roomsAdminRouter` 和 `roomsMemberRouter`
    - _Bug_Condition: isBugCondition_Bug1(input) where role != 'Admin' AND method IN ['POST','DELETE'] on /api/rooms_
    - _Expected_Behavior: 非 Admin 调用写接口返回 403_
    - _Requirements: 2.1_

  - [x] 3.2 修改 join/leave 路由使用 req.contestantId
    - 文件: `server/src/routes/rooms.ts`
    - join 路由: 将 `const { botId, position } = req.body` 改为 `const botId = (req as any).contestantId`，保留 position 从 body 获取
    - leave 路由: 将 `const { botId } = req.body` 改为 `const botId = (req as any).contestantId`
    - 移除 botId 的空值校验（contestantId 由 authMiddleware 保证存在）
    - _Bug_Condition: isBugCondition_Bug1(input) where bodyBotId != reqContestantId_
    - _Expected_Behavior: 系统使用 req.contestantId 作为 botId，忽略请求体中的 botId_
    - _Requirements: 2.2_

  - [x] 3.3 更新 app.ts 路由挂载
    - 文件: `server/src/app.ts`
    - 将 `app.use('/api/rooms', authMiddleware, roomsRouter)` 替换为:
      - `app.use('/api/rooms', authMiddleware, requireRole('Admin'), roomsAdminRouter)`
      - `app.use('/api/rooms', authMiddleware, roomsMemberRouter)`
    - 更新 import 语句: `import { roomsAdminRouter, roomsMemberRouter } from './routes/rooms'`
    - _Preservation: Admin 读接口和合法写操作不受影响_
    - _Requirements: 2.1, 2.2, 3.1, 3.2_

- [x] 4. Bug 2 (P1) 修复: 前端传递真实 contestantId

  - [x] 4.1 从 roleStore 获取 contestantId 并传递给组件
    - 文件: `client/src/App.tsx`
    - 从 `useRoleStore` 获取 `contestantId`: `const contestantId = useRoleStore((s) => s.contestantId)`
    - 将 `<RoomList currentBotId="">` 改为 `<RoomList currentBotId={contestantId ?? ''}>`
    - 将 `<RoomManagementPanel currentBotId="">` 改为 `<RoomManagementPanel currentBotId={contestantId ?? ''}>`
    - 注意: Bug 1 修复后后端使用 req.contestantId，前端 botId 仅用于 UI 标识"(你)"
    - _Bug_Condition: isBugCondition_Bug2(input) where botIdSent = 'self'_
    - _Expected_Behavior: 前端发送真实 contestantId 或由后端自动使用 req.contestantId_
    - _Requirements: 2.3_

- [x] 5. Bug 3 (P1) 修复: 切房先 leave 后 join + 后端全局去重

  - [x] 5.1 修改 onSwitchRoom 回调先 leave 后 join
    - 文件: `client/src/App.tsx`
    - 将 onSwitchRoom 回调从只调用 join 改为:
      ```
      onSwitchRoom={(roomId) => {
        const currentRoomId = useGameStore.getState().currentRoomId;
        const doSwitch = async () => {
          if (currentRoomId) {
            await apiClient.post(`/api/rooms/${currentRoomId}/leave`, {});
          }
          await apiClient.post(`/api/rooms/${roomId}/join`, {});
        };
        doSwitch().catch(err => console.error('[App] switch room error:', err));
      }}
      ```
    - _Bug_Condition: isBugCondition_Bug3(input) where action = 'switchRoom' AND currentRoomId != null_
    - _Expected_Behavior: 先 leave 旧房间再 join 新房间_
    - _Requirements: 2.4_

  - [x] 5.2 后端 addBotToRoom 添加全局去重
    - 文件: `server/src/modules/room-manager.ts`
    - 在 `addBotToRoom` 方法中，插入新记录前添加:
      `db.prepare('DELETE FROM room_bots WHERE bot_id = ? AND room_id != ?').run(botId, roomId)`
    - 放在 existing 检查之后、INSERT 之前
    - 这是防御性措施，即使前端正确 leave，后端也保证全局唯一
    - _Bug_Condition: isBugCondition_Bug3(input) where bot exists in other rooms_
    - _Expected_Behavior: addBotToRoom 在插入前清理该 bot 在其他房间的记录_
    - _Preservation: 同房去重逻辑不变，position 参数保持_
    - _Requirements: 2.5, 3.3, 3.4_

- [x] 6. Bug 4 (P1) 修复: loadAndRenderWorld 末尾调用 loadRoom

  - [x] 6.1 在 loadAndRenderWorld 末尾添加 loadRoom 调用
    - 文件: `client/src/game/GameScene.ts`
    - 在 `loadAndRenderWorld` 方法的 try 块末尾（`this.worldRenderer.renderDoorways(allDoorways)` 之后）添加:
      ```typescript
      const currentRoomId = useRoomStore.getState().currentRoomId;
      const firstRoomId = currentRoomId ?? allRooms[0]?.id;
      if (firstRoomId) {
        this.loadRoom(firstRoomId);
      }
      ```
    - 确保 `useRoomStore` 已导入（检查现有 import）
    - _Bug_Condition: isBugCondition_Bug4(input) where loadAndRenderWorldCompleted = true AND currentRoomId = null_
    - _Expected_Behavior: loadAndRenderWorld 完成后自动调用 loadRoom，currentRoomId 被正确设置_
    - _Preservation: zoom/pan/resize 功能不受影响_
    - _Requirements: 2.6, 3.5_

- [x] 7. Bug 5 (P1) 修复: setupWebSocket 清理 online+timeout 状态和 room_bots

  - [x] 7.1 扩展启动清理逻辑
    - 文件: `server/src/ws.ts`
    - 将 `WHERE status = 'online'` 改为 `WHERE status IN ('online', 'timeout')`
    - 在清理 contestants 之后添加 `db.prepare('DELETE FROM room_bots').run()` 清空残留记录
    - 添加日志: `console.log('[WS] Cleared ${roomBotsCount} stale room_bots record(s)')`
    - _Bug_Condition: isBugCondition_Bug5(input) where serverEvent = 'restart' AND (hasTimeoutContestants OR hasOrphanRoomBots)_
    - _Expected_Behavior: 重启后 online 和 timeout 都变 offline，room_bots 被清空_
    - _Preservation: 单 contestant 断线的 5 秒延迟清理逻辑不变_
    - _Requirements: 2.7, 3.6, 3.7_

- [x] 8. Bug 6 (P1) 修复: 前端构建类型错误

  - [x] 8.1 修复 pathfinding-system.ts 类型错误
    - 文件: `client/src/game/pathfinding-system.ts`
    - 确认 `import type { Room, Doorway } from '../stores'` 已存在且包含 Bot 类型
    - 如果 Bot 未在 import 中，添加: `import type { Bot } from '../stores/roomStore'`（或从 `../stores` 导入）
    - 在 findPath 方法中，将 `room.bounds` 传递给 gridPathfinder.findPath 时添加 undefined 检查:
      ```typescript
      const bounds = room.bounds;
      if (!bounds) return [start];
      ```
    - _Bug_Condition: isBugCondition_Bug6(input) where file = 'pathfinding-system.ts' AND errorCode IN ['TS2304', 'TS2345']_
    - _Expected_Behavior: tsc --noEmit 通过，运行时行为不变_
    - _Requirements: 2.8, 3.10_

  - [x] 8.2 修复 room-graph-builder.ts 导入路径
    - 文件: `client/src/game/pathfinding/room-graph-builder.ts`
    - 将 `import type { Room, Doorway } from '../../types'` 改为 `import type { Room, Doorway } from '../../stores'`
    - _Bug_Condition: isBugCondition_Bug6(input) where file = 'room-graph-builder.ts' AND errorCode = 'TS2307'_
    - _Expected_Behavior: 模块导入路径正确，tsc --noEmit 通过_
    - _Requirements: 2.8_

- [x] 9. Bug 7 (P2) 修复: AdminPanel KeysTab 修正字段名 + 添加角色选择器

  - [x] 9.1 修正请求体字段名并添加角色选择器
    - 文件: `client/src/components/AdminPanel.tsx`
    - 在 KeysTab 函数中添加 `const [role, setRole] = useState<string>('Agent_Player')`
    - 将 `apiClient.post('/api/admin/keys', { contestantName: newName })` 改为 `apiClient.post('/api/admin/keys', { name: newName, role })`
    - 在 input 和"生成"按钮之间添加角色选择器:
      ```tsx
      <select style={{ ...inputStyle }} value={role} onChange={(e) => setRole(e.target.value)}>
        <option value="Admin">Admin</option>
        <option value="Agent_Player">Agent_Player</option>
        <option value="Agent_Viewer">Agent_Viewer</option>
        <option value="Human_Viewer">Human_Viewer</option>
      </select>
      ```
    - _Bug_Condition: isBugCondition_Bug7(input) where requestBody HAS KEY 'contestantName' AND NOT HAS KEY 'name'_
    - _Expected_Behavior: 发送 { name, role } 格式请求体，UI 提供角色选择器_
    - _Preservation: Key 列表查询、吊销、重新生成接口不受影响_
    - _Requirements: 2.9, 2.10, 3.9_

- [x] 10. 验证 Bug Condition 探索性测试通过

  - [x] 10.1 验证 Bug Condition 探索性测试现在通过
    - **Property 1: Expected Behavior** — 所有 Bug 条件下的期望行为已满足
    - **重要**: 重新运行任务 1 中的同一测试，不要编写新测试
    - 运行 `server/src/tests/property/architecture-integration.property.test.ts`
    - **预期结果**: 测试通过（确认所有 bug 已修复）
    - _Requirements: 2.1, 2.2, 2.3, 2.4, 2.5, 2.6, 2.7, 2.8, 2.9, 2.10_

  - [x] 10.2 验证保持性属性测试仍然通过
    - **Property 2: Preservation** — 非 Bug 条件下的行为保持
    - **重要**: 重新运行任务 2 中的同一测试，不要编写新测试
    - 运行 `server/src/tests/property/architecture-preservation.property.test.ts`
    - **预期结果**: 测试通过（确认无回归）
    - _Requirements: 3.1, 3.2, 3.3, 3.4, 3.5, 3.6, 3.7, 3.8, 3.9, 3.10_

- [x] 11. Checkpoint — 确保所有测试通过
  - 运行全部属性基测试和现有测试套件
  - 确认所有测试通过
  - 如有问题，询问用户
