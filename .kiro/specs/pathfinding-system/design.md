# 寻路系统设计文档

## 架构概览

```
┌─────────────────────────────────────────────────────────┐
│                    GameScene (客户端)                    │
│  - 处理用户点击，调用寻路系统                             │
└────────────────┬────────────────────────────────────────┘
                 │
                 ▼
┌─────────────────────────────────────────────────────────┐
│              PathfindingSystem (客户端)                  │
│  - 单房间 A* 寻路                                        │
│  - 多房间寻路协调                                        │
│  - 路径执行和重新规划                                    │
└────────────────┬────────────────────────────────────────┘
                 │
        ┌────────┴────────┐
        ▼                 ▼
┌──────────────────┐  ┌──────────────────┐
│  GridPathfinder  │  │  RoomGraphBuilder│
│  - A* 算法       │  │  - 房间图构建    │
│  - 网格管理      │  │  - 门洞连接      │
└──────────────────┘  └──────────────────┘
```

## 核心模块

### 1. GridPathfinder (client/src/game/pathfinding/grid-pathfinder.ts)

```typescript
class GridPathfinder {
  // 网格配置
  private gridSize = 32;
  
  // A* 寻路
  findPath(
    start: Point,
    goal: Point,
    walls: Wall[],
    doorways: Doorway[],
    bots: Bot[],
    botId: string,
    bounds: Bounds
  ): Point[]
  
  // 辅助方法
  private getNeighbors(point: Point, bounds: Bounds): Point[]
  private heuristic(a: Point, b: Point): number
  private isWalkable(point: Point, walls: Wall[], doorways: Doorway[]): boolean
  private smoothPath(path: Point[]): Point[]
}
```

### 2. RoomGraphBuilder (client/src/game/pathfinding/room-graph-builder.ts)

```typescript
class RoomGraphBuilder {
  // 房间图
  private graph: Map<string, RoomNode>
  
  // 构建房间图
  buildGraph(rooms: Room[], doorways: Doorway[]): void
  
  // 查询房间连接
  getPath(roomA: string, roomB: string): string[]
  
  // 获取门洞中心点
  getDoorwayCenter(doorway: Doorway): Point
}

interface RoomNode {
  roomId: string
  neighbors: Array<{ roomId: string; doorway: Doorway }>
}
```

### 3. PathfindingSystem (client/src/game/pathfinding-system.ts)

```typescript
class PathfindingSystem {
  private gridPathfinder: GridPathfinder
  private roomGraphBuilder: RoomGraphBuilder
  
  // 单房间寻路
  findPath(
    start: Point,
    goal: Point,
    roomId: string
  ): Point[]
  
  // 多房间寻路
  findMultiRoomPath(
    start: Point,
    goal: Point,
    startRoomId: string,
    goalRoomId: string
  ): Point[]
  
  // 更新房间和门洞
  updateRooms(rooms: Room[]): void
  updateDoorways(doorways: Doorway[]): void
}
```

## 算法细节

### A* 寻路流程

1. **初始化**
   - 将起点加入 open set
   - 初始化 g(n) = 0, h(n) = heuristic(start, goal)

2. **主循环**
   - 从 open set 中取 f(n) 最小的节点
   - 如果是目标点，回溯路径
   - 否则，扩展所有邻居节点

3. **邻居评估**
   - 检查是否可通行（不在墙体内，不在其他 bot 上）
   - 计算 g(n) = g(parent) + distance
   - 如果 g(n) 更优，更新节点

4. **路径平滑**
   - 移除不必要的中间点
   - 检查直线是否可通行

### 多房间寻路流程

1. **房间级别规划**
   - 使用 BFS 找到房间序列
   - 例：Room A → Room B → Room C

2. **详细路径规划**
   - 在 Room A 中寻路到门洞中心
   - 在 Room B 中从门洞中心寻路到下一个门洞
   - 在 Room C 中从门洞中心寻路到目标

3. **路径连接**
   - 合并所有房间的路径
   - 确保门洞中心点正确连接

## 数据结构

### 网格表示
```typescript
interface GridNode {
  x: number
  y: number
  g: number  // 从起点的成本
  h: number  // 到目标的启发式成本
  f: number  // g + h
  parent?: GridNode
}
```

### 房间图表示
```typescript
interface RoomNode {
  roomId: string
  neighbors: Array<{
    roomId: string
    doorway: Doorway
  }>
}
```

## 集成点

### GameScene 中的使用
```typescript
// 初始化
const pathfinding = new PathfindingSystem(rooms, doorways)

// 用户点击时
const path = pathfinding.findMultiRoomPath(
  botPos,
  clickPos,
  currentRoomId,
  targetRoomId
)

// 执行路径
executePathStep(path[0])
```

## 性能优化

1. **网格缓存**
   - 缓存房间的可通行网格
   - 当墙体变化时更新缓存

2. **启发式优化**
   - 使用欧几里得距离（快速）
   - 可选：使用曼哈顿距离（更准确但慢）

3. **路径平滑**
   - 只在最终路径上执行
   - 使用二分查找优化

4. **动态重新规划**
   - 检测到障碍物时触发
   - 只重新规划受影响的部分
