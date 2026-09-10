'use strict';
// 隔离测试：验证删除墓碑的过期清理（GC），防止墓碑随删除次数无限增长
// 运行： node test/store-tombstone.test.js
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const tmpData = fs.mkdtempSync(path.join(os.tmpdir(), 'aishare-tomb-'));
process.env.AI_SHARE_DATA_DIR = tmpData; // 必须在 require store 之前设置

const store = require('../lib/store');

let passed = 0;
function ok(name, cond) { assert.ok(cond, name); console.log('  ✓ ' + name); passed++; }

try {
  const a = store.create('prompts', { title: 'OLD' });
  const b = store.create('prompts', { title: 'NEW' });
  store.remove('prompts', a.id);
  store.remove('prompts', b.id);

  // 把 a 的墓碑时间回拨 40 天（超过 30 天保留期）
  const items = store.listRaw('prompts');
  items.find((x) => x.id === a.id).updatedAt = new Date(Date.now() - 40 * 24 * 3600 * 1000).toISOString();
  store.rewrite('prompts', items);

  const res = store.purgeTombstones(30);
  ok('purgeTombstones 正常返回', !res.error && typeof res.removed === 'number');
  ok('清理了超过保留期的墓碑', res.removed === 1);

  const after = store.listRaw('prompts');
  ok('过期墓碑已被移除', !after.some((x) => x.id === a.id));
  ok('未过期的墓碑被保留', after.some((x) => x.id === b.id));
  ok('存活记录不受影响', after.some((x) => !x._deleted));

  ok('days=0 被拒绝（避免误清空）', !!store.purgeTombstones(0).error);
  ok('days 非数字被拒绝', !!store.purgeTombstones('abc').error);

  console.log('\n全部通过：' + passed + ' 项');
} catch (e) {
  console.error('\n测试失败：', e.message);
  console.error(e.stack);
  process.exitCode = 1;
} finally {
  fs.rmSync(tmpData, { recursive: true, force: true });
}
