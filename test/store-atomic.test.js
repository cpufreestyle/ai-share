'use strict';
// 隔离测试：验证集合落盘的原子性与崩溃可恢复性（所有读写指向临时 data 目录，不触碰真实 data/）
// 运行： node test/store-atomic.test.js
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const tmpData = fs.mkdtempSync(path.join(os.tmpdir(), 'aishare-store-'));
process.env.AI_SHARE_DATA_DIR = tmpData; // 必须在 require store 之前设置

const store = require('../lib/store');

let passed = 0;
function ok(name, cond) { assert.ok(cond, name); console.log('  ✓ ' + name); passed++; }

const target = path.join(tmpData, 'prompts.json');

try {
  // 1) 写入后不应残留临时文件，且应生成上一版本备份
  const r1 = store.create('prompts', { title: 'T1', content: 'C1' });
  ok('create 返回带 id 的记录', !!(r1 && r1.id));
  store.create('prompts', { title: 'T2', content: 'C2' });

  const files = fs.readdirSync(tmpData);
  ok('写入后无 .tmp 残留（原子落盘）', !files.some((f) => f.endsWith('.tmp')));
  ok('写入后生成 .bak 备份', files.includes('prompts.json.bak'));

  // 2) .bak 应为「上一版本」：含较早的 T1，不含最新写入的 T2
  const bakTitles = JSON.parse(fs.readFileSync(target + '.bak', 'utf8')).map((x) => x.title);
  ok('.bak 保留上一版本的记录 T1', bakTitles.includes('T1'));
  ok('.bak 不含最新一次写入的 T2', !bakTitles.includes('T2'));

  // 3) 人为破坏主文件（模拟写入被中断导致 JSON 截断）
  fs.writeFileSync(target, '{"broken":');
  const titles = store.list('prompts').map((x) => x.title);
  ok('主文件损坏后自动回滚到 .bak', titles.includes('T1'));
  ok('损坏文件被隔离留证', fs.readdirSync(tmpData).some((f) => f.startsWith('prompts.json.corrupt-')));

  // 4) 恢复后仍可正常写入
  const r3 = store.create('prompts', { title: 'T3', content: 'C3' });
  ok('恢复后仍可写入', !!(r3 && r3.id));
  ok('恢复后能读回新写入的记录', store.list('prompts').some((x) => x.title === 'T3'));

  console.log('\n全部通过：' + passed + ' 项');
} catch (e) {
  console.error('\n测试失败：', e.message);
  console.error(e.stack);
  process.exitCode = 1;
} finally {
  fs.rmSync(tmpData, { recursive: true, force: true });
}
