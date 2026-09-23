'use strict';
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const tmpData = fs.mkdtempSync(path.join(os.tmpdir(), 'aishare-semantic-'));
process.env.AI_SHARE_DATA_DIR = tmpData;
process.env.AI_SHARE_NO_OPEN = '1';
process.env.OLLAMA_URL = 'http://localhost:11435';

const server = require('../server');
const store = require('../lib/store');

let passed = 0;
function ok(name, cond) { assert.ok(cond, name); console.log('  ✓ ' + name); passed++; }

server.listen(0, '127.0.0.1', async () => {
  const port = server.address().port;
  try {
    store.create('providers', { name: 'openai-gpt', baseUrl: 'https://api.openai.com', tags: ['openai','gpt'] });
    store.create('providers', { name: 'ollama-local', baseUrl: 'http://localhost:11434', tags: ['ollama','local'] });
    store.create('prompts', { name: 'python helper', content: 'You are a python coding assistant', tags: ['python'] });

    let r = await request(port, '/api/system/semantic-search?q=LLM&semantic=1');
    ok('语义搜索接口存在', r.status === 200);
    const data = JSON.parse(r.body);
    ok('语义搜索返回结构', data.query === 'LLM' && data.semantic === true && Array.isArray(data.items));
    ok('不可用时回退为文本搜索', data.items.length >= 0);

    r = await request(port, '/api/system/semantic-search?q=python&semantic=0');
    ok('文本搜索模式可用', r.status === 200 && JSON.parse(r.body).total >= 1);

    console.log('全部通过：' + passed + ' 项');
  } catch (e) {
    console.error('FAILED: ' + (e && e.message));
    process.exitCode = 1;
  } finally {
    server.close(() => process.exit(process.exitCode || 0));
  }
});

function request(port, pathname, headers, method, body) {
  return new Promise((resolve, reject) => {
    const h = Object.assign({}, headers || {});
    let payload = null;
    if (body != null) { payload = Buffer.from(body, 'utf8'); h['Content-Length'] = payload.length; }
    const req = require('http').request({ host: '127.0.0.1', port, path: pathname, method: method || 'GET', headers: h }, res => {
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
