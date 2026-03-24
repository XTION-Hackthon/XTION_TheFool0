# 需求文档

## 简介

本功能将后端的位置/状态系统从基于自由移动的坐标系（含 pathfinding、碰撞检测）重新设计为基于固定地点的状态管理系统。

系统包含 9 个固定地点：1 个大厅（主厅）和 8 个私聊房间。每个地点拥有硬编码的固定坐标，无需动态计算。Agent 默认驻留在大厅，可通过邀请流程进入私聊房间与另一个 Agent 进行一对一私聊。

## 词汇表

- **Location_Manager**：负责管理所有地点状态和 Agent 位置的后端模块
- **Agent**：参赛的 AI 选手（对应现有系统中的 Contestant，角色为 `Agent_Player`）
- **大厅（Lobby）**：所有 Agent 的默认驻留地点，拥有 20 个固定出生槽位，容量上限为 20（预期支持 16 个 Agent，留 4 个余量）
- **出生槽位（Spawn_Slot）**：大厅内 Agent 站立的固定坐标位置，共 20 个，Agent 连接时从中分配一个空闲槽位
- **私聊房间（Private_Room）**：编号 1-8 的私聊房间，每个房间有 2 个固定坐标槽位，同时只能容纳 2 个 Agent
- **坐标槽位（Slot）**：房间内的固定坐标位置，每个私聊房间有 2 个槽位（Slot_A、Slot_B）
- **邀请（Invitation）**：一个 Agent 向另一个 Agent 发起的进入私聊房间的请求
- **位置状态（Location_State）**：Agent 当前所在地点的枚举状态，值为 `lobby` 或 `room_{1-8}`
- **Invitation_Manager**：负责管理邀请生命周期的后端模块
- **Admin**：权限类型（非角色），对应现有系统中 `Role` 类型的 `'Admin'` 值，具有该权限的用户可访问管理接口；系统中的角色类型为 `'Admin' | 'Agent_Player' | 'Human_Viewer' | 'Agent_Viewer'`
- **观众席（Audience_Area）**：Agent_Viewer 的固定坐标区域，共 30 个观众席槽位，分布在 6 列 × 5 行的网格中（x 取 10/20/30/40/50/60，y 取 10/20/30/40/50）
- **观众席槽位（Audience_Slot）**：观众席内的固定坐标位置，共 30 个，Agent_Viewer 连接时从中分配一个空闲槽位

## 需求

### 需求 1：固定地点定义

**用户故事：** 作为系统管理员，我希望系统拥有硬编码的固定地点配置，以便无需动态计算坐标即可管理 Agent 位置。

#### 验收标准

1. THE Location_Manager SHALL 定义 1 个大厅地点，包含以下 20 个固定出生槽位坐标（出生槽位为大厅内 Agent 站立的位置）：
   - Spawn_Slot_1: `{ x: 820, y: 440 }`
   - Spawn_Slot_2: `{ x: 860, y: 440 }`
   - Spawn_Slot_3: `{ x: 900, y: 440 }`
   - Spawn_Slot_4: `{ x: 940, y: 440 }`
   - Spawn_Slot_5: `{ x: 980, y: 440 }`
   - Spawn_Slot_6: `{ x: 820, y: 540 }`
   - Spawn_Slot_7: `{ x: 860, y: 540 }`
   - Spawn_Slot_8: `{ x: 900, y: 540 }`
   - Spawn_Slot_9: `{ x: 940, y: 540 }`
   - Spawn_Slot_10: `{ x: 980, y: 540 }`
   - Spawn_Slot_11: `{ x: 1020, y: 440 }`
   - Spawn_Slot_12: `{ x: 1060, y: 440 }`
   - Spawn_Slot_13: `{ x: 1100, y: 440 }`
   - Spawn_Slot_14: `{ x: 1140, y: 440 }`
   - Spawn_Slot_15: `{ x: 1180, y: 440 }`
   - Spawn_Slot_16: `{ x: 1020, y: 540 }`
   - Spawn_Slot_17: `{ x: 1060, y: 540 }`
   - Spawn_Slot_18: `{ x: 1100, y: 540 }`
   - Spawn_Slot_19: `{ x: 1140, y: 540 }`
   - Spawn_Slot_20: `{ x: 1180, y: 540 }`
2. THE Location_Manager SHALL 定义房间 1 的坐标为：Slot_A: `{ x: 340, y: 700 }`，Slot_B: `{ x: 440, y: 700 }`
3. THE Location_Manager SHALL 定义房间 2 至 8 的坐标为临时占位坐标（待确认后替换），格式一致：
   - 房间 2：Slot_A: `{ x: 340, y: 900 }`，Slot_B: `{ x: 440, y: 900 }`（临时坐标，待确认）
   - 房间 3：Slot_A: `{ x: 340, y: 1100 }`，Slot_B: `{ x: 440, y: 1100 }`（临时坐标，待确认）
   - 房间 4：Slot_A: `{ x: 640, y: 700 }`，Slot_B: `{ x: 740, y: 700 }`（临时坐标，待确认）
   - 房间 5：Slot_A: `{ x: 640, y: 900 }`，Slot_B: `{ x: 740, y: 900 }`（临时坐标，待确认）
   - 房间 6：Slot_A: `{ x: 640, y: 1100 }`，Slot_B: `{ x: 740, y: 1100 }`（临时坐标，待确认）
   - 房间 7：Slot_A: `{ x: 940, y: 700 }`，Slot_B: `{ x: 1040, y: 700 }`（临时坐标，待确认）
   - 房间 8：Slot_A: `{ x: 940, y: 900 }`，Slot_B: `{ x: 1040, y: 900 }`（临时坐标，待确认）
4. THE Location_Manager SHALL 将所有地点坐标以硬编码常量的形式存储，不依赖数据库或外部配置
5. THE Location_Manager SHALL 为大厅维护一个出生槽位容量上限，上限值为 20
6. THE Location_Manager SHALL 为每个私聊房间维护一个容量上限，上限值为 2
7. THE Location_Manager SHALL 仅在 Agent 位置状态发生变化时更新坐标，不在每次移动后持久化坐标到数据库

---

### 需求 2：Agent 默认位置与出生槽位分配

**用户故事：** 作为 Agent，我希望在连接到平台时自动被分配到大厅的一个出生槽位，以便从一个统一的起点开始活动。

#### 验收标准

1. WHEN 一个 Agent 首次连接到平台，THE Location_Manager SHALL 将该 Agent 的位置状态设置为 `lobby`，并从 20 个出生槽位中分配一个当前空闲的槽位
2. WHEN 一个 Agent 重新连接到平台，THE Location_Manager SHALL 将该 Agent 的位置状态恢复为 `lobby`，并重新分配一个空闲的出生槽位
3. IF 大厅所有 20 个出生槽位均已被占用，THEN THE Location_Manager SHALL 返回错误码 `LOBBY_FULL`，拒绝该 Agent 连接
4. THE Location_Manager SHALL 在内存中维护出生槽位的占用状态，不将槽位分配信息持久化到数据库
5. WHEN 一个 Agent 断开连接，THE Location_Manager SHALL 立即释放该 Agent 占用的出生槽位，使其可被后续连接的 Agent 使用

---

### 需求 3：发起私聊邀请

**用户故事：** 作为 Agent，我希望能够邀请另一个 Agent 进入私聊房间，以便与其进行一对一的私密对话。

#### 验收标准

1. WHEN 一个 Agent 发起邀请，THE Invitation_Manager SHALL 检查发起方当前位置状态是否为 `lobby`
2. IF 发起方的位置状态不为 `lobby`，THEN THE Invitation_Manager SHALL 返回错误码 `INVITER_NOT_IN_LOBBY`
3. WHEN 一个 Agent 发起邀请，THE Invitation_Manager SHALL 检查被邀请方当前位置状态是否为 `lobby`
4. IF 被邀请方的位置状态不为 `lobby`，THEN THE Invitation_Manager SHALL 返回错误码 `INVITEE_NOT_IN_LOBBY`
5. WHEN 一个 Agent 发起邀请，THE Invitation_Manager SHALL 检查被邀请方的角色是否为 `Agent_Player`
6. IF 被邀请方的角色不为 `Agent_Player`，THEN THE Invitation_Manager SHALL 返回错误码 `INVITEE_NOT_CONTESTANT`
7. WHEN 一个 Agent 发起邀请，THE Invitation_Manager SHALL 检查是否存在至少一个空闲的私聊房间（即当前占用人数为 0 的房间）
8. IF 不存在空闲的私聊房间，THEN THE Invitation_Manager SHALL 返回错误码 `NO_ROOM_AVAILABLE`
9. WHEN 邀请校验通过，THE Invitation_Manager SHALL 创建一条邀请记录，状态为 `pending`，并向被邀请方推送邀请通知
10. THE Invitation_Manager SHALL 为每条邀请记录设置 60 秒的超时时间
11. IF 邀请在 60 秒内未被响应，THEN THE Invitation_Manager SHALL 将邀请状态更新为 `expired`

---

### 需求 4：响应私聊邀请

**用户故事：** 作为 Agent，我希望能够接受或拒绝收到的私聊邀请，以便自主决定是否进入私聊房间。

#### 验收标准

1. WHEN 被邀请方接受邀请，THE Invitation_Manager SHALL 检查该邀请的状态是否仍为 `pending`
2. IF 邀请状态不为 `pending`，THEN THE Invitation_Manager SHALL 返回错误码 `INVITATION_NOT_PENDING`
3. WHEN 被邀请方接受邀请，THE Invitation_Manager SHALL 原子性地为双方分配同一个空闲私聊房间
4. WHEN 被邀请方接受邀请，THE Location_Manager SHALL 将发起方的位置状态更新为对应的 `room_{n}`，并分配 Slot_A
5. WHEN 被邀请方接受邀请，THE Location_Manager SHALL 将被邀请方的位置状态更新为对应的 `room_{n}`，并分配 Slot_B
6. WHEN 被邀请方拒绝邀请，THE Invitation_Manager SHALL 将邀请状态更新为 `rejected`，并通知发起方
7. IF 在被邀请方接受邀请时所有房间均已被占用，THEN THE Invitation_Manager SHALL 返回错误码 `NO_ROOM_AVAILABLE` 并保持双方位置不变

---

### 需求 5：离开私聊房间

**用户故事：** 作为 Agent，我希望能够主动离开私聊房间并返回大厅，以便结束私聊后继续参与大厅活动。

#### 验收标准

1. WHEN 一个 Agent 请求离开私聊房间，THE Location_Manager SHALL 检查该 Agent 的位置状态是否为 `room_{1-8}`
2. IF 该 Agent 的位置状态为 `lobby`，THEN THE Location_Manager SHALL 返回错误码 `AGENT_NOT_IN_ROOM`
3. WHEN 一个 Agent 离开私聊房间，THE Location_Manager SHALL 将该 Agent 的位置状态更新为 `lobby`，释放其占用的房间槽位，并分配一个空闲的大厅出生槽位
4. WHEN 一个 Agent 离开私聊房间，THE Location_Manager SHALL 通知同房间内的另一个 Agent（如存在）该 Agent 已离开
5. WHEN 一个 Agent 断开连接，THE Location_Manager SHALL 自动将该 Agent 的位置状态重置为 `lobby` 并释放其占用的所有槽位（房间槽位或出生槽位）

---

### 需求 6：查询位置状态

**用户故事：** 作为 Agent 或具有 Admin 权限的用户，我希望能够查询任意 Agent 的当前位置状态，以便了解 Agent 的分布情况。

#### 验收标准

1. THE Location_Manager SHALL 提供查询单个 Agent 位置状态的接口，返回其 `location_state` 和对应的固定坐标
2. THE Location_Manager SHALL 提供查询所有 Agent 位置状态的接口，返回每个 Agent 的 `location_state` 和坐标；该接口仅限具有 Admin 权限的用户访问
3. THE Location_Manager SHALL 提供查询指定私聊房间当前占用情况的接口，返回房间内的 Agent ID 列表及各自的槽位；该接口仅限具有 Admin 权限的用户访问
4. WHEN Agent 的位置状态发生变更，THE Location_Manager SHALL 通过 WebSocket 向所有在线客户端推送 `location.changed` 事件

---

### 需求 7：房间占用互斥保证

**用户故事：** 作为系统，我希望每个私聊房间在任意时刻最多只有 2 个 Agent，以保证私聊的私密性。

#### 验收标准

1. THE Location_Manager SHALL 保证任意私聊房间在任意时刻的占用人数不超过 2
2. WHEN 两个并发的邀请接受请求同时竞争同一个房间，THE Invitation_Manager SHALL 保证只有一个请求成功，另一个返回错误码 `NO_ROOM_AVAILABLE`
3. THE Location_Manager SHALL 保证房间分配操作的原子性，不出现部分分配（即一方进入房间而另一方未进入）的情况

---

### 需求 8：与现有系统的兼容性

**用户故事：** 作为开发者，我希望新的位置状态系统能够替换现有的 pathfinding 和碰撞检测逻辑，同时明确哪些现有接口保留、哪些被替换。

#### 验收标准

1. THE Location_Manager SHALL 替换现有 `WorldManager` 中基于坐标自由移动的 `setPosition` / `getPosition` 逻辑，改为基于地点状态的管理
2. THE Location_Manager SHALL 保留 `Position` 类型的返回格式（`{ x: number, y: number }`），其值为当前地点的固定坐标
3. THE Location_Manager SHALL 废弃对 pathfinding 系统、碰撞检测系统的依赖，不再调用相关模块
4. WHEN Agent 的位置状态变更，THE Location_Manager SHALL 记录 `location.changed` 事件到事件日志，保持与现有 `EventLogger` 的集成
5. THE Location_Manager SHALL 替换现有的 `/api/move` 自由移动接口，改为新的位置状态接口（发起邀请、响应邀请、离开房间、查询位置状态）
6. THE Location_Manager SHALL 保留现有的观众互动接口（`/api/interaction` 弹幕、投票等）不变，这些接口与私聊邀请流程相互独立，不受本次重构影响

---

### 需求 9：位置状态的内存管理

**用户故事：** 作为开发者，我希望位置状态和坐标信息仅在内存中维护，以便减少不必要的数据库写入开销。

#### 验收标准

1. THE Location_Manager SHALL 在内存中维护所有 Agent 的位置状态（`lobby` 或 `room_{1-8}`）及其当前坐标
2. THE Location_Manager SHALL 仅在 Agent 位置状态发生变化时（如进入房间、离开房间、连接、断开连接）将状态变更写入数据库
3. THE Location_Manager SHALL 不在 Agent 每次移动操作后更新数据库，坐标由固定槽位决定，无需持久化
4. WHEN 服务器重启，THE Location_Manager SHALL 将所有 Agent 的位置状态重置为 `lobby`，并重新分配出生槽位

---

### 需求 10：观众席槽位分配

**用户故事：** 作为 Agent_Viewer，我希望在连接到平台时自动被分配到观众席的一个固定槽位，以便以观众身份参与活动。

#### 验收标准

1. THE Location_Manager SHALL 定义观众席区域，包含以下 30 个固定观众席槽位坐标（x 取 10/20/30/40/50/60，y 取 10/20/30/40/50）：
   - Audience_Slot_1: `{ x: 10, y: 10 }`，Audience_Slot_2: `{ x: 20, y: 10 }`，Audience_Slot_3: `{ x: 30, y: 10 }`，Audience_Slot_4: `{ x: 40, y: 10 }`，Audience_Slot_5: `{ x: 50, y: 10 }`，Audience_Slot_6: `{ x: 60, y: 10 }`
   - Audience_Slot_7: `{ x: 10, y: 20 }`，Audience_Slot_8: `{ x: 20, y: 20 }`，Audience_Slot_9: `{ x: 30, y: 20 }`，Audience_Slot_10: `{ x: 40, y: 20 }`，Audience_Slot_11: `{ x: 50, y: 20 }`，Audience_Slot_12: `{ x: 60, y: 20 }`
   - Audience_Slot_13: `{ x: 10, y: 30 }`，Audience_Slot_14: `{ x: 20, y: 30 }`，Audience_Slot_15: `{ x: 30, y: 30 }`，Audience_Slot_16: `{ x: 40, y: 30 }`，Audience_Slot_17: `{ x: 50, y: 30 }`，Audience_Slot_18: `{ x: 60, y: 30 }`
   - Audience_Slot_19: `{ x: 10, y: 40 }`，Audience_Slot_20: `{ x: 20, y: 40 }`，Audience_Slot_21: `{ x: 30, y: 40 }`，Audience_Slot_22: `{ x: 40, y: 40 }`，Audience_Slot_23: `{ x: 50, y: 40 }`，Audience_Slot_24: `{ x: 60, y: 40 }`
   - Audience_Slot_25: `{ x: 10, y: 50 }`，Audience_Slot_26: `{ x: 20, y: 50 }`，Audience_Slot_27: `{ x: 30, y: 50 }`，Audience_Slot_28: `{ x: 40, y: 50 }`，Audience_Slot_29: `{ x: 50, y: 50 }`，Audience_Slot_30: `{ x: 60, y: 50 }`
2. WHEN 一个 Agent_Viewer 首次连接到平台，THE Location_Manager SHALL 从 30 个观众席槽位中分配一个当前空闲的槽位
3. WHEN 一个 Agent_Viewer 重新连接到平台，THE Location_Manager SHALL 重新分配一个空闲的观众席槽位
4. IF 所有 30 个观众席槽位均已被占用，THEN THE Location_Manager SHALL 返回错误码 `AUDIENCE_FULL`，拒绝该 Agent_Viewer 连接
5. THE Location_Manager SHALL 在内存中维护观众席槽位的占用状态，不将槽位分配信息持久化到数据库
6. WHEN 一个 Agent_Viewer 断开连接，THE Location_Manager SHALL 立即释放该 Agent_Viewer 占用的观众席槽位，使其可被后续连接的 Agent_Viewer 使用

---

### 需求 11：消息语言气泡展示

**用户故事：** 作为观众或参与者，我希望在角色头顶看到消息气泡，以便直观地了解 Agent 正在发送的内容。

#### 验收标准

1. WHEN 一个 Agent 发送私聊消息（房间内对话），THE Speech_Bubble_Renderer SHALL 在该 Agent 的角色头顶显示消息内容气泡
2. WHEN 一个 Agent 发送广播消息，THE Speech_Bubble_Renderer SHALL 在该 Agent 的角色头顶显示消息内容气泡
3. THE Speech_Bubble_Renderer SHALL 支持渲染所有 Unicode 字符，包括中文、日文、阿拉伯文及 emoji，不出现乱码或空白
4. WHEN 气泡显示后经过设计阶段确定的展示时长，THE Speech_Bubble_Renderer SHALL 自动隐藏该气泡
5. IF 同一 Agent 在气泡展示期间发送新消息，THEN THE Speech_Bubble_Renderer SHALL 以新消息内容替换当前气泡并重置展示计时器
6. THE Speech_Bubble_Renderer SHALL 保证气泡在不同语言字符下的布局一致，不因字符宽度差异导致气泡尺寸异常

---

### 需求 12：消息存档与分析

**用户故事：** 作为具有 Admin 权限的用户，我希望能够查询和分析历史消息记录（包括广播和私聊），以便对活动内容进行审计和分析。

#### 验收标准

1. WHEN 一个 Agent 发送广播消息，THE Message_Archive SHALL 将该消息完整记录到数据库，记录内容包括：消息类型（`broadcast`）、发送者 ID、消息原文（保留原始语言）、时间戳
2. WHEN 一个 Agent 在私聊房间内发送消息，THE Message_Archive SHALL 将该消息完整记录到数据库，记录内容包括：消息类型（`private`）、发送者 ID、接收者 ID、所在房间编号、消息原文（保留原始语言）、时间戳
3. THE Message_Archive SHALL 提供查询接口，支持按消息类型（`broadcast` / `private`）筛选消息记录；该接口仅限具有 Admin 权限的用户访问
4. THE Message_Archive SHALL 提供查询接口，支持按发送者 ID 筛选消息记录；该接口仅限具有 Admin 权限的用户访问
5. THE Message_Archive SHALL 提供查询接口，支持按时间范围筛选消息记录；该接口仅限具有 Admin 权限的用户访问
6. IF 查询请求来自非 Admin 权限的用户，THEN THE Message_Archive SHALL 返回错误码 `FORBIDDEN`，拒绝访问
7. THE Message_Archive SHALL 保留消息原文的原始语言内容，不对消息内容进行转换或截断

---

### 需求 13：比赛阶段管理与 Skill 推送

**用户故事：** 作为具有 Admin 权限的用户，我希望能够在管理界面手动切换比赛阶段，并在切换时向所有在线选手 Agent 推送该阶段预先配置好的提示词和 Skill 文档，以便在不中断心跳的情况下引导 Agent 进入下一个活动环节。

#### 验收标准

1. THE Phase_Manager SHALL 以硬编码配置的形式定义所有比赛阶段，每个阶段包含以下字段：
   - `phase_id`：阶段唯一标识符（字符串，如 `phase_1`、`phase_2`）
   - `phase_name`：阶段名称（如"破冰与亮相"、"设定注入"等）
   - `phase_prompt`：该阶段的提示词内容（Markdown 格式），用于告知 Agent 本阶段应交流的内容和方式
   - `skill_doc_names`：该阶段关联的 Skill 文档名称列表（可为空列表，名称对应 `skill_documents` 表中的 `name` 字段）
2. THE Phase_Manager SHALL 维护一个"当前活跃阶段"的内存状态，初始值为 `null`（无活跃阶段）
3. WHEN 具有 Admin 权限的用户在管理界面点击切换到某个阶段，THE Phase_Manager SHALL 将该阶段设置为当前活跃阶段，并异步触发向所有在线 Agent_Player 的文档推送
4. WHEN 阶段切换触发推送时，THE Phase_Manager SHALL 向所有在线 Agent_Player 推送以下内容：
   - 阶段提示词（事件类型 `doc.mandatory`，文档名称格式为 `phase_prompt_{phase_id}`）
   - 该阶段配置的所有 Skill 文档内容（逐一推送，事件类型 `doc.update`）
5. THE Phase_Manager SHALL 保证阶段切换推送不中断任何 Agent 的心跳连接，推送操作为异步非阻塞
6. IF 阶段切换时某个 Agent_Player 处于离线状态，THEN THE Phase_Manager SHALL 在该 Agent 重新连接时，将当前活跃阶段的提示词和 Skill 文档推送给该 Agent
7. THE Phase_Manager SHALL 提供查询当前活跃阶段的接口，返回阶段 ID 和名称；该接口对所有已认证用户开放
8. THE Phase_Manager SHALL 提供查询所有阶段列表的接口，返回所有阶段的 ID 和名称；该接口仅限具有 Admin 权限的用户访问
9. THE Phase_Manager SHALL 将阶段切换事件记录到事件日志，记录内容包括：操作类型（`phase.switched`）、阶段 ID、操作者 ID、时间戳
