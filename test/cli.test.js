'use strict';
// 隔离测试：命令行入口 bin/ai-share.js
//   ① help / 未知命令的退出码与输出
//   ② 连真实服务（临时数据目录 + 随机端口）后 list / status / plan 能跑通
// 注意：必须用异步 spawn 而非 spawnSync——被测服务就在本进程里，
// spawnSync 会冻结事件循环，导致子进程的 HTTP 请求永远得不到响应（已实测死锁）。
// 运行： node test/cli.test.js
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');

const tmpData = fs.mkdtempSync(path.join(os.tmpdir(), 'aishare-cli-'));
process.env.AI_SHARE_DATA_DIR = tmpData; // 必须在 require server 之前设置
process.env.AI_SHARE_NO_OPEN = '1';

const ROOT = path.join(__dirname, '..');
const CLI = path.join(ROOT, 'bin', 'ai-share.js');
const server = require('../server');

let passed = 0;
function ok(name, cond) { assert.ok(cond, name); console.log('  ✓ ' + name); passed++; }

function run(args, url) {
  return new Promise((resolve) => {
    const p = spawn(process.execPath, [CLI].concat(args), {
      env: Object.assign({}, process.env, { AI_SHARE_URL: url, AI_SHARE_NO_AUTOSTART: '1' }),
    });
    let out = '', err = '';
    p.stdout.on('data', (d) => { out += d; });
    p.stderr.on('data', (d) => { err += d; });
    const timer = setTimeout(() => p.kill('SIGKILL'), 20000);
    p.on('close', (code) => { clearTimeout(timer); resolve({ status: code, stdout: out, stderr: err }); });
  });
}

server.listen(0, '127.0.0.1', async () => {
  const port = server.address().port;
  const url = 'http://127.0.0.1:' + port;
  try {
    let r = await run(['help'], url);
    ok('help 退出码 0', r.status === 0);
    ok('help 输出全部命令', r.stdout.indexOf('scan-secrets') !== -1 && r.stdout.indexOf('repair-secrets') !== -1);

    r = await run(['no-such-command'], url);
    ok('未知命令退出码 1', r.status === 1);
    ok('未知命令给出提示', r.stderr.indexOf('未知命令') !== -1);

    r = await run(['list', 'not-a-col'], url);
    ok('非法集合退出码 1', r.status === 1);

    r = await run(['list', 'providers'], url);
    ok('list 输出表头与条数', r.status === 0 && r.stdout.indexOf('id') !== -1 && r.stdout.indexOf('共') !== -1);

    r = await run(['-j', 'list', 'providers'], url);
    ok('-j 输出 JSON 数组', r.status === 0 && r.stdout.trim().startsWith('['));

    r = await run(['plan', 'ghost-profile'], url);
    ok('plan 不存在的方案退出码 1', r.status === 1);

    r = await run(['status'], url);
    ok('status 输出各集合概览', r.status === 0 && r.stdout.indexOf('providers') !== -1 && r.stdout.indexOf('数据目录') !== -1);

    // 服务离线时的报错路径：指向一个不可能有服务的端口（且禁用自动拉起）
    r = await run(['status'], 'http://127.0.0.1:1');
    ok('服务不可达时给出友好错误并退出码 1', r.status === 1 && r.stderr.indexOf('错误') !== -1);

    console.log('\n全部通过：' + passed + ' 项');
  } catch (e) {
    console.error('FAILED: ' + e.message);
    process.exitCode = 1;
  } finally {
    server.close(() => { fs.rmSync(tmpData, { recursive: true, force: true }); process.exit(process.exitCode || 0); });
  }
});
