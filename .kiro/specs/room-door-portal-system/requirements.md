# 需求文档：房间-墙体-门洞系统

## 简介

房间-墙体-门洞系统在同一个 Phaser 游戏画布上构建一个连续的物理世界地图。房间是地图上由墙体围合的区域，门洞是墙体上的缺口/开口，bot 可以直接走过门洞从一个房间进入另一个房间，无需任何传送、场景切换或摄像机过渡。bot 所在的房间由其当前坐标落在哪个房间的边界范围内来判定。整个系统就像一栋建筑的平面图：一张大地图，墙壁分隔出房间，门洞是墙上的通道。

## 术语表

- **世界地图（World_Map）**: 单一的 Phaser 游戏画布，所有房间、墙体、门洞都在同一个连续坐标空间中渲染
- **房间（Room）**: 世界地图上由墙体围合的一块矩形区域，具有边界坐标（bounds_x1, bounds_y1, bounds_x2, bounds_y2），用于判定 bot 所在位置
- **墙体（Wall）**: 不可通过的物理障碍物，具有位置、宽度、高度，用于分隔房间区域，bot 不能穿过墙体
- **门洞（Doorway）**: 两个相邻房间之间共享墙体上的一段开口/缺口，bot 可以自由走过该开口进入另一个房间
- **Bot**: 系统中的自主代理或用户控制的实体，在世界地图上连续移动，通过门洞在房间之间自由穿行
- **房间归属（Room_Membership）**: 根据 bot 当前世界坐标判定其所在房间的逻辑——bot 的坐标落在哪个房间的边界范围内，bot 就属于哪个房间
- **地图编辑器（Map_Editor）**: 管理员用于在世界地图上放置房间、墙体、定义门洞开口的可视化编辑工具

## 需求

### 需求1：单一世界地图上的房间布局

**用户故事：** 作为系统管理员，我想在同一张世界地图上定义多个房间区域，这样所有房间在一个连续的游戏空间中共存。

#### 验收标准

1. THE Room SHALL 具有边界坐标属性（bounds_x1, bounds_y1, bounds_x2, bounds_y2），定义其在世界地图上的矩形区域
2. WHEN 系统启动时，THE World_Map SHALL 在同一个 Phaser 画布上渲染所有房间区域及其墙体
3. THE World_Map SHALL 使用单一的 Phaser Scene，所有房间内容在同一个场景中渲染
4. IF 两个房间的边界区域发生重叠，THEN THE World_Map SHALL 在保存时返回验证错误，阻止重叠配置
5. WHEN 管理员更新房间边界时，THE World_Map SHALL 重新渲染该房间区域到新的位置和尺寸

### 需求2：墙体放置与碰撞

**用户故事：** 作为系统管理员，我想在房间边界放置墙体，这样房间之间有物理隔离，bot 不能随意穿越。

#### 验收标准

1. THE Wall SHALL 具有以下属性：唯一标识符、所属房间标识符、位置坐标（x, y）、宽度、高度、旋转角度
2. WHEN bot 移动时，THE Wall SHALL 作为不可通过的碰撞体阻止 bot 穿越
3. WHEN 系统加载房间时，THE Room SHALL 加载该房间的所有墙体并注册到碰撞系统
4. THE Wall SHALL 在世界地图上以可视化矩形渲染，表示物理障碍
5. WHEN 管理员在地图编辑器中放置墙体时，THE Map_Editor SHALL 将墙体保存到持久存储

### 需求3：门洞定义（墙体开口）

**用户故事：** 作为系统管理员，我想在两个相邻房间之间的墙体上定义门洞开口，这样 bot 可以通过该开口自由走到另一个房间。

#### 验收标准

1. THE Doorway SHALL 具有以下属性：唯一标识符、关联的两个房间标识符、在世界地图上的位置坐标（x, y）、开口宽度、开口高度
2. THE Doorway SHALL 表示墙体上的一段缺口，该区域没有碰撞体，bot 可以自由通过
3. WHEN 管理员在地图编辑器中定义门洞时，THE Map_Editor SHALL 确保门洞位置处于两个房间的共享边界上
4. WHEN 系统渲染墙体时，THE World_Map SHALL 在门洞位置留出开口，不渲染该段墙体
5. IF 管理员定义的门洞宽度小于 bot 的碰撞箱宽度，THEN THE Map_Editor SHALL 显示警告提示门洞过窄

### 需求4：基于位置的房间归属判定

**用户故事：** 作为系统，我想根据 bot 的当前坐标自动判定其所在房间，这样无需任何切换操作即可知道 bot 在哪个房间。

#### 验收标准

1. WHEN bot 的世界坐标发生变化时，THE Room_Membership SHALL 检查 bot 坐标落在哪个房间的边界范围内，并更新 bot 的所属房间
2. THE Room_Membership SHALL 使用房间的边界坐标（bounds_x1, bounds_y1, bounds_x2, bounds_y2）进行包含判定
3. WHEN bot 从一个房间的区域走过门洞进入另一个房间的区域时，THE Room_Membership SHALL 自动将 bot 的所属房间更新为新房间
4. IF bot 的坐标不在任何房间的边界范围内，THEN THE Room_Membership SHALL 将 bot 标记为"在房间外"状态
5. WHEN bot 的所属房间发生变化时，THE Room_Membership SHALL 通过 WebSocket 通知相关客户端更新 bot 列表
6. THE Room_Membership SHALL 在服务端和客户端同时维护 bot 的房间归属状态

### 需求5：bot 连续移动与门洞穿行

**用户故事：** 作为一个 bot，我想在世界地图上连续移动，走过门洞时自然地进入另一个房间，无需任何特殊操作。

#### 验收标准

1. THE Bot SHALL 在世界地图上进行连续的坐标移动，移动逻辑不因房间边界而中断
2. WHEN bot 移动路径经过门洞开口时，THE Bot SHALL 像在普通空地上移动一样自由通过，无需触发任何传送或切换逻辑
3. WHEN bot 穿过门洞后坐标进入新房间边界时，THE Room_Membership SHALL 自动更新 bot 的所属房间
4. THE Bot SHALL 被墙体碰撞体阻挡，仅能通过门洞开口在房间之间移动
5. WHILE bot 在门洞开口区域内时，THE Bot SHALL 保持正常移动速度和行为，无任何特殊状态

### 需求6：摄像机跟随

**用户故事：** 作为用户，我想摄像机跟随 bot 在世界地图上移动，这样我始终能看到 bot 的位置。

#### 验收标准

1. THE World_Map SHALL 使摄像机跟随当前选中的 bot，保持 bot 在视口中心
2. WHEN bot 穿过门洞进入新房间区域时，THE World_Map SHALL 保持摄像机平滑跟随，无任何跳转或过渡效果
3. THE World_Map SHALL 渲染摄像机视口范围内的所有可见内容，包括多个房间的墙体和 bot

### 需求7：数据持久化

**用户故事：** 作为系统管理员，我想房间、墙体和门洞配置持久化存储，这样系统重启后地图布局不会丢失。

#### 验收标准

1. THE Room SHALL 在数据库 rooms 表中存储边界坐标（bounds_x1, bounds_y1, bounds_x2, bounds_y2）
2. THE Wall SHALL 在数据库 walls 表中存储位置、尺寸和旋转信息
3. WHEN 管理员创建门洞时，THE Doorway SHALL 将门洞数据保存到数据库的 doorways 表
4. THE Doorway SHALL 在数据库中存储以下字段：id、room_a_id、room_b_id、x、y、width、height、created_at
5. WHEN 系统启动时，THE World_Map SHALL 从数据库加载所有房间、墙体和门洞数据并渲染世界地图

### 需求8：服务端房间归属验证

**用户故事：** 作为系统架构师，我想服务端验证 bot 的房间归属变更，这样可以防止非法的位置篡改。

#### 验收标准

1. WHEN bot 提交移动请求时，THE Server SHALL 验证新坐标不与任何墙体碰撞
2. WHEN bot 的坐标从一个房间区域移动到另一个房间区域时，THE Server SHALL 验证两个房间之间存在门洞连接
3. IF bot 尝试移动到墙体内部，THEN THE Server SHALL 拒绝该移动请求
4. WHEN bot 的房间归属发生变化时，THE Server SHALL 原子性地更新 bot 的房间归属记录
5. IF 目标房间已满（达到容量上限），THEN THE Server SHALL 阻止 bot 进入该房间并返回房间已满的提示

### 需求9：地图编辑器中的房间与门洞管理

**用户故事：** 作为管理员，我想在地图编辑器中直观地管理房间布局、墙体和门洞，这样我可以方便地设计世界地图。

#### 验收标准

1. THE Map_Editor SHALL 在世界地图视图中显示所有房间的边界区域、墙体和门洞
2. WHEN 管理员创建房间时，THE Map_Editor SHALL 允许在世界地图上拖拽定义房间的矩形区域
3. WHEN 管理员在两个相邻房间的共享边界上点击时，THE Map_Editor SHALL 允许定义门洞开口的位置和宽度
4. WHEN 管理员选择门洞时，THE Map_Editor SHALL 显示门洞属性面板（关联房间、位置、宽度）
5. WHEN 管理员删除门洞时，THE Map_Editor SHALL 恢复该位置的墙体碰撞
6. THE Map_Editor SHALL 用不同的视觉样式区分墙体（实线）和门洞开口（虚线或高亮）
7. IF 管理员拖拽房间导致与其他房间重叠，THEN THE Map_Editor SHALL 显示红色警告边框并阻止保存
