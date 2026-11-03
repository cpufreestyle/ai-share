'use strict';
// 离线环境下验证连通性探测的成功与失败路径
const assert = require('assert');
const http = require('http');
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

  // 本地轻量 Mock 服务：验证成功响应下的状态码、模型计数与 serverInfo 提取
  const server = http.createServer((req, res) => {
    if (req.url === '/v1/models') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ data: [{ id: 'model-a' }, { id: 'model-b' }] }));
    }
    if (req.url === '/mcp/http' && req.method === 'POST') {
      if (req.headers['x-api-key'] !== 'secret-mcp-key') {
        res.writeHead(401, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({ error: 'unauthorized' }));
      }
      res.writeHead(200, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        result: {
          serverInfo: { name: 'test-mock-mcp', version: '1.2.3' },
          capabilities: { tools: {} },
        },
      }));
    }
    if (req.url === '/mcp/sse-fallback') {
      if (req.method === 'GET') {
        res.writeHead(405, { 'Content-Type': 'text/plain' });
        return res.end('Method Not Allowed');
      }
      if (req.method === 'POST') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({ jsonrpc: '2.0', id: 1, result: { serverInfo: { name: 'fallback-mcp', version: '0.9' } } }));
      }
    }
    res.writeHead(404);
    res.end();
  });

  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port;
  const baseUrl = `http://127.0.0.1:${port}/v1`;

  try {
    // Provider 探测：成功提取 modelCount
    const pr = await probeProvider({ baseUrl, apiKey: 'test-token' });
    assert.strictEqual(pr.ok, true, 'provider 连通成功');
    assert.strictEqual(pr.status, 200);
    assert.strictEqual(pr.modelCount, 2, '应解析出 2 个模型');

    // MCP 探测：支持 HTTP POST 初始化握手、自定义 headers 传递与 serverInfo 提取
    const mr = await checkMcp({
      type: 'http',
      url: `http://127.0.0.1:${port}/mcp/http`,
      headers: { 'x-api-key': 'secret-mcp-key' },
    });
    assert.strictEqual(mr.ok, true, 'mcp 连通成功');
    assert.strictEqual(mr.status, 200);
    assert.ok(mr.serverInfo, '应提取 serverInfo');
    assert.strictEqual(mr.serverInfo.name, 'test-mock-mcp');
    assert.strictEqual(mr.serverInfo.version, '1.2.3');

    // MCP 回退：SSE 遇 405 自动回退 POST 握手成功
    const fr = await checkMcp({
      type: 'sse',
      url: `http://127.0.0.1:${port}/mcp/sse-fallback`,
    });
    assert.strictEqual(fr.ok, true, 'mcp 回退握手应成功');
    assert.strictEqual(fr.status, 200);
    assert.strictEqual(fr.serverInfo.name, 'fallback-mcp');
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }

  console.log('全部通过：probe 9 项');
})().catch((e) => { console.error('FAILED', e); process.exit(1); });
