'use strict';
// 集成测试：真实启动 server（临时 data 目录、随机端口），验证
//  ① 防本地 CSRF 的行为（跨站 403 / 非 json 写请求 415）
//  ② 静态资源 gzip 协商与 ETag/Vary 头
// 通过 require('../server') 拿到 server 实例，用随机端口监听，测试后关闭。
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');

const tmpData = fs.mkdtempSync(path.join(os.tmpdir(), 'aishare-http-'));
process.env.AI_SHARE_DATA_DIR = tmpData;
process.env.AI_SHARE_NO_OPEN = '1';

const server = require('../server');

let passed = 0;
function ok(name, cond) { assert.ok(cond, name); console.log('  ✓ ' + name); passed++; }

function request(port, pathname, headers, method, body) {
  return new Promise((resolve, reject) => {
    const h = Object.assign({}, headers || {});
    let payload = null;
    if (body != null) { payload = Buffer.from(body, 'utf8'); h['Content-Length'] = payload.length; }
    const req = http.request({ host: '127.0.0.1', port, path: pathname, method: method || 'GET', headers: h }, res => {
      let buf = '';
      res.setEncoding('utf8');
      res.on('data', d => { buf += d; });
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: buf }));
    });
    req.on('error', reject);
    if (payload) req.write(payload);
    req.end();
  });
}

server.listen(0, '127.0.0.1', async () => {
  const port = server.address().port;
  try {
    let r = await request(port, '/api/system/info');
    ok('无 Origin 的 GET 放行 200', r.status === 200);

    r = await request(port, '/api/system/info', { Origin: 'https://evil.example' });
    ok('跨站 Origin GET 拦截 403', r.status === 403);

    r = await request(port, '/api/paths/validate', { 'Content-Type': 'text/plain' }, 'POST', '{"paths":[]}');
    ok('text/plain 写请求拦截 415', r.status === 415);

    r = await request(port, '/api/paths/validate', { 'Content-Type': 'application/json' }, 'POST', '{"paths":[]}');
    ok('application/json 写请求放行 200', r.status === 200);

    r = await request(port, '/app.js', { 'Accept-Encoding': 'gzip' });
    ok('静态资源 gzip：200', r.status === 200);
    ok('静态资源 gzip：Content-Encoding=gzip', r.headers['content-encoding'] === 'gzip');
    ok('静态资源：Vary 含 Accept-Encoding', String(r.headers['vary'] || '').indexOf('Accept-Encoding') !== -1);

    r = await request(port, '/app.js');
    ok('静态资源无 gzip 请求：不带 Content-Encoding', !r.headers['content-encoding']);

    console.log('全部通过：' + passed + ' 项');
  } catch (e) {
    console.error('FAILED: ' + (e && e.message));
    process.exitCode = 1;
  } finally {
    server.close(() => process.exit(process.exitCode || 0));
  }
});
