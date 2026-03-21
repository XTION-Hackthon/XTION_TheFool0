# 实现计划：房间-墙体-门洞系统

## 概述

基于现有的 Phaser 3 + Node.js 架构，增量扩展实现连续世界地图、门洞穿行和坐标驱动的房间归属判定。

## 任务列表

- [x] 1. 数据库与类型定义
  - [x] 1.1 在 `server/src/db.ts` 中新增 `doorways` 表的 DDL 语句及索引
    - 添加 `CREATE TABLE IF NOT EXISTS doorways` SQL（含 room_a_id、room_b_id、x、y、width、height、created_at 字段及外键约束）
    - 添加 `createIndexes` 中对 doorways 表的索引（room_a_id、room_b_id）
    - _需求: 7.3, 7.4_
  - [x] 1.2 在 `server/src/types/index.ts` 中新增 `Doorway`、`DoorwayConfig`、`MembershipChange`、`ValidationResult` 接口
    - _需求: 3.1, 4.1_

- [x] 2. 实现 DoorwayManager
  - [x] 2.1 创建 `server/src/modules/doorway-manager.ts`，实现 `DoorwayManager` 类
    - 实现 `createDoorway`、`getDoorway`、`getDoorwaysByRoom`、`getDoorwayBetweenRooms`、`getAllDoorways`、`updateDoorway`、`deleteDoorway`
    - 实现 `validateDoorwayPlacement`：验证门洞位于两个房间的共享边界上，宽度不小于 32px
    - 所有操作通过 `server/src/db.ts` 持久化到 `doorways` 表
    - _需求: 3.1, 3.2, 3.3, 3.5, 7.3, 7.4_
  - [ ]* 2.2 为 DoorwayManager 编写属性测试（Property 1）
    - **Property 1: 门洞数据持久化往返**
    - **Validates: Requirements 3.1, 7.3, 7.4**
    - 测试文件：`server/src/tests/property/doorway-persistence.property.test.ts`
  - [ ]* 2.3 为门洞共享边界验证编写属性测试（Property 4）
    - **Property 4: 门洞必须位于共享边界**
    - **Validates: Requirements 3.3**
    - 测试文件：`server/src/tests/property/doorway-boundary.property.test.ts`

- [x] 3. 实现 RoomMembershipService
  - [x] 3.1 创建 `server/src/modules/room-membership-service.ts`，实现 `RoomMembershipService` 类
    - 实现 `getRoomAtPosition`：AABB 包含检测（bounds_x1 <= x <= bounds_x2 && bounds_y1 <= y <= bounds_y2）
    - 实现 `updateMembership`：原子更新 `room_bots` 表，返回 `MembershipChange`
    - 实现 `hasConnection`：查询两个房间之间是否存在门洞记录
    - 实现 `validateNoOverlap`：检测新房间边界与现有房间是否重叠
    - _需求: 4.1, 4.2, 4.3, 4.4, 8.2, 8.4_
  - [ ]* 3.2 为房间归属判定编写属性测试（Property 5）
    - **Property 5: 基于坐标的房间归属判定**
    - **Validates: Requirements 4.1, 4.2, 4.3, 5.3**
    - 测试文件：`server/src/tests/property/doorway-membership.property.test.ts`
  - [ ]* 3.3 为房间边界重叠检测编写属性测试（Property 2）
    - **Property 2: 房间边界重叠检测**
    - **Validates: Requirements 1.4, 9.7**
    - 测试文件：`server/src/tests/property/doorway-overlap.property.test.ts`
  - [ ]* 3.4 为跨房间移动门洞连接验证编写属性测试（Property 6）
    - **Property 6: 跨房间移动需要门洞连接**
    - **Validates: Requirements 8.2**
    - 测试文件：`server/src/tests/property/doorway-connection.property.test.ts`
  - [ ]* 3.5 为房间归属更新原子性编写属性测试（Property 8）
    - **Property 8: 房间归属更新原子性**
    - **Validates: Requirements 8.4**
    - 测试文件：`server/src/tests/property/doorway-atomicity.property.test.ts`

- [x] 4. 扩展 CollisionManager（服务端）
  - [x] 4.1 在 `server/src/modules/collision-manager.ts` 中新增 `checkWallCollisionWithDoorways` 方法
    - 检查 bot 碰撞箱与墙体是否重叠，若重叠区域完全在某个门洞范围内则排除（`isPositionInDoorway` 逻辑）
    - _需求: 2.2, 3.2, 5.4, 8.1, 8.3_
  - [x] 4.2 在 `server/src/modules/collision-manager.ts` 中新增 `validateCrossRoomMovement` 方法
    - 调用 `RoomMembershipService.hasConnection` 验证跨房间移动合法性
    - 验证目标房间容量未超限
    - _需求: 8.2, 8.5_
  - [ ]* 4.3 为墙体碰撞与门洞排除编写属性测试（Property 3）
    - **Property 3: 墙体碰撞与门洞排除**
    - **Validates: Requirements 2.2, 3.2, 5.2, 5.4, 8.1, 8.3**
    - 测试文件：`server/src/tests/property/doorway-collision.property.test.ts`
  - [ ]* 4.4 为房间容量限制编写属性测试（Property 7）
    - **Property 7: 房间容量限制**
    - **Validates: Requirements 8.5**
    - 测试文件：`server/src/tests/property/doorway-capacity.property.test.ts`

- [x] 5. 检查点 — 确保所有服务端测试通过，如有疑问请询问用户

- [x] 6. 实现门洞 API 路由
  - [x] 6.1 创建 `server/src/routes/doorways.ts`，实现以下路由
    - `POST /api/doorways`：调用 `DoorwayManager.createDoorway`，广播 `doorway.created` WebSocket 事件
    - `GET /api/doorways`：调用 `DoorwayManager.getAllDoorways`
    - `GET /api/doorways/:id`：调用 `DoorwayManager.getDoorway`
    - `PUT /api/doorways/:id`：调用 `DoorwayManager.updateDoorway`
    - `DELETE /api/doorways/:id`：调用 `DoorwayManager.deleteDoorway`，广播 `doorway.deleted` WebSocket 事件
    - `GET /api/rooms/:id/doorways`：调用 `DoorwayManager.getDoorwaysByRoom`
    - 按设计文档错误处理表返回对应 HTTP 状态码和错误码
    - _需求: 3.1, 7.3, 9.3, 9.4, 9.5_
  - [x] 6.2 在服务端入口文件中注册 `doorways` 路由

- [x] 7. 更新 move 路由与 WebSocket 广播
  - [x] 7.1 在 `server/src/routes/move.ts` 中集成 `RoomMembershipService` 和 `CollisionManager` 扩展方法
    - 移动验证流程：`checkWallCollisionWithDoorways` → `validateCrossRoomMovement` → `updateMembership`
    - 若房间归属发生变化，调用 WebSocket 广播 `room.membership_changed`
    - _需求: 5.1, 5.2, 5.3, 8.1, 8.2, 8.3, 8.4, 8.5_
  - [x] 7.2 在 `server/src/ws.ts` 中新增 `room.membership_changed`、`doorway.created`、`doorway.deleted` 广播函数
    - _需求: 4.5, 4.6_

- [x] 8. 检查点 — 确保所有服务端测试通过，如有疑问请询问用户

- [x] 9. 实现客户端 doorwayStore
  - [x] 9.1 创建 `client/src/stores/doorwayStore.ts`，实现 Zustand store
    - 实现 `doorways: Record<string, Doorway>`、`setDoorways`、`addDoorway`、`removeDoorway`、`getDoorwaysByRoom`
    - _需求: 4.6_

- [x] 10. 扩展 editorStore
  - [x] 10.1 在 `client/src/stores/editorStore.ts` 中新增 `doorway` 工具类型及门洞管理方法
    - 将 `selectedTool` 类型扩展为包含 `'doorway'`
    - 新增 `doorways: Doorway[]`、`addDoorway`、`removeDoorway`、`updateDoorway`
    - _需求: 9.1, 9.3_

- [x] 11. 扩展客户端 CollisionSystem
  - [x] 11.1 在 `client/src/game/collision-system.ts` 中新增 `checkWallCollisionWithDoorways` 方法
    - 复用 `isPositionInDoorway` 逻辑，在客户端碰撞预检测中排除门洞区域
    - _需求: 5.2, 5.4_

- [x] 12. 实现 WorldRenderer
  - [x] 12.1 创建 `client/src/game/world-renderer.ts`，实现 `WorldRenderer` 类
    - 实现 `renderRooms`：在 Phaser Scene 中绘制所有房间的边界矩形
    - 实现 `renderWalls`：绘制墙体矩形，在门洞位置留出缺口（不渲染门洞覆盖的墙体段）
    - 实现 `renderDoorways`：用虚线或高亮样式标记门洞开口位置
    - 实现 `updateRoom`、`destroy`
    - _需求: 1.2, 1.3, 2.4, 3.4, 6.3, 9.1, 9.6_

- [x] 13. 更新 GameScene
  - [x] 13.1 在 `client/src/game/GameScene.ts` 中集成 `WorldRenderer` 和门洞感知碰撞
    - 在场景初始化时实例化 `WorldRenderer`，加载房间、墙体、门洞数据后调用渲染方法
    - 将移动逻辑中的碰撞检测替换为 `CollisionSystem.checkWallCollisionWithDoorways`
    - 配置摄像机跟随当前 bot（`camera.startFollow`）
    - _需求: 1.2, 1.3, 5.1, 5.2, 6.1, 6.2, 7.5_

- [x] 14. 更新 MapEditor 组件
  - [x] 14.1 在 `client/src/components/MapEditor.tsx` 中新增门洞放置工具
    - 在工具栏中添加"门洞"工具按钮，切换 `editorStore.selectedTool` 为 `'doorway'`
    - 实现点击共享边界时弹出门洞属性面板（关联房间、位置、宽度）
    - 实现门洞的视觉区分渲染（虚线/高亮）
    - 门洞宽度小于 32px 时显示警告提示
    - 房间边界重叠时显示红色警告边框并禁用保存
    - _需求: 9.1, 9.2, 9.3, 9.4, 9.5, 9.6, 9.7, 3.5_

- [x] 15. 更新 stores/index.ts 与 App.tsx
  - [x] 15.1 在 `client/src/stores/index.ts` 中新增 WebSocket 事件处理器
    - 处理 `room.membership_changed`：更新 `gameStore` 中 bot 的房间归属
    - 处理 `doorway.created`：调用 `doorwayStore.addDoorway`
    - 处理 `doorway.deleted`：调用 `doorwayStore.removeDoorway`
    - _需求: 4.5, 4.6_
  - [x] 15.2 在 `client/src/App.tsx` 中于连接建立后获取门洞数据
    - 连接成功后调用 `GET /api/doorways` 并初始化 `doorwayStore`
    - 初始化默认布局时创建两个通过门洞相连的房间（如不存在）
    - _需求: 7.5_

- [x] 16. 集成测试
  - [ ]* 16.1 在 `server/src/tests/integration/doorway.integration.test.ts` 中编写集成测试
    - 测试完整 bot 移动流程：从房间 A 通过门洞移动到房间 B，验证房间归属更新
    - 测试地图编辑器流程：创建房间 → 放置墙体 → 定义门洞 → 保存 → 重新加载
    - 测试 WebSocket 通知：房间归属变化时客户端收到 `room.membership_changed` 事件
    - _需求: 4.5, 5.1, 5.2, 5.3, 7.5_

- [x] 17. 最终检查点 — 确保所有测试通过，如有疑问请询问用户

## 备注

- 标有 `*` 的子任务为可选测试任务，可跳过以加快 MVP 进度
- 每个任务均引用了具体的需求编号以保证可追溯性
- 属性测试使用 `fast-check` 库，每个属性至少运行 100 次迭代
- 检查点任务确保增量验证，避免后期集成问题
