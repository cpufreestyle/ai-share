'use strict';
// 隔离测试：自建同步服务端（sync-server）的存储安全
//  - 原子写：覆盖前留 .bak、不残留 .tmp
//  - 损坏不清空：主文件损坏时优先从 .bak 回滚；无备份可回滚则返回 500，绝不静默覆盖
//  - 默认仅监听回环
// 所有数据指向临时目录，不触碰真实 sync-data/。
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');

const tmpData = fs.mkdtempSync(path.join(os.tmpdir(), 'aishare-syncsrv-'));
process.env.SYNC_DATA_DIR = tmpData;
delete process.env.SYNC_HOST; // 确保走默认

const mod = require('../sync-server');
const server = mod.server;

let passed = 0;
function ok(name, cond) { assert.ok(cond, name); console.log('  ✓ ' + name); passed++; }

function post(port, col, obj) {
  return new Promise((resolve, reject) => {
    const b = Buffer.from(JSON.stringify(obj));
    const req = http.request({ host: '127.0.0.1', port, path: '/sync/' + col, method: 'POST', headers: { 'Content-Type': 'application/json', 'Content-Length': b.length } }, res => {
      let s = ''; res.setEncoding('utf8'); res.on('data', d => { s += d; }); res.on('end', () => resolve({ status: res.statusCode, body: s }));
    });
    req.on('error', reject); req.write(b); req.end();
  });
}

ok('默认只监听回环（未设 SYNC_HOST）', mod.HOST === '127.0.0.1');

server.listen(0, '127.0.0.1', async () => {
  const port = server.address().port;
  const f = path.join(tmpData, 'prompts.json');
  try {
    let r = await post(port, 'prompts', { deviceId: 't1', items: [{ id: 'a', title: 'A', updatedAt: '2026-01-01T00:00:00Z' }] });
    ok('首次上报 200', r.status === 200);
    ok('已落盘', fs.existsSync(f));
    ok('原子写：无 .tmp 残留', !fs.readdirSync(tmpData).some(x => x.endsWith('.tmp')));

    r = await post(port, 'prompts', { deviceId: 't1', items: [{ id: 'b', title: 'B', updatedAt: '2026-02-01T00:00:00Z' }] });
    ok('二次上报 200（合并仍有 a）', r.status === 200 && JSON.parse(fs.readFileSync(f, 'utf8')).some(x => x.id === 'a'));
    ok('覆盖前生成 .bak', fs.existsSync(f + '.bak'));

    // 破坏主文件（有 .bak）→ 应自动从 .bak 回滚，不丢旧记录，并隔离损坏文件
    fs.writeFileSync(f, '{ broken');
    r = await post(port, 'prompts', { deviceId: 't1', items: [{ id: 'c', title: 'C', updatedAt: '2026-03-01T00:00:00Z' }] });
    ok('损坏但可从 .bak 回滚：仍 200', r.status === 200);
    ok('损坏文件被隔离留证', fs.readdirSync(tmpData).some(x => x.startsWith('prompts.json.corrupt-')));
    const healed = JSON.parse(fs.readFileSync(f, 'utf8'));
    ok('回滚保留了旧记录 a', healed.some(x => x.id === 'a'));
    ok('合并了本次上报 c', healed.some(x => x.id === 'c'));

    // 无 .bak 且损坏 → 必须 500，绝不静默清空
    try { fs.unlinkSync(f + '.bak'); } catch (e) { /* noop */ }
    fs.writeFileSync(f, '{ broken again');
    r = await post(port, 'prompts', { deviceId: 't1', items: [{ id: 'd', title: 'D', updatedAt: '2026-04-01T00:00:00Z' }] });
    ok('损坏且无备份：返回 500（不静默覆盖）', r.status === 500);

    console.log('全部通过：' + passed + ' 项');
  } catch (e) {
    console.error('FAILED: ' + (e && e.message));
    process.exitCode = 1;
  } finally {
    server.close(() => process.exit(process.exitCode || 0));
  }
});
