#!/usr/bin/env node
// ============================================================
// ai-share ↔ MCP 桥接器 (零依赖)
// 把本机运行的 ai-share (默认 http://127.0.0.1:4737) 的资源
// 通过 MCP 暴露给任意 Agent (Claude Desktop / Cursor / CodeBuddy / VS Code)。
//
// 前置：ai-share 已在运行 (node server.js 或 ai-share.exe)
// 启动：node mcp-bridge.js   (可设 AI_SHARE_URL 改地址)
// Agent 侧 mcpServers 配置见文件底部说明。
// ============================================================
'use strict';
const http = require('http');

const BASE = (process.env.AI_SHARE_URL || 'http://127.0.0.1:4737').replace(/\/$/, '');
const COLLECTIONS = ['providers', 'prompts', 'mcpservers', 'skillrepos', 'clients', 'profiles', 'repos'];

// ---------- 服务未启动时按需拉起（WSL 重启后无需手动 start） ----------
let _serverStarted = false;
function ensureServer() {
  if (_serverStarted) return Promise.resolve();
  _serverStarted = true;
  return new Promise((resolve) => {
    try {
      const { spawn } = require('child_process');
      const dir = require('path').dirname(__filename);
      const p = spawn('bash', ['-c', 'cd ' + JSON.stringify(dir) + ' && ./start.sh -d'],
        { detached: true, stdio: 'ignore' });
      p.on('error', () => {});
      p.unref();
    } catch (e) { /* 启动失败时由调用方返回错误 */ }
    setTimeout(resolve, 2500);
  });
}

// ---------- 调 ai-share REST API ----------
function api(method, path, body, _retried) {
  return new Promise((resolve, reject) => {
    const data = body ? JSON.stringify(body) : null;
    const u = new URL(BASE + path);
    const opt = {
      method,
      hostname: u.hostname,
      port: u.port || (u.protocol === 'https:' ? 443 : 80),
      path: u.pathname + u.search,
      headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
    };
    if (data) opt.headers['Content-Length'] = Buffer.byteLength(data);
    const r = http.request(opt, (res) => {
      let buf = '';
      res.on('data', (c) => (buf += c));
      res.on('end', () => {
        if (!buf) return resolve(null);
        try { resolve(JSON.parse(buf)); } catch (e) { reject(new Error('ai-share 返回非 JSON: ' + buf.slice(0, 120))); }
      });
    });
    r.on('error', (e) => {
      if (!_retried && (e.code === 'ECONNREFUSED' || e.code === 'ENOTFOUND' || e.code === 'ECONNRESET')) {
        ensureServer().then(() => api(method, path, body, true).then(resolve, reject));
      } else reject(e);
    });
    if (data) r.write(data);
    r.end();
  });
}

function asArray(r) {
  if (Array.isArray(r)) return r;
  if (r && Array.isArray(r.items)) return r.items;     // 兼容 {items:[...]}
  if (r && Array.isArray(r.data)) return r.data;
  return r ? [r] : [];
}

function searchFilter(items, q) {
  const k = String(q || '').toLowerCase();
  if (!k) return items;
  return items.filter((it) =>
    [it.name, it.title, it.label, it.description, it.type, JSON.stringify(it)]
      .filter(Boolean).join(' ').toLowerCase().includes(k));
}

const text = (s) => ({ content: [{ type: 'text', text: String(s) }] });
const json = (o) => text(typeof o === 'string' ? o : JSON.stringify(o, null, 2));

// ---------- 工具实现 ----------
const TOOLS = [
  { name: 'aishare_collections', description: '列出 ai-share 可用集合: ' + COLLECTIONS.join(', '),
    inputSchema: { type: 'object', properties: {} } },
  { name: 'aishare_list', description: '列出某集合全部条目 (collection 为 providers/prompts/mcpservers/skillrepos/clients/profiles/repos)。',
    inputSchema: { type: 'object', properties: { collection: { type: 'string', enum: COLLECTIONS } }, required: ['collection'] } },
  { name: 'aishare_get', description: '按 id 取集合中单条资源。',
    inputSchema: { type: 'object', properties: { collection: { type: 'string', enum: COLLECTIONS }, id: { type: 'string' } }, required: ['collection', 'id'] } },
  { name: 'aishare_search', description: '在集合内按关键字搜索 (匹配 name/title/description/type)。',
    inputSchema: { type: 'object', properties: { collection: { type: 'string', enum: COLLECTIONS }, q: { type: 'string' } }, required: ['collection', 'q'] } },
  { name: 'aishare_apply_profile', description: '把一个「共享配置(方案)」写入其目标客户端配置文件。',
    inputSchema: { type: 'object', properties: { profileId: { type: 'string' } }, required: ['profileId'] } },
  { name: 'aishare_detect_clients', description: '探测本机已安装的 AI 客户端及其配置文件路径。',
    inputSchema: { type: 'object', properties: {} } },
];

async function callTool(name, args = {}) {
  switch (name) {
    case 'aishare_collections':
      return json(COLLECTIONS);
    case 'aishare_list': {
      const items = asArray(await api('GET', '/api/' + args.collection));
      return json(items);
    }
    case 'aishare_get': {
      const item = await api('GET', `/api/${args.collection}/${encodeURIComponent(args.id)}`);
      return json(item);
    }
    case 'aishare_search': {
      const items = searchFilter(asArray(await api('GET', '/api/' + args.collection)), args.q);
      return json(items);
    }
    case 'aishare_apply_profile': {
      const r = await api('POST', `/api/export/${encodeURIComponent(args.profileId)}/apply`, {});
      return json(r);
    }
    case 'aishare_detect_clients': {
      const r = await api('GET', '/api/detect/clients');
      return json(r);
    }
    default:
      throw new Error('未知工具: ' + name);
  }
}

// ---------- stdio JSON-RPC (MCP) ----------
let buf = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', (d) => {
  buf += d;
  let i;
  while ((i = buf.indexOf('\n')) >= 0) {
    const line = buf.slice(0, i).trim();
    buf = buf.slice(i + 1);
    if (line) handle(line);
  }
});
process.stdin.on('end', () => process.exit(0));

const send = (m) => process.stdout.write(JSON.stringify(m) + '\n');

function handle(line) {
  let msg;
  try { msg = JSON.parse(line); } catch { return; }
  const id = msg.id;

  if (msg.method === 'initialize') {
    return send({ jsonrpc: '2.0', id, result: {
      protocolVersion: (msg.params && msg.params.protocolVersion) || '2024-11-05',
      capabilities: { tools: {}, resources: {} },
      serverInfo: { name: 'ai-share-mcp', version: '0.1.0' },
    }});
  }
  if (msg.method === 'notifications/initialized' || msg.method === 'initialized') return;
  if (msg.method === 'ping') return send({ jsonrpc: '2.0', id, result: {} });

  if (msg.method === 'tools/list') {
    return send({ jsonrpc: '2.0', id, result: { tools: TOOLS } });
  }
  if (msg.method === 'tools/call') {
    return callTool(msg.params.name, msg.params.arguments || {})
      .then((result) => send({ jsonrpc: '2.0', id, result }))
      .catch((e) => send({ jsonrpc: '2.0', id, result: { content: [{ type: 'text', text: 'Error: ' + e.message }], isError: true } }));
  }
  if (msg.method === 'resources/list') {
    return send({ jsonrpc: '2.0', id, result: { resources: [] } });
  }
  // 未知方法：回空结果，避免客户端卡住
  if (id !== undefined) send({ jsonrpc: '2.0', id, result: {} });
}

// ============================================================
// Agent 侧 mcpServers 配置示例：
//
// {
//   "mcpServers": {
//     "ai-share": {
//       "command": "node",
//       "args": ["C:/ai share/repo/ai share/mcp-bridge.js"],
//       "env": { "AI_SHARE_URL": "http://127.0.0.1:4737" }
//     }
//   }
// }
//
// 支持的 Agent：Claude Desktop / Claude Code、Cursor、CodeBuddy、
// VS Code Copilot、Cline 等一切兼容 MCP 的客户端。
// 接入后 Agent 即可调用 aishare_list / aishare_search / aishare_get
// 等工具，按需读取你的 API 端点、提示词、MCP 配置、Skill、方案。
// ============================================================
