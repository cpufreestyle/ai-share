'use strict';
// 隔离测试：lib/insights.js 健康度报告与 Markdown 索引
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const tmpData = fs.mkdtempSync(path.join(os.tmpdir(), 'aishare-insights-'));
process.env.AI_SHARE_DATA_DIR = tmpData;

const { healthReport, markdownIndex } = require('../lib/insights');
const store = require('../lib/store');

let passed = 0;
function ok(name, cond) { assert.ok(cond, name); console.log('  ✓ ' + name); passed++; }

try {
  // 造数据：1 正常 provider、1 缺 baseUrl、1 同名重复、1 陈旧、1 墓碑
  store.create('providers', { name: 'good', baseUrl: 'https://g.test', apiKey: 'k', updatedAt: new Date().toISOString() });
  store.create('providers', { name: 'no-url', baseUrl: '', updatedAt: new Date().toISOString() });
  store.create('providers', { name: 'dup', baseUrl: 'https://d1.test', updatedAt: new Date().toISOString() });
  store.create('providers', { name: 'dup', baseUrl: 'https://d2.test', updatedAt: new Date().toISOString() });
  const old = store.create('providers', { name: 'stale', baseUrl: 'https://s.test', updatedAt: new Date().toISOString() });
  const items = store.listRaw('providers');
  items.find((x) => x.id === old.id).updatedAt = new Date(Date.now() - 120 * 24 * 3600 * 1000).toISOString();
  store.rewrite('providers', items);
  const gone = store.create('providers', { name: 'tomb', baseUrl: 'https://t.test' });
  store.remove('providers', gone.id);

  const all = store.exportAll();
  // 与 server.js health-report 路由同源的数据源：listRaw 含墓碑（exportAll 会隐藏）
  const raw = {};
  for (const k of ['providers', 'prompts', 'mcpservers', 'skillrepos', 'clients', 'profiles', 'repos']) raw[k] = store.listRaw(k);
  const r = healthReport({ collections: raw }, { staleDays: 90 });

  ok('返回结构含 issues/score/summary', Array.isArray(r.issues) && typeof r.score === 'number' && typeof r.summary === 'string');
  ok('缺 baseUrl 被检出', r.issues.some(i => i.kind === 'missing-field' && i.name === 'no-url'));
  ok('同名重复被检出', r.issues.some(i => i.kind === 'duplicate' && i.name === 'dup'));
  ok('陈旧记录被检出（120 天 > 90 天）', r.issues.some(i => i.kind === 'stale' && i.name === 'stale'));
  ok('墓碑积压被检出', r.issues.some(i => i.kind === 'tombstones'));
  ok('墓碑记录本身不参与健康分析', !r.issues.some(i => i.name === 'tomb'));
  ok('score 随问题数扣减且非负', r.score >= 0 && r.score < 100);
  ok('staleDays 边界生效', healthReport(all, { staleDays: 365 }).issues.every(i => !(i.kind === 'stale' && i.name === 'stale')));

  // 空库：无问题、满分
  const empty = healthReport({ collections: { providers: [], prompts: [], mcpservers: [], skillrepos: [], clients: [], profiles: [], repos: [] } });
  ok('空库 score=100 且 0 问题', empty.score === 100 && empty.total === 0);

  // Markdown 索引
  const md = markdownIndex(all, {});
  ok('索引含标题与生成时间', md.startsWith('# AI 资源索引') && md.includes('生成于'));
  const aliveProviders = store.listRaw('providers').filter((x) => !x._deleted).length;
  ok('索引含各集合小节与计数', md.includes('## API 端点（' + aliveProviders + '）') && md.includes('## MCP 服务器'));
  ok('索引表格包含正常资源', md.includes('`good`') && md.includes('https://g.test'));
  ok('索引不含密钥明文', !md.includes('apiKey') && !md.includes('| k |'));
  ok('索引不含墓碑记录', !md.includes('tomb'));
  ok('方案小节在无方案时省略', !markdownIndex({ collections: { ...all.collections, profiles: [] } }, {}).includes('## 共享方案'));

  const md2 = markdownIndex({ collections: { ...all.collections, profiles: [{ id: 'p1', name: '默认工作区', _deleted: false }] } }, {});
  ok('有方案时输出方案小节', md2.includes('## 共享方案（1）') && md2.includes('默认工作区'));
  ok('索引剔除墓碑后按活记录计数', !md.includes('tomb') && aliveProviders >= 5);

  console.log('\n全部通过：' + passed + ' 项');
} catch (e) {
  console.error('\n测试失败：', e.message);
  console.error(e.stack);
  process.exitCode = 1;
} finally {
  fs.rmSync(tmpData, { recursive: true, force: true });
}
