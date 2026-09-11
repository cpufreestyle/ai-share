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
const { writeFileAtomic } = require('./lib/fsutil');

const PORT = process.env.SYNC_PORT || 4738;
const TOKEN = process.env.SYNC_TOKEN || '';
// 默认只监听回环，避免未设 SYNC_TOKEN 时把权威数据暴露到局域网；
// 如需跨设备同步，显式设置 SYNC_HOST=0.0.0.0（并务必同时设置 SYNC_TOKEN）。
const HOST = process.env.SYNC_HOST || '127.0.0.1';
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
  try {
    return JSON.parse(fs.readFileSync(f, 'utf8'));
  } catch (e) {
    // 主文件损坏：先隔离证据，再尝试用上一份完好的 .bak 自动回滚。
    try { fs.renameSync(f, f + '.corrupt-' + Date.now()); } catch (e2) { /* noop */ }
    const bak = f + '.bak';
    if (fs.existsSync(bak)) {
      try {
        fs.copyFileSync(bak, f);
        return JSON.parse(fs.readFileSync(f, 'utf8'));
      } catch (e3) { /* 回滚失败：继续抛出，交给上层返回 500 */ }
    }
    // 无法恢复：抛出而非返回 []，杜绝「解析失败即清空权威数据」的数据丢失。
    throw new Error('集合文件损坏且无法从备份恢复：' + col);
  }
}
function writeCol(col, items) {
  ensureDir();
  // 原子写（同 lib/fsutil）：tmp → fsync → rename，并保留上一版本 .bak
  writeFileAtomic(fileFor(col), JSON.stringify(items, null, 2));
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
      let merged;
      try {
        merged = mergeLWW(readCol(col), incoming).merged;
        writeCol(col, merged);
      } catch (e) {
        // 存储层错误（含「文件损坏且无法回滚」）单独归为 500，
        // 且绝不把损坏当成空集去覆盖，避免清空权威数据。
        console.error('[sync-server] 存储错误(' + col + '):', e.message);
        return sendJson(res, 500, { error: '服务端存储错误' });
      }
      return sendJson(res, 200, { items: merged, count: merged.length });
    } catch (e) {
      return sendJson(res, 400, { error: e.message || String(e) });
    }
  }

  sendJson(res, 404, { error: 'Not Found' });
});

if (require.main === module) {
  // 默认只绑回环；跨设备同步需显式 SYNC_HOST（并务必配 SYNC_TOKEN）。
  server.listen(PORT, HOST, () => {
    const exposed = !(HOST === '127.0.0.1' || HOST === 'localhost' || HOST === '::1');
    console.log(`AI Share 同步服务端已启动: http://${HOST}:${PORT}`);
    console.log(`数据目录: ${DATA_DIR}`);
    if (TOKEN) {
      console.log('鉴权: 已启用 (SYNC_TOKEN)');
    } else if (exposed) {
      console.warn('⚠ 未设置 SYNC_TOKEN 却监听对外地址：任何能访问该端口的设备都可读写全部同步数据，请立刻设置 SYNC_TOKEN。');
    } else {
      console.log('鉴权: 未启用（当前仅监听本机回环，外部无法直接访问）');
    }
    if (!exposed) console.log('跨设备同步：需设置 SYNC_HOST=0.0.0.0 并配置 SYNC_TOKEN 后重启');
  });
}

module.exports = { server, DATA_DIR, HOST, TOKEN };
