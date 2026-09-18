'use strict';
// 隔离测试：明文密钥扫描（参照 gitleaks / trufflehog 的检测思路）
//   ① 各类密钥特征能命中  ② 高优先级特征优先（sk-ant- 不重复报成 sk-…）
//   ③ 结果只带脱敏片段，且能识别「已被本系统收口」的密钥
//   ④ 占位符 / 示例值不报  ⑤ 目录遍历遵守忽略规则与上限
// 全部用 defaults:false（只扫显式给的路径），避免被本机真实客户端配置干扰。
// 所有读写指向临时目录，不触碰真实 data/ 与真实客户端配置。
// 运行： node test/secretscan.test.js
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const tmpData = fs.mkdtempSync(path.join(os.tmpdir(), 'aishare-scan-'));
process.env.AI_SHARE_DATA_DIR = tmpData; // 必须在 require 之前设置

const store = require('../lib/store');
const { scanSecrets, PATTERNS, mask } = require('../lib/secretscan');

let passed = 0;
function ok(name, cond) { assert.ok(cond, name); console.log('  ✓ ' + name); passed++; }
function has(findings, pattern, contains) {
  return findings.some((f) => f.pattern === pattern && (!contains || f.masked.includes(contains)));
}

try {
  const OPENAI = 'sk-proj-abcdefghij0123456789ABCDEFGHIJ';
  const ANTHROPIC = 'sk-ant-api03-aaaaBBBBccccDDDDeeeeFFFF';
  const AWS = 'AKIAQW3RFTYU7PLKJHGD';
  const GH = 'ghp_0123456789abcdefghijklmnopqrstuvwxyzAB';
  const JWT = 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjMifQ.SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJV_adQssw5c';

  // ① 文件扫描：各类特征 + 行号 + 脱敏
  const cfgFile = path.join(tmpData, 'claude_desktop_config.json');
  fs.writeFileSync(cfgFile, JSON.stringify({
    mcpServers: { a: { command: 'npx', env: { OPENAI_API_KEY: OPENAI } } },
    notes: 'anthropic=' + ANTHROPIC + ' aws=' + AWS + ' gh=' + GH,
    auth: 'Bearer ' + JWT,
  }, null, 2));
  const r = scanSecrets({ paths: [cfgFile], defaults: false });
  ok('扫描了 1 个文件', r.scanned === 1);
  ok('命中 Anthropic 特征', has(r.findings, 'anthropic'));
  ok('命中 AWS 特征', has(r.findings, 'aws'));
  ok('命中 GitHub 特征', has(r.findings, 'github'));
  ok('命中 JWT 特征', has(r.findings, 'jwt'));
  ok('命中 apikey 字段特征', has(r.findings, 'apikey-kv'));
  ok('sk-ant- 未被重复报成通用 sk-…', !has(r.findings, 'openai-like'));
  ok('结果只带脱敏片段（不含完整密钥）', !JSON.stringify(r).includes(OPENAI));
  const lineHit = r.findings.find((f) => f.pattern === 'anthropic');
  ok('能定位行号', lineHit && lineHit.line > 1);

  // ② 已收口识别：把 OPENAI 登记为 provider 的 apiKey 后应标记 inVault
  store.create('providers', { name: 'V', baseUrl: 'https://v', apiKey: OPENAI });
  const r2 = scanSecrets({ paths: [cfgFile], defaults: false });
  const hitOpenai = r2.findings.find((f) => f.pattern === 'apikey-kv');
  ok('库内密钥标记为已收口', hitOpenai && hitOpenai.inVault === true);
  ok('未登记密钥标记为未收口', r2.findings.some((f) => f.pattern === 'anthropic' && f.inVault === false));

  // ③ 占位符 / 示例值不报
  const dummy = path.join(tmpData, 'dummy.json');
  fs.writeFileSync(dummy, JSON.stringify({
    a: 'sk-xxxxxxxxxxxxxxxxxxxxxxxxxxxx',
    apiKey: 'your-api-key-here-123456',
    c: '<YOUR_API_KEY_1234567890>',
    d: 'AKIAIOSFODNN7EXAMPLE',
  }, null, 2));
  const r3 = scanSecrets({ paths: [dummy], defaults: false });
  ok('示例值不报', r3.findings.length === 0);

  // ④ 目录遍历：忽略 node_modules，递归子目录
  const dir = path.join(tmpData, 'proj');
  fs.mkdirSync(path.join(dir, 'node_modules'), { recursive: true });
  fs.mkdirSync(path.join(dir, 'sub'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'node_modules', 'leak.json'), JSON.stringify({ k: ANTHROPIC }));
  fs.writeFileSync(path.join(dir, 'sub', 'real.json'), JSON.stringify({ k: GH }));
  const r4 = scanSecrets({ paths: [dir], defaults: false });
  ok('忽略 node_modules', !r4.findings.some((f) => f.file.includes('node_modules')));
  ok('递归扫描子目录', r4.findings.some((f) => f.file.includes('sub') && f.pattern === 'github'));

  // ⑤ 二进制 / 过大文件跳过
  const bin = path.join(tmpData, 'bin.dat');
  fs.writeFileSync(bin, Buffer.from([0x00, 0x01, 0x02, ANTHROPIC.charCodeAt(0)]));
  const big = path.join(tmpData, 'big.json');
  fs.writeFileSync(big, 'x'.repeat(3 * 1024 * 1024) + ANTHROPIC);
  const r5 = scanSecrets({ paths: [bin, big], defaults: false });
  ok('二进制文件跳过', !r5.findings.some((f) => f.file.endsWith('bin.dat')));
  ok('过大文件记入 skipped', r5.skipped.some((s) => s.file.endsWith('big.json')));

  // ⑥ 掩码函数
  ok('短值全掩码', mask('short') === '***');
  ok('长值露头尾', /^.{6}….{4}$/.test(mask('abcdefghijklmnop')));

  // ⑦ 已登记客户端的 configPath 也会被扫（默认模式），且显式路径不受影响
  const reg = path.join(tmpData, 'registered.json');
  fs.writeFileSync(reg, JSON.stringify({ token: GH }));
  store.create('clients', { name: 'REG', type: 'cursor', enabled: true, configPath: reg });
  const r6 = scanSecrets({});
  ok('已登记客户端的配置文件被扫描', r6.findings.some((f) => f.file.endsWith('registered.json') && f.pattern === 'github'));
  ok('显式路径扫描不受已登记客户端影响', scanSecrets({ paths: [cfgFile], defaults: false }).scanned === 1);

  // ⑧ 特征表至少覆盖常见云厂商
  const ids = PATTERNS.map((p) => p.id);
  ['anthropic', 'openai-like', 'google', 'aws', 'github', 'jwt'].forEach((id) => ok('特征表含 ' + id, ids.includes(id)));

  console.log('\n全部通过：' + passed + ' 项');
} catch (e) {
  console.error('\n测试失败：', e.message);
  console.error(e.stack);
  process.exitCode = 1;
} finally {
  fs.rmSync(tmpData, { recursive: true, force: true });
}
