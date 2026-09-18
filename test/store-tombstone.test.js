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

  const tp = store.create('clients', { title: 'TMP' });
  store.remove('clients', tp.id);
  ok('移除后进入墓碑', store.listDeleted('clients').some((x) => x.id === tp.id));
  const pr = store.purgeTombstone('clients', tp.id);
  ok('purgeTombstone 返回被删 id', pr && pr.id === tp.id);
  ok('彻底删除后墓碑消失', !store.listDeleted('clients').some((x) => x.id === tp.id));
  ok('对不存在的墓碑返回 null', store.purgeTombstone('clients', 'nope') === null);

  // 回归：墓碑曾只存空壳，恢复丢全部字段（且同步会把空壳传播到对端）
  const full = store.create('providers', { name: 'FULLROW', baseUrl: 'https://f.test', notes: 'keepme' });
  store.remove('providers', full.id);
  ok('删除后回收站可见原字段', store.listDeleted('providers').some((x) => x.id === full.id && x.name === 'FULLROW'));
  const back = store.restore('providers', full.id);
  ok('恢复后字段完整不丢失', back && back.name === 'FULLROW' && back.baseUrl === 'https://f.test' && back.notes === 'keepme');
  ok('恢复后重回正常列表', store.list('providers').some((x) => x.id === full.id));

  // 批量操作：一次加锁完成 N 条，替代前端 N 次串行请求
  const b1 = store.create('prompts', { title: 'B1' });
  const b2 = store.create('prompts', { title: 'B2' });
  const b3 = store.create('prompts', { title: 'B3' });
  const rm = store.removeMany('prompts', [b1.id, b2.id, 'nope']);
  ok('removeMany 删除了 2 条', rm.removed === 2);
  ok('removeMany 报告了 1 条不存在', rm.missing.length === 1 && rm.missing[0] === 'nope');
  ok('批量删除后进入墓碑', [b1.id, b2.id].every(id => store.listDeleted('prompts').some(x => x.id === id)));
  ok('批量删除不影响未选中的记录', store.list('prompts').some(x => x.id === b3.id && !x._deleted));
  ok('removeMany 空数组不报错', store.removeMany('prompts', []).removed === 0);

  const rr = store.restoreMany([{ col: 'prompts', id: b1.id }, { col: 'prompts', id: b2.id }, { col: 'prompts', id: 'ghost' }]);
  ok('restoreMany 恢复了 2 条', rr.restored === 2);
  ok('restoreMany 报告了 1 条不存在', rr.missing.length === 1);
  ok('批量恢复后重回正常列表', [b1.id, b2.id].every(id => store.list('prompts').some(x => x.id === id && !x._deleted)));
  ok('restoreMany 忽略未知集合', store.restoreMany([{ col: 'nope', id: b3.id }]).restored === 0);

  store.remove('prompts', b3.id);
  const pp = store.purgeMany([{ col: 'prompts', id: b3.id }]);
  ok('purgeMany 彻底删除了 1 条', pp.purged === 1);
  ok('purgeMany 后墓碑消失', !store.listDeleted('prompts').some(x => x.id === b3.id));
  // 安全边界：purgeMany 只对墓碑生效，不能误删存活记录
  const alive = store.create('prompts', { title: 'ALIVE' });
  const pp2 = store.purgeMany([{ col: 'prompts', id: alive.id }]);
  ok('purgeMany 不删存活记录', pp2.purged === 0 && store.list('prompts').some(x => x.id === alive.id));
  ok('purgeMany 对非墓碑报 missing', pp2.missing.length === 1);

  // 批量启用/停用
  const e1 = store.create('mcpservers', { name: 'E1', type: 'stdio', command: 'npx', enabled: false });
  const e2 = store.create('mcpservers', { name: 'E2', type: 'stdio', command: 'npx', enabled: false });
  const en = store.setEnabledMany('mcpservers', [e1.id, e2.id], true);
  ok('setEnabledMany 切换 2 条', en.changed === 2);
  ok('setEnabledMany 后 enabled 为 true', [e1.id, e2.id].every((id) => store.get('mcpservers', id).enabled === true));
  ok('setEnabledMany 同值重复调用 changed 为 0', store.setEnabledMany('mcpservers', [e1.id], true).changed === 0);
  ok('setEnabledMany 停用生效', store.setEnabledMany('mcpservers', [e1.id, e2.id], false).changed === 2 && store.get('mcpservers', e1.id).enabled === false);
  ok('setEnabledMany 空数组不报错', store.setEnabledMany('mcpservers', [], true).changed === 0);
  const dead = store.create('mcpservers', { name: 'DEAD', type: 'stdio', command: 'npx', enabled: false });
  store.remove('mcpservers', dead.id);
  const deadRes = store.setEnabledMany('mcpservers', [dead.id], true);
  ok('setEnabledMany 不触碰墓碑', deadRes.changed === 0 && deadRes.missing.length === 1);

  // 一键清空回收站
  const t1 = store.create('prompts', { title: 'T1' });
  const t2 = store.create('prompts', { title: 'T2' });
  const liveP = store.create('prompts', { title: 'LIVE-P' });
  store.remove('prompts', t1.id);
  store.remove('prompts', t2.id);
  const pa = store.purgeAllTombstones();
  ok('purgeAllTombstones 返回总数与分集合计数', pa.total >= 2 && typeof pa.byCollection === 'object');
  ok('purgeAllTombstones 计数含 prompts', (pa.byCollection.prompts || 0) >= 2);
  ok('purgeAllTombstones 后墓碑清空', store.listDeleted('prompts').length === 0);
  ok('purgeAllTombstones 保留存活记录', store.list('prompts').some((x) => x.id === liveP.id));
  ok('purgeAllTombstones 可重复调用', store.purgeAllTombstones().total === 0);

  console.log('\n全部通过：' + passed + ' 项');
} catch (e) {
  console.error('\n测试失败：', e.message);
  console.error(e.stack);
  process.exitCode = 1;
} finally {
  fs.rmSync(tmpData, { recursive: true, force: true });
}
