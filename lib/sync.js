'use strict';
// 网络双向同步：与自建/第三方同步服务端交换资源，按 updatedAt 做 LWW（新者胜）合并。
// 设计要点：
//  1. 每条记录以 id 为键、updatedAt 为版本；两端各自上报全量，服务端做权威合并。
//  2. 删除以「墓碑」（_deleted）表达，保证删除能跨端传播。
//  3. 密钥字段在传输前用同步密钥二次加密，服务端只见密文。
const http = require('http');
const https = require('https');
const path = require('path');
const fs = require('fs');
const { URL } = require('url');
const crypto = require('crypto');

// 参与同步的集合（profiles 也一并同步，便于多端共用方案）
const SYNC_COLLECTIONS = ['providers', 'prompts', 'mcpservers', 'skillrepos', 'clients', 'profiles', 'repos'];
// 需要在传输层额外加密的字段（与 store 的 SECRET_FIELDS 对应）
const SECRET_FIELDS = { providers: ['apiKey'] };

function cfgFile() {
  const store = require('./store');
  return path.join(store.DATA_DIR, 'sync.json');
}

// 同步配置：服务端地址、开关、间隔、同步密钥等
function getConfig() {
  const def = { enabled: false, url: '', token: '', secret: '', intervalMinutes: 15, deviceId: '', lastSyncAt: '', lastResult: '' };
  try {
    const f = cfgFile();
    if (!fs.existsSync(f)) return def;
    return Object.assign(def, JSON.parse(fs.readFileSync(f, 'utf8')));
  } catch (_) { return def; }
}

function saveConfig(patch) {
  const store = require('./store');
  if (!fs.existsSync(store.DATA_DIR)) fs.mkdirSync(store.DATA_DIR, { recursive: true });
  const next = Object.assign(getConfig(), patch || {});
  if (!next.deviceId) next.deviceId = crypto.randomBytes(8).toString('hex');
  fs.writeFileSync(cfgFile(), JSON.stringify(next, null, 2));
  return next;
}

/* ---------- 传输层字段加密 ---------- */
// 用同步密钥派生 AES-256-GCM 密钥，保证服务端拿不到明文密钥
function keyFrom(secret) {
  return crypto.createHash('sha256').update(String(secret || '')).digest();
}
function encField(text, secret) {
  const iv = crypto.randomBytes(12);
  const c = crypto.createCipheriv('aes-256-gcm', keyFrom(secret), iv);
  const enc = Buffer.concat([c.update(String(text), 'utf8'), c.final()]);
  return 'senc:' + iv.toString('base64') + ':' + c.getAuthTag().toString('base64') + ':' + enc.toString('base64');
}
function decField(text, secret) {
  const s = String(text || '');
  if (!s.startsWith('senc:')) return text; // 兼容明文/未加密来源
  try {
    const [, ivB, tagB, dataB] = s.split(':');
    const d = crypto.createDecipheriv('aes-256-gcm', keyFrom(secret), Buffer.from(ivB, 'base64'));
    d.setAuthTag(Buffer.from(tagB, 'base64'));
    return Buffer.concat([d.update(Buffer.from(dataB, 'base64')), d.final()]).toString('utf8');
  } catch (_) {
    return null; // 密钥不匹配：返回 null，由调用方决定丢弃该字段
  }
}
function sealForWire(col, item, secret) {
  const fields = SECRET_FIELDS[col];
  if (!fields || !secret) return item;
  const out = Object.assign({}, item);
  for (const f of fields) {
    if (out[f] != null && out[f] !== '') out[f] = encField(out[f], secret);
  }
  return out;
}
function unsealFromWire(col, item, secret) {
  const fields = SECRET_FIELDS[col];
  if (!fields) return item;
  const out = Object.assign({}, item);
  for (const f of fields) {
    if (out[f] != null && out[f] !== '') {
      const v = secret ? decField(out[f], secret) : out[f];
      // 解不开（同步密钥不一致）时丢弃该字段，避免把密文当明文写入本地
      if (v === null) delete out[f]; else out[f] = v;
    }
  }
  return out;
}

/* ---------- LWW 合并（纯函数，便于测试） ---------- */
// 返回 { merged, localChanges, remoteChanges }
// localChanges：需要写入本地的远端记录；remoteChanges：需要推送到远端的本地记录
function mergeLWW(localItems, remoteItems) {
  const byId = new Map();
  const localMap = new Map((localItems || []).map(x => [x.id, x]));
  const remoteMap = new Map((remoteItems || []).map(x => [x.id, x]));
  const localChanges = [];
  const remoteChanges = [];

  const ts = x => Date.parse((x && (x.updatedAt || x.createdAt)) || 0) || 0;

  for (const id of new Set([...localMap.keys(), ...remoteMap.keys()])) {
    const l = localMap.get(id);
    const r = remoteMap.get(id);
    if (l && !r) { byId.set(id, l); remoteChanges.push(l); continue; }
    if (!l && r) { byId.set(id, r); localChanges.push(r); continue; }
    const lt = ts(l), rt = ts(r);
    if (rt > lt) { byId.set(id, r); localChanges.push(r); }
    else if (lt > rt) { byId.set(id, l); remoteChanges.push(l); }
    else byId.set(id, l); // 时间戳相同视为一致，不产生变更
  }
  return { merged: [...byId.values()], localChanges, remoteChanges };
}

/* ---------- HTTP 请求（零依赖） ---------- */
function request(urlStr, { method = 'GET', body, token, timeout = 20000 } = {}) {
  return new Promise((resolve, reject) => {
    let u;
    try { u = new URL(urlStr); } catch (e) { return reject(new Error('同步服务端地址无效：' + urlStr)); }
    const mod = u.protocol === 'https:' ? https : http;
    const payload = body == null ? null : Buffer.from(JSON.stringify(body));
    const headers = { 'Content-Type': 'application/json' };
    if (payload) headers['Content-Length'] = payload.length;
    if (token) headers['Authorization'] = 'Bearer ' + token;
    // Windows 下 localhost 可能优先解析为 IPv6(::1)，若服务端只监听 IPv4 会连接悬挂直至超时。
    // 这里显式允许双栈解析，避免出现「服务端明明在跑却一直超时」的困惑。
    const opts = { method, headers, timeout, family: 0, autoSelectFamily: true };
    const req = mod.request(u, opts, res => {
      let buf = '';
      res.setEncoding('utf8');
      res.on('data', d => { buf += d; });
      res.on('end', () => {
        if (res.statusCode < 200 || res.statusCode >= 300) {
          return reject(new Error('服务端返回 ' + res.statusCode + '：' + buf.slice(0, 200)));
        }
        try { resolve(JSON.parse(buf || '{}')); }
        catch (e) { reject(new Error('服务端响应不是合法 JSON')); }
      });
    });
    req.on('timeout', () => req.destroy(new Error('请求超时（' + timeout + 'ms）')));
    req.on('error', reject);
    if (payload) req.write(payload);
    req.end();
  });
}

/* ---------- 主流程：一次双向同步 ---------- */
async function syncOnce(overrideCfg) {
  const cfg = Object.assign(getConfig(), overrideCfg || {});
  if (!cfg.url) return { ok: false, error: '未配置同步服务端地址' };

  const store = require('./store');
  const base = cfg.url.replace(/\/+$/, '');
  const stats = {};
  let pulled = 0, pushed = 0;

  try {
    for (const col of SYNC_COLLECTIONS) {
      // 含墓碑的本地全量
      const localRaw = store.listRaw(col);
      const localWire = localRaw.map(x => sealForWire(col, x, cfg.secret));

      // 与服务端交换：上报本地全量，取回服务端全量
      const res = await request(`${base}/sync/${col}`, {
        method: 'POST',
        token: cfg.token,
        body: { deviceId: cfg.deviceId, items: localWire },
      });
      const remoteWire = (res && res.items) || [];
      const remote = remoteWire.map(x => unsealFromWire(col, x, cfg.secret));

      const { localChanges, remoteChanges } = mergeLWW(localRaw, remote);

      // 落地远端更新到本地
      for (const item of localChanges) {
        const exists = store.listRaw(col).some(x => x.id === item.id);
        if (exists) store.update(col, item.id, item);
        else store.create(col, item);
      }
      pulled += localChanges.length;
      pushed += remoteChanges.length;
      if (localChanges.length || remoteChanges.length) {
        stats[col] = { pulled: localChanges.length, pushed: remoteChanges.length };
      }
    }

    const lastSyncAt = new Date().toISOString();
    saveConfig({ lastSyncAt, lastResult: `成功：拉取 ${pulled} 项，推送 ${pushed} 项` });
    return { ok: true, pulled, pushed, stats, lastSyncAt };
  } catch (e) {
    const msg = e && e.message ? e.message : String(e);
    saveConfig({ lastResult: '失败：' + msg });
    return { ok: false, error: msg };
  }
}

/* ---------- 定时自动同步 ---------- */
let timer = null;
function stopAuto() {
  if (timer) { clearInterval(timer); timer = null; }
}
function startAuto() {
  stopAuto();
  const cfg = getConfig();
  if (!cfg.enabled || !cfg.url) return { running: false };
  const ms = Math.max(1, Number(cfg.intervalMinutes) || 15) * 60 * 1000;
  timer = setInterval(() => {
    syncOnce().catch(() => { /* 定时任务不抛出，结果已记入 lastResult */ });
  }, ms);
  if (timer.unref) timer.unref(); // 不阻止进程退出（测试友好）
  return { running: true, intervalMinutes: cfg.intervalMinutes };
}
function autoStatus() { return { running: !!timer }; }

module.exports = {
  SYNC_COLLECTIONS, getConfig, saveConfig, mergeLWW, syncOnce,
  startAuto, stopAuto, autoStatus, encField, decField,
};
