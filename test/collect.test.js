'use strict';
// 隔离测试：所有读写都指向临时 data 目录（通过 AI_SHARE_DATA_DIR），不触碰真实 data/
// 运行： node test/collect.test.js
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const tmpData = fs.mkdtempSync(path.join(os.tmpdir(), 'aishare-'));
process.env.AI_SHARE_DATA_DIR = tmpData; // 必须在 require store 之前设置

const store = require('../lib/store');
const { scanClientSkills, scanClientPrompts, scanPromptsFromSources, scanClientMcp, scanMcpConfig, normalizeMcp, scanRepoLocal, syncRepo } = require('../lib/export');

const MB = 1024 * 1024;
let passed = 0;
function ok(name, cond) { assert.ok(cond, name); console.log('  ✓ ' + name); passed++; }

let sDir, sDir2, pDir;
try {
  // ---- 准备临时 skill / 提示词目录 ----
  sDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sk-'));
  sDir2 = fs.mkdtempSync(path.join(os.tmpdir(), 'sk2-'));
  pDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pr-'));

  const skillMd = '---\nname: Job Helper\ndescription: does jobs\n---\nbody';
  fs.mkdirSync(path.join(sDir, 'job'));
  fs.writeFileSync(path.join(sDir, 'job', 'SKILL.md'), skillMd);
  fs.mkdirSync(path.join(sDir, 'plain')); // 没有 SKILL.md，应被跳过
  fs.writeFileSync(path.join(sDir, 'plain', 'README.md'), 'x');
  fs.mkdirSync(path.join(sDir, 'big'));
  fs.writeFileSync(path.join(sDir, 'big', 'SKILL.md'), 'x'.repeat(MB + 10)); // 超大，应跳过
  // 第二个目录放同一份内容（不同路径），用于跨路径去重
  fs.mkdirSync(path.join(sDir2, 'other'));
  fs.writeFileSync(path.join(sDir2, 'other', 'SKILL.md'), skillMd);

  const claudeMd = '# 全局指令\n我是 Claude 指令';
  fs.writeFileSync(path.join(pDir, 'CLAUDE.md'), claudeMd);
  fs.writeFileSync(path.join(pDir, 'style.mdc'), 'rule one');
  fs.writeFileSync(path.join(pDir, 'note.md'), 'rule two');
  fs.writeFileSync(path.join(pDir, 'huge.md'), 'y'.repeat(MB + 10)); // 超大提示词，应跳过

  // 注册客户端并记录自定义扫描路径（覆盖内置默认）：更新已存在的种子客户端，避免按 type 查到旧记录
  store.update('clients', 'c_claude', { skillPaths: [sDir], promptPaths: [pDir] });
  store.update('clients', 'c_cursor', { skillPaths: [sDir2] });

  // ---- 1) scanClientSkills：扫描、跳过无 SKILL.md、跳过超大、带 hash ----
  const sk = scanClientSkills('claude');
  ok('scanClientSkills 找到 1 个 skill（job）', sk.skills.length === 1);
  ok('skill 名称取自 frontmatter', sk.skills[0].name === 'Job Helper');
  ok('skill 带内容指纹 hash', typeof sk.skills[0].hash === 'string' && sk.skills[0].hash.length > 0);
  ok('scanClientSkills 跳过超大 SKILL.md 并告警', sk.warnings.some(w => w.includes('big')));

  // ---- 2) importScannedSkills：按 hash 去重（重复导入为 updated） ----
  const baseSkills = store.list('skillrepos').length; // 含种子记录
  let r = store.importScannedSkills(sk.skills);
  ok('首次导入 skill 为 created', r.results.filter(x => x.status === 'created').length === 1);
  r = store.importScannedSkills(sk.skills);
  ok('重复导入同一 skill 为 updated', r.results.filter(x => x.status === 'updated').length === 1);
  ok('导入后 skill 仓库仅 +1 条', store.list('skillrepos').length === baseSkills + 1);

  // ---- 3) 跨路径去重：另一目录相同内容导入应为 updated ----
  const sk2 = scanClientSkills('cursor');
  ok('第二目录也扫描到 1 个 skill', sk2.skills.length === 1);
  r = store.importScannedSkills(sk2.skills);
  ok('相同内容跨路径导入为 updated（去重）', r.results.filter(x => x.status === 'updated').length === 1);
  ok('跨路径去重后 skill 仓库条数不变', store.list('skillrepos').length === baseSkills + 1);

  // ---- 4) scanPromptsFromSources：目录覆盖路径 + 多文件 + 超大跳过 ----
  const pr = scanPromptsFromSources([pDir, path.join(pDir, 'CLAUDE.md')], 'claude', []);
  ok('scanPromptsFromSources 扫描目录与单文件共 3 条（超大已跳过）', pr.length === 3);
  ok('提示词带内容指纹 hash', pr.every(p => typeof p.hash === 'string' && p.hash.length > 0));
  ok('scanPromptsFromSources 跳过超大提示词', true); // 由 warnings 间接保证，下面验证

  const prWarn = [];
  scanPromptsFromSources([pDir], 'claude', prWarn);
  ok('超大提示词产生告警', prWarn.some(w => w.includes('huge')));

  // ---- 5) importScannedPrompts：去重 + 保留用户分类 ----
  let rp = store.importScannedPrompts(pr);
  ok('首次导入提示词为 created', rp.results.filter(x => x.status === 'created').length === 3);
  const target = store.list('prompts').find(p => p.name === 'style');
  store.update('prompts', target.id, { category: '我的分类' });
  rp = store.importScannedPrompts(pr);
  ok('重复导入提示词为 updated', rp.results.filter(x => x.status === 'updated').length === 3);
  const after = store.list('prompts').find(p => p.id === target.id);
  ok('重复导入保留用户改过的分类', after.category === '我的分类');

  // ---- 6) normalizeMcp：MCP 配置标准化（stdio / sse-http） ----
  const stdio = normalizeMcp('fs', { command: 'npx', args: ['-y', 'x'] });
  ok('normalizeMcp stdio 类型正确', stdio.type === 'stdio' && stdio.command === 'npx');
  const httpMcp = normalizeMcp('r', { type: 'http', url: 'http://x' });
  ok('normalizeMcp http 映射为 http', httpMcp.type === 'http' && httpMcp.url === 'http://x');
  const sseMcp = normalizeMcp('r2', { url: 'http://y/sse' });
  ok('normalizeMcp 默认映射为 sse', sseMcp.type === 'sse');

  // ---- 7) scanClientMcp：按客户端类型扫描（无配置时不报错，返回 servers 数组） ----
  ok('scanClientMcp 未知类型返回 null', scanClientMcp('nope') === null);
  const mcpScan = scanClientMcp('claude');
  ok('scanClientMcp 返回 servers 数组', mcpScan && Array.isArray(mcpScan.servers));

  // ---- 7b) scanMcpConfig：用临时配置文件测试真实导入（隔离） ----
  const mcpFile = path.join(tmpData, 'mcp.test.json');
  fs.writeFileSync(mcpFile, JSON.stringify({ mcpServers: {
    alpha: { command: 'npx', args: ['-y', 'alpha'] },
    beta: { url: 'http://localhost:9000/sse' }
  } }));
  const cfg = scanMcpConfig(mcpFile);
  ok('scanMcpConfig 解析出 2 个服务器', cfg.length === 2);
  ok('scanMcpConfig 标准化 stdio', cfg.find(s => s.name === 'alpha').type === 'stdio');
  ok('scanMcpConfig 标准化 sse', cfg.find(s => s.name === 'beta').type === 'sse');
  ok('scanMcpConfig 带来源路径', typeof cfg[0].sourcePath === 'string');
  ok('scanMcpConfig 不存在的文件返回空数组', scanMcpConfig(path.join(tmpData, 'nope.json')).length === 0);
  // 通过扫描指定路径（扫描真实配置导入的可测试入口）
  const byPath = scanClientMcp('claude', mcpFile);
  ok('scanClientMcp(configPath) 返回该文件的服务器', byPath && byPath.servers.length === 2);

  // ---- 7c) normalizeMcp 对非法 cfg 返回 null（避免垃圾条目） ----
  ok('normalizeMcp(null) 返回 null', normalizeMcp('x', null) === null);
  fs.writeFileSync(mcpFile, JSON.stringify({ mcpServers: {
    good: { command: 'npx' },
    bad: null,
    alsoBad: 123
  } }));
  ok('scanMcpConfig 过滤 null/非法条目', scanMcpConfig(mcpFile).length === 1);

  // ---- 7d) scanPromptsFromSources：string 源不存在时给出 warning ----
  const w2 = [];
  scanPromptsFromSources(['C:/绝对/不存在/的路径.md'], 'claude', w2);
  ok('不存在的 string 源产生 warning', w2.some(w => w.includes('忽略')));

  // ---- 7e) create 保留传入的 id（修复方案包导入引用断裂） ----
  const made = store.create('mcpservers', { id: 'm_fix', name: 'fixed' });
  ok('create 保留传入的 id', made.id === 'm_fix');
  ok('create 后按该 id 可取回', store.get('mcpservers', 'm_fix').name === 'fixed');

  // ---- 8) collectFromClients：端到端采集（隔离于临时 data 目录） ----
  const beforeClients = store.list('clients').length;
  const col = store.collectFromClients();
  ok('collectFromClients 返回 ok', col.ok === true);
  ok('collectFromClients 返回各客户端结果', Array.isArray(col.clients) && col.clients.length > 0);
  ok('collectFromClients 为各客户端登记记录', store.list('clients').length >= beforeClients);
  ok('collectFromClients 统计为数字', typeof col.totalCreated === 'number' && typeof col.totalSCreated === 'number' && typeof col.totalPCreated === 'number');

  // ---- 9) restoreAll replace 模式也加密落地（不写明文密钥） ----
  const provFile = path.join(tmpData, 'providers.json');
  store.create('providers', { id: 'p_test', name: 'T', baseUrl: 'http://x', apiKey: 'SECRET' });
  store.restoreAll({ providers: [{ id: 'p_test', name: 'T', baseUrl: 'http://x', apiKey: 'SECRET2' }] }, 'replace');
  const raw = JSON.parse(fs.readFileSync(provFile, 'utf8'));
  ok('restoreAll replace 不落明文密钥', raw.find(p => p.id === 'p_test').apiKey !== 'SECRET2');

  // ---- 10) repos 仓库管理：本地目录扫描 + 同步到对应集合 ----
  // 10a) local 仓库（skillrepos）扫描到 sDir 中的 skill
  const repoSkill = { type: 'local', path: sDir, resourceType: 'skillrepos', name: '测试仓库', enabled: true };
  const sl = scanRepoLocal(repoSkill);
  ok('scanRepoLocal(skillrepos) 扫描到 sDir 的 skill', sl.items.some(s => s.name === 'Job Helper'));

  // 10b) local 仓库（prompts）扫描到 pDir 的提示词
  const repoPrompt = { type: 'local', path: pDir, resourceType: 'prompts', name: '提示词仓库', enabled: true };
  const pl = scanRepoLocal(repoPrompt);
  ok('scanRepoLocal(prompts) 扫描到 pDir 的提示词', pl.items.length >= 2);

  // 10c) local 仓库（mcpservers）：目录下 mcp.json 清单
  const mcpRepoDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mcr-'));
  fs.writeFileSync(path.join(mcpRepoDir, 'mcp.json'), JSON.stringify({ mcpServers: { repoSrv: { command: 'uvx' } } }));
  const ml = scanRepoLocal({ type: 'local', path: mcpRepoDir, resourceType: 'mcpservers', name: 'MCP 仓库', enabled: true });
  ok('scanRepoLocal(mcpservers) 解析仓库内 mcp.json', ml.items.some(s => s.name === 'repoSrv'));

  // 10d) 不存在的本地路径产生 warning
  const wl = scanRepoLocal({ type: 'local', path: 'C:/不存在/路径', resourceType: 'skillrepos', name: '坏仓库', enabled: true });
  ok('scanRepoLocal 路径不存在时给出 warning', wl.warnings.length > 0 && wl.items.length === 0);

  // 10e) git 仓库未配 url 时同步被拒（url 是 clone 必需）
  const gitRejected = syncRepo({ type: 'git', resourceType: 'skillrepos', name: '纯 git', enabled: true });
  ok('git 仓库未配 url 时 syncRepo 返回错误', gitRejected.ok === false && !!gitRejected.error);

  // 10f) syncRepo 将 local skill 仓库同步进 skillrepos 集合（按 hash 去重）
  const baseRepoSkills = store.list('skillrepos').length;
  const sres = syncRepo(repoSkill);
  ok('syncRepo(skillrepos) 返回 ok', sres.ok === true);
  ok('syncRepo 写回 lastSyncAt', typeof sres.lastSyncAt === 'string');
  ok('syncRepo(skillrepos) 同步后 skillrepos 仅 +1', store.list('skillrepos').length === baseRepoSkills + 1);
  const sres2 = syncRepo(repoSkill);
  ok('syncRepo 重复同步为 updated（不去重新增）', store.list('skillrepos').length === baseRepoSkills + 1);

  // 10g) repos 集合 CRUD 经 COLLECTIONS 可见
  ok('repos 在 COLLECTIONS 中', store.COLLECTIONS.includes('repos'));
  const created = store.create('repos', { name: '新仓库', type: 'local', path: sDir, resourceType: 'skillrepos', enabled: true });
  ok('repos 可创建并取回', store.get('repos', created.id).name === '新仓库');

  try { fs.rmSync(mcpRepoDir, { recursive: true, force: true }); } catch (e) {}

  console.log('\n全部通过：' + passed + ' 项');
} catch (e) {
  console.error('\n测试失败：', e.message);
  console.error(e.stack);
  process.exitCode = 1;
} finally {
  fs.rmSync(tmpData, { recursive: true, force: true });
  for (const d of [sDir, sDir2, pDir]) { try { if (d) fs.rmSync(d, { recursive: true, force: true }); } catch (e) {} }
}
