'use strict';
// 隔离测试：本地自动备份（快照 / 滚动保留 / 回滚 / 定时器开关）
// 运行： node test/autobackup.test.js
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const tmpData = fs.mkdtempSync(path.join(os.tmpdir(), 'aishare-bk-'));
process.env.AI_SHARE_DATA_DIR = tmpData; // 必须在 require 之前设置

const store = require('../lib/store');
const autobackup = require('../lib/autobackup');

let passed = 0;
function ok(name, cond) {
  assert.ok(cond, name);
  console.log('  ok  ' + name);
  passed++;
}

try {
  // ---------- 配置 ----------
  let cfg = autobackup.getConfig();
  ok('默认未启用自动备份', cfg.enabled === false);
  ok('默认保留 10 份', cfg.keep === 10);
  ok('默认间隔 12 小时', cfg.intervalHours === 12);

  autobackup.saveConfig({ enabled: true, keep: 5, intervalHours: 24 });
  cfg = autobackup.getConfig();
  ok('配置已持久化', cfg.enabled === true && cfg.keep === 5 && cfg.intervalHours === 24);

  autobackup.saveConfig({ keep: 0, intervalHours: 0 });
  cfg = autobackup.getConfig();
  ok('keep=0 被夹到 1（避免全空）', cfg.keep === 1);
  ok('intervalHours=0 被夹到 1（避免疯狂写盘）', cfg.intervalHours === 1);

  autobackup.saveConfig({ keep: 999, intervalHours: 99999 });
  cfg = autobackup.getConfig();
  ok('keep 上限 50', cfg.keep === 50);
  ok('intervalHours 上限 720', cfg.intervalHours === 720);

  autobackup.saveConfig({ enabled: true, keep: 5, intervalHours: 24 });

  // ---------- 创建快照 ----------
  store.create('prompts', { title: 'alpha' });
  const r1 = autobackup.createSnapshot('test');
  ok('createSnapshot 成功', !!r1.ok && !!r1.snapshot && !!r1.snapshot.name);
  ok('快照文件已落盘', fs.existsSync(path.join(autobackup.dirOf(cfg), r1.snapshot.name)));
  ok('快照名带时间戳格式', /^ai-share-\d{8}-\d{6}(-\d+)?\.json$/.test(r1.snapshot.name));
  ok('快照记录了条目数', r1.snapshot.count >= 1);

  const raw = JSON.parse(fs.readFileSync(path.join(autobackup.dirOf(cfg), r1.snapshot.name), 'utf8'));
  ok('快照含 collections 数据', !!raw.collections && Array.isArray(raw.collections.prompts));
  ok('快照标明了来源', raw.reason === 'test');

  // ---------- 列表 ----------
  let list = autobackup.listSnapshots();
  ok('listSnapshots 返回刚创建的快照', list.length >= 1 && list.some((s) => s.name === r1.snapshot.name));
  ok('列表项含大小与时间', typeof list[0].size === 'number' && !!list[0].takenAt);
  ok('列表按时间倒序', new Date(list[0].takenAt) >= new Date(list[list.length - 1].takenAt));

  // ---------- 滚动保留 ----------
  for (let i = 0; i < 8; i++) autobackup.createSnapshot('test');
  list = autobackup.listSnapshots();
  ok('滚动保留：数量不超过 keep=5', list.length === 5);
  ok('滚动保留：保留的是最新的那些', list[0].name !== r1.snapshot.name || list.length < 5);

  const rot = autobackup.rotate({ keep: 2 });
  ok('rotate 可单独调用并删除多余快照', autobackup.listSnapshots().length === 2 && rot.removed.length >= 1);

  // ---------- 回滚 ----------
  const target = store.create('prompts', { title: 'before' });
  const snap = autobackup.createSnapshot('test').snapshot;
  store.update('prompts', target.id, { title: 'after' });
  const extra = store.create('prompts', { title: 'extra' });
  ok('回滚前标题已被改动', store.get('prompts', target.id).title === 'after');

  const rr = autobackup.restoreSnapshot(snap.name, 'merge');
  ok('回滚未报错', !rr.error && rr.ok === true);
  ok('回滚恢复了旧数据', store.get('prompts', target.id).title === 'before');
  ok('merge 模式不删除回滚后新增的记录', !!store.get('prompts', extra.id));
  ok('回滚前自动生成了安全快照', !!rr.safety && /^ai-share-/.test(rr.safety.name));

  // ---------- 非法输入 ----------
  ok('回滚：拒绝路径穿越的快照名', !!autobackup.restoreSnapshot('../evil').error);
  ok('回滚：不存在的快照返回错误', !!autobackup.restoreSnapshot('ai-share-20990101-000000.json').error);
  ok('删除：拒绝路径穿越的快照名', !!autobackup.deleteSnapshot('../evil.json').error);

  const del = autobackup.deleteSnapshot(autobackup.listSnapshots()[0].name);
  ok('删除快照成功', !!del.ok && !!del.removed);
  ok('删除后列表变短', autobackup.listSnapshots().length >= 0);

  // 损坏文件不影响列表（会被标记为 corrupt 而非抛错）
  const bad = path.join(autobackup.dirOf(cfg), 'ai-share-20200101-000000.json');
  fs.writeFileSync(bad, '{not json');
  const withBad = autobackup.listSnapshots();
  ok('损坏快照被标记为 corrupt 而不抛错', withBad.some((s) => s.corrupt));
  fs.unlinkSync(bad);

  // ---------- 定时器 ----------
  autobackup.saveConfig({ enabled: true, intervalHours: 12 });
  let st = autobackup.startAuto();
  ok('startAuto 后处于运行中', st.running === true && autobackup.autoStatus().running === true);
  ok('autoStatus 返回间隔与目录', st.intervalHours === 12 && !!autobackup.autoStatus().dir);
  autobackup.stopAuto();
  ok('stopAuto 后不再运行', autobackup.autoStatus().running === false);

  autobackup.saveConfig({ enabled: false });
  st = autobackup.startAuto();
  ok('未启用时 startAuto 不启动定时器', st.running === false);

  console.log('\n全部通过：' + passed + ' 项');
} catch (e) {
  console.error('\n测试失败：', e && e.message);
  if (e && e.stack) console.error(e.stack);
  process.exitCode = 1;
} finally {
  autobackup.stopAuto();
  try {
    fs.rmSync(tmpData, { recursive: true, force: true, maxRetries: 3, retryDelay: 50 });
  } catch (e) {
    /* 忽略临时目录清理失败 */
  }
}
