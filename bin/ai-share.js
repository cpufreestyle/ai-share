#!/usr/bin/env node
'use strict';
// ai-share 命令行（命令习惯参照 llm / aichat / kubectx 这类本地工具）：
//   ai-share status                      服务健康与各集合概览
//   ai-share list <collection>           列出条目（id / 名称 / 启用状态）
//   ai-share get <col> <id|名称>          输出单条 JSON（本机接口含明文密钥，注意保管）
//   ai-share search <关键字> [col] [--semantic] 跨集合搜索（可选向量语义搜索）
//   ai-share related <col> <id|名称>       查找相似资源（语义搜索）
//   ai-share profiles                    列出方案
//   ai-share plan <方案>                  预览将写入客户端的内容（不落盘）
//   ai-share apply <方案>                 把方案写入客户端配置
//   ai-share scan-secrets                扫描本地配置里的明文密钥
//   ai-share test [id|名称] [--all]       测试端点或 MCP 工具连通性与延迟
//   ai-share snapshot [list]             创建或查看本地安全快照
//   ai-share trash                       查看回收站
//   ai-share health [staleDays]          资源健康度报告（缺失/重复/陈旧/回收站积压）
//   ai-share markdown [> out.md]         输出全部资源的 Markdown 索引
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
  '  search <关键字> [collection]   跨集合搜索（加 --semantic 启用向量语义搜索）',
  '  profiles                      列出方案',
  '  plan <方案>                   预览将写入客户端的内容（不落盘）',
  '  apply <方案>                  把方案写入客户端配置',
  '  scan-secrets                  扫描本地配置里的明文密钥',
  '  test [id|名称] [--all]        测试端点 (Provider) 或工具 (MCP) 连通性',
  '  snapshot [list]               创建或查看全库安全快照',
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
    const semantic = rest.includes('--semantic') || rest.includes('-s');
    const pos = rest.filter((a) => a !== '--semantic' && a !== '-s');
    const [kw, col] = pos;
    if (!kw) throw new Error('用法： ai-share search <关键字> [collection] [--semantic]');
    if (col && !COLS.includes(col)) throw new Error('集合必须是 ' + COLS.join(' / '));
    await ensureServer();
    const endpoint = '/api/system/semantic-search?q=' + encodeURIComponent(kw) + (col ? ('&col=' + encodeURIComponent(col)) : '');
    let r = await req('GET', endpoint + (semantic ? '&semantic=1' : '&semantic=0'));
    if (semantic && r.warning) {
      if (!JSON_MODE) console.log(dim(r.warning + '，已自动回退到普通文本搜索'));
      r = await req('GET', endpoint + '&semantic=0');
    }
    const out = r.items || [];
    if (JSON_MODE) return console.log(JSON.stringify(out, null, 2));
    if (!out.length) return console.log(dim('无匹配'));
    for (const { collection: c, item, score } of out) {
      const scoreStr = (semantic && score) ? dim(' (相似度 ' + (score * 100).toFixed(0) + '%)') : '';
      console.log(pad(c, 14) + pad(item.id, 18) + titleOf(item) + scoreStr);
    }
    console.log(dim('共 ' + out.length + ' 条'));
    return;
  }

  if (cmd === 'related') {
    const [col, key] = rest;
    if (!COLS.includes(col) || !key) throw new Error('用法： ai-share related <collection> <id|名称>');
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
    const r = await req('GET', '/api/system/semantic-search?q=' + encodeURIComponent(titleOf(item)) + '&col=' + col + '&semantic=1');
    const out = (r.items || []).filter(x => x.item && x.item.id !== item.id).slice(0, 10);
    if (JSON_MODE) return console.log(JSON.stringify(out, null, 2));
    if (!out.length) return console.log(dim('无相似资源'));
    for (const x of out) console.log(pad(x.collection, 14) + pad(x.item.id, 18) + titleOf(x.item));
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

  if (cmd === 'health') {
    await ensureServer();
    const days = parseInt(rest[0], 10);
    const q = Number.isFinite(days) ? ('?staleDays=' + days) : '';
    const r = await req('GET', '/api/system/health-report' + q);
    if (JSON_MODE) return console.log(JSON.stringify(r, null, 2));
    const icon = (k) => ({ 'missing-field': '⚠ 缺字段', 'duplicate': '⧉ 重复', 'stale': '◷ 陈旧', 'tombstones': '♻ 回收站' }[k] || k);
    console.log('健康分 ' + r.score + '/100 · ' + r.summary);
    for (const i of r.issues) console.log('  [' + icon(i.kind) + '] ' + pad(i.collection, 12) + ' ' + pad(i.name, 24) + ' ' + dim(i.detail));
    if (!r.issues.length) console.log(dim('未发现问题'));
    return;
  }

  if (cmd === 'markdown') {
    await ensureServer();
    const res = await fetch(BASE + '/api/export/markdown', { headers: { 'Accept': 'text/markdown' } });
    const md = await res.text();
    process.stdout.write(md);
    if (process.stdout.isTTY) console.log(dim('\n# 提示：重定向保存，如  ai-share markdown > ai-index.md'));
    return;
  }

  if (cmd === 'test') {
    const all = rest.includes('--all') || (!rest.length);
    const target = rest.find((a) => a !== '--all');
    await ensureServer();

    if (all && !target) {
      const [providers, mcps] = await Promise.all([req('GET', '/api/providers'), req('GET', '/api/mcpservers')]);
      const results = { providers: [], mcpservers: [] };
      if (!JSON_MODE) console.log('● 端点 (Providers)');
      for (const p of providers) {
        let r;
        try { r = await req('POST', '/api/providers/' + p.id + '/test'); } catch (e) { r = { ok: false, error: e.message }; }
        results.providers.push({ id: p.id, name: p.name, result: r });
        if (!JSON_MODE) {
          const mark = r.ok ? '✓ ' : '✗ ';
          const detail = r.ok ? ((r.status || 'OK') + ' (' + r.ms + 'ms' + (r.modelCount != null ? ', ' + r.modelCount + ' models' : '') + ')') : (r.error || '失败');
          console.log('  ' + mark + pad(titleOf(p), 24) + pad(p.id, 16) + dim(detail));
        }
      }
      if (!providers.length && !JSON_MODE) console.log(dim('  无端点'));

      if (!JSON_MODE) console.log('\n● 工具 (MCP Servers)');
      for (const m of mcps) {
        let r;
        try { r = await req('POST', '/api/mcpservers/' + m.id + '/check'); } catch (e) { r = { ok: false, error: e.message }; }
        results.mcpservers.push({ id: m.id, name: m.name, result: r });
        if (!JSON_MODE) {
          const mark = r.ok ? '✓ ' : '✗ ';
          let detail = '';
          if (r.ok) {
            detail = r.kind === 'stdio' ? (r.exists ? '命令就绪' : '命令待安装') : ('可达 (' + (r.ms ? r.ms + 'ms, ' : '') + 'HTTP ' + (r.status || 200) + (r.serverInfo ? ', ' + (r.serverInfo.name || 'mcp') + (r.serverInfo.version ? ' v' + r.serverInfo.version : '') : '') + ')');
          } else {
            detail = r.error || '不可达';
          }
          console.log('  ' + mark + pad(titleOf(m), 24) + pad(m.id, 16) + dim(detail));
        }
      }
      if (!mcps.length && !JSON_MODE) console.log(dim('  无工具'));
      if (JSON_MODE) return console.log(JSON.stringify(results, null, 2));
      return;
    }

    if (!target) throw new Error('用法： ai-share test <id|名称> 或 ai-share test --all');

    const providers = await req('GET', '/api/providers');
    const tk = String(target).toLowerCase();
    const pHit = providers.find((p) => p.id === target)
      || providers.find((p) => p.name === target)
      || (() => { const m = providers.filter((p) => (p.name || '').toLowerCase().includes(tk)); return m.length === 1 ? m[0] : null; })();

    if (pHit) {
      const r = await req('POST', '/api/providers/' + pHit.id + '/test');
      if (JSON_MODE) return console.log(JSON.stringify({ target: pHit, result: r }, null, 2));
      if (r.ok) {
        console.log('✓ [Provider] ' + titleOf(pHit) + ' (' + pHit.id + ') · ' + (r.status || 'OK') + ' (' + r.ms + 'ms)' + (r.modelCount != null ? ' · ' + r.modelCount + ' models' : ''));
        if (r.url) console.log(dim('  端点：' + r.url));
      } else {
        console.log('✗ [Provider] ' + titleOf(pHit) + ' (' + pHit.id + ') · 失败：' + (r.error || '不可达'));
      }
      return;
    }

    const mcps = await req('GET', '/api/mcpservers');
    const mHit = mcps.find((m) => m.id === target)
      || mcps.find((m) => m.name === target)
      || (() => { const m = mcps.filter((x) => (x.name || '').toLowerCase().includes(tk)); return m.length === 1 ? m[0] : null; })();

    if (mHit) {
      const r = await req('POST', '/api/mcpservers/' + mHit.id + '/check');
      if (JSON_MODE) return console.log(JSON.stringify({ target: mHit, result: r }, null, 2));
      if (r.ok) {
        const detail = r.kind === 'stdio' ? (r.exists ? '命令就绪' : '命令待安装') : ('可达 (' + (r.ms ? r.ms + 'ms, ' : '') + 'HTTP ' + (r.status || 200) + (r.serverInfo ? ', ' + (r.serverInfo.name || 'mcp') + (r.serverInfo.version ? ' v' + r.serverInfo.version : '') : '') + ')');
        console.log('✓ [MCP] ' + titleOf(mHit) + ' (' + mHit.id + ') · ' + detail);
        if (r.command) console.log(dim('  命令：' + r.command));
        if (r.url) console.log(dim('  URL：' + r.url));
      } else {
        console.log('✗ [MCP] ' + titleOf(mHit) + ' (' + mHit.id + ') · 失败：' + (r.error || '不可达'));
      }
      return;
    }

    throw new Error('找不到可测试的端点或 MCP 服务：' + target + '（可用 ai-share list providers 或 mcpservers 查看）');
  }

  if (cmd === 'snapshot') {
    const sub = rest[0];
    await ensureServer();
    if (sub === 'list' || sub === '-l' || sub === '--list') {
      const r = await req('GET', '/api/backup/snapshots');
      const list = r.snapshots || [];
      if (JSON_MODE) return console.log(JSON.stringify(list, null, 2));
      if (!list.length) return console.log(dim('暂无快照'));
      console.log(pad('快照名', 32) + pad('大小', 12) + pad('创建时间', 22) + dim('包含'));
      for (const s of list) {
        const sz = (s.size / 1024).toFixed(1) + ' KB';
        const st = s.corrupt ? ' [损坏]' : '';
        const timeStr = s.takenAt ? s.takenAt.replace('T', ' ').slice(0, 19) : '-';
        console.log(pad(s.name, 32) + pad(sz, 12) + pad(timeStr, 22) + dim(s.count + ' 项' + st));
      }
      console.log(dim('共 ' + list.length + ' 份快照'));
      return;
    }
    const r = await req('POST', '/api/backup/snapshot', {});
    if (JSON_MODE) return console.log(JSON.stringify(r, null, 2));
    const s = r.snapshot || {};
    console.log('✓ 快照已创建：' + s.name + ' (' + (s.size / 1024).toFixed(1) + ' KB · ' + s.count + ' 项资源)');
    if (r.dir) console.log(dim('  路径：' + r.dir));
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
