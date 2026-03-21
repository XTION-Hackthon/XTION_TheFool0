# 地图编辑器使用指南

## 概述

地图编辑器提供两种使用方式：
- **React 组件**：`<MapEditor>` 可视化拖拽编辑，适合管理员界面
- **REST API**：直接调用 `/api/map-editor` 接口，适合脚本或自动化配置

---

## React 组件使用

### 基本用法

```tsx
import { MapEditor } from '../components/MapEditor';

function AdminPage() {
  const [editing, setEditing] = useState(false);

  return (
    <>
      <button onClick={() => setEditing(true)}>编辑地图</button>
      {editing && (
        <MapEditor
          roomId="room-uuid"
          apiBaseUrl="http://localhost:3000"
          authToken={token}
          onClose={() => setEditing(false)}
        />
      )}
    </>
  );
}
```

### 编辑工具

| 工具 | 操作 | 说明 |
|------|------|------|
| 选择 | 点击对象 | 选中墙体或出生点，在属性面板中编辑坐标 |
| 墙体 | 拖拽画布 | 按住鼠标拖拽绘制矩形墙体 |
| 出生点 | 点击画布 | 在点击位置放置出生点 |

保存前，编辑器会自动验证配置（墙体尺寸必须 > 0，出生点坐标必须为有效数字）。

---

## API 使用

### 保存房间配置

```typescript
const config = {
  walls: [
    { id: 'wall-001', roomId: 'room-uuid', x: 100, y: 50, width: 200, height: 20, rotation: 0, createdAt: new Date().toISOString() },
    { id: 'wall-002', roomId: 'room-uuid', x: 400, y: 200, width: 20, height: 150, rotation: 0, createdAt: new Date().toISOString() },
  ],
  spawnPoints: [
    { id: 'spawn-001', roomId: 'room-uuid', x: 150, y: 300, isAvailable: true, createdAt: new Date().toISOString() },
    { id: 'spawn-002', roomId: 'room-uuid', x: 500, y: 300, isAvailable: true, createdAt: new Date().toISOString() },
  ],
  bounds: { x1: 0, y1: 0, x2: 1280, y2: 720 },
};

const res = await fetch(`/api/map-editor/rooms/${roomId}/config`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
  body: JSON.stringify(config),
});

const { success, version } = await res.json();
console.log(`配置已保存，版本号：${version}`);
```

每次保存会替换该房间的全部墙体和出生点，并自动递增版本号。

### 加载房间配置

```typescript
const res = await fetch(`/api/map-editor/rooms/${roomId}/config`, {
  headers: { Authorization: `Bearer ${token}` },
});

if (res.status === 404) {
  console.log('该房间尚无配置');
} else {
  const { walls, spawnPoints, bounds } = await res.json();
  console.log(`墙体数量：${walls.length}，出生点数量：${spawnPoints.length}`);
}
```

### 查看配置历史

```typescript
const history = await fetch(`/api/map-editor/rooms/${roomId}/config/history`, {
  headers: { Authorization: `Bearer ${token}` },
}).then((r) => r.json());

// 按版本号降序排列，最新版本在前
for (const version of history) {
  console.log(`版本 ${version.version}，创建于 ${version.createdAt}`);
}
```

### 回滚到历史版本

```typescript
// 先获取历史版本列表
const history = await fetch(`/api/map-editor/rooms/${roomId}/config/history`, {
  headers: { Authorization: `Bearer ${token}` },
}).then((r) => r.json());

// 回滚到第二个版本（history[1]）
const targetVersion = history[1];
await fetch(`/api/map-editor/rooms/${roomId}/config/rollback`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
  body: JSON.stringify({ versionId: targetVersion.id }),
});
// 回滚后会创建一个新版本（版本号递增），内容与目标版本相同
```

---

## EditorStore 直接使用

如需在自定义组件中使用编辑器状态：

```typescript
import { useEditorStore } from '../stores/editorStore';

const {
  walls,
  spawnPoints,
  isDirty,
  validationErrors,
  startEditing,
  addWall,
  removeWall,
  addSpawnPoint,
  removeSpawnPoint,
  validateConfiguration,
  saveConfiguration,
} = useEditorStore();

// 开始编辑指定房间
startEditing('room-uuid');

// 添加墙体
addWall({ id: 'wall-001', roomId: 'room-uuid', x: 100, y: 50, width: 200, height: 20, rotation: 0 });

// 添加出生点
addSpawnPoint({ id: 'spawn-001', roomId: 'room-uuid', x: 300, y: 400, isAvailable: true });

// 验证配置
const errors = validateConfiguration();
if (errors.length === 0) {
  // 保存到后端
  const result = await saveConfiguration('http://localhost:3000', token);
  console.log(`保存成功，版本：${result.version}`);
}
```

---

## 配置验证规则

保存前系统会自动验证以下规则，违反时返回 `VALIDATION_ERROR`：

| 规则 | 说明 |
|------|------|
| 墙体尺寸 | `width > 0` 且 `height > 0` |
| 墙体坐标 | `x` 和 `y` 必须为有限数 |
| 出生点坐标 | `x` 和 `y` 必须为有限数 |
| 房间边界 | 若提供，`x2 > x1` 且 `y2 > y1` |

---

## 注意事项

- 每次保存会**替换**该房间的全部墙体和出生点，不是增量更新
- 墙体坐标 `x`、`y` 为左上角，碰撞检测时系统内部自动转换为中心坐标
- 出生点建议分散放置，避免新 bot 出生时碰撞（系统最多尝试 3 次分配）
- 配置历史无限保留，可随时回滚到任意历史版本
