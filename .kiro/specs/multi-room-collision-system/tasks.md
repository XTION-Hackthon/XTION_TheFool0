# 实现计划：多房间碰撞系统

## 概览

基于现有的 XTION_TheFool0 平台架构（Node.js + Express + SQLite 后端，React + Phaser 3 前端），为前端引入多房间架构和物理碰撞检测。按模块递增实现，每个任务构建在前一个任务之上。

## 任务列表

- [ ] 1. 数据库与后端基础设施
  - [x] 1.1 扩展数据库表结构
    - 创建 `rooms` 表：id, name, type (MainHall/PrivateRoom), capacity, bounds_x1, bounds_y1, bounds_x2, bounds_y2, created_at, updated_at
    - 创建 `walls` 表：id, room_id, x, y, width, height, rotation, created_at
    - 创建 `spawn_points` 表：id, room_id, x, y, is_available, created_at
    - 创建 `room_configs` 表：id, room_id, config_json, version, created_at
    - 创建 `room_bots` 表：id, room_id, bot_id, position_x, position_y, joined_at
    - 需求：7, 8

  - [x] 1.2 实现 RoomManager 后端模块
    - 创建 `server/src/modules/room-manager.ts`
    - 实现房间CRUD操作：createRoom, deleteRoom, updateRoom, getRoom, getAllRooms
    - 实现容量管理：canJoinRoom, addBotToRoom, removeBotFromRoom
    - 实现出生点分配：allocateSpawnPoint, getAvailableSpawnPoints
    - 数据持久化到SQLite
    - 需求：1, 2, 11

  - [x] 1.3 实现 CollisionManager 后端模块
    - 创建 `server/src/modules/collision-manager.ts`
    - 实现碰撞检测：checkBotCollision, checkWallCollision, validateMovement
    - 实现空间索引：updateSpatialIndex, getNearbyBots
    - 实现碰撞信息查询：getCollisionInfo
    - 需求：3, 4, 5, 8

  - [x] 1.4 实现 MapEditorManager 后端模块
    - 创建 `server/src/modules/map-editor-manager.ts`
    - 实现配置管理：saveRoomConfiguration, loadRoomConfiguration, deleteRoomConfiguration
    - 实现配置验证：validateConfiguration, validateWalls, validateSpawnPoints
    - 实现版本管理：getConfigurationHistory, rollbackConfiguration
    - 需求：6, 7

  - [x] 1.5 创建房间管理API路由
    - 创建 `server/src/routes/rooms.ts`
    - POST `/api/rooms` — 创建房间
    - GET `/api/rooms` — 获取所有房间
    - GET `/api/rooms/:id` — 获取房间详情
    - PUT `/api/rooms/:id` — 更新房间
    - DELETE `/api/rooms/:id` — 删除房间
    - POST `/api/rooms/:id/join` — 加入房间
    - POST `/api/rooms/:id/leave` — 离开房间
    - 需求：1, 2, 9

  - [x] 1.6 创建碰撞检测API路由
    - 创建 `server/src/routes/collision.ts`
    - POST `/api/collision/validate-move` — 验证移动
    - GET `/api/collision/nearby-bots` — 查询附近bot
    - 需求：3, 4, 5

  - [x] 1.7 创建地图编辑API路由
    - 创建 `server/src/routes/map-editor.ts`
    - POST `/api/map-editor/rooms/:id/config` — 保存房间配置
    - GET `/api/map-editor/rooms/:id/config` — 获取房间配置
    - GET `/api/map-editor/rooms/:id/config/history` — 获取配置历史
    - POST `/api/map-editor/rooms/:id/config/rollback` — 回滚配置
    - 需求：6, 7

- [x] 2. 检查点 — 后端基础设施验证
  - 确保所有后端模块可编译运行，API路由可正常调用，数据库操作成功。

- [ ] 3. 前端状态管理与Store
  - [x] 3.1 实现 RoomStore (Zustand)
    - 创建 `client/src/stores/roomStore.ts`
    - 定义 Room, Bot, Wall, SpawnPoint 接口
    - 实现房间操作：createRoom, deleteRoom, updateRoom, switchRoom
    - 实现Bot管理：addBotToRoom, removeBotFromRoom, updateBotPosition
    - 实现房间状态订阅与同步
    - 需求：1, 2, 9

  - [x] 3.2 实现 CollisionStore (Zustand)
    - 创建 `client/src/stores/collisionStore.ts`
    - 定义 CollisionBox, CollisionEvent, SpatialGrid 接口
    - 实现碰撞检测：checkCollision, updateSpatialIndex
    - 实现查询：getNearbyBots, getWallsInArea
    - 实现碰撞事件记录
    - 需求：3, 4, 5, 8

  - [x] 3.3 实现 EditorStore (Zustand)
    - 创建 `client/src/stores/editorStore.ts`
    - 定义编辑器状态接口
    - 实现编辑操作：startEditing, stopEditing, addWall, removeWall, updateWall, addSpawnPoint, removeSpawnPoint
    - 实现验证和保存：validateConfiguration, saveConfiguration
    - 需求：6, 7

  - [x] 3.4 更新 gameStore 支持多房间
    - 修改 `client/src/stores/gameStore.ts`
    - 添加当前房间ID字段
    - 添加房间列表字段
    - 实现房间切换逻辑
    - 需求：1, 9

- [ ] 4. 前端UI组件
  - [x] 4.1 实现房间列表组件
    - 创建 `client/src/components/RoomList.tsx`
    - 显示所有可用房间
    - 显示房间容量和当前人数
    - 支持加入/离开房间
    - 需求：1, 2

  - [x] 4.2 实现房间管理面板
    - 创建 `client/src/components/RoomManagementPanel.tsx`
    - 显示当前房间信息
    - 显示房间内的bot列表
    - 支持房间切换
    - 需求：1, 9

  - [x] 4.3 实现地图编辑器UI
    - 创建 `client/src/components/MapEditor.tsx`
    - Canvas画布显示房间、墙体、出生点
    - 工具栏：选择编辑工具（墙体、出生点、边界）
    - 属性面板：编辑选中对象的属性
    - 预览面板：实时预览碰撞效果
    - 需求：6

  - [x] 4.4 实现碰撞可视化组件
    - 创建 `client/src/components/CollisionVisualization.tsx`
    - 显示bot碰撞箱
    - 显示墙体
    - 显示碰撞事件
    - 需求：3, 4, 5

- [ ] 5. GameScene扩展与碰撞检测集成
  - [x] 5.1 扩展GameScene支持多房间
    - 修改 `client/src/game/GameScene.ts`
    - 添加房间管理：currentRoom, roomBots, walls
    - 实现房间加载：loadRoom(roomId)
    - 实现房间渲染：renderWalls, renderSpawnPoints, renderBots
    - 需求：1, 4, 6

  - [x] 5.2 实现碰撞检测系统
    - 创建 `client/src/game/collision-system.ts`
    - 实现AABB碰撞检测算法
    - 实现空间索引（Grid-based）
    - 实现碰撞查询接口
    - 需求：3, 4, 5, 8

  - [x] 5.3 实现移动验证与处理
    - 修改 `client/src/game/GameScene.ts`
    - 实现handleBotMovement方法
    - 调用后端验证移动
    - 处理碰撞错误
    - 更新bot位置
    - 需求：3, 4, 5, 10

  - [x] 5.4 实现出生点分配与渲染
    - 修改 `client/src/game/GameScene.ts`
    - 实现renderSpawnPoints方法
    - 支持新bot出生时的位置分配
    - 需求：11

- [x] 6. WebSocket集成与实时同步
  - [x] 6.1 实现房间状态推送
    - 修改 `server/src/ws.ts`
    - 房间状态变化时推送给所有在线客户端
    - 推送房间容量变化
    - 推送bot加入/离开事件
    - 需求：1, 2, 9

  - [x] 6.2 实现碰撞事件推送
    - 修改 `server/src/ws.ts`
    - 碰撞检测后推送碰撞事件
    - 推送碰撞信息（碰撞类型、位置、涉及对象）
    - 需求：3, 4, 5, 10

  - [x] 6.3 实现出生点分配推送
    - 修改 `server/src/ws.ts`
    - bot加入房间时推送分配的出生点
    - 需求：11

  - [x] 6.4 更新Move API集成碰撞检测
    - 修改 `server/src/routes/move.ts`
    - 调用CollisionManager.validateMovement验证移动
    - 验证失败返回碰撞错误
    - 验证成功更新bot位置
    - 需求：3, 4, 5

- [x] 7. 属性测试与正确性验证
  - [x] 7.1 编写碰撞检测完整性属性测试
    - 创建 `server/src/tests/property/collision-detection.property.test.ts`
    - **Property 1: 碰撞检测完整性** — 对于任意两个bot，如果碰撞箱重叠，系统必须检测到碰撞
    - **Property 2: 墙体碰撞检测** — 对于任意bot和墙体，如果碰撞箱与墙体重叠，系统必须检测到碰撞
    - 需求：3, 4, 5

  - [x] 7.2 编写移动原子性属性测试
    - 创建 `server/src/tests/property/movement-atomicity.property.test.ts`
    - **Property 3: 移动原子性** — 移动操作要么完全成功，要么完全失败
    - 需求：3, 5

  - [x] 7.3 编写房间容量约束属性测试
    - 创建 `server/src/tests/property/room-capacity.property.test.ts`
    - **Property 4: 房间容量约束** — 私聊房间的bot数量不应超过容量限制
    - 需求：2

  - [x] 7.4 编写出生点无碰撞属性测试
    - 创建 `server/src/tests/property/spawn-point-collision.property.test.ts`
    - **Property 5: 出生点无碰撞** — 新bot出生时不应与现有bot碰撞
    - 需求：11

  - [x] 7.5 编写房间隔离属性测试
    - 创建 `server/src/tests/property/room-isolation.property.test.ts`
    - **Property 6: 房间隔离** — 不同房间的bot不应相互碰撞
    - 需求：1, 8

- [x] 8. 集成测试与端到端验证
  - [x] 8.1 编写多房间场景集成测试
    - 创建 `server/src/tests/integration/multi-room.integration.test.ts`
    - 测试创建主大厅和私聊房间
    - 测试bot加入/离开房间
    - 测试房间容量限制
    - 需求：1, 2, 9

  - [x] 8.2 编写碰撞检测集成测试
    - 创建 `server/src/tests/integration/collision.integration.test.ts`
    - 测试bot-bot碰撞检测
    - 测试bot-wall碰撞检测
    - 测试移动验证
    - 需求：3, 4, 5, 10

  - [x] 8.3 编写地图编辑集成测试
    - 创建 `server/src/tests/integration/map-editor.integration.test.ts`
    - 测试房间配置保存和加载
    - 测试配置验证
    - 测试版本回滚
    - 需求：6, 7

  - [x] 8.4 编写前端集成测试
    - 创建 `client/src/tests/integration/multi-room.integration.test.ts`
    - 测试房间列表显示
    - 测试房间切换
    - 测试碰撞可视化
    - 需求：1, 2, 3, 4, 5

- [x] 9. 性能优化与调优
  - [x] 9.1 优化空间索引性能
    - 调整Grid-based索引的网格大小
    - 测试不同bot数量下的性能
    - 目标：碰撞检测延迟 < 10ms（100个bot）
    - 需求：8

  - [x] 9.2 优化碰撞检测性能
    - 实现碰撞检测结果缓存
    - 减少不必要的碰撞检查
    - 目标：出生点分配延迟 < 5ms
    - 需求：8, 11

  - [x] 9.3 优化渲染性能
    - 使用Phaser对象池管理精灵
    - 仅渲染可见区域内的对象
    - 使用脏标记减少重绘
    - 目标：房间切换延迟 < 100ms
    - 需求：1, 9

  - [x] 9.4 优化网络传输
    - 压缩碰撞事件数据
    - 批量推送状态更新
    - 实现增量同步
    - 需求：6

- [x] 10. 文档与示例
  - [x] 10.1 编写API文档
    - 创建 `docs/api/rooms.md` — 房间管理API文档
    - 创建 `docs/api/collision.md` — 碰撞检测API文档
    - 创建 `docs/api/map-editor.md` — 地图编辑API文档
    - 需求：1, 3, 6

  - [x] 10.2 编写使用指南
    - 创建 `docs/guides/multi-room-guide.md` — 多房间系统使用指南
    - 创建 `docs/guides/map-editor-guide.md` — 地图编辑器使用指南
    - 创建 `docs/guides/collision-guide.md` — 碰撞检测使用指南
    - 需求：1, 6

  - [x] 10.3 编写示例代码
    - 创建 `examples/multi-room-example.ts` — 多房间使用示例
    - 创建 `examples/collision-example.ts` — 碰撞检测使用示例
    - 创建 `examples/map-editor-example.tsx` — 地图编辑器使用示例
    - 需求：1, 3, 6

- [ ] 11. 最终验收与部署
  - [x] 11.1 功能验收
    - 验证所有需求都已实现
    - 验证所有属性测试都通过
    - 验证所有集成测试都通过
    - 需求：全部

  - [x] 11.2 性能验收
    - 验证碰撞检测延迟 < 10ms
    - 验证出生点分配延迟 < 5ms
    - 验证房间切换延迟 < 100ms
    - 需求：8

  - [x] 11.3 代码审查与优化
    - 代码风格检查
    - 性能瓶颈分析
    - 安全性审查
    - 需求：全部

  - [ ] 11.4 部署与上线
    - 构建生产版本
    - 部署到测试环境
    - 进行端到端测试
    - 部署到生产环境
    - 需求：全部
