// 导入 skills 文件夹里的文档到数据库
const Database = require('better-sqlite3');
const fs = require('fs');
const crypto = require('crypto');
const db = new Database('./data/xtion.db');

const docs = [
  { file: 'skills/skill.md', name: 'skill.md' },
  { file: 'skills/heartbeat.md', name: 'heartbeat.md' },
  { file: 'skills/messaging.md', name: 'messaging.md' },
  { file: 'skills/rules.md', name: 'rules.md' },
];

console.log('\n📄 导入平台文档到数据库...\n');

for (const doc of docs) {
  try {
    const content = fs.readFileSync(doc.file, 'utf-8');
    const docId = crypto.randomUUID();
    const now = Date.now();

    // 检查是否已存在
    const existing = db.prepare('SELECT id FROM platform_documents WHERE name = ?').get(doc.name);
    
    if (existing) {
      // 更新
      db.prepare(`
        UPDATE platform_documents 
        SET markdown_content = ?, updated_at = ?
        WHERE name = ?
      `).run(content, now, doc.name);
      console.log(`✅ 更新: ${doc.name}`);
    } else {
      // 插入
      db.prepare(`
        INSERT INTO platform_documents (id, name, markdown_content, is_mandatory, updated_at)
        VALUES (?, ?, ?, 1, ?)
      `).run(docId, doc.name, content, now);
      console.log(`✅ 导入: ${doc.name}`);
    }
  } catch (err) {
    console.error(`❌ 失败: ${doc.name}`, err.message);
  }
}

console.log('\n✅ 完成！\n');
db.close();
