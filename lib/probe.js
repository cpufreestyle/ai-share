'use strict';
const http = require('http');
const https = require('https');
const fs = require('fs');
const path = require('path');
const { URL } = require('url');

// 最小连通性探测：只发请求、丢弃响应体，记录状态码与耗时。
// 用于「Provider 连通性测试」「MCP 服务器可用性检查」，零依赖。
function request(url, opts) {
  return new Promise((resolve, reject) => {
    let u;
    try { u = new URL(url); } catch (e) { return reject(new Error('URL 无效: ' + url)); }
    const lib = u.protocol === 'https:' ? https : http;
    const t0 = Date.now();
    const r = lib.request(u, {
      method: (opts && opts.method) || 'GET',
      headers: Object.assign({ 'User-Agent': 'ai-share-probe/0.1' }, (opts && opts.headers) || {}),
    }, (res) => { res.resume(); resolve({ status: res.statusCode, ms: Date.now() - t0 }); });
    const to = setTimeout(() => { r.destroy(); reject(new Error('连接超时（5s）')); }, 5000);
    r.on('error', (e) => { clearTimeout(to); reject(e); });
    if (opts && opts.body) r.write(opts.body);
    r.end();
  });
}

// Provider：用 baseUrl + apiKey 发起最小探测（先试 /models，再试根路径）。
async function probeProvider(p) {
  const base = (p && p.baseUrl || '').replace(/\/+$/, '');
  const key = p && p.apiKey;
  if (!base) return { ok: false, error: '未配置 baseUrl' };
  const headers = key ? { Authorization: 'Bearer ' + key } : {};
  for (const suffix of ['/models', '']) {
    const url = base + suffix;
    try { const r = await request(url, { method: 'GET', headers }); if (r.status < 500) return { ok: true, status: r.status, ms: r.ms, url }; }
    catch (e) { /* 尝试下一个候选 */ }
  }
  return { ok: false, error: '无法连接（已尝试 /models 与根路径）' };
}

// MCP 服务器：stdio 检查命令是否可解析（绝对路径看存在性，相对命令依赖 PATH）；
// http/sse 直接探测 URL 可达性。
async function checkMcp(server) {
  if (!server) return { ok: false, error: '无配置' };
  if (server.command) {
    const cmd = String(server.command).trim().split(/\s+/)[0];
    if (path.isAbsolute(cmd)) {
      const exists = fs.existsSync(cmd);
      return { ok: exists, kind: 'stdio', command: cmd, exists };
    }
    return { ok: true, kind: 'stdio', command: cmd, note: '命令依赖 PATH，未做静态校验（请确认已安装）' };
  }
  if (server.url) {
    try { const r = await request(server.url, { method: 'GET', headers: { Accept: 'text/event-stream' } }); return { ok: true, kind: 'url', status: r.status, ms: r.ms, url: server.url }; }
    catch (e) { return { ok: false, kind: 'url', error: String(e.message || e), url: server.url }; }
  }
  return { ok: false, error: '未配置 command 或 url' };
}

module.exports = { probeProvider, checkMcp };
