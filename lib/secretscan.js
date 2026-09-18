'use strict';
// 明文密钥扫描（思路参照 gitleaks / trufflehog）：
// 扫描本地客户端配置文件与技能 / 提示词目录里的「疑似明文密钥」，
// 并标注该值是否已被本系统收口（等于某个 providers.apiKey）。
// 只读：绝不改写任何文件；结果只带脱敏片段，不把完整密钥经 /api 回传。
const fs = require('fs');
const path = require('path');

const MAX_FILE = 2 * 1024 * 1024; // 单文件上限：日志 / 构建产物不扫
const MAX_FILES = 400;            // 目录扫描的文件数上限
const MAX_FINDINGS = 300;         // 结果条数上限

// 忽略的目录（与 lib/export.js 的 IGNORE_DIRS 对齐，另加常见缓存目录）
const IGNORE_DIRS = new Set(['node_modules', '.git', 'dist', 'build', '.venv', 'venv', '__pycache__', '.next', 'out', 'target', 'bin', 'obj', '.cache']);

// 带值捕获的 kv / bearer 类最优先（能取出值本身做收口比对），其次具体厂商特征，
// 最后才是通用 sk-…——同一span 只报一次，避免同一段密钥被重复归到多类。
// group 表示「密钥值所在的捕获组」（需要取出值本身来做收口比对与脱敏）
const PATTERNS = [
  { id: 'apikey-kv', name: 'apikey 字段', re: /[A-Za-z_]*api[-_]?key["']?\s*[:=]\s*["']([A-Za-z0-9._~+/=-]{16,})["']/gi, group: 1 },
  { id: 'bearer', name: '硬编码 Bearer', re: /[Aa]uthorization["']?\s*[:=]\s*["']Bearer\s+([A-Za-z0-9._~+/=-]{16,})/g, group: 1 },
  { id: 'anthropic', name: 'Anthropic', re: /\bsk-ant-[A-Za-z0-9_-]{16,}\b/g },
  { id: 'openrouter', name: 'OpenRouter', re: /\bsk-or-v1-[A-Za-z0-9]{20,}\b/g },
  { id: 'google', name: 'Google AI Studio', re: /\bAIza[0-9A-Za-z_-]{30,}\b/g },
  { id: 'aws', name: 'AWS Access Key', re: /\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/g },
  { id: 'github', name: 'GitHub Token', re: /\b(?:ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9]{30,}\b/g },
  { id: 'gitlab', name: 'GitLab Token', re: /\bglpat-[A-Za-z0-9_-]{18,}\b/g },
  { id: 'slack', name: 'Slack Token', re: /\bxox[baprs]-[A-Za-z0-9-]{10,}\b/g },
  { id: 'stripe', name: 'Stripe Live Key', re: /\b(?:sk|rk)_live_[A-Za-z0-9]{20,}\b/g },
  { id: 'huggingface', name: 'HuggingFace', re: /\bhf_[A-Za-z0-9]{30,}\b/g },
  { id: 'jwt', name: 'JWT', re: /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b/g },
  { id: 'private-key', name: '私钥块', re: /-----BEGIN [A-Z ]*PRIVATE KEY-----/g },
  { id: 'openai-like', name: 'OpenAI 兼容（sk-…）', re: /\bsk-[A-Za-z0-9_-]{20,}\b/g },
];

// 明显是占位符 / 示例值的不报（your-api-key、<YOUR_KEY>、sk-xxxx… 等）
const PLACEHOLDER_RE = /(xxxx|example|placeholder|your[-_a-z]|<[a-z_]+>|\$\{)/i;

function isBinary(buf) {
  const n = Math.min(1024, buf.length);
  for (let i = 0; i < n; i++) if (buf[i] === 0) return true;
  return false;
}

// 只露头尾，避免把完整密钥写进响应体 / 日志
function mask(v) {
  const s = String(v);
  if (s.length <= 10) return '***';
  return s.slice(0, 6) + '…' + s.slice(-4);
}

function lineAt(text, index) {
  let n = 1;
  const end = Math.min(index, text.length);
  for (let i = 0; i < end; i++) if (text.charCodeAt(i) === 10) n++;
  return n;
}

function scanText(text, file, vaultKeys, findings, state) {
  const covered = [];
  const overlaps = (a, b) => covered.some(([s, e]) => a < e && b > s);
  for (const p of PATTERNS) {
    p.re.lastIndex = 0;
    let m;
    while ((m = p.re.exec(text)) !== null) {
      if (m[0].length === 0) { p.re.lastIndex++; continue; }
      const value = p.group ? (m[p.group] || '') : m[0];
      const start = m.index + (m.group ? m[0].indexOf(value) : 0);
      if (overlaps(start, start + value.length)) continue;
      covered.push([start, start + value.length]);
      if (PLACEHOLDER_RE.test(value)) continue;
      findings.push({
        file,
        line: lineAt(text, start),
        pattern: p.id,
        name: p.name,
        masked: mask(value),
        length: value.length,
        inVault: vaultKeys.has(value),
      });
      state.findings++;
      if (state.findings >= MAX_FINDINGS) return;
    }
    if (state.findings >= MAX_FINDINGS) return;
  }
}

function scanFile(file, vaultKeys, findings, state) {
  if (state.files >= MAX_FILES) return;
  state.files++;
  let st = null;
  try { st = fs.statSync(file); } catch (e) { return; }
  if (!st.isFile()) return;
  if (st.size > MAX_FILE) { state.skipped.push({ file, reason: '文件过大（' + st.size + ' 字节）' }); return; }
  let buf;
  try { buf = fs.readFileSync(file); } catch (e) { return; }
  if (isBinary(buf)) return;
  scanText(buf.toString('utf8'), file, vaultKeys, findings, state);
}

function walk(entry, vaultKeys, findings, state, depth) {
  if (state.files >= MAX_FILES || depth > 6) return;
  let real = entry;
  try { real = fs.realpathSync(entry); } catch (e) { return; }
  if (state.seen.has(real)) return;
  state.seen.add(real);
  let st = null;
  try { st = fs.statSync(real); } catch (e) { return; }
  if (st.isFile()) { scanFile(real, vaultKeys, findings, state); return; }
  if (!st.isDirectory()) return;
  state.dirs.push(real);
  let names = [];
  try { names = fs.readdirSync(real); } catch (e) { return; }
  for (const n of names) {
    if (state.files >= MAX_FILES) return;
    if (IGNORE_DIRS.has(n)) continue;
    walk(path.join(real, n), vaultKeys, findings, state, depth + 1);
  }
}

// 扫描目标：已登记客户端的 configPath / skillPaths / promptPaths
//            + 各客户端类型的默认配置路径（detectClients）
//            + 调用方额外传入的 paths
function scanSecrets(opts) {
  const o = opts || {};
  const { list } = require('./store');
  let vaultKeys = new Set();
  try {
    vaultKeys = new Set(list('providers').map((x) => x.apiKey).filter((v) => typeof v === 'string' && v.length > 8));
  } catch (e) { /* store 未就绪时不做收口比对 */ }

  const entries = new Set();
  // defaults:false 时只扫 o.paths（单测隔离用；默认会带上已登记客户端与各客户端默认配置路径）
  const useDefaults = o.defaults !== false;
  let clients = [];
  if (useDefaults) {
    try { clients = list('clients'); } catch (e) { clients = []; }
    // configPath / skillPaths 存的是 {APPDATA} 这类占位符，必须先展开成真实路径
    let expandFn = (p) => p;
    try { expandFn = require('./export').expand; } catch (e) { /* 占位符路径将被跳过 */ }
    for (const c of clients) {
      if (c.configPath) entries.add(String(expandFn(c.configPath)));
      (c.skillPaths || []).forEach((p) => entries.add(String(expandFn(p))));
      (c.promptPaths || []).forEach((p) => entries.add(String(expandFn(p))));
    }
    try {
      const { detectClients } = require('./export');
      for (const d of detectClients()) if (d && d.configPath) entries.add(String(expandFn(d.configPath)));
    } catch (e) { /* export 未就绪时只用已登记路径 */ }
  }
  (Array.isArray(o.paths) ? o.paths : []).forEach((p) => { if (typeof p === 'string' && p) entries.add(p); });

  const state = { files: 0, findings: 0, skipped: [], seen: new Set(), dirs: [] };
  const findings = [];
  for (const e of Array.from(entries)) walk(e, vaultKeys, findings, state, 0);

  const inVault = findings.filter((f) => f.inVault).length;
  return {
    scanned: state.files,
    scannedDirs: state.dirs.length,
    findings,
    skipped: state.skipped.slice(0, 20),
    truncated: state.files >= MAX_FILES || state.findings >= MAX_FINDINGS,
    summary: { total: findings.length, inVault, unknown: findings.length - inVault, files: new Set(findings.map((f) => f.file)).size },
  };
}

module.exports = { scanSecrets, PATTERNS, mask };
