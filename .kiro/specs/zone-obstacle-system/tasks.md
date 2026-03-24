# 实现计划：Zone 障碍物系统

## 概览

将多房间（Room）系统重构为单一 Zone 系统。按依赖顺序执行：先删除废弃文件，再迁移数据库 schema，然后逐层适配服务端和客户端代码，最后更新属性测试并验证编译。

## 任务

- [x] 1. 删除废弃文件
  - [x] 1.1 删除服务端 Room/Doorway/MapEditor 模块文件
    - 删除 `server/src/modules/room-manager.ts`
    - 删除 `server/src/modules/room-membership-service.ts`
    - 删除 `server/src/modules/doorway-manager.ts`
    - 删除 `server/src/modules/map-editor-manager.ts`
    - 删除 `server/src/routes/rooms.ts`
    - 删除 `server/src/routes/doorways.ts`
    - 删除 `server/src/routes/map-editor.ts`
    - _需求: 1.1, 1.2, 1.3, 4.3, 4.4_

  - [x] 1.2 删除客户端 Store 和组件文件
    - 删除 `client/src/stores/roomStore.ts`
    - 删除 `client/src/stores/doorwayStore.ts`（如存在）
    - 删除 `client/src/stores/editorStore.ts`
    - 删除 `client/src/components/RoomManagementPanel.tsx`
    - 删除 `client/src/components/RoomList.tsx`
    - 删除 `client/src/components/MapEditor.tsx`
    - _需求: 1.6, 1.7, 1.8, 1.9, 4.1, 4.2_

  - [x] 1.3 删除废弃测试文件
    - 删除 `server/src/tests/property/room-isolation.property.test.ts`
    - 删除 `server/src/tests/property/room-capacity.property.test.ts`
    - 删除 `server/src/tests/integration/multi-room.integration.test.ts`
    - 删除 `server/src/tests/integration/map-editor.integration.test.ts`
    - 删除 `client/src/tests/integration/multi-room.integration.test.ts`
    - 删除 `examples/map-editor-example.tsx`
    - _需求: 1.12, 4.5, 10.1, 10.2, 10.3, 10.4_

  - [x] 1.4 删除寻路系统中的 RoomGraphBuilder
    - 删除 `client/src/game/pathfinding/room-graph-builder.ts`（如存在）
    - _需求: 5.2_

- [x] 2. 数据库 Schema 迁移（server/src/db.ts）
  - [x] 2.1 更新 `createTables()` 函数
    - 移除 `rooms`、`room_bots`、`doorways`、`room_configs` 表的创建语句
    - 将 `walls` 表的 `room_id` 字段替换为 `zone_id`，外键关联 `zones` 表
    - 将 `spawn_points` 表的 `room_id` 字段替换为 `zone_id`，外键关联 `zones` 表
    - 新增 `obstacles` 表（id、zone_id、x、y、width、height、rotation、type、created_at）
    - 新增 `zone_configs` 表替代 `room_configs`（zone_id 替换 room_id）
    - _需求: 9.1, 9.2, 9.3, 9.4, 9.5, 9.6, 9.7, 9.9_

  - [x] 2.2 更新 `createIndexes()` 函数
    - 删除 `idx_walls_room_id`、`idx_spawn_points_room_id`、`idx_room_configs_room_id` 等旧索引
    - 删除 `idx_room_bots_*`、`idx_doorways_*` 相关索引
    - 新增 `idx_walls_zone_id`、`idx_spawn_points_zone_id`、`idx_obstacles_zone_id`、`idx_zone_configs_zone_id`
    - _需求: 9.5, 9.6_

  - [x] 2.3 新增 `seedWalls()` 和 `seedObstacles()` 函数
    - 实现 `seedWalls()`：硬编码写入 zone-main-hall 的边界墙体，使用 `INSERT OR IGNORE`
    - 实现 `seedObstacles()`：硬编码写入石块、树木、箱子等障碍物（参考设计文档中的 DEFAULT_OBSTACLES），使用 `INSERT OR IGNORE`
    - 实现 `seedSpawnPoints()`：写入 zone 级别的出生点（zone_id 替代 room_id）
    - _需求: 4.10, 9.7_

  - [x] 2.4 更新 `initializeDatabase()` 调用顺序
    - 移除 `seedDefaultRoom()` 调用
    - 新增 `seedWalls()`、`seedObstacles()`、`seedSpawnPoints()` 调用
    - _需求: 9.8_

- [x] 3. 服务端类型定义更新（server/src/types/index.ts）
  - [x] 3.1 删除废弃接口
    - 删除 `Room`、`RoomConfig`、`RoomBot`、`Doorway`、`DoorwayConfig`、`MembershipChange`、`RoomType` 接口
    - _需求: 1.11_

  - [x] 3.2 更新和新增接口
    - 更新 `Wall` 接口：将 `roomId` 替换为 `zoneId`
    - 更新 `SpawnPoint` 接口：将 `roomId` 替换为 `zoneId`
    - 新增 `Obstacle` 接口（id、zoneId、x、y、width、height、rotation、type）
    - 在 `IWorldManager` 接口中新增 `getZoneWalls(zoneId: string): Wall[]` 和 `getZoneObstacles(zoneId: string): Obstacle[]` 方法签名
    - _需求: 2.3, 2.4, 6.4, 6.5_

- [x] 4. 服务端模块适配
  - [x] 4.1 适配 WorldManager（server/src/modules/world-manager.ts）
    - 删除对 `room-manager` 和 `room-membership-service` 的所有 import 引用
    - 新增 `getZoneWalls(zoneId: string): Wall[]` 方法，查询 `walls` 表
    - 新增 `getZoneObstacles(zoneId: string): Obstacle[]` 方法，查询 `obstacles` 表
    - _需求: 6.1, 6.2, 6.4, 6.5_

  - [x] 4.2 适配 CollisionManager（server/src/modules/collision-manager.ts）
    - 删除对 `roomManager`、`doorwayManager`、`roomMembershipService` 的 import 引用
    - 将所有方法签名中的 `roomId` 参数替换为 `zoneId`
    - 删除 `checkWallCollisionWithDoorways()`、`validateCrossRoomMovement()`、`_isPositionInDoorway()` 方法
    - 新增 `checkObstacleCollision(zoneId, targetPos, size)` 方法，通过 `worldManager.getZoneObstacles(zoneId)` 获取障碍物并执行 AABB 检测
    - 更新 `validateMovement()` 检测顺序：Bot 碰撞 → Wall 碰撞 → Obstacle 碰撞
    - 将 `spatialIndex` 的键语义从 `roomId` 改为 `zoneId`
    - _需求: 3.1, 3.2, 3.3, 3.4, 3.5_

- [x] 5. 服务端路由适配
  - [x] 5.1 适配碰撞路由（server/src/routes/collision.ts）
    - 将 `POST /api/collision/validate-move` 请求体中的 `roomId` 替换为 `zoneId`
    - 将 `GET /api/collision/nearby-bots` 查询参数中的 `roomId` 替换为 `zoneId`
    - 更新参数校验逻辑（`zoneId` 不能为空）
    - _需求: 3.6, 8.2, 8.3_

  - [x] 5.2 适配 app.ts 路由注册
    - 删除 `app.use('/api/rooms', ...)` 注册
    - 删除 `app.use('/api/doorways', ...)` 注册
    - 删除 `app.use('/api/map-editor', ...)` 注册
    - 删除对已删除路由模块的 import 引用
    - _需求: 4.8, 8.1_

  - [x] 5.3 适配 WebSocket 广播（server/src/ws.ts）
    - 将碰撞广播事件中的 `roomId` 字段替换为 `zoneId`
    - _需求: 8.4_

- [x] 6. 客户端 Store 重构
  - [x] 6.1 更新 collisionStore（client/src/stores/collisionStore.ts）
    - 将 `spatialGrids` 的键语义从 `roomId` 改为 `zoneId`（类型不变，仅语义和注释更新）
    - 更新 `checkCollision` 方法签名，新增 `obstacles: Obstacle[]` 参数
    - 将 `walls` 过滤条件从 `wall.roomId` 改为 `wall.zoneId`
    - 更新相关类型导入（从 `types/index.ts` 导入 `Obstacle`）
    - _需求: 3.10, 3.11_

  - [x] 6.2 新增 zoneStore（client/src/stores/zoneStore.ts）
    - 创建 `ZoneState` 接口，包含 `currentZoneId`、`walls`、`obstacles` 状态
    - 实现 `setWalls()`、`setObstacles()`、`setCurrentZoneId()` 操作
    - _需求: 7.4, 7.5, 7.6_

  - [x] 6.3 更新 stores/index.ts
    - 移除对已删除 store（roomStore、doorwayStore、editorStore）的导出引用
    - 新增对 `zoneStore` 的导出
    - _需求: 1.11_

  - [x] 6.4 更新 gameStore（client/src/stores/gameStore.ts）
    - 将 `currentRoomId` 字段替换为 `currentZoneId`（如存在该字段）
    - _需求: 7.3_

- [x] 7. 客户端碰撞系统适配（client/src/game/collision-system.ts）
  - [x] 7.1 清理废弃依赖和方法
    - 删除对 `doorwayStore`、`roomStore` 的 import 引用
    - 删除 `checkWallCollisionWithDoorways()` 方法
    - 删除 `_isPositionInDoorway()` 私有方法
    - _需求: 3.7_

  - [x] 7.2 新增 Obstacle 碰撞检测方法
    - 实现 `checkObstacleCollision(position, obstacles: Obstacle[]): CollisionResult`，对 Obstacle 列表执行 AABB 碰撞检测
    - 更新 `validateMove` 签名，新增 `obstacles: Obstacle[]` 参数
    - 更新 `validateMove` 检测顺序：Bot 碰撞 → Wall 碰撞 → Obstacle 碰撞
    - _需求: 3.8, 3.9_

  - [ ]* 7.3 为 checkObstacleCollision 编写属性测试
    - **Property 2：客户端 AABB 碰撞检测覆盖 Obstacle**
    - **Validates: Requirements 3.8, 3.9**

- [-] 8. 客户端寻路系统适配（client/src/game/pathfinding-system.ts）
  - [x] 8.1 删除多房间寻路逻辑
    - 删除 `import { RoomGraphBuilder }` 及其实例
    - 删除 `findMultiRoomPath()` 方法
    - 删除 `updateRooms()`、`addRoom()`、`updateDoorways()`、`addDoorway()`、`removeDoorway()` 方法
    - 删除 `rooms: Map<string, Room>` 和 `doorways: Map<string, Doorway>` 成员变量
    - _需求: 5.1, 5.2, 5.5_

  - [x] 8.2 新增 Zone 级别寻路方法
    - 新增 `updateZone(bounds, walls, obstacles)` 方法，将 Obstacle 转换为 Wall 格式合并到障碍列表
    - 更新 `findPath` 签名，接受 Zone 边界、Wall 列表和 Obstacle 列表作为参数
    - _需求: 5.3, 5.4, 5.6_

  - [ ]* 8.3 为 findPath 编写属性测试
    - **Property 6：findPath 将 Wall 和 Obstacle 合并为障碍**
    - **Validates: Requirements 5.3, 5.4**

- [x] 9. 客户端组件清理
  - [x] 9.1 更新 UIOverlay 和 App.tsx
    - 从 `client/src/components/UIOverlay.tsx` 中移除对 `RoomManagementPanel`、`RoomList`、`MapEditor` 的 import 和使用
    - 从 `client/src/App.tsx` 中移除对已删除组件和 store 的 import 引用
    - 如存在 map-editor 相关路由配置，一并删除
    - _需求: 1.11, 4.7, 4.9_

  - [x] 9.2 更新 api-client（client/src/services/api-client.ts）
    - 移除 Room、Doorway、MapEditor 相关的 API 调用方法
    - _需求: 8.5_

- [x] 10. 属性测试更新
  - [ ]* 10.1 更新 collision-detection.property.test.ts
    - 将所有 `roomId` 替换为 `zoneId`
    - 新增 Obstacle 碰撞的属性测试（Property 1）
    - 添加注释标签 `// Feature: zone-obstacle-system, Property 1`
    - _需求: 10.5_

  - [ ]* 10.2 更新 spawn-point-collision.property.test.ts
    - 将所有 `roomId` 替换为 `zoneId`
    - 添加注释标签 `// Feature: zone-obstacle-system`
    - _需求: 10.6_

  - [ ]* 10.3 更新 movement-atomicity.property.test.ts
    - 移除 Room 相关的移动原子性测试逻辑
    - _需求: 10.7_

  - [ ]* 10.4 为 collisionStore 编写属性测试
    - **Property 3：collisionStore 基于 zoneId 的空间索引与碰撞检测**
    - **Validates: Requirements 3.10, 3.11**

  - [ ]* 10.5 为 WorldManager 编写属性测试
    - **Property 7：WorldManager Zone 碰撞体查询 round-trip**
    - **Validates: Requirements 6.4, 6.5**

- [x] 11. 编译验证
  - [x] 11.1 检查并修复所有残留的废弃 import 引用
    - 搜索代码库中所有对 `roomStore`、`doorwayStore`、`editorStore`、`room-manager`、`doorway-manager`、`map-editor-manager` 的 import 引用
    - 搜索所有对已删除组件（`RoomManagementPanel`、`RoomList`、`MapEditor`）的引用
    - 逐一修复或删除这些引用，确保 TypeScript 编译通过
    - _需求: 1.11, 4.7_

  - [x] 11.2 最终检查点
    - 确保所有测试通过，向用户确认是否有疑问。

## 备注

- 标有 `*` 的子任务为可选项，可跳过以加快 MVP 进度
- 每个任务均引用具体需求条目以保证可追溯性
- 任务 1（删除文件）必须在任务 2-11 之前完成，避免编译错误
- 需求 4.5（精灵动画）相关代码已在之前会话中完成，不在本任务列表中重复
