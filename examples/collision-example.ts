/**
 * collision-example.ts
 * 碰撞检测使用示例
 * Requirements: 3, 4, 5
 *
 * 演示：移动验证、墙体碰撞、bot 碰撞、附近 bot 查询、碰撞响应
 */

// ─── 配置 ─────────────────────────────────────────────────────────────────────

const API_BASE = 'http://localhost:3000';
const TOKEN = 'your-api-token-here';

const headers = {
  'Content-Type': 'application/json',
  Authorization: `Bearer ${TOKEN}`,
};

// ─── 示例 1：验证移动（无碰撞） ───────────────────────────────────────────────

async function example1_validMove(roomId: string) {
  console.log('\n=== 示例 1：验证合法移动 ===');

  const res = await fetch(`${API_BASE}/api/collision/validate-move`, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      roomId,
      botId: 'bot-001',
      targetPos: { x: 200, y: 300 },
    }),
  });

  const result = await res.json();
  if (result.valid) {
    console.log('移动合法，可以更新位置');
  }
}

// ─── 示例 2：检测 bot-bot 碰撞 ────────────────────────────────────────────────

async function example2_botCollision(roomId: string) {
  console.log('\n=== 示例 2：Bot-Bot 碰撞检测 ===');

  // 假设 bot-002 已在 (200, 300)，bot-001 尝试移动到同一位置
  const res = await fetch(`${API_BASE}/api/collision/validate-move`, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      roomId,
      botId: 'bot-001',
      targetPos: { x: 200, y: 300 }, // bot-002 所在位置
    }),
  });

  const result = await res.json();
  if (!result.valid && result.collisionType === 'bot') {
    console.log(`与 bot ${result.collidedWith} 碰撞，移动被阻止`);
    console.log('尝试替代位置...');
  }
}

// ─── 示例 3：检测墙体碰撞 ─────────────────────────────────────────────────────

async function example3_wallCollision(roomId: string) {
  console.log('\n=== 示例 3：Bot-Wall 碰撞检测 ===');

  const res = await fetch(`${API_BASE}/api/collision/validate-move`, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      roomId,
      botId: 'bot-001',
      targetPos: { x: 150, y: 60 }, // 墙体所在区域
    }),
  });

  const result = await res.json();
  if (!result.valid && result.collisionType === 'wall') {
    console.log(`与墙体 ${result.collidedWith} 碰撞，需要绕行`);
  }
}

// ─── 示例 4：碰撞响应 — 自动寻找替代位置 ─────────────────────────────────────

async function tryMove(
  roomId: string,
  botId: string,
  target: { x: number; y: number },
): Promise<{ x: number; y: number } | null> {
  const res = await fetch(`${API_BASE}/api/collision/validate-move`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ roomId, botId, targetPos: target }),
  });
  const result = await res.json();

  if (result.valid) return target;

  // 尝试 4 个替代方向（步长 40px）
  const alternatives = [
    { x: target.x + 40, y: target.y },
    { x: target.x - 40, y: target.y },
    { x: target.x, y: target.y + 40 },
    { x: target.x, y: target.y - 40 },
  ];

  for (const alt of alternatives) {
    const altRes = await fetch(`${API_BASE}/api/collision/validate-move`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ roomId, botId, targetPos: alt }),
    });
    const altResult = await altRes.json();
    if (altResult.valid) {
      console.log(`替代位置找到: (${alt.x}, ${alt.y})`);
      return alt;
    }
  }

  console.log('所有方向均被阻挡');
  return null;
}

async function example4_collisionResponse(roomId: string) {
  console.log('\n=== 示例 4：碰撞响应 ===');

  const finalPos = await tryMove(roomId, 'bot-001', { x: 200, y: 300 });
  if (finalPos) {
    console.log(`最终移动到: (${finalPos.x}, ${finalPos.y})`);
  }
}

// ─── 示例 5：查询附近 bot ─────────────────────────────────────────────────────

async function example5_nearbyBots(roomId: string) {
  console.log('\n=== 示例 5：查询附近 Bot ===');

  const res = await fetch(
    `${API_BASE}/api/collision/nearby-bots?roomId=${roomId}&x=200&y=300&radius=150`,
    { headers },
  );
  const { botIds } = await res.json();
  console.log(`半径 150px 内的 bot: ${botIds.join(', ') || '无'}`);
}

// ─── 主流程 ───────────────────────────────────────────────────────────────────

async function main() {
  // 假设已有一个房间 ID
  const roomId = 'your-room-id-here';

  await example1_validMove(roomId);
  await example2_botCollision(roomId);
  await example3_wallCollision(roomId);
  await example4_collisionResponse(roomId);
  await example5_nearbyBots(roomId);
}

main().catch(console.error);
