// 临时脚本：查看数据库状态
const Database = require('better-sqlite3');
const db = new Database('./data/xtion.db');

console.log('\n=== 所有选手 ===');
const contestants = db.prepare('SELECT id, name, status, key_id FROM contestants').all();
console.table(contestants);

console.log('\n=== 在线选手 ===');
const online = db.prepare('SELECT id, name, status FROM contestants WHERE status = "online"').all();
console.table(online);

console.log('\n=== 所有 API Keys ===');
const keys = db.prepare('SELECT id, contestant_name, role, revoked FROM keys').all();
console.table(keys);

db.close();
