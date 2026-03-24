# 需求文档：Zone 障碍物系统（Room 系统移除与 Zone 简化重构）

## 简介

本次重构将现有的多房间（Room）系统简化为单一大 Zone 系统。移除 Room、Doorway、RoomMembership 等概念，所有玩家在同一个 Zone 中活动。在 Zone 中支持放置障碍物（Obstacle）和墙体（Wall）作为碰撞体，保留并适配现有的碰撞检测系统至 Zone 级别。

## 术语表

- **Zone**: 游戏世界中的一个区域，具有边界（bounds）、类型（type）和规则（rules），所有玩家在同一个大 Zone 中活动
- **Obstacle**: Zone 内放置的障碍物碰撞体，具有位置（x, y）、尺寸（width, height）和可选旋转（rotation）属性
- **Wall**: Zone 内放置的墙体碰撞体，与 Obstacle 类似但语义上表示不可通过的边界墙
- **CollisionSystem**: 基于 AABB 的碰撞检测系统，使用空间网格索引加速碰撞查询
- **SpatialIndex**: 基于网格的空间索引，将实体映射到网格单元以加速邻近查询
- **Bot**: 游戏中的参与者实体（Contestant），具有位置和碰撞箱
- **ObstacleConfig**: 障碍物和墙体的硬编码或配置文件定义，直接在代码中维护
- **PathfindingSystem**: 寻路系统，基于 A* 算法在 Zone 内寻找避开障碍物的路径
- **WorldManager**: 服务端世界管理器，管理 Zone、玩家位置和区域规则

## 需求

### 需求 1：移除 Room 系统

**用户故事：** 作为开发者，我希望移除整个 Room 系统相关代码，以便简化架构为单一 Zone 模型。

#### 验收标准

1. THE 重构过程 SHALL 删除服务端 room-manager 模块（server/src/modules/room-manager.ts）
2. THE 重构过程 SHALL 删除服务端 room-membership-service 模块（server/src/modules/room-membership-service.ts）
3. THE 重构过程 SHALL 删除服务端 doorway-manager 模块（server/src/modules/doorway-manager.ts）
4. THE 重构过程 SHALL 删除服务端 rooms 路由（server/src/routes/rooms.ts）
5. THE 重构过程 SHALL 删除服务端 doorways 路由（server/src/routes/doorways.ts）
6. THE 重构过程 SHALL 删除客户端 roomStore（client/src/stores/roomStore.ts）
7. THE 重构过程 SHALL 删除客户端 doorwayStore（client/src/stores/doorwayStore.ts）
8. THE 重构过程 SHALL 删除客户端 RoomManagementPanel 组件（client/src/components/RoomManagementPanel.tsx）
9. THE 重构过程 SHALL 删除客户端 RoomList 组件（client/src/components/RoomList.tsx）
10. THE 重构过程 SHALL 从数据库 schema 中移除 rooms、room_bots、doorways、room_configs 表
11. THE 重构过程 SHALL 移除所有对已删除模块的 import 引用，确保编译通过
12. THE 重构过程 SHALL 删除与 Room 系统相关的测试文件（room-isolation、room-capacity、multi-room 集成测试等）

### 需求 2：Wall 和 Obstacle 数据模型重构

**用户故事：** 作为开发者，我希望将 Wall 和 Obstacle 的数据模型从 Room 级别迁移到 Zone 级别，以便在单一 Zone 中管理碰撞体。

#### 验收标准

1. THE 数据库 SHALL 将 walls 表的 room_id 外键替换为 zone_id 外键，关联到 zones 表
2. THE 数据库 SHALL 新增 obstacles 表，包含 id、zone_id、x、y、width、height、rotation、type（如 'rock'、'tree'、'crate'）和 created_at 字段
3. THE 服务端类型定义 SHALL 更新 Wall 接口，将 roomId 字段替换为 zoneId 字段
4. THE 服务端类型定义 SHALL 新增 Obstacle 接口，包含 id、zoneId、x、y、width、height、rotation 和 type 字段
5. THE spawn_points 表 SHALL 将 room_id 外键替换为 zone_id 外键，关联到 zones 表
6. THE 客户端类型定义 SHALL 同步更新 Wall 和 Obstacle 的接口定义，与服务端保持一致

### 需求 3：碰撞检测系统适配

**用户故事：** 作为开发者，我希望碰撞检测系统从 Room 级别适配为 Zone 级别，以便在单一 Zone 中正确检测 Bot 与障碍物、墙体的碰撞。

#### 验收标准

1. WHEN 服务端 CollisionManager 接收到移动验证请求时，THE CollisionManager SHALL 使用 zoneId 替代 roomId 作为碰撞检测的作用域参数
2. WHEN 服务端 CollisionManager 检测墙体碰撞时，THE CollisionManager SHALL 查询指定 Zone 内的所有 Wall 进行 AABB 碰撞检测
3. WHEN 服务端 CollisionManager 检测障碍物碰撞时，THE CollisionManager SHALL 查询指定 Zone 内的所有 Obstacle 进行 AABB 碰撞检测
4. THE CollisionManager SHALL 移除所有与 Doorway 相关的碰撞豁免逻辑（checkWallCollisionWithDoorways、_isPositionInDoorway 等方法）
5. THE CollisionManager SHALL 移除 validateCrossRoomMovement 方法
6. THE 服务端碰撞 API 路由 SHALL 将请求参数中的 roomId 替换为 zoneId
7. WHEN 客户端 CollisionSystem 执行碰撞检测时，THE CollisionSystem SHALL 移除 Doorway 相关的碰撞豁免逻辑（checkWallCollisionWithDoorways 方法）
8. THE 客户端 CollisionSystem SHALL 新增 checkObstacleCollision 方法，对 Obstacle 列表执行 AABB 碰撞检测
9. THE 客户端 CollisionSystem 的 validateMove 方法 SHALL 依次检测 Bot 碰撞、Wall 碰撞和 Obstacle 碰撞
10. THE 客户端 collisionStore SHALL 将 spatialGrids 的键从 roomId 替换为 zoneId
11. THE 客户端 collisionStore 的 checkCollision 方法 SHALL 新增对 Obstacle 列表的碰撞检测

### 需求 4：移除地图编辑器功能

**用户故事：** 作为开发者，我希望移除地图编辑器功能，因为障碍物和墙体配置将通过代码实现，不需要专门的地图编辑器 UI。

#### 验收标准

1. THE 重构过程 SHALL 删除客户端 MapEditor 组件（client/src/components/MapEditor.tsx）
2. THE 重构过程 SHALL 删除客户端 editorStore（client/src/stores/editorStore.ts）
3. THE 重构过程 SHALL 删除服务端 map-editor-manager 模块（server/src/modules/map-editor-manager.ts）
4. THE 重构过程 SHALL 删除服务端 map-editor 路由（server/src/routes/map-editor.ts）
5. THE 重构过程 SHALL 删除地图编辑器集成测试（server/src/tests/integration/map-editor.integration.test.ts）
6. THE 重构过程 SHALL 删除地图编辑器示例文件（examples/map-editor-example.tsx）
7. THE 重构过程 SHALL 移除所有对已删除地图编辑器模块的 import 引用，确保编译通过
8. THE 重构过程 SHALL 移除 app.ts 中对 map-editor 路由的注册
9. IF 客户端路由配置中存在 map-editor 相关路由，THEN THE 重构过程 SHALL 删除该路由配置
10. THE 障碍物和墙体配置 SHALL 通过代码中的硬编码或配置文件定义，在服务端初始化时加载到数据库

### 需求 4.5：角色精灵与移动动画

**用户故事：** 作为开发者，我希望所有 agent 角色使用指定的图片资源，并根据移动方向切换动画帧，移动速度适中不过快。

#### 验收标准

1. THE BootScene SHALL 加载 `/maps/ghost.png` 作为纹理键 `ghost`（静止状态）
2. THE BootScene SHALL 加载 `/maps/leftmove.png` 作为纹理键 `leftmove`（向左移动）
3. THE BootScene SHALL 加载 `/maps/rightmove.png` 作为纹理键 `rightmove`（向右移动）
4. THE SpriteManager SHALL 在 addContestant 时使用 `ghost` 纹理作为默认静止图
5. WHEN agent 开始向左移动时，THE SpriteManager SHALL 将 image 纹理切换为 `leftmove`
6. WHEN agent 开始向右移动时，THE SpriteManager SHALL 将 image 纹理切换为 `rightmove`
7. WHEN agent 移动 tween 完成时，THE SpriteManager SHALL 将 image 纹理恢复为 `ghost`
8. THE SpriteManager 的移动速度常量 MOVEMENT_SPEED SHALL 调整为 0.08（像素/毫秒），使移动更缓慢自然
9. THE SpriteManager 的 TWEEN_MAX_MS SHALL 调整为 3000ms，允许更长的移动动画时间

### 需求 5：寻路系统适配

**用户故事：** 作为开发者，我希望寻路系统从多房间模型适配为单一 Zone 模型，以便在 Zone 内正确避开障碍物和墙体寻路。

#### 验收标准

1. THE PathfindingSystem SHALL 移除多房间寻路逻辑（findMultiRoomPath 方法）
2. THE PathfindingSystem SHALL 移除对 RoomGraphBuilder 的依赖
3. THE PathfindingSystem 的 findPath 方法 SHALL 接受 Zone 的边界和障碍物列表作为参数
4. THE PathfindingSystem 的 findPath 方法 SHALL 将 Obstacle 列表与 Wall 列表合并作为寻路障碍
5. THE PathfindingSystem SHALL 移除 updateRooms、addRoom、updateDoorways、addDoorway、removeDoorway 等 Room/Doorway 相关方法
6. THE PathfindingSystem SHALL 提供 updateZone 方法，接受 Zone 边界、Wall 列表和 Obstacle 列表

### 需求 6：WorldManager 适配

**用户故事：** 作为开发者，我希望 WorldManager 在移除 Room 系统后仍能正确管理玩家位置和 Zone 规则。

#### 验收标准

1. THE WorldManager SHALL 继续使用现有的 Zone 管理功能（createZone、updateZone、deleteZone、getZoneAt 等）
2. THE WorldManager SHALL 移除对 room-manager 和 room-membership-service 的所有依赖引用
3. WHEN Bot 移动时，THE WorldManager SHALL 仅基于 Zone 边界判定 Bot 所在区域，无需考虑 Room 归属
4. THE WorldManager SHALL 新增 getZoneWalls(zoneId: string) 方法，返回指定 Zone 内的所有 Wall
5. THE WorldManager SHALL 新增 getZoneObstacles(zoneId: string) 方法，返回指定 Zone 内的所有 Obstacle

### 需求 7：客户端状态管理重构

**用户故事：** 作为开发者，我希望客户端状态管理从多房间模型简化为单一 Zone 模型，以便减少状态复杂度。

#### 验收标准

1. THE 客户端 SHALL 移除 roomStore 中的所有 Room 相关状态和操作
2. THE 客户端 SHALL 移除 doorwayStore 的全部内容
3. THE 客户端 gameStore SHALL 将 currentRoomId 替换为 currentZoneId（如果存在该字段）
4. THE 客户端 SHALL 在适当的 store 中新增 obstacles 状态，用于存储当前 Zone 的障碍物列表
5. THE 客户端 SHALL 在适当的 store 中新增 walls 状态，用于存储当前 Zone 的墙体列表（从 roomStore 迁移）
6. WHEN 客户端从服务端获取 Zone 数据时，THE 客户端 SHALL 同时获取该 Zone 的 Wall 和 Obstacle 列表

### 需求 8：API 路由清理与适配

**用户故事：** 作为开发者，我希望清理所有与 Room 系统相关的 API 路由，并将碰撞路由适配为 Zone 级别。

#### 验收标准

1. THE app.ts SHALL 移除对 rooms 路由和 doorways 路由的注册
2. THE 碰撞 API（/api/collision/validate-move）SHALL 将请求体中的 roomId 参数替换为 zoneId
3. THE 碰撞 API（/api/collision/nearby-bots）SHALL 将查询参数中的 roomId 替换为 zoneId
4. THE WebSocket 广播碰撞事件 SHALL 将 roomId 参数替换为 zoneId
5. IF 客户端 api-client 中存在 Room、Doorway 或 MapEditor 相关的 API 调用方法，THEN THE api-client SHALL 移除这些方法

### 需求 9：数据库迁移

**用户故事：** 作为开发者，我希望数据库 schema 正确迁移，移除 Room 相关表并适配 Wall/Obstacle 表结构。

#### 验收标准

1. THE 数据库初始化 SHALL 移除 rooms 表的创建语句
2. THE 数据库初始化 SHALL 移除 room_bots 表的创建语句
3. THE 数据库初始化 SHALL 移除 doorways 表的创建语句
4. THE 数据库初始化 SHALL 移除 room_configs 表的创建语句
5. THE 数据库初始化 SHALL 将 walls 表的 room_id 字段替换为 zone_id 字段，外键关联到 zones 表
6. THE 数据库初始化 SHALL 将 spawn_points 表的 room_id 字段替换为 zone_id 字段，外键关联到 zones 表
7. THE 数据库初始化 SHALL 新增 obstacles 表，包含 id（TEXT PRIMARY KEY）、zone_id（TEXT NOT NULL，外键关联 zones）、x（REAL）、y（REAL）、width（REAL）、height（REAL）、rotation（REAL DEFAULT 0）、type（TEXT DEFAULT 'generic'）和 created_at（TIMESTAMP）字段
8. THE 数据库初始化 SHALL 移除 seedDefaultRoom 函数的调用
9. THE 数据库初始化 SHALL 新增 zone_configs 表替代 room_configs 表，将 room_id 替换为 zone_id

### 需求 10：测试清理与新增

**用户故事：** 作为开发者，我希望清理与 Room 系统和地图编辑器相关的测试，并为新的 Zone 障碍物碰撞功能新增测试。

#### 验收标准

1. THE 重构过程 SHALL 删除 room-isolation.property.test.ts 测试文件
2. THE 重构过程 SHALL 删除 room-capacity.property.test.ts 测试文件
3. THE 重构过程 SHALL 删除 client/src/tests/integration/multi-room.integration.test.ts 测试文件
4. THE 重构过程 SHALL 删除 server/src/tests/integration/multi-room.integration.test.ts 测试文件
5. THE 重构过程 SHALL 更新 collision-detection.property.test.ts，将 roomId 替换为 zoneId 并新增 Obstacle 碰撞测试
6. THE 重构过程 SHALL 更新 spawn-point-collision.property.test.ts，将 roomId 替换为 zoneId
7. THE 重构过程 SHALL 更新 movement-atomicity.property.test.ts，移除 Room 相关的移动原子性测试逻辑
8. THE 重构过程 SHALL 删除地图编辑器集成测试文件（server/src/tests/integration/map-editor.integration.test.ts，已在需求 4 中覆盖）
