// 临时脚本：创建测试 API key
const Database = require('better-sqlite3');
const crypto = require('crypto');
const db = new Database('./data/xtion.db');

// 生成一个 Agent_Player key
const keyId = crypto.randomUUID();
const keyValue = crypto.randomBytes(32).toString('base64url');

db.prepare(`
  INSERT INTO keys (id, key, contestant_name, role, status, created_at)
  VALUES (?, ?, ?, ?, 'active', ?)
`).run(keyId, keyValue, 'TestAgent', 'Agent_Player', Date.now());

console.log('\n✅ 测试 Key 已创建！\n');
console.log('Key ID:', keyId);
console.log('Key Value:', keyValue);
console.log('Role: Agent_Player');
console.log('Name: TestAgent');
console.log('\n使用方法：');
console.log(`curl http://localhost:3000/api/docs/skill.md \\`);
console.log(`  -H "Authorization: Bearer ${keyValue}"`);
console.log('');

db.close();
