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
const store = require('../lib/store');

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
    store.create('providers', { name: 'stat-probe', baseUrl: 'https://x.test' });
    r = await request(port, '/api/system/stats');
    ok('概览统计接口 200 且 counts.providers>=1（验证取的是 exportAll.collections）', r.status === 200 && (() => { try { const s = JSON.parse(r.body); return s.counts && s.counts.providers >= 1 && typeof s.counts.total === 'number' && typeof s.storageBytes === 'number' && !!s.snapshots; } catch (_) { return false; } })());

    r = await request(port, '/api/health');
    ok('健康检查接口 200 且返回 ok/version/uptime', r.status === 200 && (() => { try { const h = JSON.parse(r.body); return h.ok === true && typeof h.version === 'string' && typeof h.uptime === 'number'; } catch (_) { return false; } })());

    r = await request(port, '/api/providers/nope-missing');
    ok('GET 单条不存在返回 404（曾返回 200 空对象）', r.status === 404);
    const tp = store.create('clients', { title: 'tomb' });
    store.remove('clients', tp.id);
    r = await request(port, '/api/clients/' + tp.id + '/tombstone', {}, 'DELETE');
    ok('DELETE 墓碑返回 200 且 id 匹配', r.status === 200 && JSON.parse(r.body).id === tp.id);
    r = await request(port, '/api/clients/' + tp.id + '/tombstone', {}, 'DELETE');
    ok('重复删除墓碑返回 404', r.status === 404);
    r = await request(port, '/api/nope/' + tp.id + '/tombstone', {}, 'DELETE');
    ok('未知集合的墓碑路由返回 400', r.status === 400);

    r = await request(port, '/api/system/info', { Origin: 'https://evil.example' });
    ok('跨站 Origin GET 拦截 403', r.status === 403);

    r = await request(port, '/api/paths/validate', { 'Content-Type': 'text/plain' }, 'POST', '{"paths":[]}');
    ok('text/plain 写请求拦截 415', r.status === 415);

    r = await request(port, '/api/paths/validate', { 'Content-Type': 'application/json' }, 'POST', '{"paths":[]}');
    ok('application/json 写请求放行 200', r.status === 200);

    r = await request(port, '/api/paths/validate', { 'Content-Type': 'application/json' }, 'POST', '{bad');
    ok('非法 JSON 请求体返回 400（保留客户端提示）', r.status === 400);

    r = await request(port, '/api/paths/validate', { 'Content-Type': 'application/json' }, 'POST', '{"paths":[123,"ok"]}');
    ok('非字符串路径被忽略（不再 500）', r.status === 200 && JSON.parse(r.body).results.length === 1);

    // 故意用非法类型字段（数字 baseUrl）让 handler 内部抛异常，验证服务器错误的脱敏行为
    const badProv = store.create('providers', { name: 'bad-type', baseUrl: 123 });
    r = await request(port, '/api/providers/' + badProv.id + '/test', { 'Content-Type': 'application/json' }, 'POST', '{}');
    ok('服务器内部错误返回 500 且已脱敏', r.status === 500 && r.body.indexOf('内部错误') !== -1 && r.body.indexOf('ERR_') === -1);


    // 批量操作路由：一次请求完成 N 条
    const ba = store.create('clients', { title: 'BA' });
    const bb = store.create('clients', { title: 'BB' });
    const H = { 'Content-Type': 'application/json' };
    r = await request(port, '/api/clients/bulk-delete', H, 'POST', JSON.stringify({ ids: [ba.id, bb.id] }));
    ok('bulk-delete 返回 200', r.status === 200);
    ok('bulk-delete 删除了 2 条', JSON.parse(r.body).removed === 2);
    ok('bulk-delete 后进入回收站', store.listDeleted('clients').filter(x => x.id === ba.id || x.id === bb.id).length === 2);

    r = await request(port, '/api/trash/bulk-restore', H, 'POST', JSON.stringify({ items: [{ col: 'clients', id: ba.id }] }));
    ok('bulk-restore 返回 200', r.status === 200);
    ok('bulk-restore 恢复了 1 条', JSON.parse(r.body).restored === 1);

    r = await request(port, '/api/trash/bulk-purge', H, 'POST', JSON.stringify({ items: [{ col: 'clients', id: bb.id }] }));
    ok('bulk-purge 返回 200', r.status === 200);
    ok('bulk-purge 彻底删除了 1 条', JSON.parse(r.body).purged === 1);
    ok('bulk-purge 后墓碑消失', !store.listDeleted('clients').some(x => x.id === bb.id));

    r = await request(port, '/api/clients/bulk-delete', H, 'POST', '{"ids":"x"}');
    ok('bulk-delete 非数组 ids 返回 400', r.status === 400);
    r = await request(port, '/api/nope/bulk-delete', H, 'POST', '{"ids":[]}');
    ok('bulk-delete 未知集合返回 400', r.status === 400);
    r = await request(port, '/api/trash/bulk-restore', H, 'POST', '{"items":"x"}');
    ok('bulk-restore 非数组 items 返回 400', r.status === 400);
    r = await request(port, '/api/trash/bulk-purge', H, 'POST', '{"items":"x"}');
    ok('bulk-purge 非数组 items 返回 400', r.status === 400);
    r = await request(port, '/api/clients/bulk-delete', H, 'POST', JSON.stringify({ ids: new Array(501).fill('x') }));
    ok('bulk-delete 超过 500 条返回 400', r.status === 400);

    // 列表接口 ETag / 304：重复拉取不再传输整份 JSON
    store.create('providers', { name: 'etag-probe', baseUrl: 'https://e.test' });
    r = await request(port, '/api/providers');
    ok('列表返回 ETag', r.status === 200 && !!r.headers.etag);
    ok('列表允许缓存但需再校验', String(r.headers['cache-control'] || '').indexOf('no-cache') !== -1);
    const et1 = r.headers.etag;
    r = await request(port, '/api/providers', { 'If-None-Match': et1 });
    ok('带 If-None-Match 命中 304', r.status === 304);
    ok('304 无响应体', r.body === '');
    store.create('providers', { name: 'etag-probe-2', baseUrl: 'https://e2.test' });
    r = await request(port, '/api/providers', { 'If-None-Match': et1 });
    ok('数据变化后不再 304（避免客户端吃旧数据）', r.status === 200);
    ok('新 ETag 与旧的不同', r.headers.etag !== et1);

    // 批量启用/停用
    const ea = store.create('mcpservers', { name: 'EA', type: 'stdio', command: 'npx', enabled: false });
    const eb = store.create('mcpservers', { name: 'EB', type: 'stdio', command: 'npx', enabled: false });
    r = await request(port, '/api/mcpservers/bulk-enabled', H, 'POST', JSON.stringify({ ids: [ea.id, eb.id], enabled: true }));
    ok('bulk-enabled 返回 200', r.status === 200);
    ok('bulk-enabled 启用 2 条', JSON.parse(r.body).changed === 2);
    ok('批量启用后确实为启用态', store.list('mcpservers').filter((x) => x.id === ea.id || x.id === eb.id).every((x) => x.enabled === true));
    r = await request(port, '/api/mcpservers/bulk-enabled', H, 'POST', JSON.stringify({ ids: [ea.id, eb.id], enabled: true }));
    ok('重复设置同值 changed 为 0', JSON.parse(r.body).changed === 0);
    r = await request(port, '/api/mcpservers/bulk-enabled', H, 'POST', JSON.stringify({ ids: [ea.id], enabled: 'yes' }));
    ok('enabled 非布尔返回 400', r.status === 400);
    r = await request(port, '/api/mcpservers/bulk-enabled', H, 'POST', '{"ids":"x","enabled":true}');
    ok('bulk-enabled 非数组 ids 返回 400', r.status === 400);
    r = await request(port, '/api/nope/bulk-enabled', H, 'POST', '{"ids":[],"enabled":true}');
    ok('bulk-enabled 未知集合返回 400', r.status === 400);

    // 回收站一键清空
    const ta = store.create('clients', { title: 'TA' });
    const tb = store.create('clients', { title: 'TB' });
    const liveC = store.create('clients', { title: 'LIVE-C' });
    store.remove('clients', ta.id);
    store.remove('clients', tb.id);
    r = await request(port, '/api/trash/purge-all', H, 'POST', '{}');
    ok('purge-all 返回 200', r.status === 200);
    ok('purge-all 清掉至少 2 条墓碑', JSON.parse(r.body).total >= 2);
    ok('purge-all 后该集合无墓碑', store.listDeleted('clients').length === 0);
    ok('purge-all 保留存活记录', store.list('clients').some((x) => x.id === liveC.id));

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
