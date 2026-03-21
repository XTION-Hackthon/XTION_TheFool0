#!/usr/bin/env node

/**
 * 生成多个 API Key 的脚本
 * 使用方式: node generate-keys.js <数量> [基础名称] [角色]
 * 例如: XTION_ADMIN_KEY=... node generate-keys.js 5 Agent Agent_Player
 */

const http = require('http');

const count = parseInt(process.argv[2]) || 3;
const baseName = process.argv[3] || 'Agent';
const role = process.argv[4] || 'Agent_Player';
const adminKey = process.env.XTION_ADMIN_KEY || process.env.ADMIN_KEY || '';
const apiHost = process.env.XTION_API_HOST || 'localhost';
const apiPort = parseInt(process.env.XTION_API_PORT || '3000', 10);
const VALID_ROLES = new Set(['Admin', 'Agent_Player', 'Human_Viewer', 'Agent_Viewer']);

async function generateKey(name) {
  return new Promise((resolve, reject) => {
    const postData = JSON.stringify({ name, role });

    const options = {
      hostname: apiHost,
      port: apiPort,
      path: '/api/admin/keys',
      method: 'POST',
      headers: {
        Authorization: `Bearer ${adminKey}`,
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(postData),
      },
    };

    const req = http.request(options, (res) => {
      let data = '';
      res.on('data', (chunk) => {
        data += chunk;
      });
      res.on('end', () => {
        if (res.statusCode === 201) {
          resolve(JSON.parse(data));
        } else {
          reject(new Error(`HTTP ${res.statusCode}: ${data}`));
        }
      });
    });

    req.on('error', reject);
    req.write(postData);
    req.end();
  });
}

async function main() {
  if (!adminKey) {
    throw new Error('缺少 XTION_ADMIN_KEY 或 ADMIN_KEY，无法调用 /api/admin/keys');
  }
  if (!VALID_ROLES.has(role)) {
    throw new Error(`无效角色: ${role}。可选值: ${Array.from(VALID_ROLES).join(', ')}`);
  }

  console.log(`\n🔑 生成 ${count} 个 API Key（role=${role}）...\n`);

  const keys = [];
  for (let i = 1; i <= count; i++) {
    try {
      const name = `${baseName}${i}`;
      const key = await generateKey(name);
      keys.push(key);
      console.log(`✓ ${name}`);
      console.log(`  Key: ${key.key}`);
      console.log(`  ID:  ${key.id}\n`);
    } catch (err) {
      console.error(`✗ 生成失败: ${err.message}\n`);
    }
  }

  console.log('\n📋 所有 Key 汇总:\n');
  keys.forEach((key, idx) => {
    console.log(`${idx + 1}. ${key.contestantName}`);
    console.log(`   Key: ${key.key}`);
  });

  console.log('\n✅ 完成！\n');
}

main().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
