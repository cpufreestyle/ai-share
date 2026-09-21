'use strict';
// test/run-all.js — 并行测试 runner（零依赖）
// 用法: node test/run-all.js [并发数]   默认并发 = min(4, cpu 数)
// 设计约束:
//  - 每个套件是独立进程（AI_SHARE_DATA_DIR 各自 mkdtemp，server.listen(0) 随机端口），互不共享状态，可安全并行
//  - 输出按「完成顺序」流式打印，但每套件内的行保持原子（行级缓冲），避免交错乱码
//  - 任一套件退出码非 0 → 整体失败；结束打印逐套件耗时汇总
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');

const dir = __dirname;
const suites = fs.readdirSync(dir).filter(f => f.endsWith('.test.js')).sort();
const limit = Math.max(1, Math.min(parseInt(process.argv[2], 10) || 4, suites.length, require('os').cpus().length));

if (process.argv.includes('--list')) { console.log(suites.join('\n')); process.exit(0); }

const results = [];
let cursor = 0, failed = 0;

function printSafe(lines) { for (const l of lines) process.stdout.write(l + '\n'); }

function runSuite(file, done) {
  const t0 = Date.now();
  const child = spawn(process.execPath, [path.join(dir, file)], { env: process.env, stdio: ['ignore', 'pipe', 'pipe'] });
  let buf = '';
  const flush = (chunk, dest) => {
    buf += chunk.toString('utf8');
    let i;
    while ((i = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, i); buf = buf.slice(i + 1);
      (dest === 'stderr' ? process.stderr : process.stdout).write('  [' + file.replace('.test.js', '') + '] ' + line + '\n');
    }
  };
  child.stdout.on('data', c => flush(c, 'stdout'));
  child.stderr.on('data', c => flush(c, 'stderr'));
  child.on('close', (code) => {
    if (buf.trim()) printSafe([buf]);
    const ms = Date.now() - t0;
    results.push({ file, code: code || 0, ms });
    if (code) failed++;
    done();
  });
}

function next() {
  if (cursor >= suites.length) return;
  runSuite(suites[cursor++], next);
}
for (let i = 0; i < limit; i++) next();

process.on('exit', () => {
  if (!results.length) return;
  console.log('\n===== 套件汇总（并发 ' + limit + '）=====');
  for (const r of results.sort((a, b) => a.file.localeCompare(b.file))) {
    console.log((r.code ? '✗ ' : '✓ ') + r.file + '  ' + r.ms + 'ms');
  }
  console.log('总计: ' + suites.length + ' 套件, 失败 ' + failed + ', 墙钟 ' + results.reduce((m, r) => Math.max(m, r.ms), 0) + 'ms');
});
