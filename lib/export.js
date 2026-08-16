'use strict';
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { execFileSync } = require('child_process');
// 注意：store 与 export 存在相互依赖，这里改为在函数内惰性 require，避免顶层循环依赖导致 list/get 为 undefined

// 单文件大小上限（1MB），超过则跳过，避免误放大文件导致卡顿
const MAX_FILE = 1024 * 1024;
// 扫描提示词时的默认分类（未显式指定时回退）
const DEFAULT_CATEGORY = '来源';
// 仓库扫描时忽略的目录：依赖与构建产物不应被同步收口（如 repo/ 下生成项目的 node_modules）
const IGNORE_DIRS = new Set(['node_modules', '.git', 'dist', 'build', '.venv', 'venv', '__pycache__', '.next', 'out', 'target', 'bin', 'obj']);
function isIgnoredDir(name) { return IGNORE_DIRS.has(name); }
// 内容指纹：用于跨路径去重（同一内容出现在不同客户端/路径只登记一次）
function hashOf(text) { return crypto.createHash('sha256').update(String(text)).digest('hex').slice(0, 16); }

// 读取代理地址：优先环境变量，其次 data/proxy.json 中的 { "url": "http://127.0.0.1:7897" }
// 返回空字符串表示不使用代理（直连）
function getProxyUrl() {
  const candidates = [
    process.env.AI_SHARE_PROXY,
    process.env.HTTPS_PROXY, process.env.https_proxy,
    process.env.HTTP_PROXY, process.env.http_proxy,
  ];
  for (const c of candidates) {
    // 仅接受形如 scheme://host 的地址；空串/空白/残缺值一律忽略，避免覆盖有效配置
    const v = String(c || '').trim();
    if (v && /^[a-z0-9.+-]+:\/\/[^/\s]+/i.test(v)) return v;
  }
  try {
    const store = require('./store');
    const cfgFile = path.join(store.DATA_DIR, 'proxy.json');
    if (fs.existsSync(cfgFile)) {
      const cfg = JSON.parse(fs.readFileSync(cfgFile, 'utf8'));
      if (cfg && cfg.enabled !== false && cfg.url) return String(cfg.url).trim();
    }
  } catch (_) { /* 配置损坏时静默降级为直连 */ }
  return '';
}

// 构造 git 命令参数：以 -c 形式临时注入代理，不写入用户全局 git 配置
function gitArgsWithProxy(args) {
  const proxy = getProxyUrl();
  if (!proxy) return args;
  return ['-c', 'http.proxy=' + proxy, '-c', 'https.proxy=' + proxy].concat(args);
}

// 构造 git 子进程环境变量。
// 关键：父进程中若存在空值或过期的 *_PROXY 变量，会覆盖上面 -c 注入的代理，
// 导致 "schannel: failed to receive handshake" 之类的握手失败，因此统一剔除，
// 代理一律以 -c 参数为准。
function gitEnv() {
  const env = Object.assign({}, process.env);
  for (const k of ['HTTP_PROXY', 'HTTPS_PROXY', 'http_proxy', 'https_proxy', 'ALL_PROXY', 'all_proxy']) {
    delete env[k];
  }
  return env;
}

// 将选中的 MCP 服务器转换为各客户端通用格式
function buildMcpServers(servers) {
  const out = {};
  for (const s of servers) {
    if (!s.enabled) continue;
    if (s.type === 'stdio') {
      const entry = { command: s.command };
      if (Array.isArray(s.args) && s.args.length) entry.args = s.args;
      const env = s.env || {};
      if (env && Object.keys(env).length) entry.env = env;
      out[s.name] = entry;
    } else {
      out[s.name] = {
        type: s.type === 'http' ? 'http' : 'sse',
        url: s.url
      };
      const headers = s.headers || {};
      if (headers && Object.keys(headers).length) out[s.name].headers = headers;
    }
  }
  return out;
}

// 生成某个 profile 针对所有启用客户端的导出配置
function exportProfile(profileId) {
  const { list, get } = require('./store');
  const profile = get('profiles', profileId);
  if (!profile) return null;

  const allServers = list('mcpservers');
  const allPrompts = list('prompts');
  const allSkills = list('skillrepos');
  const allClients = list('clients');
  const provider = profile.providerId ? get('providers', profile.providerId) : null;

  const servers = allServers.filter(s => (profile.mcpServerIds || []).includes(s.id));
  const prompts = allPrompts.filter(p => (profile.promptIds || []).includes(p.id));
  const skills = allSkills.filter(s => (profile.skillRepoIds || []).includes(s.id));
  const mcpBlock = buildMcpServers(servers);

  const configs = [];
  for (const c of allClients) {
    if (!c.enabled) continue;
    if (profile.clientIds && profile.clientIds.length && !profile.clientIds.includes(c.id)) continue;

    const content = { mcpServers: Object.assign({}, mcpBlock) };
    const env = {};
    if (profile.injectEnv && provider) {
      if (provider.baseUrl) env.AI_BASE_URL = provider.baseUrl;
      if (provider.apiKey) env.AI_API_KEY = provider.apiKey;
    }
    if (Object.keys(env).length) content.env = env;

    configs.push({
      clientId: c.id,
      clientName: c.name,
      clientType: c.type,
      configPath: expand(c.configPath),
      rawConfigPath: c.configPath,
      format: 'mcp.json',
      content
    });
  }

  return {
    profile,
    provider,
    prompts,
    skills,
    mcpServers: servers,
    configs
  };
}

// 将生成的配置写入客户端配置文件（合并保留已有 mcpServers）
function applyExport(profileId) {
  const data = exportProfile(profileId);
  if (!data) return { ok: false, error: 'profile 不存在' };
  const results = [];
  for (const cfg of data.configs) {
    try {
      const target = cfg.configPath;
      if (!target) { results.push({ clientId: cfg.clientId, ok: false, error: '未配置 configPath' }); continue; }
      fs.mkdirSync(path.dirname(target), { recursive: true });
      let existing = {};
      if (fs.existsSync(target)) {
        try { existing = JSON.parse(fs.readFileSync(target, 'utf8')); } catch (e) { existing = {}; }
      }
      existing.mcpServers = Object.assign({}, existing.mcpServers || {}, cfg.content.mcpServers);
      if (cfg.content.env) existing.env = Object.assign({}, existing.env || {}, cfg.content.env);
      fs.writeFileSync(target, JSON.stringify(existing, null, 2));
      results.push({ clientId: cfg.clientId, clientName: cfg.clientName, ok: true, path: target });
    } catch (e) {
      results.push({ clientId: cfg.clientId, clientName: cfg.clientName, ok: false, error: e.message });
    }
  }
  return { ok: true, results, data };
}

// 客户端定义（路径模板使用占位符，运行时展开为真实路径）
// 占位符在非 Windows 平台会映射到各平台约定目录（见 getRoots），
// 因此 configs / skills / prompts 的模板大多跨平台通用；exes 补充了
// macOS 的 /Applications 与 Linux 的常见安装位置用于「已安装」探测。
// prompts 来源描述：{ file: '<文件模板>', name?, category? } 或 { dir: '<目录模板>', exts?, category? }
const CLIENT_DEFS = [
  { type: 'claude', name: 'Claude Desktop',
    configs: ['{APPDATA}/Claude/claude_desktop_config.json'],
    exes: ['{LOCALAPPDATA}/AnthropicClaude/claude.exe', '{LOCALAPPDATA}/AnthropicClaude/claude.cmd', '/Applications/Claude.app'],
    skills: ['{USERPROFILE}/.claude/skills'],
    prompts: [
      { file: '{USERPROFILE}/.claude/CLAUDE.md', name: 'Claude 全局指令', category: '角色' },
      { dir: '{USERPROFILE}/.claude/rules', exts: ['.md', '.txt'], category: '规则' },
    ] },
  { type: 'cursor', name: 'Cursor',
    configs: ['{USERPROFILE}/.cursor/mcp.json', '{APPDATA}/Cursor/User/globalStorage/mcp.json'],
    exes: ['{LOCALAPPDATA}/Programs/cursor/Cursor.exe', '{LOCALAPPDATA}/cursor/Cursor.exe', 'C:/Program Files/Cursor/Cursor.exe', '/Applications/Cursor.app', '/usr/bin/cursor'],
    skills: ['{USERPROFILE}/.cursor/skills'],
    prompts: [
      { dir: '{USERPROFILE}/.cursor/rules', exts: ['.mdc', '.md', '.txt'], category: '规则' },
    ] },
  { type: 'vscode', name: 'VS Code',
    configs: ['{USERPROFILE}/.vscode/mcp.json'],
    exes: ['{LOCALAPPDATA}/Programs/Microsoft VS Code/Code.exe', 'C:/Program Files/Microsoft VS Code/Code.exe', '/Applications/Visual Studio Code.app', '/usr/bin/code'],
    skills: ['{USERPROFILE}/.vscode/skills'],
    prompts: [
      { file: '{USERPROFILE}/.vscode/copilot-instructions.md', name: 'VS Code Copilot 指令', category: '角色' },
      { file: '{USERPROFILE}/.github/copilot-instructions.md', name: '项目 Copilot 指令', category: '角色' },
    ] },
  { type: 'codebuddy', name: 'CodeBuddy',
    configs: ['{APPDATA}/CodeBuddy/mcp.json', '{USERPROFILE}/.codebuddy/mcp.json'],
    exes: ['/Applications/CodeBuddy.app'],
    skills: ['{APPDATA}/CodeBuddy/skills', '{USERPROFILE}/.codebuddy/skills'],
    prompts: [
      { dir: '{APPDATA}/CodeBuddy/rules', exts: ['.md', '.txt'], category: '规则' },
      { dir: '{USERPROFILE}/.codebuddy/rules', exts: ['.md', '.txt'], category: '规则' },
      { file: '{USERPROFILE}/.codebuddy/CODEBUDDY.md', name: 'CodeBuddy 全局指令', category: '角色' },
    ] },
];

// 取得某客户端的扫描路径：优先使用客户端记录中用户自定义的覆盖路径（skillPaths / promptPaths），
// 否则回退到 CLIENT_DEFS 的内置默认。clientsList 可选（采集时由调用方传入已加载的列表，避免重复读盘）。
function getClientPaths(clientType, kind, clientsList) {
  const def = CLIENT_DEFS.find(d => d.type === clientType);
  if (!def) return [];
  const field = kind === 'skills' ? 'skillPaths' : 'promptPaths';
  let rec = null;
  if (Array.isArray(clientsList)) rec = clientsList.find(c => c.type === clientType);
  if (!rec) {
    try {
      const { list } = require('./store');
      rec = list('clients').find(c => c.type === clientType);
    } catch (e) { /* store 未就绪时回退默认 */ }
  }
  if (rec && Array.isArray(rec[field]) && rec[field].length) return rec[field];
  return def[kind] || [];
}

// 占位符 → 真实路径 的转换辅助（环境变量一般不变，模块级缓存避免重复建对象）
// 非平台占位符补默认值：使同一套 {APPDATA} 模板在 Windows 之外的系统也能指向
// 各平台约定俗成的目录，从而让客户端探测 / 扫描 / 一键采集跨平台可用。
let _ROOTS = null;
function getRoots() {
  if (_ROOTS) return _ROOTS;
  const home = process.env.USERPROFILE || process.env.HOME || '';
  let appData = process.env.APPDATA;
  let localAppData = process.env.LOCALAPPDATA;
  if (process.platform === 'darwin') {
    // macOS：Windows 的漫游配置与本地应用数据都对应 ~/Library/Application Support
    appData = appData || path.join(home, 'Library', 'Application Support');
    localAppData = localAppData || path.join(home, 'Library', 'Application Support');
  } else if (process.platform !== 'win32') {
    // Linux 等：遵循 XDG 惯例（应用配置 ~/.config，应用数据 ~/.local/share）
    appData = appData || path.join(home, '.config');
    localAppData = localAppData || path.join(home, '.local', 'share');
  }
  _ROOTS = {
    '{APPDATA}': appData,
    '{LOCALAPPDATA}': localAppData,
    '{USERPROFILE}': home,
  };
  return _ROOTS;
}
function expand(p) {
  if (!p) return p;
  const R = getRoots();
  let r = p;
  for (const [ph, v] of Object.entries(R)) if (v) r = r.split(ph).join(v);
  return r;
}
function collapse(p) {
  const R = getRoots(); let r = p;
  for (const [ph, v] of Object.entries(R)) if (v && r.toLowerCase().startsWith(v.toLowerCase())) r = ph + r.slice(v.length);
  return r;
}
function exists(p) { try { return fs.existsSync(p); } catch (e) { return false; } }

// 扫描各客户端的真实安装位置与已有配置文件，返回建议写入路径
function detectClients() {
  return CLIENT_DEFS.map(d => {
    const existing = d.configs.map(expand).find(exists);
    const installed = d.exes.map(expand).some(exists);
    const configPath = collapse(existing || expand(d.configs[0]));
    return {
      type: d.type, name: d.name, configPath,
      resolved: expand(existing || d.configs[0]),
      exists: !!existing, installed,
      dirExists: fs.existsSync(path.dirname(expand(d.configs[0])))
    };
  });
}

// 将客户端配置文件中的单个 mcp server 转换为标准资源格式；cfg 非法（非对象/空）时返回 null
function normalizeMcp(name, cfg) {
  if (!cfg || typeof cfg !== 'object') return null;
  if (cfg.command) {
    return { name, type: 'stdio', enabled: true, command: cfg.command || '', args: cfg.args || [], env: cfg.env || {}, url: '', headers: {} };
  }
  const t = cfg.type === 'http' ? 'http' : 'sse';
  return { name, type: t, enabled: true, command: '', args: [], env: {}, url: cfg.url || '', headers: cfg.headers || {} };
}

// 解析单个 MCP 配置文件（已展开的真实路径），返回其中的 mcpServers 数组
function scanMcpConfig(real) {
  if (!exists(real)) return [];
  let parsed = {};
  try { parsed = JSON.parse(fs.readFileSync(real, 'utf8')); } catch (e) { return []; }
  const block = parsed.mcpServers || {};
  const servers = [];
  for (const [name, cfg] of Object.entries(block)) {
    const norm = normalizeMcp(name, cfg);
    if (!norm) continue; // 跳过 null / 非法条目，避免产生垃圾记录
    if (servers.find(s => s.name === name)) continue; // 同一文件内同名去重
    servers.push(Object.assign({ sourcePath: real }, norm));
  }
  return servers;
}

// 扫描某客户端真实配置文件，解析其中的 mcpServers（用于反向导入到本系统）
// configPath 可选：指定单条配置文件路径（便于测试与覆盖默认路径）；缺省则扫描该客户端所有内置配置
function scanClientMcp(clientType, configPath) {
  const def = CLIENT_DEFS.find(d => d.type === clientType);
  if (!def) return null;
  const servers = [];
  const paths = configPath ? [configPath] : def.configs.map(expand);
  for (const real of paths) {
    for (const s of scanMcpConfig(real)) {
      if (servers.find(x => x.name === s.name)) continue; // 多文件同名去重
      servers.push(s);
    }
  }
  return { clientType, name: def.name, servers };
}

// 解析 SKILL.md 的 frontmatter（仅读取 name / description 单行字段）
function parseSkillFrontMatter(text) {
  const fm = {};
  const m = text.match(/^---\s*\n([\s\S]*?)\n---/);
  if (!m) return fm;
  m[1].split('\n').forEach(line => {
    const i = line.indexOf(':');
    if (i > 0) {
      const k = line.slice(0, i).trim().toLowerCase();
      const v = line.slice(i + 1).trim().replace(/^["']|["']$/g, '');
      if (k === 'name' || k === 'description') fm[k] = v;
    }
  });
  return fm;
}

// 扫描某客户端本地 skill 目录，解析每个 skill 文件夹的 SKILL.md，逐个汇总（用于采集到 Skill 仓库）
function scanClientSkills(clientType, clientsList) {
  const def = CLIENT_DEFS.find(d => d.type === clientType);
  if (!def) return null;
  const skills = [];
  const seen = new Set();
  const warnings = [];
  for (const sp of getClientPaths(clientType, 'skills', clientsList)) {
    const dir = expand(sp);
    let st;
    try { st = fs.statSync(dir); } catch (e) { continue; }
    if (!st.isDirectory()) continue;
    for (const entry of fs.readdirSync(dir)) {
      const fp = path.join(dir, entry);
      let fst;
      try { fst = fs.statSync(fp); } catch (e) { continue; }
      if (!fst.isDirectory()) continue;
      const sk = ['SKILL.md', 'SKILL.mdx', 'skill.md'].map(n => path.join(fp, n)).find(exists);
      if (!sk) continue;
      if (seen.has(fp)) continue;
      seen.add(fp);
      const size = fs.statSync(sk).size;
      if (size > MAX_FILE) { warnings.push(`跳过超大文件 ${sk}（${Math.round(size / 1024)}KB）`); continue; }
      const raw = fs.readFileSync(sk, 'utf8'); // 只读一次，frontmatter 与 hash 共用
      const fm = parseSkillFrontMatter(raw);
      skills.push({ name: fm.name || entry, description: fm.description || '', path: fp, clientType, sourcePath: dir, hash: hashOf(raw) });
    }
  }
  return { clientType, name: def.name, skills, warnings };
}

// 把提示词扫描源（描述符或纯路径字符串）展开为具体文件并读取内容，返回提示词列表
function scanPromptsFromSources(sources, clientType, warnings) {
  const prompts = [];
  const seen = new Set();
  for (const src of (sources || [])) {
    let targets = [];
    let category = DEFAULT_CATEGORY;
    let fixedName = null;
    if (typeof src === 'string') {
      // 覆盖路径（promptPaths）既可能是文件也可能是目录：目录则扫描其中的文本文件
      const fp = expand(src);
      let st;
      try { st = fs.statSync(fp); } catch (e) { st = null; }
      if (st && st.isDirectory()) {
        const exts = ['.md', '.mdc', '.txt', '.markdown'];
        for (const e of fs.readdirSync(fp)) {
          if (isIgnoredDir(e)) continue; // 跳过依赖/构建目录
          const cfp = path.join(fp, e);
          let cst; try { cst = fs.statSync(cfp); } catch (e) { continue; }
          if (cst.isFile() && exts.includes(path.extname(e).toLowerCase())) targets.push(cfp);
        }
      } else if (st && st.isFile()) {
        targets = [fp];
      } else if (warnings) {
        warnings.push(`扫描路径不存在，已忽略：${src}`);
      }
    } else if (src.dir) {
      const d = expand(src.dir);
      category = src.category || DEFAULT_CATEGORY;
      const exts = src.exts || ['.md', '.mdc', '.txt', '.markdown'];
      let dst;
      try { dst = fs.statSync(d); } catch (e) { dst = null; }
      if (dst && dst.isDirectory()) {
        for (const e of fs.readdirSync(d)) {
          if (isIgnoredDir(e)) continue; // 跳过依赖/构建目录
          const fp = path.join(d, e);
          let fst; try { fst = fs.statSync(fp); } catch (e) { continue; }
          if (fst.isFile() && exts.includes(path.extname(e).toLowerCase())) targets.push(fp);
        }
      }
    } else if (src.file) {
      targets = [expand(src.file)];
      category = src.category || category;
      fixedName = src.name || null;
    }
    for (const fp of targets) {
      let st;
      try { st = fs.statSync(fp); } catch (e) { continue; }
      if (seen.has(fp)) continue;
      if (st.size > MAX_FILE) { if (warnings) warnings.push(`跳过超大文件 ${fp}（${Math.round(st.size / 1024)}KB）`); continue; }
      seen.add(fp);
      const content = fs.readFileSync(fp, 'utf8').trim();
      if (!content) continue;
      const bn = path.basename(fp);
      const name = fixedName || bn.replace(/\.[^.]+$/, '') || bn;
      prompts.push({ name, category, content, path: fp, clientType, hash: hashOf(content) });
    }
  }
  return prompts;
}

// 扫描某客户端的提示词/规则文件（CLAUDE.md、.cursor/rules、copilot-instructions.md 等），汇总进「提示词」资源
function scanClientPrompts(clientType, clientsList) {
  const def = CLIENT_DEFS.find(d => d.type === clientType);
  if (!def) return null;
  const warnings = [];
  const prompts = scanPromptsFromSources(getClientPaths(clientType, 'prompts', clientsList), clientType, warnings);
  return { clientType, name: def.name, prompts, warnings };
}

// 扫描一个本地仓库目录下的某一类资源，返回待导入的资源列表
// repo: { path, name, resourceType? }；usePath 覆盖实际扫描目录（git clone 后指向缓存目录）；
// resourceType 为单个字符串——若省略则回退读取 repo.resourceType（兼容老调用与单类型仓库）
function scanRepoLocal(repo, usePath, resourceType) {
  resourceType = resourceType || repo.resourceType;
  const dir = expand(usePath || repo.path);
  const warnings = [];
  if (!dir) { warnings.push('仓库未配置本地路径'); return { items: [], warnings }; }
  let st;
  try { st = fs.statSync(dir); } catch (e) { return { items: [], warnings: ['本地路径不存在：' + repo.path] }; }
  if (!st.isDirectory()) { warnings.push('本地路径不是目录：' + repo.path); return { items: [], warnings }; }

  if (resourceType === 'skillrepos') {
    const skills = [];
    const seen = new Set();
    for (const entry of fs.readdirSync(dir)) {
      if (isIgnoredDir(entry)) continue; // 跳过依赖/构建目录
      const fp = path.join(dir, entry);
      let fst; try { fst = fs.statSync(fp); } catch (e) { continue; }
      if (!fst.isDirectory()) continue;
      const sk = ['SKILL.md', 'SKILL.mdx', 'skill.md'].map(n => path.join(fp, n)).find(exists);
      if (!sk) continue;
      if (seen.has(fp)) continue;
      seen.add(fp);
      const size = fs.statSync(sk).size;
      if (size > MAX_FILE) { warnings.push(`跳过超大文件 ${sk}（${Math.round(size / 1024)}KB）`); continue; }
      const raw = fs.readFileSync(sk, 'utf8'); // 只读一次，frontmatter 与 hash 共用
      const fm = parseSkillFrontMatter(raw);
      skills.push({ name: fm.name || entry, description: fm.description || '', path: fp, clientType: repo.name, sourcePath: dir, hash: hashOf(raw) });
    }
    return { items: skills, warnings };
  }

  if (resourceType === 'prompts') {
    const prompts = scanPromptsFromSources([{ dir, category: repo.name || DEFAULT_CATEGORY }], repo.name, warnings);
    return { items: prompts, warnings };
  }

  if (resourceType === 'mcpservers') {
    // 递归扫描仓库目录（含各生成软件项目子目录）内所有 mcp.json / *.mcp.json 清单
    const mcpFiles = [];
    const walk = (root, depth) => {
      if (depth > 6) return;
      let entries; try { entries = fs.readdirSync(root); } catch (e) { return; }
      for (const e of entries) {
        if (isIgnoredDir(e)) continue; // 跳过依赖/构建目录
        const fp = path.join(root, e);
        let st; try { st = fs.statSync(fp); } catch (err) { continue; }
        if (st.isDirectory()) { walk(fp, depth + 1); continue; }
        if (/^mcp\.json$|^.*\.mcp\.json$/.test(e)) mcpFiles.push(fp);
      }
    };
    walk(dir, 0);
    const servers = [];
    for (const f of mcpFiles) {
      for (const s of scanMcpConfig(f)) servers.push(s);
    }
    if (!servers.length) warnings.push('未在仓库目录中找到 mcp.json 清单');
    return { items: servers, warnings };
  }

  warnings.push('未知的资源类型：' + resourceType);
  return { items: [], warnings };
}

// 同步一个仓库到目标资源集合：扫描后按路径/名称合并导入，返回统计
// 支持 resourceType 为数组（一个生成的软件项目可同时包含 Skill/MCP/提示词）或单字符串（兼容旧数据）
// git 仓库：自动 clone/pull 到本地缓存目录（data/.repos-cache/<id>），再扫描该目录
function syncRepo(repo) {
  if (!repo || !repo.enabled) return { ok: false, error: '仓库未启用或不存在' };

  let scanPath = repo.path;       // local 仓库直接用 path；git 仓库若已填本地 path 也复用
  const gitWarnings = [];

  if (repo.type === 'git') {
    if (!repo.url) return { ok: false, error: 'git 仓库未配置 Git 地址' };
    const store = require('./store');
    const cacheDir = path.join(store.DATA_DIR, '.repos-cache', repo.id || 'tmp');
    try {
      if (fs.existsSync(path.join(cacheDir, '.git'))) {
        execFileSync('git', gitArgsWithProxy(['pull', '--ff-only']), { cwd: cacheDir, stdio: 'pipe', timeout: 120000, env: gitEnv() });
      } else {
        fs.mkdirSync(path.dirname(cacheDir), { recursive: true });
        if (fs.existsSync(cacheDir)) fs.rmSync(cacheDir, { recursive: true, force: true });
        execFileSync('git', gitArgsWithProxy(['clone', '--depth', '1', repo.url, cacheDir]), { stdio: 'pipe', timeout: 120000, env: gitEnv() });
      }
      scanPath = cacheDir;
    } catch (e) {
      const msg = (e.stderr && e.stderr.toString()) || e.message || String(e);
      const proxy = getProxyUrl();
      const hint = proxy
        ? '（当前代理：' + proxy + '）'
        : '（当前未配置代理，如需科学上网请在 data/proxy.json 设置 { "url": "http://127.0.0.1:7897" }）';
      return { ok: false, error: 'git 同步失败：' + msg.split('\n')[0] + hint, detail: msg };
    }
  }

  // 归一化 resourceType 为数组（兼容单字符串旧数据）
  const types = Array.isArray(repo.resourceType) ? repo.resourceType : (repo.resourceType ? [repo.resourceType] : []);
  const store = require('./store');
  if (!types.length) return { ok: false, error: '仓库 resourceType 未配置（可选 skillrepos / mcpservers / prompts）' };

  let totalCreated = 0, totalUpdated = 0;
  const allWarnings = gitWarnings.slice();
  for (const type of types) {
    const { items, warnings } = scanRepoLocal(repo, scanPath, type);
    allWarnings.push(...warnings);
    if (!items.length) continue;
    let result;
    if (type === 'skillrepos') result = store.importScannedSkills(items);
    else if (type === 'prompts') result = store.importScannedPrompts(items);
    else if (type === 'mcpservers') result = store.importScannedServers(items);
    else { allWarnings.push('跳过未知资源类型：' + type); continue; }
    totalCreated += (result.results || []).filter(r => r.status === 'created').length;
    totalUpdated += (result.results || []).filter(r => r.status === 'updated').length;
    allWarnings.push(...(result.warnings || []));
  }

  const lastSyncAt = new Date().toISOString();
  if (repo.id) store.update('repos', repo.id, { lastSyncAt });
  return { ok: true, created: totalCreated, updated: totalUpdated, lastSyncAt, warnings: allWarnings };
}

module.exports = { exportProfile, applyExport, expand, buildMcpServers, detectClients, scanClientMcp, scanMcpConfig, normalizeMcp, scanClientSkills, parseSkillFrontMatter, scanClientPrompts, scanPromptsFromSources, scanRepoLocal, syncRepo, getProxyUrl, gitArgsWithProxy };
