/**
 * multi-room-example.ts
 * 多房间系统使用示例
 * Requirements: 1, 2, 9
 *
 * 演示：创建房间、bot 加入/离开、房间切换、容量管理、WebSocket 实时同步
 */

// ─── 配置 ─────────────────────────────────────────────────────────────────────

const API_BASE = 'http://localhost:3000';
const TOKEN = 'your-api-token-here';

const headers = {
  'Content-Type': 'application/json',
  Authorization: `Bearer ${TOKEN}`,
};

// ─── 辅助函数 ─────────────────────────────────────────────────────────────────

async function apiPost(path: string, body: unknown) {
  const res = await fetch(`${API_BASE}${path}`, { method: 'POST', headers, body: JSON.stringify(body) });
  return res.json();
}

async function apiGet(path: string) {
  const res = await fetch(`${API_BASE}${path}`, { headers });
  return res.json();
}

// ─── 示例 1：创建主大厅和私聊房间 ────────────────────────────────────────────

async function example1_createRooms() {
  console.log('\n=== 示例 1：创建房间 ===');

  // 创建主大厅（容量无限）
  const mainHall = await apiPost('/api/rooms', {
    name: 'MainHall',
    type: 'MainHall',
    bounds: { x1: 0, y1: 0, x2: 1280, y2: 720 },
  });
  console.log('主大厅已创建:', mainHall.id, `容量: ${mainHall.capacity}`);

  // 创建私聊房间（容量默认为 2）
  const privateRoom = await apiPost('/api/rooms', {
    name: 'PrivateRoom-A',
    type: 'PrivateRoom',
  });
  console.log('私聊房间已创建:', privateRoom.id, `容量: ${privateRoom.capacity}`);

  return { mainHall, privateRoom };
}

// ─── 示例 2：Bot 加入主大厅（自动分配出生点） ────────────────────────────────

async function example2_joinMainHall(mainHallId: string) {
  console.log('\n=== 示例 2：Bot 加入主大厅 ===');

  // bot-001 加入，自动分配出生点
  const join1 = await apiPost(`/api/rooms/${mainHallId}/join`, { botId: 'bot-001' });
  console.log(`bot-001 出生于 (${join1.position.x}, ${join1.position.y})`);

  // bot-002 加入，指定位置
  const join2 = await apiPost(`/api/rooms/${mainHallId}/join`, {
    botId: 'bot-002',
    position: { x: 400, y: 300 },
  });
  console.log(`bot-002 加入于 (${join2.position.x}, ${join2.position.y})`);

  // 查看房间当前状态
  const detail = await apiGet(`/api/rooms/${mainHallId}`);
  console.log(`主大厅当前人数: ${detail.currentCount}`);
}

// ─── 示例 3：私聊房间容量管理 ─────────────────────────────────────────────────

async function example3_capacityManagement(privateRoomId: string) {
  console.log('\n=== 示例 3：私聊房间容量管理 ===');

  // 第一个 bot 加入
  await apiPost(`/api/rooms/${privateRoomId}/join`, { botId: 'bot-003' });
  console.log('bot-003 已加入私聊房间');

  // 第二个 bot 加入（达到上限）
  await apiPost(`/api/rooms/${privateRoomId}/join`, { botId: 'bot-004' });
  console.log('bot-004 已加入私聊房间（已满员）');

  // 第三个 bot 尝试加入（应被拒绝）
  const res = await fetch(`${API_BASE}/api/rooms/${privateRoomId}/join`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ botId: 'bot-005' }),
  });
  const result = await res.json();

  if (res.status === 400 && result.code === 'ROOM_AT_CAPACITY') {
    console.log('bot-005 被拒绝：房间已满');
  }

  // bot-003 离开后，房间重新可用
  await apiPost(`/api/rooms/${privateRoomId}/leave`, { botId: 'bot-003' });
  console.log('bot-003 已离开，房间重新可用');

  const detail = await apiGet(`/api/rooms/${privateRoomId}`);
  console.log(`私聊房间当前人数: ${detail.currentCount}/${detail.capacity}`);
}

// ─── 示例 4：房间切换 ─────────────────────────────────────────────────────────

async function example4_roomSwitch(mainHallId: string, privateRoomId: string) {
  console.log('\n=== 示例 4：房间切换 ===');

  const botId = 'bot-001';

  // 离开主大厅
  await apiPost(`/api/rooms/${mainHallId}/leave`, { botId });
  console.log(`${botId} 已离开主大厅`);

  // 加入私聊房间
  const join = await apiPost(`/api/rooms/${privateRoomId}/join`, { botId });
  console.log(`${botId} 已加入私聊房间，位置: (${join.position.x}, ${join.position.y})`);

  // 切换回主大厅
  await apiPost(`/api/rooms/${privateRoomId}/leave`, { botId });
  const rejoin = await apiPost(`/api/rooms/${mainHallId}/join`, { botId });
  console.log(`${botId} 已返回主大厅，位置: (${rejoin.position.x}, ${rejoin.position.y})`);
}

// ─── 示例 5：获取所有房间列表 ─────────────────────────────────────────────────

async function example5_listRooms() {
  console.log('\n=== 示例 5：房间列表 ===');

  const rooms = await apiGet('/api/rooms');
  for (const room of rooms) {
    const status = room.currentCount >= room.capacity ? '已满' : '可加入';
    console.log(`[${room.type}] ${room.name} — ${room.currentCount}/${room.capacity} (${status})`);
  }
}

// ─── 主流程 ───────────────────────────────────────────────────────────────────

async function main() {
  const { mainHall, privateRoom } = await example1_createRooms();
  await example2_joinMainHall(mainHall.id);
  await example3_capacityManagement(privateRoom.id);
  await example4_roomSwitch(mainHall.id, privateRoom.id);
  await example5_listRooms();
}

main().catch(console.error);
