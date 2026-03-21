# 技术设计文档 — 多房间碰撞系统

## 概览

多房间碰撞系统是 XTION_TheFool0 平台的前端功能扩展，为游戏世界引入多房间架构和物理碰撞检测。系统支持主大厅（无限容量）和私聊房间（最多2个bot），实现bot之间的碰撞检测、墙体碰撞、移动验证和房间切换。

核心设计理念：
- **房间隔离**：每个房间独立维护bot列表、墙体配置、空间索引，房间间消息隔离
- **物理真实性**：bot移动前验证目标位置，支持bot碰撞和墙体碰撞检测
- **性能优化**：使用空间索引（Quadtree/Grid）加速碰撞查询，仅检查同房间内的bot
- **可视化编辑**：地图编辑器提供拖拽式房间/墙体编辑，实时预览
- **状态持久化**：房间配置保存到数据库，系统重启后自动加载

### 技术栈选型

| 层级 | 技术 | 理由 |
|------|------|------|
| 前端框架 | React + Phaser 3 | React 管理UI（编辑器、房间列表），Phaser 3 渲染游戏画面和碰撞可视化 |
| 碰撞检测 | Phaser Physics | 内置物理引擎支持AABB碰撞检测，性能优化 |
| 空间索引 | Grid-based Spatial Index | 将房间分割成网格，快速查询附近bot |
| 状态管理 | Zustand | 管理房间状态、bot位置、碰撞信息 |
| 后端存储 | SQLite | 持久化房间配置、墙体数据、出生点信息 |
| 编辑器UI | Canvas + React | 自定义编辑器界面，支持拖拽、缩放、网格对齐 |

## 架构

### 系统架构总览

```
┌─────────────────────────────────────────────────────────────┐
│                        前端 (React + Phaser 3)               │
├─────────────────────────────────────────────────────────────┤
│                                                               │
│  ┌──────────────────┐  ┌──────────────────┐                 │
│  │  React UI 层     │  │  Phaser 3 层     │                 │
│  ├──────────────────┤  ├──────────────────┤                 │
│  │ • 房间列表       │  │ • GameScene      │                 │
│  │ • 地图编辑器     │  │ • 碰撞检测       │                 │
│  │ • 房间管理       │  │ • 精灵渲染       │                 │
│  │ • 容量显示       │  │ • 墙体渲染       │                 │
│  └──────────────────┘  └──────────────────┘                 │
│           │                      │                           │
│           └──────────┬───────────┘                           │
│                      │                                       │
│           ┌──────────▼──────────┐                           │
│           │  Zustand 状态管理   │                           │
│           ├─────────────────────┤                           │
│           │ • roomStore         │                           │
│           │ • collisionStore    │                           │
│           │ • editorStore       │                           │
│           └─────────────────────┘                           │
│                      │                                       │
│           ┌──────────▼──────────┐                           │
│           │  WebSocket Client   │                           │
│           └─────────────────────┘                           │
│                      │                                       │
└──────────────────────┼───────────────────────────────────────┘
                       │
                       │ HTTP/WebSocket
                       │
┌──────────────────────▼───────────────────────────────────────┐
│                    后端 (Node.js)                             │
├─────────────────────────────────────────────────────────────┤
│                                                               │
│  ┌──────────────────────────────────────────────────────┐   │
│  │           房间管理模块 (RoomManager)                 │   │
│  ├──────────────────────────────────────────────────────┤   │
│  │ • 房间CRUD                                           │   │
│  │ • 房间容量管理                                       │   │
│  │ • 房间状态维护                                       │   │
│  │ • 出生点分配                                         │   │
│  └──────────────────────────────────────────────────────┘   │
│                                                               │
│  ┌──────────────────────────────────────────────────────┐   │
│  │         碰撞检测模块 (CollisionManager)              │   │
│  ├──────────────────────────────────────────────────────┤   │
│  │ • Bot碰撞检测                                        │   │
│  │ • 墙体碰撞检测                                       │   │
│  │ • 移动验证                                           │   │
│  │ • 空间索引维护                                       │   │
│  └──────────────────────────────────────────────────────┘   │
│                                                               │
│  ┌──────────────────────────────────────────────────────┐   │
│  │         地图编辑模块 (MapEditorManager)              │   │
│  ├──────────────────────────────────────────────────────┤   │
│  │ • 房间配置CRUD                                       │   │
│  │ • 墙体配置管理                                       │   │
│  │ • 配置验证                                           │   │
│  │ • 版本历史管理                                       │   │
│  └──────────────────────────────────────────────────────┘   │
│                                                               │
│  ┌──────────────────────────────────────────────────────┐   │
│  │              数据库 (SQLite)                         │   │
│  ├──────────────────────────────────────────────────────┤   │
│  │ • rooms 表                                           │   │
│  │ • walls 表                                           │   │
│  │ • spawn_points 表                                    │   │
│  │ • room_configs 表                                    │   │
│  └──────────────────────────────────────────────────────┘   │
│                                                               │
└─────────────────────────────────────────────────────────────┘
```

## 前端设计

### 1. 房间管理 (RoomStore)

**Zustand Store 结构：**

```typescript
interface Room {
  id: string;
  name: string;
  type: 'MainHall' | 'PrivateRoom';
  capacity: number;
  currentCount: number;
  bots: Bot[];
  walls: Wall[];
  spawnPoints: SpawnPoint[];
  bounds: Bounds;
}

interface RoomStore {
  rooms: Map<string, Room>;
  currentRoomId: string;
  
  // 房间操作
  createRoom(config: RoomConfig): void;
  deleteRoom(roomId: string): void;
  updateRoom(roomId: string, updates: Partial<Room>): void;
  switchRoom(roomId: string): void;
  
  // Bot管理
  addBotToRoom(roomId: string, bot: Bot): void;
  removeBotFromRoom(roomId: string, botId: string): void;
  updateBotPosition(roomId: string, botId: string, position: Position): void;
}
```

**关键特性：**
- 主大厅始终存在，容量无限
- 私聊房间动态创建/销毁
- 房间状态实时同步到后端
- 支持房间间的bot状态保留

### 2. 碰撞检测 (CollisionStore)

**Zustand Store 结构：**

```typescript
interface CollisionBox {
  botId: string;
  x: number;
  y: number;
  width: number;
  height: number;
}

interface CollisionEvent {
  type: 'bot-bot' | 'bot-wall';
  botId: string;
  targetId?: string; // 另一个bot或墙体ID
  position: Position;
  timestamp: number;
}

interface CollisionStore {
  collisions: CollisionEvent[];
  spatialIndex: SpatialGrid;
  
  // 碰撞检测
  checkCollision(roomId: string, position: Position, size: Size): CollisionEvent | null;
  updateSpatialIndex(roomId: string, bots: Bot[]): void;
  
  // 查询
  getNearbyBots(roomId: string, position: Position, radius: number): Bot[];
  getWallsInArea(roomId: string, bounds: Bounds): Wall[];
}
```

**空间索引实现：**
- 使用Grid-based索引，将房间分割成固定大小的网格
- 每个网格单元维护该区域内的bot列表
- 移动时只检查相邻网格内的bot，大幅减少碰撞检查次数

### 3. 地图编辑器 (EditorStore)

**Zustand Store 结构：**

```typescript
interface EditorState {
  editingRoomId: string | null;
  selectedTool: 'select' | 'wall' | 'spawn' | 'boundary';
  selectedObject: Wall | SpawnPoint | null;
  
  // 编辑操作
  startEditing(roomId: string): void;
  stopEditing(): void;
  addWall(wall: Wall): void;
  removeWall(wallId: string): void;
  updateWall(wallId: string, updates: Partial<Wall>): void;
  addSpawnPoint(point: SpawnPoint): void;
  removeSpawnPoint(pointId: string): void;
  
  // 验证和保存
  validateConfiguration(): ValidationResult;
  saveConfiguration(): Promise<void>;
}
```

**编辑器UI组件：**
- Canvas画布：显示房间、墙体、出生点
- 工具栏：选择编辑工具（墙体、出生点、边界）
- 属性面板：编辑选中对象的属性
- 预览面板：实时预览碰撞效果

### 4. GameScene 扩展

**新增功能：**

```typescript
export class GameScene extends Phaser.Scene {
  // 房间管理
  private currentRoom: Room;
  private roomBots: Map<string, Sprite>;
  private walls: Phaser.GameObjects.Graphics[];
  
  // 碰撞检测
  private collisionSystem: CollisionSystem;
  private spatialIndex: SpatialGrid;
  
  // 方法
  loadRoom(roomId: string): void;
  renderWalls(walls: Wall[]): void;
  renderSpawnPoints(points: SpawnPoint[]): void;
  handleBotMovement(botId: string, targetPos: Position): void;
  checkCollisions(botId: string, targetPos: Position): CollisionResult;
}
```

## 后端设计

### 1. 房间管理模块 (RoomManager)

**职责：**
- 房间CRUD操作
- 房间容量管理
- 房间状态维护
- 出生点分配

**核心接口：**

```typescript
interface RoomManager {
  // 房间操作
  createRoom(config: RoomConfig): Room;
  deleteRoom(roomId: string): void;
  updateRoom(roomId: string, updates: Partial<Room>): void;
  getRoom(roomId: string): Room;
  getAllRooms(): Room[];
  
  // 容量管理
  canJoinRoom(roomId: string): boolean;
  addBotToRoom(roomId: string, botId: string): void;
  removeBotFromRoom(roomId: string, botId: string): void;
  
  // 出生点分配
  allocateSpawnPoint(roomId: string): SpawnPoint;
  getAvailableSpawnPoints(roomId: string): SpawnPoint[];
}
```

### 2. 碰撞检测模块 (CollisionManager)

**职责：**
- Bot碰撞检测
- 墙体碰撞检测
- 移动验证
- 空间索引维护

**核心接口：**

```typescript
interface CollisionManager {
  // 碰撞检测
  checkBotCollision(roomId: string, botId: string, targetPos: Position): boolean;
  checkWallCollision(roomId: string, targetPos: Position, size: Size): boolean;
  validateMovement(roomId: string, botId: string, targetPos: Position): ValidationResult;
  
  // 空间索引
  updateSpatialIndex(roomId: string): void;
  getNearbyBots(roomId: string, position: Position, radius: number): string[];
  
  // 碰撞信息
  getCollisionInfo(roomId: string, botId: string, targetPos: Position): CollisionInfo;
}
```

### 3. 地图编辑模块 (MapEditorManager)

**职责：**
- 房间配置CRUD
- 墙体配置管理
- 配置验证
- 版本历史管理

**核心接口：**

```typescript
interface MapEditorManager {
  // 配置管理
  saveRoomConfiguration(roomId: string, config: RoomConfiguration): void;
  loadRoomConfiguration(roomId: string): RoomConfiguration;
  deleteRoomConfiguration(roomId: string): void;
  
  // 验证
  validateConfiguration(config: RoomConfiguration): ValidationResult;
  validateWalls(walls: Wall[]): ValidationResult;
  validateSpawnPoints(points: SpawnPoint[]): ValidationResult;
  
  // 版本管理
  getConfigurationHistory(roomId: string): ConfigurationVersion[];
  rollbackConfiguration(roomId: string, versionId: string): void;
}
```

## 数据模型

### 数据库表结构

**rooms 表：**
```sql
CREATE TABLE rooms (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  type TEXT NOT NULL, -- 'MainHall' | 'PrivateRoom'
  capacity INTEGER NOT NULL,
  bounds_x1 REAL,
  bounds_y1 REAL,
  bounds_x2 REAL,
  bounds_y2 REAL,
  created_at TIMESTAMP,
  updated_at TIMESTAMP
);
```

**walls 表：**
```sql
CREATE TABLE walls (
  id TEXT PRIMARY KEY,
  room_id TEXT NOT NULL,
  x REAL NOT NULL,
  y REAL NOT NULL,
  width REAL NOT NULL,
  height REAL NOT NULL,
  rotation REAL DEFAULT 0,
  created_at TIMESTAMP,
  FOREIGN KEY (room_id) REFERENCES rooms(id)
);
```

**spawn_points 表：**
```sql
CREATE TABLE spawn_points (
  id TEXT PRIMARY KEY,
  room_id TEXT NOT NULL,
  x REAL NOT NULL,
  y REAL NOT NULL,
  is_available BOOLEAN DEFAULT 1,
  created_at TIMESTAMP,
  FOREIGN KEY (room_id) REFERENCES rooms(id)
);
```

**room_configs 表：**
```sql
CREATE TABLE room_configs (
  id TEXT PRIMARY KEY,
  room_id TEXT NOT NULL,
  config_json TEXT NOT NULL,
  version INTEGER NOT NULL,
  created_at TIMESTAMP,
  FOREIGN KEY (room_id) REFERENCES rooms(id)
);
```

## 关键算法

### 1. 出生点分配算法

```
算法：AllocateSpawnPoint(roomId)
输入：房间ID
输出：可用的出生点

1. 获取房间的所有出生点列表
2. 过滤出未被占据的出生点
3. 如果没有可用出生点，返回错误
4. 从可用出生点中随机选择一个
5. 检查该出生点周围是否有其他bot
6. 如果有碰撞，重复步骤4-5，最多尝试3次
7. 返回选中的出生点
```

### 2. 碰撞检测算法

```
算法：CheckCollision(roomId, targetPos, size)
输入：房间ID、目标位置、bot大小
输出：碰撞信息或null

1. 使用空间索引查询目标位置附近的bot
2. 对每个附近的bot进行AABB碰撞检测
3. 如果检测到bot碰撞，返回碰撞信息
4. 查询目标位置附近的墙体
5. 对每个墙体进行AABB碰撞检测
6. 如果检测到墙体碰撞，返回碰撞信息
7. 如果没有碰撞，返回null
```

### 3. 空间索引更新算法

```
算法：UpdateSpatialIndex(roomId)
输入：房间ID
输出：无

1. 获取房间的所有bot
2. 清空当前的空间索引
3. 对每个bot：
   a. 计算bot所在的网格单元
   b. 将bot添加到该网格单元
4. 索引更新完成
```

## 正确性属性

### Property 1: 碰撞检测完整性
**定义：** 系统应检测所有可能的碰撞（bot-bot、bot-wall）

**验证方式：**
- 对于任意两个bot，如果它们的碰撞箱重叠，系统必须检测到碰撞
- 对于任意bot和墙体，如果bot的碰撞箱与墙体重叠，系统必须检测到碰撞

### Property 2: 移动原子性
**定义：** 移动操作要么完全成功，要么完全失败，不存在中间状态

**验证方式：**
- 移动前验证，验证失败则不更新位置
- 验证成功后原子性更新位置和空间索引

### Property 3: 房间容量约束
**定义：** 私聊房间的bot数量不应超过容量限制

**验证方式：**
- 加入房间前检查容量
- 容量满时拒绝新的加入请求

### Property 4: 出生点无碰撞
**定义：** 新bot出生时不应与现有bot碰撞

**验证方式：**
- 分配出生点时检查周围bot
- 如果有碰撞，选择另一个出生点

## 集成点

### 与现有系统的集成

1. **与 Move API 的集成**
   - Move API 调用 CollisionManager.validateMovement()
   - 验证失败返回碰撞错误
   - 验证成功更新bot位置

2. **与 WebSocket 的集成**
   - 房间状态变化推送给所有在线客户端
   - 碰撞事件实时推送
   - 出生点分配结果推送

3. **与 GameScene 的集成**
   - GameScene 订阅房间状态变化
   - 实时渲染bot位置、墙体、出生点
   - 处理用户的移动输入

## 性能考虑

### 优化策略

1. **空间索引优化**
   - 使用Grid-based索引而非Quadtree，减少内存占用
   - 网格大小根据房间大小动态调整
   - 仅在bot移动时更新索引

2. **碰撞检测优化**
   - 使用AABB碰撞检测而非圆形，计算更快
   - 仅检查同房间内的bot
   - 缓存碰撞检测结果

3. **渲染优化**
   - 使用Phaser的对象池管理精灵
   - 仅渲染可见区域内的对象
   - 使用脏标记减少重绘

### 性能指标

- 碰撞检测延迟：< 10ms（100个bot）
- 出生点分配延迟：< 5ms
- 房间切换延迟：< 100ms
- 空间索引更新：< 20ms（1000个bot）
