'use strict';
// 自建同步服务端（零依赖）：作为多台机器之间的中转与权威存储。
// 协议：POST /sync/:collection  { deviceId, items:[...] } -> { items:[...] }
//   服务端把客户端上报的全量与自身存量按 updatedAt 做 LWW 合并，
//   持久化合并结果，并把合并后的全量返回给客户端，从而实现双向收敛。
// 数据只做透传存储：密钥字段在客户端已加密，服务端看到的是密文。
const http = require('http');
const fs = require('fs');
const path = require('path');
const { mergeLWW, SYNC_COLLECTIONS } = require('./lib/sync');

const PORT = process.env.SYNC_PORT || 4738;
const TOKEN = process.env.SYNC_TOKEN || '';
const APP_ROOT = process.pkg
  ? path.dirname(process.execPath)
  : __dirname;
const DATA_DIR = process.env.SYNC_DATA_DIR
  ? path.resolve(process.env.SYNC_DATA_DIR)
  : path.join(APP_ROOT, 'sync-data');

function ensureDir() { if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true }); }
function fileFor(col) { return path.join(DATA_DIR, col + '.json'); }
function readCol(col) {
  ensureDir();
  const f = fileFor(col);
  if (!fs.existsSync(f)) return [];
  try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch (_) { return []; }
}
function writeCol(col, items) {
  ensureDir();
  fs.writeFileSync(fileFor(col), JSON.stringify(items, null, 2));
}

function sendJson(res, code, obj) {
  const b = Buffer.from(JSON.stringify(obj));
  res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8', 'Content-Length': b.length });
  res.end(b);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let buf = '';
    let size = 0;
    req.on('data', d => {
      size += d.length;
      if (size > 32 * 1024 * 1024) { reject(new Error('请求体过大')); req.destroy(); return; }
      buf += d;
    });
    req.on('end', () => {
      try { resolve(buf ? JSON.parse(buf) : {}); } catch (e) { reject(new Error('请求体不是合法 JSON')); }
    });
    req.on('error', reject);
  });
}

const server = http.createServer(async (req, res) => {
  const p = (req.url || '').split('?')[0];

  if (p === '/health') return sendJson(res, 200, { ok: true, collections: SYNC_COLLECTIONS });

  const m = p.match(/^\/sync\/([\w-]+)$/);
  if (m && req.method === 'POST') {
    // 鉴权：配置了 SYNC_TOKEN 时校验 Bearer
    if (TOKEN) {
      const auth = req.headers['authorization'] || '';
      if (auth !== 'Bearer ' + TOKEN) return sendJson(res, 401, { error: '鉴权失败' });
    }
    const col = m[1];
    if (!SYNC_COLLECTIONS.includes(col)) return sendJson(res, 404, { error: '未知集合：' + col });
    try {
      const body = await readBody(req);
      const incoming = Array.isArray(body.items) ? body.items : [];
      // 服务端以自身存量为 local、客户端上报为 remote 做合并，结果即权威全量
      const { merged } = mergeLWW(readCol(col), incoming);
      writeCol(col, merged);
      return sendJson(res, 200, { items: merged, count: merged.length });
    } catch (e) {
      return sendJson(res, 400, { error: e.message || String(e) });
    }
  }

  sendJson(res, 404, { error: 'Not Found' });
});

if (require.main === module) {
  // 不指定 host：Node 会监听 :: 并接受 IPv4 映射，避免客户端用 localhost
  // 解析到 ::1 时连不上（Windows 常见）
  server.listen(PORT, () => {
    console.log(`AI Share 同步服务端已启动: http://localhost:${PORT}`);
    console.log(`数据目录: ${DATA_DIR}`);
    console.log(TOKEN ? '鉴权: 已启用 (SYNC_TOKEN)' : '鉴权: 未启用，建议设置 SYNC_TOKEN 环境变量');
  });
}

module.exports = { server, DATA_DIR };
