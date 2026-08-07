'use strict';
// 双向同步测试：
//  1) mergeLWW 纯函数的合并语义（不依赖网络）
//  2) 端到端：两个隔离数据目录经真实同步服务端双向收敛
// 运行： node test/sync.test.js
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const { spawn, execFileSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const PORT = 4741;
const URL = `http://127.0.0.1:${PORT}`;

let passed = 0;
function ok(name, cond) { assert.ok(cond, name); console.log('  ✓ ' + name); passed++; }

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'aishare-sync-'));
const dirA = path.join(TMP, 'A');
const dirB = path.join(TMP, 'B');
const dirS = path.join(TMP, 'S');

/* ---------- 1. mergeLWW 纯函数 ---------- */
function testMerge() {
  // mergeLWW 不触碰 store，可直接引入
  const { mergeLWW } = require('../lib/sync');

  const older = { id: 'x', name: 'old', updatedAt: '2026-01-01T00:00:00.000Z' };
  const newer = { id: 'x', name: 'new', updatedAt: '2026-06-01T00:00:00.000Z' };

  let r = mergeLWW([older], [newer]);
  ok('LWW：远端较新时以远端为准', r.merged[0].name === 'new' && r.localChanges.length === 1);

  r = mergeLWW([newer], [older]);
  ok('LWW：本地较新时以本地为准', r.merged[0].name === 'new' && r.remoteChanges.length === 1);

  r = mergeLWW([newer], [newer]);
  ok('LWW：时间戳相同不产生变更', r.localChanges.length === 0 && r.remoteChanges.length === 0);

  r = mergeLWW([{ id: 'a', updatedAt: '2026-01-01T00:00:00.000Z' }], []);
  ok('LWW：仅本地存在时标记为待推送', r.remoteChanges.length === 1 && r.merged.length === 1);

  r = mergeLWW([], [{ id: 'b', updatedAt: '2026-01-01T00:00:00.000Z' }]);
  ok('LWW：仅远端存在时标记为待拉取', r.localChanges.length === 1 && r.merged.length === 1);

  // 墓碑比存活记录新 -> 删除应当胜出
  r = mergeLWW(
    [{ id: 'c', name: '存活', updatedAt: '2026-01-01T00:00:00.000Z' }],
    [{ id: 'c', _deleted: true, updatedAt: '2026-06-01T00:00:00.000Z' }],
  );
  ok('LWW：较新的墓碑覆盖存活记录', r.merged[0]._deleted === true);
}

/* ---------- 2. 端到端 ---------- */
// 每台「机器」用独立子进程，保证 store 的 DATA_DIR 相互隔离
function onMachine(dir, code) {
  const script = `
    process.env.AI_SHARE_DATA_DIR = ${JSON.stringify(dir)};
    const store = require(${JSON.stringify(path.join(ROOT, 'lib', 'store.js'))});
    const sync  = require(${JSON.stringify(path.join(ROOT, 'lib', 'sync.js'))});
    (async () => { ${code} })().catch(e => { console.error('ERR ' + e.message); process.exit(1); });
  `;
  const out = execFileSync(process.execPath, ['-e', script], { encoding: 'utf8', timeout: 60000 });
  return JSON.parse(out.trim().split('\n').pop());
}

const CFG = `sync.saveConfig({ url: ${JSON.stringify(URL)}, secret: 'shared-secret', enabled: false });`;

function waitReady(retries) {
  return new Promise((resolve, reject) => {
    const tick = n => {
      if (n <= 0) return reject(new Error('同步服务端启动超时'));
      const req = http.get({ host: '127.0.0.1', port: PORT, path: '/health', timeout: 1000 }, res => { res.resume(); resolve(); });
      req.on('error', () => setTimeout(() => tick(n - 1), 300));
      req.on('timeout', () => { req.destroy(); setTimeout(() => tick(n - 1), 300); });
    };
    tick(retries);
  });
}

async function testE2E(srv) {
  await waitReady(20);

  const rA = onMachine(dirA, `${CFG}
    store.create('providers', { id: 'p1', name: 'A的端点', apiKey: 'SECRET-A' });
    const r = await sync.syncOnce();
    console.log(JSON.stringify({ ok: r.ok, err: r.error }));
  `);
  ok('A 首次同步成功', rA.ok === true);

  // 服务端只应看到密文
  const sData = JSON.parse(fs.readFileSync(path.join(dirS, 'providers.json'), 'utf8'));
  ok('服务端存储的密钥为密文', String(sData.find(x => x.id === 'p1').apiKey).startsWith('senc:'));
  ok('服务端不含明文密钥', !JSON.stringify(sData).includes('SECRET-A'));

  const rB = onMachine(dirB, `${CFG}
    await sync.syncOnce();
    const g = store.get('providers', 'p1');
    console.log(JSON.stringify({ name: g && g.name, key: g && g.apiKey }));
  `);
  ok('B 拉取到 A 的记录', rB.name === 'A的端点');
  ok('B 能正确解密密钥', rB.key === 'SECRET-A');

  onMachine(dirB, `${CFG}
    store.update('providers', 'p1', { name: 'B改的名字' });
    const r = await sync.syncOnce();
    console.log(JSON.stringify({ ok: r.ok }));
  `);
  const rA2 = onMachine(dirA, `${CFG}
    await sync.syncOnce();
    const g = store.get('providers', 'p1');
    console.log(JSON.stringify({ name: g && g.name }));
  `);
  ok('A 收敛到 B 的最新修改', rA2.name === 'B改的名字');

  onMachine(dirA, `${CFG}
    store.remove('providers', 'p1');
    const r = await sync.syncOnce();
    console.log(JSON.stringify({ ok: r.ok }));
  `);
  const rB3 = onMachine(dirB, `${CFG}
    await sync.syncOnce();
    const g = store.get('providers', 'p1');
    const raw = store.listRaw('providers').find(x => x.id === 'p1');
    console.log(JSON.stringify({ got: g, tombstone: !!(raw && raw._deleted) }));
  `);
  ok('删除已跨端传播', rB3.got === null);
  ok('对端保留墓碑记录', rB3.tombstone === true);

  // 同步密钥不一致：应丢弃该字段而非把密文当明文存下
  const rC = onMachine(path.join(TMP, 'C'), `sync.saveConfig({ url: ${JSON.stringify(URL)}, secret: 'WRONG', enabled: false });
    store.create('providers', { id: 'p9', name: 'C', apiKey: 'x' });
    await sync.syncOnce();
    const raw = store.listRaw('providers');
    console.log(JSON.stringify({ anyCipher: raw.some(x => String(x.apiKey || '').startsWith('senc:')) }));
  `);
  ok('同步密钥不匹配时不写入密文', rC.anyCipher === false);
}

(async () => {
  let srv;
  try {
    testMerge();
    srv = spawn(process.execPath, [path.join(ROOT, 'sync-server.js')], {
      env: Object.assign({}, process.env, { SYNC_DATA_DIR: dirS, SYNC_PORT: String(PORT) }),
      stdio: 'ignore',
    });
    await testE2E(srv);
    console.log('\n全部通过：' + passed + ' 项');
  } catch (e) {
    console.error('\n测试失败：', e.message);
    console.error(e.stack);
    process.exitCode = 1;
  } finally {
    if (srv) { try { srv.kill(); } catch (_) { /* ignore */ } }
    fs.rmSync(TMP, { recursive: true, force: true });
  }
})();
