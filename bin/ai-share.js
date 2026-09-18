#!/usr/bin/env node
'use strict';
// ai-share 命令行（命令习惯参照 llm / aichat / kubectx 这类本地工具）：
//   ai-share status                      服务健康与各集合概览
//   ai-share list <collection>           列出条目（id / 名称 / 启用状态）
//   ai-share get <col> <id|名称>          输出单条 JSON（本机接口含明文密钥，注意保管）
//   ai-share search <关键字> [collection] 跨集合搜索
//   ai-share profiles                    列出方案
//   ai-share plan <方案>                  预览将写入客户端的内容（不落盘）
//   ai-share apply <方案>                 把方案写入客户端配置
//   ai-share scan-secrets                扫描本地配置里的明文密钥
//   ai-share trash                       查看回收站
//   ai-share repair-secrets [--apply]    密钥多层加密体检 / 修复
//   ai-share env <端点>                   输出该端点的 shell export 片段
// 零依赖，Node >= 20。默认连 127.0.0.1:4737，可用 AI_SHARE_URL / PORT 覆盖。
const { spawn } = require('child_process');
const path = require('path');

const BASE = process.env.AI_SHARE_URL || ('http://127.0.0.1:' + (process.env.PORT || 4737));
const argv = process.argv.slice(2);
const JSON_MODE = argv.includes('-j') || argv.includes('--json');
const args = argv.filter((a) => a !== '-j' && a !== '--json');
const cmd = args[0] || 'help';
const rest = args.slice(1);

const COLS = ['providers', 'prompts', 'mcpservers', 'skillrepos', 'clients', 'profiles', 'repos'];
const titleOf = (it) => it.name || it.title || it.skillName || it.label || it.id;
const dim = (s) => (process.stdout.isTTY ? '\u001b[2m' + s + '\u001b[0m' : s);
const pad = (s, n) => (String(s).length > n ? String(s).slice(0, n - 1) + '…' : String(s).padEnd(n));

async function req(method, p, body) {
  const opts = { method, headers: { 'Content-Type': 'application/json' } };
  if (body !== undefined) opts.body = JSON.stringify(body);
  const res = await fetch(BASE + p, opts);
  let data = {};
  try { data = await res.json(); } catch (e) { data = {}; }
  if (!res.ok) { const e = new Error(data.error || ('HTTP ' + res.status)); e.status = res.status; throw e; }
  return data;
}

// 服务没起就拉起一次（与 mcp-bridge.js 的自愈逻辑一致），最多等 15 秒；
// AI_SHARE_NO_AUTOSTART=1 时禁用（测试 / 脚本场景避免误启动别的实例）
const NO_AUTOSTART = process.env.AI_SHARE_NO_AUTOSTART === '1';
async function ensureServer() {
  try { await req('GET', '/api/health'); return; } catch (e) { /* 未就绪 */ }
  if (NO_AUTOSTART) throw new Error('服务未就绪：' + BASE + '（已禁用自动拉起）');
  const start = path.join(__dirname, '..', 'start.sh');
  try {
    spawn('bash', [start, '-d'], { cwd: path.join(__dirname, '..'), stdio: 'ignore', detached: true }).unref();
  } catch (e) { /* 拉起失败则靠下面的重试报错 */ }
  for (let i = 0; i < 30; i++) {
    await new Promise((r) => setTimeout(r, 500));
    try { await req('GET', '/api/health'); return; } catch (e) { /* 再等 */ }
  }
  throw new Error('服务未就绪：' + BASE + '（可先手动执行 ./start.sh -d，或用 AI_SHARE_URL 指向其它实例）');
}

async function resolveProfile(nameOrId) {
  const profiles = await req('GET', '/api/profiles');
  const hit = profiles.find((p) => p.id === nameOrId)
    || profiles.find((p) => p.name === nameOrId)
    || profiles.find((p) => p.name.toLowerCase() === String(nameOrId).toLowerCase());
  if (!hit) throw new Error('找不到方案：' + nameOrId + '（可用 ai-share profiles 查看）');
  return hit;
}

async function resolveProvider(nameOrId) {
  const providers = await req('GET', '/api/providers');
  const k = String(nameOrId).toLowerCase();
  const hit = providers.find((p) => p.id === nameOrId)
    || providers.find((p) => p.name === nameOrId)
    || (() => { const m = providers.filter((p) => p.name.toLowerCase().includes(k)); return m.length === 1 ? m[0] : null; })();
  if (!hit) throw new Error('找不到端点：' + nameOrId + '（可用 ai-share list providers 查看）');
  return hit;
}

function planText(r) {
  const L = ['目标 ' + r.summary.targets + ' 个：新增 ' + r.summary.added + ' · 修改 ' + r.summary.changed
    + ' · 不变 ' + r.summary.unchanged + (r.summary.warnings ? (' · 警告 ' + r.summary.warnings) : ''), ''];
  for (const t of r.targets || []) {
    const st = { ok: '', 'new-file': dim('（新文件）'), 'invalid-json': dim('（非法 JSON，将跳过）'), 'no-path': dim('（未配置路径）') }[t.status] || '';
    L.push('● ' + t.clientName + ' · ' + (t.path || '（无路径）') + ' ' + st);
    for (const a of t.mcpServers.add) L.push('  + ' + a.name + '  ' + JSON.stringify(a.after));
    for (const c of t.mcpServers.change) L.push('  ~ ' + c.name + '  ' + JSON.stringify(c.before) + '  →  ' + JSON.stringify(c.after));
    for (const s of t.mcpServers.same) L.push('  = ' + s);
    for (const k of t.mcpServers.kept) L.push('  · 保留（方案外）' + k);
    for (const a of t.env.add) L.push('  + env.' + a.key + ' = ' + a.after);
    for (const c of t.env.change) L.push('  ~ env.' + c.key + ' = ' + c.before + ' → ' + c.after);
    L.push('');
  }
  L.push(dim('以上为计划预览，未写入任何文件；密钥已脱敏。'));
  return L.join('\n');
}

function secretScanText(r) {
  const L = ['扫描 ' + r.scanned + ' 个文件：疑似明文密钥 ' + r.summary.total + ' 处'
    + '（已收口 ' + r.summary.inVault + ' / 未登记 ' + r.summary.unknown + '），涉及 ' + r.summary.files + ' 个文件', ''];
  if (!r.summary.total) L.push('未发现明文密钥。');
  const shown = r.findings.slice(0, 60);
  for (const f of shown) {
    L.push('· ' + f.file + ':' + f.line + '  [' + f.name + ']  ' + f.masked
      + (f.inVault ? dim('（已收口）') : '（未登记）'));
  }
  if (r.findings.length > shown.length) L.push(dim('… 其余 ' + (r.findings.length - shown.length) + ' 条略，详见 /api/security/scan-secrets'));
  for (const s of r.skipped || []) L.push(dim('跳过 ' + s.file + '：' + s.reason));
  if (r.truncated) L.push(dim('（结果被截断：文件数或命中数达到上限）'));
  return L.join('\n');
}

const HELP = [
  'ai-share — 本地 AI 资源库的命令行入口',
  '',
  '用法： ai-share <命令> [参数]',
  '',
  '  status                        服务健康与各集合概览',
  '  list <collection>             列出条目（' + COLS.join(' / ') + '）',
  '  get <collection> <id|名称>     输出单条 JSON（含明文密钥，注意保管）',
  '  search <关键字> [collection]   跨集合搜索',
  '  profiles                      列出方案',
  '  plan <方案>                   预览将写入客户端的内容（不落盘）',
  '  apply <方案>                  把方案写入客户端配置',
  '  scan-secrets                  扫描本地配置里的明文密钥',
  '  trash                         查看回收站',
  '  repair-secrets [--apply]      密钥多层加密体检 / 修复',
  '  env <端点>                    输出该端点的 shell export 片段',
  '',
  '  -j / --json                   以 JSON 输出（便于脚本消费）',
  '  环境变量： AI_SHARE_URL / PORT 指定服务地址',
].join('\n');

async function main() {
  if (cmd === 'help' || cmd === '--help' || cmd === '-h') { console.log(HELP); return; }

  if (cmd === 'status') {
    await ensureServer();
    const [h, info, stats] = await Promise.all([req('GET', '/api/health'), req('GET', '/api/system/info'), req('GET', '/api/system/stats')]);
    if (JSON_MODE) return console.log(JSON.stringify({ health: h, info, stats }, null, 2));
    console.log('服务    ' + h.name + ' v' + h.version + '  运行 ' + Math.round(h.uptime) + 's  ' + BASE);
    console.log('数据目录 ' + info.dataDir);
    console.log('占用    ' + (stats.storageBytes / 1048576).toFixed(1) + ' MB · 快照 ' + ((stats.snapshots && stats.snapshots.length) || 0) + ' 份');
    for (const k of COLS) console.log('  ' + pad(k, 14) + (stats.counts[k] || 0) + ' 项');
    return;
  }

  if (cmd === 'list') {
    const col = rest[0];
    if (!COLS.includes(col)) throw new Error('集合必须是 ' + COLS.join(' / '));
    await ensureServer();
    const items = await req('GET', '/api/' + col);
    if (JSON_MODE) return console.log(JSON.stringify(items, null, 2));
    console.log(pad('id', 20) + pad('名称', 34) + dim('状态'));
    for (const it of items) {
      const st = ('enabled' in it) ? (it.enabled ? '启用' : '停用') : (it._deleted ? '已删除' : '');
      console.log(pad(it.id, 20) + pad(titleOf(it), 34) + dim(st));
    }
    console.log(dim('共 ' + items.length + ' 项'));
    return;
  }

  if (cmd === 'get') {
    const [col, key] = rest;
    if (!COLS.includes(col) || !key) throw new Error('用法： ai-share get <collection> <id|名称>');
    await ensureServer();
    let item = null;
    try { item = await req('GET', '/api/' + col + '/' + encodeURIComponent(key)); } catch (e) { /* 按名称再试 */ }
    if (!item || !item.id) {
      const items = await req('GET', '/api/' + col);
      const k = String(key).toLowerCase();
      const m = items.filter((x) => String(titleOf(x)).toLowerCase() === k);
      if (m.length !== 1) throw new Error(m.length ? '名称不唯一，请用 id' : '找不到记录：' + key);
      item = m[0];
    }
    console.log(JSON.stringify(item, null, 2));
    return;
  }

  if (cmd === 'search') {
    const [kw, col] = rest;
    if (!kw) throw new Error('用法： ai-share search <关键字> [collection]');
    await ensureServer();
    if (col) return console.log(JSON.stringify(await req('GET', '/api/' + col), null, 2));
    const out = [];
    for (const c of COLS) {
      let items = [];
      try { items = await req('GET', '/api/' + c); } catch (e) { continue; }
      const k = kw.toLowerCase();
      for (const it of items) {
        const hay = JSON.stringify(it).toLowerCase();
        if (hay.includes(k)) out.push({ collection: c, item: it });
      }
    }
    if (JSON_MODE) return console.log(JSON.stringify(out, null, 2));
    if (!out.length) return console.log(dim('无匹配'));
    for (const { collection, item } of out) console.log(pad(collection, 14) + pad(item.id, 18) + titleOf(item));
    console.log(dim('共 ' + out.length + ' 条'));
    return;
  }

  if (cmd === 'profiles') {
    await ensureServer();
    const profiles = await req('GET', '/api/profiles');
    if (JSON_MODE) return console.log(JSON.stringify(profiles, null, 2));
    for (const p of profiles) console.log(pad(p.id, 20) + pad(p.name, 30) + dim('mcp ' + (p.mcpServerIds || []).length + ' · 客户端 ' + (p.clientIds || []).length));
    console.log(dim('共 ' + profiles.length + ' 个方案'));
    return;
  }

  if (cmd === 'plan') {
    if (!rest[0]) throw new Error('用法： ai-share plan <方案>');
    await ensureServer();
    const p = await resolveProfile(rest[0]);
    const r = await req('POST', '/api/export/' + p.id + '/plan');
    if (JSON_MODE) return console.log(JSON.stringify(r, null, 2));
    console.log(planText(r));
    return;
  }

  if (cmd === 'apply') {
    if (!rest[0]) throw new Error('用法： ai-share apply <方案>');
    await ensureServer();
    const p = await resolveProfile(rest[0]);
    const r = await req('POST', '/api/export/' + p.id + '/apply');
    for (const x of r.results || []) console.log((x.ok ? '✓ ' : '✗ ') + (x.clientName || x.clientId) + '  ' + (x.path || x.error));
    if (!r.results || !r.results.length) console.log(dim('该方案未关联启用中的客户端'));
    return;
  }

  if (cmd === 'scan-secrets') {
    await ensureServer();
    const r = await req('POST', '/api/security/scan-secrets', {});
    if (JSON_MODE) return console.log(JSON.stringify(r, null, 2));
    console.log(secretScanText(r));
    return;
  }

  if (cmd === 'trash') {
    await ensureServer();
    const out = [];
    for (const c of COLS) {
      let items = [];
      try { items = await req('GET', '/api/' + c + '/deleted'); } catch (e) { continue; }
      for (const it of items) out.push({ collection: c, item: it });
    }
    if (JSON_MODE) return console.log(JSON.stringify(out, null, 2));
    if (!out.length) return console.log(dim('回收站为空'));
    for (const { collection, item } of out) console.log(pad(collection, 14) + pad(item.id, 18) + titleOf(item) + dim('  删除于 ' + item.updatedAt));
    console.log(dim('共 ' + out.length + ' 条（默认 30 天后自动清除）'));
    return;
  }

  if (cmd === 'repair-secrets') {
    const apply = rest.includes('--apply');
    await ensureServer();
    const r = await req('POST', '/api/maintenance/repair-secrets', { apply });
    if (JSON_MODE) return console.log(JSON.stringify(r, null, 2));
    const cols = Object.keys(r.report || {});
    if (!cols.length) return console.log('检查完成：未发现重复加密的密钥字段。');
    for (const c of cols) {
      const i = r.report[c];
      console.log((r.apply ? '已修复 ' : '发现 ') + c + '：' + i.fixed + ' 个字段'
        + (i.unfixable ? ('，' + i.unfixable + ' 个无法自动解开（已跳过）') : ''));
      for (const s of i.samples || []) console.log('   ' + s.id + ' 字段 ' + s.field + ' 套了 ' + s.layers + ' 层，当前 ' + (s.before / 1024).toFixed(1) + ' KB');
    }
    if (!r.apply) console.log(dim('以上仅为扫描结果（未改动任何数据）。加 --apply 执行修复，建议先做快照。'));
    return;
  }

  if (cmd === 'env') {
    if (!rest[0]) throw new Error('用法： ai-share env <端点>');
    await ensureServer();
    const p = await resolveProvider(rest[0]);
    if (JSON_MODE) return console.log(JSON.stringify({ baseUrl: p.baseUrl || '', apiKey: p.apiKey || '' }, null, 2));
    const L = [];
    if (p.baseUrl) L.push('export AI_BASE_URL="' + p.baseUrl + '"');
    if (p.apiKey) L.push('export AI_API_KEY="' + p.apiKey + '"');
    if (!L.length) return console.log(dim('该端点没有 baseUrl / apiKey'));
    console.log(L.join('\n'));
    console.log(dim('# 来源： ' + p.id + '（' + p.name + '）—— 密钥为明文，请勿提交到仓库'));
    return;
  }

  throw new Error('未知命令：' + cmd + '\n' + HELP);
}

main().then(() => process.exit(0)).catch((e) => {
  console.error('错误： ' + (e && e.message));
  process.exit(1);
});
