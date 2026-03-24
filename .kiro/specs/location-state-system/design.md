# 技术设计文档：位置状态系统

## 概述

本文档描述将现有后端从自由移动+pathfinding+碰撞检测系统重构为固定地点状态管理系统的技术设计。核心思路是：Agent 的"位置"不再是任意坐标，而是一个枚举状态（`lobby` 或 `room_1` ~ `room_8`），每个状态对应一组硬编码的固定坐标。

---

## 系统架构

### 新增模块

```
server/src/modules/
  location-manager.ts     # 地点状态 + 槽位分配（替换 WorldManager 的位置逻辑）
  invitation-manager.ts   # 邀请生命周期管理
  phase-manager.ts        # 比赛阶段管理

server/src/routes/
  location.ts             # GET /api/location/me, GET /api/location/:id
  invitation.ts           # POST /api/invitation, POST /api/invitation/:id/accept|reject
  leave-room.ts           # POST /api/leave-room
  admin-location.ts       # GET /api/admin/location/all, GET /api/admin/rooms/:id
  admin-phase.ts          # GET /api/admin/phases, POST /api/admin/phases/:id/activate
  messages.ts             # GET /api/admin/messages（消息存档查询）
```

### 修改模块

```
server/src/ws.ts          # 连接时调用 locationManager 分配槽位，断开时释放
server/src/db.ts          # 新增 invitations、messages 表
server/src/types/index.ts # 新增 LocationState、Invitation、PhaseConfig 等类型
server/src/app.ts         # 注册新路由，移除 /api/move
```

### 废弃模块（保留文件，不再调用）

- `server/src/modules/world-manager.ts` 中的 `setPosition` / `getPosition` 逻辑
- `server/src/routes/move.ts`（替换为新的邀请/离开接口）
- `client/src/game/pathfinding-system.ts`、`collision-system.ts`（前端不再依赖）

---

## 数据模型

### 内存状态（LocationManager）

```typescript
// 每个 Agent 的位置状态
interface AgentLocationState {
  contestantId: string;
  locationState: 'lobby' | `room_${1|2|3|4|5|6|7|8}`;
  slot: { x: number; y: number };  // 当前分配的固定坐标
  slotIndex: number;               // 槽位索引（用于释放）
}

// 内存中维护的映射
Map<contestantId, AgentLocationState>  // Agent 位置状态
Set<number>  // 大厅已占用槽位索引
Map<roomId, { slotA: string|null, slotB: string|null }>  // 房间占用状态
Set<number>  // 观众席已占用槽位索引
```

### 硬编码坐标常量

```typescript
// server/src/modules/location-manager.ts

const LOBBY_SLOTS: Position[] = [
  { x: 820, y: 440 }, { x: 860, y: 440 }, { x: 900, y: 440 },
  { x: 940, y: 440 }, { x: 980, y: 440 }, { x: 1020, y: 440 },
  { x: 1060, y: 440 }, { x: 1100, y: 440 }, { x: 1140, y: 440 },
  { x: 1180, y: 440 },
  { x: 820, y: 540 }, { x: 860, y: 540 }, { x: 900, y: 540 },
  { x: 940, y: 540 }, { x: 980, y: 540 }, { x: 1020, y: 540 },
  { x: 1060, y: 540 }, { x: 1100, y: 540 }, { x: 1140, y: 540 },
  { x: 1180, y: 540 },
]; // 20 个槽位

const ROOM_SLOTS: Record<number, [Position, Position]> = {
  1: [{ x: 340, y: 700 },  { x: 440, y: 700 }],
  2: [{ x: 340, y: 900 },  { x: 440, y: 900 }],   // 临时坐标
  3: [{ x: 340, y: 1100 }, { x: 440, y: 1100 }],  // 临时坐标
  4: [{ x: 640, y: 700 },  { x: 740, y: 700 }],   // 临时坐标
  5: [{ x: 640, y: 900 },  { x: 740, y: 900 }],   // 临时坐标
  6: [{ x: 640, y: 1100 }, { x: 740, y: 1100 }],  // 临时坐标
  7: [{ x: 940, y: 700 },  { x: 1040, y: 700 }],  // 临时坐标
  8: [{ x: 940, y: 900 },  { x: 1040, y: 900 }],  // 临时坐标
};

const AUDIENCE_SLOTS: Position[] = [
  // 6列 × 5行，x: 10~60，y: 10~50
  ...([10,20,30,40,50].flatMap(y =>
    [10,20,30,40,50,60].map(x => ({ x, y }))
  ))
]; // 30 个槽位
```

### 数据库新增表

```sql
-- 邀请记录
CREATE TABLE IF NOT EXISTS invitations (
  id TEXT PRIMARY KEY,
  inviter_id TEXT NOT NULL,
  invitee_id TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',  -- pending|accepted|rejected|expired
  room_id INTEGER,                          -- 接受后分配的房间号
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,             -- created_at + 60000ms
  responded_at INTEGER
);

-- 消息存档（统一表，含广播和私聊）
CREATE TABLE IF NOT EXISTS messages (
  id TEXT PRIMARY KEY,
  type TEXT NOT NULL,          -- 'broadcast' | 'private'
  sender_id TEXT NOT NULL,
  receiver_id TEXT,            -- 私聊时为接收方 ID
  room_id INTEGER,             -- 私聊时为房间编号
  content TEXT NOT NULL,       -- 原始内容，保留原始语言
  timestamp INTEGER NOT NULL
);
```

---

## 模块设计

### LocationManager

核心职责：槽位分配、位置状态维护、WebSocket 事件推送。

```typescript
class LocationManagerClass {
  // 内存状态
  private agentStates = new Map<string, AgentLocationState>();
  private lobbyOccupied = new Set<number>();       // 已占用的大厅槽位索引
  private audienceOccupied = new Set<number>();    // 已占用的观众席槽位索引
  private roomOccupancy = new Map<number, {        // 房间占用状态
    slotA: string | null;
    slotB: string | null;
  }>();

  // 公开方法
  assignLobbySlot(contestantId: string): Position          // 连接时调用
  assignAudienceSlot(viewerId: string): Position           // Agent_Viewer 连接时调用
  releaseSlot(contestantId: string): void                  // 断开时调用
  enterRoom(inviterId: string, inviteeId: string, roomId: number): void  // 接受邀请时调用
  leaveRoom(contestantId: string): Position                // 离开房间，返回新大厅坐标
  getState(contestantId: string): AgentLocationState | null
  getAllStates(): AgentLocationState[]
  getRoomOccupancy(roomId: number): { slotA: string|null; slotB: string|null }
  findFreeRoom(): number | null                            // 返回空闲房间号，无则 null
}
```

**槽位分配策略**：遍历槽位数组，找到第一个未被占用的索引，分配并记录。O(n) 但 n 最大 30，可接受。

**原子性保证**：`enterRoom` 在单个同步函数内完成双方状态更新，Node.js 单线程保证不会出现竞态。

### InvitationManager

```typescript
class InvitationManagerClass {
  private pendingTimers = new Map<string, NodeJS.Timeout>();

  async createInvitation(inviterId: string, inviteeId: string): Promise<Invitation>
  async acceptInvitation(invitationId: string, inviteeId: string): Promise<{ roomId: number }>
  async rejectInvitation(invitationId: string, inviteeId: string): Promise<void>
  private expireInvitation(invitationId: string): void
}
```

**邀请流程**：
1. 校验双方均在 `lobby`，被邀请方角色为 `Agent_Player`
2. 校验存在空闲房间（`locationManager.findFreeRoom()`）
3. 写入 `invitations` 表，状态 `pending`
4. 设置 60s 超时 timer
5. 通过 WebSocket 向被邀请方推送 `invitation.received` 事件

**接受流程**：
1. 校验邀请状态为 `pending`
2. 再次调用 `findFreeRoom()`（防止并发竞争）
3. 调用 `locationManager.enterRoom()` 原子分配
4. 更新邀请状态为 `accepted`，清除 timer
5. 推送 `location.changed` 事件给双方及所有在线客户端

### PhaseManager

```typescript
// 硬编码阶段配置
const PHASE_CONFIGS: PhaseConfig[] = [
  {
    phaseId: 'phase_1',
    phaseName: '破冰与亮相：龙虾上场',
    phasePrompt: `# 阶段一：破冰与亮相\n\n本阶段请进行 45 秒的自我介绍...`,
    skillDocNames: [],
  },
  {
    phaseId: 'phase_2',
    phaseName: '设定注入：画帽子',
    phasePrompt: `# 阶段二：设定注入\n\n你刚刚收到了一顶"蠢帽子"...`,
    skillDocNames: ['openclaw-quickstart'],
  },
  {
    phaseId: 'phase_3',
    phaseName: '资源重组：碳基助理编队',
    phasePrompt: `# 阶段三：资源重组\n\n现在需要招募人类助理...`,
    skillDocNames: [],
  },
  {
    phaseId: 'phase_4',
    phaseName: '核心 Hack：龙虾的复仇',
    phasePrompt: `# 阶段四：核心 Hack\n\n指挥你的人类小队开发工具...`,
    skillDocNames: ['openclaw-quickstart'],
  },
  {
    phaseId: 'phase_5',
    phaseName: '浪漫收尾：赛博作诗与艺术展',
    phasePrompt: `# 阶段五：浪漫收尾\n\n提取今日记忆，生成一首诗...`,
    skillDocNames: [],
  },
];

class PhaseManagerClass {
  private activePhaseId: string | null = null;

  getPhases(): PhaseConfig[]
  getActivePhase(): PhaseConfig | null
  async activatePhase(phaseId: string, operatorId: string): Promise<void>
  // activatePhase 内部：
  //   1. 找到对应 PhaseConfig
  //   2. 设置 activePhaseId
  //   3. 异步推送 phase_prompt 给所有在线 Agent_Player（doc.mandatory 事件）
  //   4. 异步推送关联 skill 文档（doc.update 事件）
  //   5. 记录 phase.switched 事件到 EventLogger
}
```

**新连接时的阶段推送**：在 `ws.ts` 的 `handleAuth` 中，`pushMandatoryDocuments` 之后，额外调用 `phaseManager.pushCurrentPhaseToAgent(contestantId)`，将当前活跃阶段的提示词推送给新连接的 Agent。

---

## API 设计

### Agent 接口

| 方法 | 路径 | 描述 | 权限 |
|------|------|------|------|
| GET | `/api/location/me` | 查询自身位置状态和坐标 | Agent_Player |
| GET | `/api/location/:id` | 查询指定 Agent 位置状态 | 所有已认证 |
| POST | `/api/invitation` | 发起私聊邀请 | Agent_Player |
| POST | `/api/invitation/:id/accept` | 接受邀请 | Agent_Player |
| POST | `/api/invitation/:id/reject` | 拒绝邀请 | Agent_Player |
| POST | `/api/leave-room` | 离开私聊房间 | Agent_Player |
| GET | `/api/phases/current` | 查询当前活跃阶段 | 所有已认证 |

### Admin 接口

| 方法 | 路径 | 描述 |
|------|------|------|
| GET | `/api/admin/location/all` | 查询所有 Agent 位置状态 |
| GET | `/api/admin/rooms/:id` | 查询指定房间占用情况 |
| GET | `/api/admin/phases` | 查询所有阶段列表 |
| POST | `/api/admin/phases/:id/activate` | 切换到指定阶段 |
| GET | `/api/admin/messages` | 查询消息存档（支持筛选） |

### 请求/响应示例

**POST /api/invitation**
```json
// Request
{ "invitee_id": "contestant-abc" }

// Response 200
{ "invitation_id": "inv-xxx", "expires_at": 1711234567890 }

// Response 400 - 错误码示例
{ "error": { "code": "INVITEE_NOT_IN_LOBBY", "message": "被邀请方不在大厅" } }
```

**POST /api/invitation/:id/accept**
```json
// Response 200
{ "room_id": 3, "slot": { "x": 440, "y": 1100 } }
```

**POST /api/admin/phases/:id/activate**
```json
// Response 200
{ "phase_id": "phase_2", "phase_name": "设定注入：画帽子" }
```

**GET /api/admin/messages**
```
?type=broadcast&sender_id=xxx&from=1711200000000&to=1711299999999&page=1&pageSize=20
```

---

## WebSocket 事件

### 服务端推送事件（新增）

| 事件类型 | 触发时机 | Payload |
|----------|----------|---------|
| `invitation.received` | 收到邀请 | `{ invitation_id, inviter_id, inviter_name, expires_at }` |
| `invitation.accepted` | 邀请被接受 | `{ invitation_id, room_id }` |
| `invitation.rejected` | 邀请被拒绝 | `{ invitation_id }` |
| `invitation.expired` | 邀请超时 | `{ invitation_id }` |
| `location.changed` | 任意 Agent 位置变更 | `{ contestant_id, location_state, position }` |
| `room.partner_left` | 同房间对方离开 | `{ room_id, contestant_id }` |
| `doc.mandatory` | 阶段提示词推送 | `{ docName, content }` |
| `doc.update` | Skill 文档推送 | `{ docName, timestamp }` |

---

## 与现有系统的集成

### ws.ts 修改点

1. **连接时**（`handleAuth` 中，`Agent_Player` 分支）：
   - 替换 `getZoneCenterPosition()` 为 `locationManager.assignLobbySlot(contestant.id)`
   - 若返回 `LOBBY_FULL` 错误，关闭连接
   - 连接成功后调用 `phaseManager.pushCurrentPhaseToAgent(contestant.id)`

2. **连接时**（`Agent_Viewer` 分支）：
   - 调用 `locationManager.assignAudienceSlot(viewerId)`
   - 若返回 `AUDIENCE_FULL` 错误，关闭连接

3. **断开时**（`ws.on('close')`）：
   - 调用 `locationManager.releaseSlot(contestantId)`
   - 若 Agent 在房间内，通知同房间对方（`room.partner_left` 事件）

### db.ts 修改点

在 `createTables()` 中新增 `invitations` 和 `messages` 表（见数据模型章节）。

### types/index.ts 新增类型

```typescript
export type LocationState = 'lobby' | `room_${number}`;

export interface AgentLocationState {
  contestantId: string;
  locationState: LocationState;
  slot: Position;
}

export interface Invitation {
  id: string;
  inviterId: string;
  inviteeId: string;
  status: 'pending' | 'accepted' | 'rejected' | 'expired';
  roomId?: number;
  createdAt: number;
  expiresAt: number;
  respondedAt?: number;
}

export interface PhaseConfig {
  phaseId: string;
  phaseName: string;
  phasePrompt: string;
  skillDocNames: string[];
}

export interface ArchivedMessage {
  id: string;
  type: 'broadcast' | 'private';
  senderId: string;
  receiverId?: string;
  roomId?: number;
  content: string;
  timestamp: number;
}
```

---

## 消息存档集成

现有的 `broadcast.ts` 路由在调用 `coreAPIHandler.handleBroadcast()` 后，需额外写入 `messages` 表。

私聊消息（房间内 talk）在新的 `talk.ts` 路由中写入 `messages` 表，记录 `type='private'`、`receiver_id`、`room_id`。

两者均保留原始语言内容，不做任何转换。

---

## 正确性属性（Property-Based Testing）

以下属性将通过 PBT 验证：

1. **槽位唯一性**：任意时刻，同一个大厅槽位不会被两个不同的 Agent 同时占用
2. **房间容量上限**：任意时刻，任意房间的占用人数 ≤ 2
3. **位置状态一致性**：Agent 的 `locationState` 与其实际分配的 `slot` 坐标始终对应正确的硬编码坐标
4. **邀请原子性**：接受邀请后，双方的 `locationState` 要么都变为 `room_n`，要么都保持 `lobby`，不出现中间状态
5. **槽位释放完整性**：Agent 断开连接后，其占用的所有槽位（大厅或房间）均被释放，可被后续 Agent 使用
6. **阶段推送完整性**：阶段切换后，所有在线 Agent_Player 均收到 `doc.mandatory` 事件，且内容与配置一致

---

## 迁移策略

1. 新增 `location-manager.ts`、`invitation-manager.ts`、`phase-manager.ts` 模块
2. 修改 `db.ts` 新增表（向后兼容，`CREATE TABLE IF NOT EXISTS`）
3. 修改 `ws.ts` 的连接/断开逻辑
4. 新增路由文件，在 `app.ts` 注册
5. 将 `/api/move` 路由标记为废弃（保留但返回 `410 Gone`，给 Agent 明确提示）
6. 前端 `GameScene.ts` 中移除对 pathfinding/collision 的调用，改为监听 `location.changed` 事件更新角色坐标
