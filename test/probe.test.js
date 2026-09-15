'use strict';
// 离线环境下验证连通性探测的“失败路径”是确定性、可断言的（不依赖外网）。
const assert = require('assert');
const { probeProvider, checkMcp } = require('../lib/probe');

(async () => {
  // 不可达地址：连接被拒，应确定性返回 ok:false（不抛、不挂）
  const r1 = await probeProvider({ baseUrl: 'http://127.0.0.1:1/nope', apiKey: 'x' });
  assert.strictEqual(r1.ok, false, '不可达 provider 应 ok:false');
  assert.ok(r1.error, '应带错误信息');

  const r2 = await probeProvider({});
  assert.strictEqual(r2.ok, false, '无 baseUrl 应 ok:false');

  const r3 = await checkMcp({ url: 'http://127.0.0.1:1/nope' });
  assert.strictEqual(r3.ok, false, '不可达 url 应 ok:false');

  // 相对命令：依赖 PATH，按“可能存在”处理
  const r4 = await checkMcp({ command: 'definitely-not-a-real-command-xyz' });
  assert.strictEqual(r4.ok, true, '相对命令按可能处理');
  assert.strictEqual(r4.kind, 'stdio');

  // 绝对路径不存在的命令：明确 ok:false
  const r5 = await checkMcp({ command: '/no/such/bin/ai-share-fake' });
  assert.strictEqual(r5.ok, false, '不存在的绝对路径应 ok:false');

  const r6 = await checkMcp({});
  assert.strictEqual(r6.ok, false, '无配置应 ok:false');

  console.log('全部通过：probe 6 项');
})().catch((e) => { console.error('FAILED', e); process.exit(1); });
