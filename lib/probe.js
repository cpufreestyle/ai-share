'use strict';
const http = require('http');
const https = require('https');
const fs = require('fs');
const path = require('path');
const { URL } = require('url');

// 最小连通性探测：记录状态码、耗时，并捕获前 16KB 响应体（用于提取模型数或 MCP serverInfo）。
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
    }, (res) => {
      let buf = '';
      res.setEncoding('utf8');
      res.on('data', (chunk) => {
        if (buf.length < 16384) buf += chunk;
      });
      res.on('end', () => {
        let data = null;
        try { data = JSON.parse(buf); } catch (_) {}
        resolve({ status: res.statusCode, ms: Date.now() - t0, body: data, raw: buf });
      });
    });
    const to = setTimeout(() => { r.destroy(); reject(new Error('连接超时（5s）')); }, 5000);
    r.on('error', (e) => { clearTimeout(to); reject(e); });
    if (opts && opts.body) r.write(opts.body);
    r.end();
  });
}

// Provider：用 baseUrl + apiKey 发起最小探测（先试 /models，再试根路径）。
// 返回 ok / status / ms / url，若端点返回合法 models 数组则一并返回 modelCount。
async function probeProvider(p) {
  const base = (p && p.baseUrl || '').replace(/\/+$/, '');
  const key = p && p.apiKey;
  if (!base) return { ok: false, error: '未配置 baseUrl' };
  const headers = key ? { Authorization: 'Bearer ' + key } : {};
  for (const suffix of ['/models', '']) {
    const url = base + suffix;
    try {
      const r = await request(url, { method: 'GET', headers });
      if (r.status < 500) {
        const modelCount = (r.body && Array.isArray(r.body.data)) ? r.body.data.length : undefined;
        return { ok: true, status: r.status, ms: r.ms, url, modelCount };
      }
    } catch (e) { /* 尝试下一个候选 */ }
  }
  return { ok: false, error: '无法连接（已尝试 /models 与根路径）' };
}

// MCP 服务器：stdio 检查命令是否可解析（绝对路径看存在性，相对命令依赖 PATH）；
// http/sse 直接探测 URL 可达性（针对 HTTP POST MCP 自动尝试 JSON-RPC 最小握手并提取 serverInfo）。
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
    try {
      const urlStr = String(server.url).trim();
      const isHttp = server.type === 'http';
      const customHeaders = (server.headers && typeof server.headers === 'object') ? server.headers : {};
      const initBody = JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'ai-share-probe', version: '0.1' } } });
      let r;
      if (isHttp) {
        r = await request(urlStr, { method: 'POST', headers: Object.assign({ 'Content-Type': 'application/json' }, customHeaders), body: initBody });
      } else {
        r = await request(urlStr, { method: 'GET', headers: Object.assign({ Accept: 'text/event-stream' }, customHeaders) });
        if (r.status === 405) {
          r = await request(urlStr, { method: 'POST', headers: Object.assign({ 'Content-Type': 'application/json' }, customHeaders), body: initBody });
        }
      }
      const sInfo = r.body && r.body.result && r.body.result.serverInfo;
      return { ok: r.status < 500, kind: 'url', status: r.status, ms: r.ms, url: urlStr, serverInfo: sInfo || undefined };
    } catch (e) {
      return { ok: false, kind: 'url', error: String(e.message || e), url: String(server.url) };
    }
  }
  return { ok: false, error: '未配置 command 或 url' };
}

module.exports = { probeProvider, checkMcp };
