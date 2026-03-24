#!/usr/bin/env node

/**
 * 更新 Admin Key 脚本
 * 使用方式: node update-admin-key.js
 */

const Database = require('better-sqlite3');

const db = new Database('./data/xtion.db');

try {
  // 查找 Admin Key
  const admin = db.prepare(`
    SELECT * FROM keys WHERE role = 'Admin' LIMIT 1
  `).get();

  if (!admin) {
    console.log('\n❌ 未找到 Admin Key，请先运行 init-admin-key.js\n');
    process.exit(1);
  }

  // 更新为新的 key
  const newKey = '1234560';
  
  db.prepare(`
    UPDATE keys SET key = ? WHERE role = 'Admin'
  `).run(newKey);

  console.log('\n✅ Admin Key 已更新！\n');
  console.log(`  新 Key: ${newKey}`);
  console.log(`  Name: ${admin.contestant_name}`);
  console.log(`  Role: ${admin.role}`);
  console.log(`\n📋 访问 URL:\n  http://localhost:3000?key=${newKey}\n`);

} catch (err) {
  console.error('❌ 错误:', err.message);
  process.exit(1);
} finally {
  db.close();
}
