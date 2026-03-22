#!/usr/bin/env node

/**
 * 初始化脚本：创建第一个 Admin Key
 * 使用方式: node init-admin-key.js
 * 
 * 这个脚本会：
 * 1. 检查是否已有 Admin Key
 * 2. 如果没有，创建一个新的 Admin Key
 * 3. 输出 Key 和访问 URL
 */

const Database = require('better-sqlite3');
const crypto = require('crypto');
const { v4: uuidv4 } = require('uuid');

const db = new Database('./data/xtion.db');

try {
  // 检查是否已有 Admin Key
  const existingAdmin = db.prepare(`
    SELECT * FROM keys WHERE role = 'Admin' AND status = 'active' LIMIT 1
  `).get();

  if (existingAdmin) {
    console.log('\n✓ Admin Key 已存在！\n');
    console.log(`  Key: ${existingAdmin.key}`);
    console.log(`  Name: ${existingAdmin.contestant_name}`);
    console.log(`  URL: http://localhost:3000?key=${existingAdmin.key}\n`);
    process.exit(0);
  }

  // 创建新的 Admin Key
  const adminKey = {
    id: uuidv4(),
    key: crypto.randomBytes(32).toString('hex'),
    contestantName: 'admin',
    role: 'Admin',
    status: 'active',
    createdAt: Date.now(),
  };

  db.prepare(`
    INSERT INTO keys (id, key, contestant_name, role, status, created_at)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(
    adminKey.id,
    adminKey.key,
    adminKey.contestantName,
    adminKey.role,
    adminKey.status,
    adminKey.createdAt
  );

  console.log('\n✅ Admin Key 已创建！\n');
  console.log(`  Key: ${adminKey.key}`);
  console.log(`  Name: ${adminKey.contestantName}`);
  console.log(`  Role: ${adminKey.role}`);
  console.log(`\n📋 访问 URL:\n  http://localhost:3000?key=${adminKey.key}\n`);
  console.log('💡 提示：');
  console.log('  1. 复制上面的 URL 在浏览器中打开');
  console.log('  2. 或者在前端输入框中粘贴 Key');
  console.log('  3. 登录后可以通过 Admin Panel 生成其他 Agent 的 Key\n');

} catch (err) {
  console.error('❌ 错误:', err.message);
  process.exit(1);
} finally {
  db.close();
}
