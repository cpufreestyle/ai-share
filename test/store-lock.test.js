'use strict';
// 隔离测试：跨进程写锁（lib/lockfile.js）与多实例并发写入不丢更新
// 运行： node test/store-lock.test.js
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');

// 子进程模式：由父用例并发拉起，模拟「另一个 ai-share 实例」，
// 用于验证两个进程同时做读改写时不会互相覆盖。
// 用法： node test/store-lock.test.js --child create <n> | --child update <id>
if (process.argv[2] === '--child') {
  const mode = process.argv[3];
  const childStore = require('../lib/store');
  if (mode === 'create') {
    const n = Number(process.argv[4]);
    for (let i = 0; i < n; i++) {
      childStore.create('prompts', { title: 'c' + process.pid + '-' + i, content: 'x' });
    }
  } else if (mode === 'update') {
    const id = process.argv[4];
    // 故意循环多次：每次都是一次独立的读改写，放大并发交错的可能
    for (let i = 0; i < 5; i++) {
      const patch = {};
      patch['f' + process.pid] = true;
      patch.round = i;
      childStore.update('prompts', id, patch);
    }
  }
  process.exit(0);
}

const tmpData = fs.mkdtempSync(path.join(os.tmpdir(), 'aishare-lock-'));
process.env.AI_SHARE_DATA_DIR = tmpData; // 必须在 require store 之前设置

const store = require('../lib/store');
const lockfile = require('../lib/lockfile');

let passed = 0;
function ok(name, cond) {
  assert.ok(cond, name);
  console.log('  ok  ' + name);
  passed++;
}

const targetFile = path.join(tmpData, 'prompts.json');
const lockPath = targetFile + '.lock';

function runChild() {
  const args = [__filename, '--child'].concat(Array.prototype.slice.call(arguments));
  return new Promise((resolve, reject) => {
    const p = spawn(process.execPath, args, {
      env: Object.assign({}, process.env, { AI_SHARE_DATA_DIR: tmpData }),
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let err = '';
    p.stderr.on('data', (d) => (err += d));
    p.on('error', reject);
    p.on('exit', (code) => (code === 0 ? resolve() : reject(new Error('child exit ' + code + ': ' + err))));
  });
}

async function main() {
  // ---------- 锁本身的基本语义 ----------
  const rel = lockfile.acquire(targetFile);
  ok('acquire 后哨兵文件存在', fs.existsSync(lockPath));
  ok('持锁期间 isHeld 为真', lockfile.isHeld(targetFile));
  rel();
  ok('release 后哨兵文件消失', !fs.existsSync(lockPath));
  ok('释放后 isHeld 为假', !lockfile.isHeld(targetFile));

  // 同进程重入：不阻塞、不自锁（外层 CRUD 里再调 CRUD 是允许的用法）
  const r1 = lockfile.acquire(targetFile);
  const r2 = lockfile.acquire(targetFile);
  ok('同进程可重入获取同一把锁', lockfile.isHeld(targetFile));
  r2();
  ok('内层释放后仍持有锁', fs.existsSync(lockPath));
  r1();
  ok('外层释放后锁被清除', !fs.existsSync(lockPath));

  // 陈旧锁（持有者已不存在）应被清理，避免崩溃残留导致集合永久不可写
  fs.writeFileSync(lockPath, JSON.stringify({ pid: 999999, ts: Date.now() }));
  const staleRel = lockfile.acquire(targetFile, { staleMs: 1000, timeout: 500 });
  ok('陈旧锁可被清理并重新获取', fs.existsSync(lockPath));
  staleRel();

  // 持有者存活且未过期 → 应等待并在超时后报错，而不是强行写入
  fs.writeFileSync(lockPath, JSON.stringify({ pid: process.pid, ts: Date.now() }));
  let threw = false;
  try {
    lockfile.acquire(targetFile, { staleMs: 60000, timeout: 150, interval: 20 });
  } catch (e) {
    threw = /写锁超时/.test(e.message);
  }
  ok('锁被其它进程持有时超时报错', threw);
  fs.unlinkSync(lockPath);

  // ---------- store 的每次写入都应当释放锁 ----------
  const seed = store.create('prompts', { title: 'seed', content: 'c' });
  ok('create 后无锁残留', fs.readdirSync(tmpData).filter((f) => f.endsWith('.lock')).length === 0);
  ok('create 成功写入', !!seed && !!seed.id);

  store.update('prompts', seed.id, { title: 'seed2' });
  store.remove('prompts', seed.id);
  store.restore('prompts', seed.id);
  ok('update/remove/restore 后无锁残留', fs.readdirSync(tmpData).filter((f) => f.endsWith('.lock')).length === 0);

  // ---------- 多进程并发：交错写不应丢更新 ----------
  const WORKERS = 4;
  const PER = 40;
  const before = store.list('prompts').length;
  await Promise.all(new Array(WORKERS).fill(0).map(() => runChild('create', String(PER))));
  const after = store.list('prompts').length;
  ok(
    WORKERS + ' 个子进程各写 ' + PER + ' 条后总数正确（期望 ' + (before + WORKERS * PER) + '，实际 ' + after + '）',
    after === before + WORKERS * PER
  );

  const target = store.create('prompts', { title: 'shared', content: 'x' });
  await Promise.all(new Array(WORKERS).fill(0).map(() => runChild('update', target.id)));
  const merged = store.get('prompts', target.id);
  const flags = Object.keys(merged).filter((k) => /^f\d+$/.test(k));
  ok('并发 update 未互相覆盖（' + flags.length + '/' + WORKERS + ' 个进程的修改都在）', flags.length === WORKERS);
  ok('并发结束后无锁残留', fs.readdirSync(tmpData).filter((f) => f.endsWith('.lock')).length === 0);

  console.log('\n全部通过：' + passed + ' 项');
}

main().catch((e) => {
  console.error('\n测试失败：', e && e.message);
  if (e && e.stack) console.error(e.stack);
  process.exitCode = 1;
}).finally(() => {
  try {
    fs.rmSync(tmpData, { recursive: true, force: true });
  } catch (e) {
    // 子进程刚退出时目录项可能还没完全回收，稍候再删一次
    try {
      fs.rmSync(tmpData, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
    } catch (e2) {
      /* 临时目录残留不影响结论 */
    }
  }
});
