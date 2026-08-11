'use strict';
const http = require('http');
const fs = require('fs');
const path = require('path');
const { COLLECTIONS, list, get, create, update, remove, rewrite, exportAll, restoreAll, exportProfileBundle, importProfileBundle, importScannedServers, importScannedSkills, importScannedPrompts, collectFromClients } = require('./lib/store');
const { exportProfile, applyExport, detectClients, scanClientMcp, scanClientSkills, scanClientPrompts, expand, syncRepo } = require('./lib/export');
const sync = require('./lib/sync');
const vault = require('./lib/crypto');
// 应用根目录：server.js 与 public/ 同级（源码模式与 exe 解压模式均如此）
const APP_ROOT = process.pkg
  ? path.dirname(process.execPath)
  : __dirname;

// 加密盐文件放在资源根 data/ 下（与 store.js 的 DATA_DIR 同根），而非 app 内部
const SALT_FILE = path.join(APP_ROOT, 'data', '.salt');

const PORT = process.env.PORT || 4737;
const PUBLIC = path.join(APP_ROOT, 'public');

const MIME = {
  '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css',
  '.json': 'application/json', '.svg': 'image/svg+xml', '.ico': 'image/x-icon'
};

function send(res, code, body, mime = 'application/json') {
  let payload;
  if (Buffer.isBuffer(body)) payload = body;
  else if (typeof body === 'string') payload = Buffer.from(body, 'utf8');
  else payload = Buffer.from(JSON.stringify(body), 'utf8');
  res.writeHead(code, { 'Content-Type': mime + '; charset=utf-8', 'Content-Length': payload.length, 'Cache-Control': 'no-store' });
  res.end(payload);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', c => {
      data += c;
      if (data.length > 5e6) { req.destroy(); reject(new Error('请求体过大')); } // 超限直接 reject，避免 Promise 永不 settle
    });
    req.on('end', () => { try { resolve(data ? JSON.parse(data) : {}); } catch (e) { reject(e); } });
    req.on('error', reject);
  });
}

function serveStatic(req, res, urlPath) {
  const rel = urlPath === '/' ? '/index.html' : urlPath;
  const fp = path.normalize(path.join(PUBLIC, rel));
  if (!fp.startsWith(PUBLIC)) return send(res, 403, { error: 'forbidden' });
  if (!fs.existsSync(fp) || !fs.statSync(fp).isFile()) return send(res, 404, { error: 'not found' });
  send(res, 200, fs.readFileSync(fp), MIME[path.extname(fp)] || 'application/octet-stream');
}

// 声明式路由表：精确匹配 method+path，handler(ctx) 返回响应体（已自动 JSON 序列化）
// 需要读取请求体时使用 readBody；返回非对象值（如布尔）请用 send 自行处理。
const sendJson = (res, code, body) => send(res, code, body);

// 从扫描结果按 body.selected 过滤（缺省全部）
function pickSelected(arr, selected, key = 'name') {
  return (selected && Array.isArray(selected)) ? arr.filter(x => selected.includes(x[key])) : arr;
}

const ROUTES = [
  // 方案导出预览 / 写入客户端
  { method: 'GET', test: p => /^\/api\/export\/([\w-]+)$/.test(p), handler: (ctx) => {
      const m = ctx.p.match(/^\/api\/export\/([\w-]+)$/);
      const data = exportProfile(m[1]);
      return data ? sendJson(ctx.res, 200, data) : sendJson(ctx.res, 404, { error: 'profile 不存在' });
    } },
  { method: 'POST', test: p => /^\/api\/export\/([\w-]+)\/apply$/.test(p), handler: (ctx) => {
      const m = ctx.p.match(/^\/api\/export\/([\w-]+)\/apply$/);
      return sendJson(ctx.res, 200, applyExport(m[1]));
    } },

  // 客户端自动探测
  { method: 'GET', test: p => p === '/api/detect/clients', handler: (ctx) => sendJson(ctx.res, 200, detectClients()) },

  // 一键自动采集
  { method: 'POST', test: p => p === '/api/collect', handler: (ctx) => sendJson(ctx.res, 200, collectFromClients()) },

  // 路径校验（供表单保存提示）
  { method: 'POST', test: p => p === '/api/paths/validate', handler: async (ctx) => {
      const body = await readBody(ctx.req);
      const paths = Array.isArray(body.paths) ? body.paths : [];
      const results = paths.map(pth => { const e = expand(pth); return { path: pth, expanded: e, exists: fs.existsSync(e) }; });
      return sendJson(ctx.res, 200, { results });
    } },

  // 备份导出 / 导入
  { method: 'GET', test: p => p === '/api/backup/export', handler: (ctx) => {
      if (fs.existsSync(SALT_FILE) && !vault.hasKey()) {
        return sendJson(ctx.res, 423, { error: '主密码已启用，请先在侧边栏解锁后再导出备份' });
      }
      return sendJson(ctx.res, 200, exportAll());
    } },
  { method: 'POST', test: p => p === '/api/backup/import', handler: async (ctx) => {
      const body = await readBody(ctx.req);
      if (!body || !body.data) return sendJson(ctx.res, 400, { error: '缺少 data' });
      const mode = body.mode === 'replace' ? 'replace' : 'merge';
      return sendJson(ctx.res, 200, restoreAll(body.data, mode));
    } },

  // 网络双向同步：配置读写、立即同步、定时开关
  { method: 'GET', test: p => p === '/api/sync/config', handler: (ctx) => {
      const c = sync.getConfig();
      // token/secret 不回传明文，仅告知是否已设置，避免密钥经接口泄露
      return sendJson(ctx.res, 200, Object.assign({}, c, {
        token: c.token ? '__SET__' : '',
        secret: c.secret ? '__SET__' : '',
        auto: sync.autoStatus(),
      }));
    } },
  { method: 'PUT', test: p => p === '/api/sync/config', handler: async (ctx) => {
      const body = await readBody(ctx.req);
      const patch = {};
      for (const k of ['enabled', 'url', 'intervalMinutes']) {
        if (body[k] !== undefined) patch[k] = body[k];
      }
      // 占位符表示「保持原值不变」，避免前端回显时把已存的密钥覆盖成占位符
      for (const k of ['token', 'secret']) {
        if (body[k] !== undefined && body[k] !== '__SET__') patch[k] = body[k];
      }
      const next = sync.saveConfig(patch);
      sync.startAuto(); // 配置变更后按新设置重建定时器
      return sendJson(ctx.res, 200, Object.assign({}, next, {
        token: next.token ? '__SET__' : '',
        secret: next.secret ? '__SET__' : '',
        auto: sync.autoStatus(),
      }));
    } },
  { method: 'POST', test: p => p === '/api/sync/now', handler: async (ctx) => {
      const r = await sync.syncOnce();
      return sendJson(ctx.res, r.ok ? 200 : 400, r);
    } },

  // 方案包导出 / 导入
  { method: 'GET', test: p => /^\/api\/profiles\/([\w-]+)\/export$/.test(p), handler: (ctx) => {
      const m = ctx.p.match(/^\/api\/profiles\/([\w-]+)\/export$/);
      const b = exportProfileBundle(m[1]);
      return b ? sendJson(ctx.res, 200, b) : sendJson(ctx.res, 404, { error: '方案不存在' });
    } },
  { method: 'POST', test: p => p === '/api/profiles/import', handler: async (ctx) => {
      const body = await readBody(ctx.req);
      if (!body || !body.bundle) return sendJson(ctx.res, 400, { error: '缺少 bundle' });
      return sendJson(ctx.res, 200, importProfileBundle(body.bundle));
    } },

  // 密钥保险库
  { method: 'GET', test: p => p === '/api/vault/status', handler: (ctx) => {
      const enabled = fs.existsSync(SALT_FILE);
      return sendJson(ctx.res, 200, { enabled, locked: enabled && !vault.hasKey() });
    } },
  { method: 'POST', test: p => p === '/api/vault/set', handler: async (ctx) => {
      const body = await readBody(ctx.req);
      if (!body.password) return sendJson(ctx.res, 400, { error: '缺少密码' });
      const data = list('providers'); // 用当前(旧)密钥解密得到明文
      const salt = vault.genSalt();
      vault.setKey(vault.deriveKey(body.password, salt));
      rewrite('providers', data);      // 用主密码派生密钥重加密
      fs.mkdirSync(path.dirname(SALT_FILE), { recursive: true });
      fs.writeFileSync(SALT_FILE, salt.toString('base64'));
      return sendJson(ctx.res, 200, { ok: true });
    } },
  { method: 'POST', test: p => p === '/api/vault/unlock', handler: async (ctx) => {
      const body = await readBody(ctx.req);
      if (!body.password) return sendJson(ctx.res, 400, { error: '缺少密码' });
      if (!fs.existsSync(SALT_FILE)) return sendJson(ctx.res, 400, { error: '未启用主密码' });
      const salt = Buffer.from(fs.readFileSync(SALT_FILE, 'utf8').trim(), 'base64');
      vault.setKey(vault.deriveKey(body.password, salt));
      const wrong = list('providers').some(x => x.apiKey && typeof x.apiKey === 'string' && x.apiKey.startsWith('v1:'));
      if (wrong) { vault.clearKey(); return sendJson(ctx.res, 200, { ok: false, error: '密码错误' }); }
      return sendJson(ctx.res, 200, { ok: true });
    } },
  { method: 'POST', test: p => p === '/api/vault/lock', handler: () => ({ ok: true }) },

  // 仓库同步：将某仓库（local 目录）扫描导入到其 resourceType 对应的集合
  { method: 'POST', test: p => /^\/api\/repos\/([\w-]+)\/sync$/.test(p), handler: (ctx) => {
      const m = ctx.p.match(/^\/api\/repos\/([\w-]+)\/sync$/);
      const repo = get('repos', m[1]);
      if (!repo) return sendJson(ctx.res, 404, { error: '仓库不存在' });
      const r = syncRepo(repo);
      const code = r.ok ? 200 : 400;
      return sendJson(ctx.res, code, Object.assign({ id: m[1], name: repo.name }, r));
    } },

  // 客户端扫描预览 / 导入：clients/:type/(scan|skills|prompts) (+/import)
  { method: 'GET', test: p => /^\/api\/clients\/([\w-]+)\/scan$/.test(p), handler: (ctx) => {
      const m = ctx.p.match(/^\/api\/clients\/([\w-]+)\/scan$/);
      const r = scanClientMcp(m[1]);
      return r ? sendJson(ctx.res, 200, r) : sendJson(ctx.res, 404, { error: '未知客户端类型' });
    } },
  { method: 'GET', test: p => /^\/api\/clients\/([\w-]+)\/skills$/.test(p), handler: (ctx) => {
      const m = ctx.p.match(/^\/api\/clients\/([\w-]+)\/skills$/);
      const r = scanClientSkills(m[1]);
      return r ? sendJson(ctx.res, 200, r) : sendJson(ctx.res, 404, { error: '未知客户端类型' });
    } },
  { method: 'GET', test: p => /^\/api\/clients\/([\w-]+)\/prompts$/.test(p), handler: (ctx) => {
      const m = ctx.p.match(/^\/api\/clients\/([\w-]+)\/prompts$/);
      const r = scanClientPrompts(m[1]);
      return r ? sendJson(ctx.res, 200, r) : sendJson(ctx.res, 404, { error: '未知客户端类型' });
    } },
  { method: 'POST', test: p => /^\/api\/clients\/([\w-]+)\/import$/.test(p), handler: async (ctx) => {
      const m = ctx.p.match(/^\/api\/clients\/([\w-]+)\/import$/);
      const r = scanClientMcp(m[1]);
      if (!r) return sendJson(ctx.res, 404, { error: '未知客户端类型' });
      const body = await readBody(ctx.req);
      return sendJson(ctx.res, 200, importScannedServers(pickSelected(r.servers, body.selected)));
    } },
  { method: 'POST', test: p => /^\/api\/clients\/([\w-]+)\/skills\/import$/.test(p), handler: async (ctx) => {
      const m = ctx.p.match(/^\/api\/clients\/([\w-]+)\/skills\/import$/);
      const r = scanClientSkills(m[1]);
      if (!r) return sendJson(ctx.res, 404, { error: '未知客户端类型' });
      const body = await readBody(ctx.req);
      return sendJson(ctx.res, 200, Object.assign(importScannedSkills(pickSelected(r.skills, body.selected)), { warnings: r.warnings || [] }));
    } },
  { method: 'POST', test: p => /^\/api\/clients\/([\w-]+)\/prompts\/import$/.test(p), handler: async (ctx) => {
      const m = ctx.p.match(/^\/api\/clients\/([\w-]+)\/prompts\/import$/);
      const r = scanClientPrompts(m[1]);
      if (!r) return sendJson(ctx.res, 404, { error: '未知客户端类型' });
      const body = await readBody(ctx.req);
      return sendJson(ctx.res, 200, Object.assign(importScannedPrompts(pickSelected(r.prompts, body.selected)), { warnings: r.warnings || [] }));
    } },
];

// 资源 CRUD: /api/:col  /api/:col/:id
async function handleCrud(req, res, p) {
  const m = p.match(/^\/api\/([\w]+)(?:\/([\w-]+))?$/);
  if (!m) return false;
  const col = m[1], id = m[2];
  if (!COLLECTIONS.includes(col)) { send(res, 400, { error: '未知集合' }); return true; }
  if (req.method === 'GET') {
    send(res, 200, id ? (get(col, id) || {}) : list(col));
  } else if (req.method === 'POST') {
    const body = await readBody(req);
    send(res, 201, create(col, body));
  } else if (req.method === 'PUT' || req.method === 'PATCH') {
    if (!id) return send(res, 400, { error: '缺少 id' });
    const body = await readBody(req);
    const r = update(col, id, body);
    send(res, r ? 200 : 404, r || { error: '不存在' });
  } else if (req.method === 'DELETE') {
    if (!id) return send(res, 400, { error: '缺少 id' });
    send(res, 200, remove(col, id));
  }
  return true;
}

const server = http.createServer(async (req, res) => {
  try {
    const p = new URL(req.url, 'http://localhost').pathname;
    const ctx = { req, res, p };

    if (req.method === 'GET' && !p.startsWith('/api/')) {
      return serveStatic(req, res, p);
    }

    for (const route of ROUTES) {
      if (route.method === req.method && route.test(p)) {
        const r = await route.handler(ctx);
        if (r !== undefined) send(res, 200, r); // handler 已自行 send 时返回 undefined
        return;
      }
    }

    if (await handleCrud(req, res, p)) return;

    console.error('[404] not found:', req.method, p);
    return send(res, 404, { error: 'not found' });
  } catch (e) {
    return send(res, 500, { error: e.message });
  }
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`AI Share 已启动: http://localhost:${PORT}  (监听 0.0.0.0:${PORT})`);
  // 重启后按已保存的配置恢复定时同步，避免自动同步静默失效
  const s = sync.startAuto();
  if (s.running) console.log(`定时同步已启用，每 ${s.intervalMinutes} 分钟一次`);

  // 本机自动打开浏览器（设置 AI_SHARE_NO_OPEN=1 可关闭）
  if (!process.env.AI_SHARE_NO_OPEN) {
    const { spawn } = require('child_process');
    const url = `http://localhost:${PORT}/`;
    let op, args;
    if (process.platform === 'win32') { op = 'cmd'; args = ['/c', 'start', '', url]; }
    else if (process.platform === 'darwin') { op = 'open'; args = [url]; }
    else { op = 'xdg-open'; args = [url]; } // Linux / BSD
    try { spawn(op, args, { detached: true, stdio: 'ignore' }).unref(); } catch (_) {}
  }
});
