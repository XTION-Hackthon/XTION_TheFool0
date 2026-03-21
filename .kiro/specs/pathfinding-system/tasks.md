# 寻路系统实现计划

## 任务列表

- [x] 1. 实现 GridPathfinder
  - [x] 1.1 创建 `client/src/game/pathfinding/grid-pathfinder.ts`
    - 实现 `GridPathfinder` 类
    - 实现 `findPath` 方法（A* 算法）
    - 实现 `isWalkable` 检查（墙体、门洞、bot）
    - 实现 `smoothPath` 路径平滑
    - 实现 `getNeighbors` 8 方向邻居生成
    - 实现 `heuristic` 欧几里得距离
    - _需求: 1.1, 1.2, 1.3_

- [x] 2. 实现 RoomGraphBuilder
  - [x] 2.1 创建 `client/src/game/pathfinding/room-graph-builder.ts`
    - 实现 `RoomGraphBuilder` 类
    - 实现 `buildGraph` 方法（构建房间图）
    - 实现 `getPath` 方法（BFS 查询房间路径）
    - 实现 `getDoorwayCenter` 方法
    - 实现 `updateRooms` 和 `updateDoorways` 方法
    - _需求: 2.1, 2.2, 2.3_

- [x] 3. 实现 PathfindingSystem
  - [x] 3.1 创建 `client/src/game/pathfinding-system.ts`
    - 实现 `PathfindingSystem` 类
    - 实现 `findPath` 方法（单房间寻路）
    - 实现 `findMultiRoomPath` 方法（多房间寻路）
    - 实现 `updateRooms` 和 `updateDoorways` 方法
    - 集成 `GridPathfinder` 和 `RoomGraphBuilder`
    - _需求: 3.1, 3.2_

- [x] 4. 集成到 GameScene
  - [x] 4.1 在 `client/src/game/GameScene.ts` 中集成寻路系统
    - 初始化 `PathfindingSystem`
    - 添加公开 API 方法 `moveToTarget()` 供 agent 调用
    - 实现路径执行逻辑（逐步移动）
    - 实现动态重新规划（遇到障碍物时）
    - _需求: 3.1, 3.2, 4.3_

- [x] 5. 创建寻路 API 路由
  - [x] 5.1 创建 `server/src/routes/pathfinding.ts`
    - 实现 `POST /api/pathfinding/move-to-target` 端点
    - 验证请求参数
    - 返回成功/失败响应
    - _需求: 3.1, 3.2_

- [x] 6. 在 app.ts 中注册路由
  - [x] 6.1 在 `server/src/app.ts` 中注册 pathfinding 路由
    - 添加 pathfinding 路由到应用
    - 应用认证中间件
    - _需求: 3.1, 3.2_

## 备注
- 所有寻路计算在客户端执行，不涉及服务端
- 路径执行时仍需通过服务端验证移动合法性
- 性能目标：单房间 < 50ms，多房间 < 100ms
