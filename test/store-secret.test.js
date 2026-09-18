'use strict';
// 隔离测试：密钥字段的加密落地
//   ① 回归「重复加密」——update / remove / restore / 批量 / 导入都不该给已有密文再套一层
//      （该 bug 曾让某条 apiKey 被套 30 多层、从 30 字节膨胀到 3 MB）
//   ② repairSecrets 能把历史多层密文还原成单层，且 dry run 绝不落盘
//   ③ listPublic（列表接口）不回传明文密钥，list（内部用）仍然回传
// 运行： node test/store-secret.test.js
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const tmpData = fs.mkdtempSync(path.join(os.tmpdir(), 'aishare-secret-'));
process.env.AI_SHARE_DATA_DIR = tmpData; // 必须在 require store 之前设置

const store = require('../lib/store');
const { encrypt, decrypt, isSealed } = require('../lib/crypto');

let passed = 0;
function ok(name, cond) { assert.ok(cond, name); console.log('  ✓ ' + name); passed++; }

const fileFor = (col) => path.join(tmpData, col + '.json');
const readFileArr = (col) => JSON.parse(fs.readFileSync(fileFor(col), 'utf8'));
const onDisk = (col, id) => readFileArr(col).find((x) => x.id === id);

try {
  // ① 基本加解密
  const p = store.create('providers', { name: 'P1', baseUrl: 'https://p1', apiKey: 'sk-abc' });
  ok('create 后读回明文密钥', store.get('providers', p.id).apiKey === 'sk-abc');
  ok('落盘的是密文', isSealed(onDisk('providers', p.id).apiKey));
  const size0 = onDisk('providers', p.id).apiKey.length;

  // ② 不含密钥的更新不得再加密一次（核心回归）
  store.update('providers', p.id, { name: 'P1-renamed' });
  ok('只改名字后密钥仍读得回明文', store.get('providers', p.id).apiKey === 'sk-abc');
  ok('只改名字后密文长度不变（未重复加密）', onDisk('providers', p.id).apiKey.length === size0);

  for (let i = 0; i < 5; i++) store.update('providers', p.id, { notes: 'n' + i });
  ok('连续 5 次更新后密文长度依然不变', onDisk('providers', p.id).apiKey.length === size0);

  // ③ 墓碑往返
  store.remove('providers', p.id);
  store.restore('providers', p.id);
  ok('删除+恢复后密钥仍读得回明文', store.get('providers', p.id).apiKey === 'sk-abc');
  ok('删除+恢复后密文长度不变', onDisk('providers', p.id).apiKey.length === size0);

  // ④ 批量路径（一次加锁重写整个集合）
  store.removeMany('providers', [p.id]);
  store.restoreMany([{ col: 'providers', id: p.id }]);
  ok('批量删除+恢复后密钥仍读得回明文', store.get('providers', p.id).apiKey === 'sk-abc');
  ok('批量删除+恢复后密文长度不变', onDisk('providers', p.id).apiKey.length === size0);

  store.setEnabledMany('providers', [p.id], true);
  ok('批量改启用后密文长度不变', onDisk('providers', p.id).apiKey.length === size0);

  // ⑤ 备份导入（restoreAll 先 seal 再 writeRaw，历史上同样会双加密）
  store.restoreAll({ collections: { providers: [{ id: 'imp1', name: 'IMP', apiKey: 'sk-import' }] } }, 'merge');
  ok('导入的密钥读得回明文', store.get('providers', 'imp1').apiKey === 'sk-import');
  ok('导入的密钥只加密一层', decrypt(onDisk('providers', 'imp1').apiKey) === 'sk-import');
  ok('导入不影响原有记录的密钥', store.get('providers', p.id).apiKey === 'sk-abc');

  // ⑥ listPublic 不回传明文，list 仍然回传（编辑表单走单条接口）
  ok('listPublic 用占位符替换密钥', store.listPublic('providers').find((x) => x.id === p.id).apiKey === '__SET__');
  ok('list 仍返回明文密钥', store.list('providers').find((x) => x.id === p.id).apiKey === 'sk-abc');
  ok('listPublic 不改动落盘内容', isSealed(onDisk('providers', p.id).apiKey));
  ok('无密钥字段的集合原样返回', Array.isArray(store.listPublic('prompts')));

  // ⑦ repairSecrets：人工造多层密文；dry run 只报告，apply 才修复
  const data = readFileArr('providers');
  const target = data.find((x) => x.id === p.id);
  const plain = decrypt(target.apiKey);
  target.apiKey = encrypt(encrypt(encrypt(plain)));
  fs.writeFileSync(fileFor('providers'), JSON.stringify(data, null, 2));
  const broken = readFileArr('providers').find((x) => x.id === p.id).apiKey;
  ok('已人为写入多层密文', isSealed(decrypt(broken)));

  const dry = store.repairSecrets({});
  ok('dry run 报告命中 1 个字段', dry.report.providers && dry.report.providers.fixed === 1);
  ok('dry run 报告套了几层', dry.report.providers.samples[0].layers === 3);
  ok('dry run 不落盘', isSealed(decrypt(readFileArr('providers').find((x) => x.id === p.id).apiKey)));

  const applied = store.repairSecrets({ apply: true });
  ok('apply 报告修复 1 个字段', applied.report.providers.fixed === 1);
  ok('修复后读得回原始明文', store.get('providers', p.id).apiKey === 'sk-abc');
  const after = readFileArr('providers').find((x) => x.id === p.id).apiKey;
  ok('修复后落盘只剩一层', isSealed(after) && !isSealed(decrypt(after)));
  ok('修复后体积明显变小', after.length < broken.length);

  ok('重复修复不再命中（幂等）', !store.repairSecrets({ apply: true }).report.providers);

  console.log('\n全部通过：' + passed + ' 项');
} catch (e) {
  console.error('\n测试失败：', e.message);
  console.error(e.stack);
  process.exitCode = 1;
} finally {
  fs.rmSync(tmpData, { recursive: true, force: true });
}
