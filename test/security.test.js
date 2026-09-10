'use strict';
// 隔离测试：防本地 CSRF 的纯判定逻辑（不启动服务）
const assert = require('assert');
const { isCrossSite, hasJsonContentType } = require('../lib/security');

let passed = 0;
function ok(name, cond) { assert.ok(cond, name); console.log('  ✓ ' + name); passed++; }

ok('无来源头（Node/MCP 客户端）不判跨站', isCrossSite({ host: '127.0.0.1:4737' }) === false);
ok('同源 127.0.0.1 放行', isCrossSite({ host: '127.0.0.1:4737', origin: 'http://127.0.0.1:4737' }) === false);
ok('同源 localhost 放行', isCrossSite({ host: 'localhost:4737', origin: 'http://localhost:4737' }) === false);
ok('恶意站点 Origin 拦截', isCrossSite({ host: '127.0.0.1:4737', origin: 'https://evil.example' }) === true);
ok('端口不同视为跨站', isCrossSite({ host: '127.0.0.1:4737', origin: 'http://127.0.0.1:9999' }) === true);
ok('Origin=null 拦截', isCrossSite({ host: '127.0.0.1:4737', origin: 'null' }) === true);
ok('Sec-Fetch-Site=cross-site 拦截', isCrossSite({ host: '127.0.0.1:4737', 'sec-fetch-site': 'cross-site' }) === true);

ok('无 Content-Type（bodyless POST）放行', hasJsonContentType({}) === true);
ok('application/json 放行', hasJsonContentType({ 'content-type': 'application/json; charset=utf-8' }) === true);
ok('text/plain 拦截', hasJsonContentType({ 'content-type': 'text/plain;charset=UTF-8' }) === false);
ok('表单类型拦截', hasJsonContentType({ 'content-type': 'application/x-www-form-urlencoded' }) === false);
ok('multipart 拦截', hasJsonContentType({ 'content-type': 'multipart/form-data; boundary=x' }) === false);

console.log('全部通过：' + passed + ' 项');
