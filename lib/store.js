'use strict';
const fs = require('fs');
const path = require('path');
const { encrypt, decrypt } = require('./crypto');
const { scanClientMcp, detectClients, scanClientSkills, scanClientPrompts } = require('./export');

// 应用根目录：源码模式下为资源根（lib 上两级）；pkg 打包后 exe 所在目录
const APP_ROOT = process.pkg
  ? path.dirname(process.execPath)
  : path.join(__dirname, '..', '..');

// 数据目录：默认指向资源根 d:\ai share\data，
// 可用环境变量 AI_SHARE_DATA_DIR 覆盖（主要用于隔离测试）
const DATA_DIR = process.env.AI_SHARE_DATA_DIR
  ? path.resolve(process.env.AI_SHARE_DATA_DIR)
  : path.join(APP_ROOT, 'data');
const COLLECTIONS = ['providers', 'prompts', 'mcpservers', 'skillrepos', 'clients', 'profiles', 'repos'];

// 需要加密落地的字段
const SECRET_FIELDS = { providers: ['apiKey'] };

function ensureDir() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
}
function fileFor(col) { return path.join(DATA_DIR, col + '.json'); }
function genId() { return Date.now().toString(36) + Math.random().toString(36).slice(2, 8); }

function seal(item, col) {
  const fields = SECRET_FIELDS[col];
  if (!fields || !item) return item;
  const out = Object.assign({}, item);
  for (const f of fields) {
    if (out[f] != null && out[f] !== '') out[f] = encrypt(out[f]);
  }
  return out;
}
function unseal(item, col) {
  const fields = SECRET_FIELDS[col];
  if (!fields || !item) return item;
  const out = Object.assign({}, item);
  for (const f of fields) {
    if (out[f] != null && out[f] !== '') out[f] = decrypt(out[f]);
  }
  return out;
}

function readRaw(col) {
  ensureDir();
  const f = fileFor(col);
  if (!fs.existsSync(f)) fs.writeFileSync(f, JSON.stringify(seed(col), null, 2));
  return JSON.parse(fs.readFileSync(f, 'utf8'));
}
function writeRaw(col, data) {
  ensureDir();
  fs.writeFileSync(fileFor(col), JSON.stringify(data.map(x => seal(x, col)), null, 2));
}

// 对外一律隐藏墓碑记录（_deleted），仅同步模块通过 listRaw 读取完整数据
function list(col) { return readRaw(col).filter(x => !x._deleted).map(x => unseal(x, col)); }
function get(col, id) {
  const x = readRaw(col).find(y => y.id === id);
  return x && !x._deleted ? unseal(x, col) : null;
}
// 含墓碑的原始列表：供双向同步比对使用
function listRaw(col) { return readRaw(col).map(x => unseal(x, col)); }

function create(col, item) {
  const data = readRaw(col);
  const now = new Date().toISOString();
  const rec = Object.assign({ createdAt: now }, item);
  if (!rec.id) rec.id = genId(); // 保留调用方传入的 id（如方案包导入），仅缺失时生成
  // updatedAt 是双向同步 LWW（新者胜）的判定依据；调用方显式传入时以其为准（用于同步落地远端记录）
  if (!rec.updatedAt) rec.updatedAt = now;
  data.push(rec);
  writeRaw(col, data);
  return unseal(rec, col);
}

function update(col, id, patch) {
  const data = readRaw(col);
  const i = data.findIndex(x => x.id === id);
  if (i < 0) return null;
  const stamp = patch && patch.updatedAt ? {} : { updatedAt: new Date().toISOString() };
  data[i] = Object.assign({}, data[i], patch, stamp, { id });
  writeRaw(col, data);
  return unseal(data[i], col);
}

// 删除：默认留下「墓碑」（_deleted 标记），使删除操作能跨端传播。
// 否则同步时对端会把本地已删除的记录当作「本地缺失」重新推回来。
function remove(col, id, opts) {
  const hard = opts && opts.hard;
  const data = readRaw(col);
  const i = data.findIndex(x => x.id === id);
  if (i < 0) return { ok: true, removed: 0 };
  if (hard) {
    writeRaw(col, data.filter(x => x.id !== id));
    return { ok: true, removed: 1 };
  }
  // 墓碑只保留同步所需的最小字段，避免残留密钥等敏感内容
  data[i] = { id, _deleted: true, updatedAt: new Date().toISOString() };
  writeRaw(col, data);
  return { ok: true, removed: 1 };
}

// 直接以明文数组重写某集合（配合主密码切换时的重加密使用）
function rewrite(col, items) { writeRaw(col, items); }

// 方案级单文件：打包该方案引用的全部资源，便于分享/迁移
function exportProfileBundle(id) {
  const p = get('profiles', id);
  if (!p) return null;
  const pick = (col, ids) => list(col).filter(x => (ids || []).includes(x.id));
  return {
    version: 1, kind: 'profile-bundle',
    profile: p,
    providers: pick('providers', p.providerId ? [p.providerId] : []),
    prompts: pick('prompts', p.promptIds),
    mcpservers: pick('mcpservers', p.mcpServerIds),
    skillrepos: pick('skillrepos', p.skillRepoIds),
    clients: pick('clients', p.clientIds),
  };
}

// 导入方案包：资源按 id 合并（已存在则更新），方案新建（避免重复）
function importProfileBundle(bundle) {
  const upsert = (col, items) => (items || []).forEach(x => {
    const ex = get(col, x.id);
    if (ex) update(col, x.id, x); else create(col, x);
  });
  upsert('providers', bundle.providers);
  upsert('prompts', bundle.prompts);
  upsert('mcpservers', bundle.mcpservers);
  upsert('skillrepos', bundle.skillrepos);
  upsert('clients', bundle.clients);
  const p = Object.assign({}, bundle.profile);
  delete p.id; delete p.createdAt;
  const np = create('profiles', p);
  return { ok: true, profileId: np.id };
}

// 从客户端扫描导入 MCP 服务器：按名称合并（已存在同名则更新，否则新建），返回新增/更新清单
function importScannedServers(servers) {
  const existing = list('mcpservers');
  const byName = {};
  existing.forEach(x => { byName[x.name] = x; });
  const results = [];
  for (const s of servers || []) {
    const norm = { name: s.name, type: s.type, enabled: true, command: s.command || '', args: s.args || [], env: s.env || {}, url: s.url || '', headers: s.headers || {} };
    const ex = byName[norm.name];
    if (ex) { update('mcpservers', ex.id, norm); results.push({ name: norm.name, status: 'updated' }); }
    else { create('mcpservers', norm); results.push({ name: norm.name, status: 'created' }); }
  }
  return { ok: true, results };
}

// 从客户端扫描导入 Skill：优先按内容指纹去重（同一内容跨路径只登记一次），回退按路径合并
function importScannedSkills(skills) {
  const existing = list('skillrepos');
  const byHash = {}, byPath = {};
  existing.forEach(x => { if (x.hash) byHash[x.hash] = x; if (x.path) byPath[x.path] = x; });
  const results = [];
  for (const s of skills || []) {
    const norm = { name: s.name, type: 'local', enabled: true, url: '', path: s.path, description: s.description || '', hash: s.hash };
    const ex = (s.hash && byHash[s.hash]) || byPath[s.path];
    if (ex) { update('skillrepos', ex.id, norm); results.push({ name: norm.name, status: 'updated' }); }
    else { create('skillrepos', norm); results.push({ name: norm.name, status: 'created' }); }
  }
  return { ok: true, results };
}

// 从客户端扫描导入提示词/规则：优先按内容指纹去重（同一内容跨路径只登记一次），回退按路径合并
function importScannedPrompts(prompts) {
  const existing = list('prompts');
  const byHash = {}, byPath = {};
  existing.forEach(x => { if (x.hash) byHash[x.hash] = x; if (x.path) byPath[x.path] = x; });
  const results = [];
  for (const p of prompts || []) {
    const norm = { name: p.name, category: p.category || '来源', content: p.content, tags: Array.isArray(p.tags) ? p.tags : [p.clientType], path: p.path, hash: p.hash };
    const ex = (p.hash && byHash[p.hash]) || byPath[p.path];
    if (ex) {
      const tags = Array.from(new Set([...(ex.tags || []), ...norm.tags]));
      // 保留用户手动改过的分类：已有分类非空则沿用，否则采用扫描到的分类
      const category = (ex.category !== undefined && ex.category !== '') ? ex.category : norm.category;
      update('prompts', ex.id, { name: norm.name, category, content: norm.content, tags, path: norm.path, hash: norm.hash });
      results.push({ name: norm.name, status: 'updated' });
    } else {
      create('prompts', norm);
      results.push({ name: norm.name, status: 'created' });
    }
  }
  return { ok: true, results };
}

// 一键自动采集：遍历本机所有已识别客户端，登记客户端并导入其 MCP 服务器、Skill 与提示词（分别按名称/路径合并）
function collectFromClients() {
  const dets = detectClients();
  const clients = [];
  // 仅加载一次客户端列表，传给各扫描函数，避免重复读盘
  const clientsList = list('clients');
  let totalCreated = 0, totalUpdated = 0;
  let totalSCreated = 0, totalSUpdated = 0;
  let totalPCreated = 0, totalPUpdated = 0;
  for (const d of dets) {
    if (!d.installed && !d.exists) { clients.push({ type: d.type, name: d.name, found: false }); continue; }
    const byType = {};
    clientsList.forEach(x => { byType[x.type] = x; });
    if (!byType[d.type]) { create('clients', { name: d.name, type: d.type, enabled: true, configPath: d.configPath, description: '' }); clientsList.push(byType[d.type] = list('clients').find(c => c.type === d.type)); }

    const scanned = scanClientMcp(d.type);
    const servers = scanned ? scanned.servers : [];
    let created = 0, updated = 0;
    if (servers.length) {
      const imp = importScannedServers(servers);
      created = imp.results.filter(r => r.status === 'created').length;
      updated = imp.results.filter(r => r.status === 'updated').length;
      totalCreated += created; totalUpdated += updated;
    }

    const scannedS = scanClientSkills(d.type, clientsList);
    const skills = scannedS ? scannedS.skills : [];
    let sCreated = 0, sUpdated = 0;
    if (skills.length) {
      const impS = importScannedSkills(skills);
      sCreated = impS.results.filter(r => r.status === 'created').length;
      sUpdated = impS.results.filter(r => r.status === 'updated').length;
      totalSCreated += sCreated; totalSUpdated += sUpdated;
    }

    const scannedP = scanClientPrompts(d.type, clientsList);
    const prompts = scannedP ? scannedP.prompts : [];
    let pCreated = 0, pUpdated = 0;
    if (prompts.length) {
      const impP = importScannedPrompts(prompts);
      pCreated = impP.results.filter(r => r.status === 'created').length;
      pUpdated = impP.results.filter(r => r.status === 'updated').length;
      totalPCreated += pCreated; totalPUpdated += pUpdated;
    }

    clients.push({ type: d.type, name: d.name, found: true, installed: d.installed, exists: d.exists, mcpCount: servers.length, created, updated, skillCount: skills.length, sCreated, sUpdated, promptCount: prompts.length, pCreated, pUpdated });
  }
  return { ok: true, clients, totalCreated, totalUpdated, totalSCreated, totalSUpdated, totalPCreated, totalPUpdated };
}

// 备份导出（明文，便于迁移）；导入时再重新加密
function exportAll() {
  const out = { version: 1, collections: {} };
  for (const c of COLLECTIONS) out.collections[c] = list(c);
  return out;
}
function restoreAll(payload, mode) {
  const collections = payload.collections || payload;
  for (const c of COLLECTIONS) {
    const incoming = collections[c] || [];
    if (mode === 'replace') {
      writeRaw(c, incoming.map(x => seal(x, c))); // 统一加密落地，避免明文密钥写入磁盘
    } else {
      const map = {};
      readRaw(c).forEach(x => { map[x.id] = x; });
      incoming.forEach(x => { map[x.id] = seal(x, c); });
      writeRaw(c, Object.values(map));
    }
  }
  return { ok: true };
}

function seed(col) {
  switch (col) {
    case 'providers':
      return [
        { id: 'p_openai', name: 'OpenAI', baseUrl: 'https://api.openai.com/v1', apiKey: '', models: ['gpt-4o', 'gpt-4o-mini'], notes: '官方 API' },
        { id: 'p_anthropic', name: 'Anthropic', baseUrl: 'https://api.anthropic.com', apiKey: '', models: ['claude-opus-4', 'claude-sonnet-4'], notes: '官方 API' },
        { id: 'p_ollama', name: 'Ollama (本地)', baseUrl: 'http://localhost:11434/v1', apiKey: 'ollama', models: ['qwen2.5', 'llama3.1'], notes: '本地模型，免密钥' }
      ];
    case 'prompts':
      return [
        { id: 'pr_translator', name: '翻译专家', category: '角色', content: '你是一名专业的翻译专家，负责在中文与英文之间准确互译，保持术语一致与语气自然。', tags: ['翻译'] },
        { id: 'pr_coder', name: '代码评审', category: '工程', content: '你是一名资深工程师，请对下面的代码进行评审，指出潜在 bug、性能与可读性问题，并给出修改建议。', tags: ['代码', 'review'] },
        { id: 'pr_summarizer', name: '文档摘要', category: '通用', content: '请用简洁的要点总结下面文档的核心内容，不超过 5 条。', tags: ['摘要'] }
      ];
    case 'mcpservers':
      return [
        { id: 'm_filesystem', name: 'filesystem', type: 'stdio', enabled: true, command: 'npx', args: ['-y', '@modelcontextprotocol/server-filesystem', 'd:/ai share'], env: {}, url: '', headers: {} },
        { id: 'm_fetch', name: 'fetch', type: 'stdio', enabled: true, command: 'uvx', args: ['mcp-server-fetch'], env: {}, url: '', headers: {} },
        { id: 'm_remote', name: 'remote-demo', type: 'sse', enabled: false, command: '', args: [], env: {}, url: 'http://localhost:8000/sse', headers: {} }
      ];
    case 'skillrepos':
      return [
        { id: 's_default', name: 'CodeBuddy Skills', type: 'git', url: 'https://github.com/tencent-ai/codebuddy-skills', path: '', description: '官方技能仓库' },
        { id: 's_local', name: '本地技能库', type: 'local', url: '', path: 'd:/ai share/skills', description: '本机维护的 skill 目录' }
      ];
    case 'clients':
      return [
        { id: 'c_claude', name: 'Claude Desktop', type: 'claude', enabled: true, configPath: '{APPDATA}/Claude/claude_desktop_config.json', description: 'Anthropic 桌面客户端' },
        { id: 'c_cursor', name: 'Cursor', type: 'cursor', enabled: true, configPath: '{USERPROFILE}/.cursor/mcp.json', description: 'AI 编辑器' },
        { id: 'c_vscode', name: 'VS Code', type: 'vscode', enabled: true, configPath: '{USERPROFILE}/.vscode/mcp.json', description: '项目级 .vscode/mcp.json' },
        { id: 'c_codebuddy', name: 'CodeBuddy', type: 'codebuddy', enabled: false, configPath: '{APPDATA}/CodeBuddy/mcp.json', description: '腾讯 AI 编程助手（路径可在 UI 中调整）' }
      ];
    case 'repos':
      // repos 主要登记“生成的软件项目目录”（本地目录），位于 d:\ai share\repo\ 下。
      // 每个生成的软件项目可能同时包含 Skill/MCP/提示词，因此 resourceType 改为多选数组，
      // 同步时按各类型分别扫描并导入到对应集合（skillrepos / mcpservers / prompts）。
      // git 远程仓库为可选补充。Skill 来源本身仍由 skillrepos 管理，避免重复登记。
      return [
        { id: 'r_repo_default', name: '生成的软件项目', type: 'local', url: '', path: 'd:/ai share/repo', resourceType: ['skillrepos', 'mcpservers', 'prompts'], enabled: true, description: '生成的软件项目目录（d:\\ai share\\repo\\），同步其中的 Skill/MCP/提示词' },
        { id: 'r_remote_optional', name: '远程仓库（可选）', type: 'git', url: 'https://github.com/modelcontextprotocol/servers.git', path: '', resourceType: ['mcpservers'], enabled: false, description: '可选的远程 git 仓库，仅作为补充来源（默认禁用）' }
      ];
    case 'profiles':
      return [
        { id: 'pf_default', name: '默认工作区', providerId: 'p_ollama', promptIds: ['pr_coder', 'pr_summarizer'], mcpServerIds: ['m_filesystem', 'm_fetch'], clientIds: ['c_claude', 'c_cursor'], skillRepoIds: ['s_default'], injectEnv: false }
      ];
    default:
      return [];
  }
}

module.exports = { COLLECTIONS, DATA_DIR, list, listRaw, get, create, update, remove, rewrite, exportAll, restoreAll, exportProfileBundle, importProfileBundle, importScannedServers, importScannedSkills, importScannedPrompts, collectFromClients };
