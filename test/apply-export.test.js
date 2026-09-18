'use strict';
// 隔离测试：applyExport 写客户端配置的安全性（原子写 + 解析失败不清空）。
// 所有读写指向临时目录，不触碰真实 data/ 与真实客户端配置。
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const tmpData = fs.mkdtempSync(path.join(os.tmpdir(), 'aishare-apply-'));
process.env.AI_SHARE_DATA_DIR = tmpData;

const store = require('../lib/store');
const { applyExport, writeJsonAtomic } = require('../lib/export');

let passed = 0;
function ok(name, cond) { assert.ok(cond, name); console.log('  ✓ ' + name); passed++; }

const target = path.join(tmpData, 'cursor-mcp.json');
const client = store.create('clients', { name: 'Cursor', type: 'cursor', enabled: true, configPath: target });
const srv = store.create('mcpservers', { name: 'ai-share', type: 'stdio', command: 'node', args: ['x.js'], enabled: true });
const profile = store.create('profiles', { name: 'P1', clientIds: [client.id], mcpServerIds: [srv.id] });

// 1) 目标含尾逗号（JSONC，非法 JSON）→ 跳过，不覆盖用户文件
const jsonc = '{ "mcpServers": { "keep": { "command": "a" } }, }';
fs.writeFileSync(target, jsonc);
let r = applyExport(profile.id);
ok('非法 JSON 目标：该客户端标记失败', r.results[0].ok === false);
ok('非法 JSON 目标：文件内容原样保留', fs.readFileSync(target, 'utf8') === jsonc);

// 2) 合法 JSON → 合并写入，无 .tmp 残留，生成 .bak
fs.writeFileSync(target, JSON.stringify({ mcpServers: { keep: { command: 'a' } } }, null, 2));
r = applyExport(profile.id);
ok('合法 JSON 目标：写入成功', r.results[0].ok === true);
const written = JSON.parse(fs.readFileSync(target, 'utf8'));
ok('保留既有 mcpServers 项', !!written.mcpServers.keep);
ok('写入方案内 mcpServer', !!written.mcpServers['ai-share']);
ok('原子写：无 .tmp 残留', !fs.readdirSync(tmpData).some(f => f.endsWith('.tmp')));
ok('写前生成 .bak 备份', fs.existsSync(target + '.bak'));

// 3) 目标不存在 → 新建
const target2 = path.join(tmpData, 'fresh.json');
const client2 = store.create('clients', { name: 'Fresh', type: 'cursor', enabled: true, configPath: target2 });
const profile2 = store.create('profiles', { name: 'P2', clientIds: [client2.id], mcpServerIds: [srv.id] });
const r2 = applyExport(profile2.id);
ok('目标不存在时可新建', r2.results[0].ok === true && fs.existsSync(target2));
ok('新建内容含方案 mcpServer', !!JSON.parse(fs.readFileSync(target2, 'utf8')).mcpServers['ai-share']);

// 4) writeJsonAtomic 单测：覆盖生成 .bak
const f = path.join(tmpData, 'atomic.json');
writeJsonAtomic(f, { v: 1 });
ok('writeJsonAtomic 首次写入', JSON.parse(fs.readFileSync(f, 'utf8')).v === 1);
writeJsonAtomic(f, { v: 2 });
ok('writeJsonAtomic 覆盖成功', JSON.parse(fs.readFileSync(f, 'utf8')).v === 2);
ok('writeJsonAtomic 覆盖前留 .bak', JSON.parse(fs.readFileSync(f + '.bak', 'utf8')).v === 1);


// 5) planExport：参照 terraform plan —— 只计算差异、绝不落盘、密钥一律脱敏
const { planExport } = require('../lib/export');
const beforeText = fs.readFileSync(target, 'utf8');
const plan = planExport(profile.id);
ok('plan 返回 ok 且带汇总', plan.ok === true && plan.summary.targets === 1);
ok('plan 不改动目标文件', fs.readFileSync(target, 'utf8') === beforeText);
ok('已应用过的方案 plan 为不变（same）', plan.targets[0].mcpServers.same.includes('ai-share') && plan.targets[0].mcpServers.add.length === 0);
ok('方案外已有条目标记为保留', plan.targets[0].mcpServers.kept.includes('keep'));

store.update('mcpservers', srv.id, { command: 'node2' });
const plan2 = planExport(profile.id);
ok('上游改动被识别为 modified', plan2.targets[0].mcpServers.change.some((c) => c.name === 'ai-share'));
ok('modified 带脱敏前值', !!plan2.targets[0].mcpServers.change[0].before);

const prov = store.create('providers', { name: 'PK', baseUrl: 'https://pk', apiKey: 'sk-plain-secret-1234567890' });
const prof3 = store.create('profiles', { name: 'P3', clientIds: [client.id], mcpServerIds: [], providerId: prov.id, injectEnv: true });
const plan3 = planExport(prof3.id);
ok('plan 识别 env 新增', plan3.targets[0].env.add.some((e) => e.key === 'AI_API_KEY'));
ok('plan 不回传明文密钥', !JSON.stringify(plan3).includes('sk-plain-secret-1234567890'));
ok('plan 的密钥值已脱敏', JSON.stringify(plan3).indexOf('***') !== -1);

fs.writeFileSync(target, '{ bad json');
const plan4 = planExport(profile.id);
ok('非法 JSON 目标被标记 invalid-json', plan4.targets[0].status === 'invalid-json');
ok('非法 JSON 目标不计入告警且不给出预览', plan4.summary.warnings >= 1 && plan4.targets[0].preview === null);
fs.writeFileSync(target, JSON.stringify({ mcpServers: { keep: { command: 'a' } } }, null, 2));

fs.rmSync(target2, { force: true }); // 前面用例已创建过该文件，删掉才能走到 new-file 分支
const plan5 = planExport(profile2.id);
ok('目标不存在时标记 new-file 并列为新增', plan5.targets[0].status === 'new-file' && plan5.targets[0].mcpServers.add.length === 1);
ok('planExport 对不存在的方案返回 ok:false', planExport('nope').ok === false);

console.log('全部通过：' + passed + ' 项');
