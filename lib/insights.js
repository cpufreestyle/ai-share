'use strict';
// Innovation patch A: lib/insights.js — resource health report + markdown index (zero-dep, read-only)
const fs = require('fs');
const path = require('path');

// 资源健康度：只读分析，不落盘。给概览页与 CLI 用。
// 检测四类问题：空关键字段 / 重复项 / 陈旧未更新 / 墓碑积压。
function healthReport(all, opts) {
  const o = opts || {};
  const staleDays = o.staleDays || 90;
  const now = Date.now();
  const cutoff = now - staleDays * 24 * 3600 * 1000;
  const cols = (all && all.collections) || {};
  const issues = [];
  const addIssue = (col, id, name, kind, detail) => issues.push({ collection: col, id: id || '', name: name || '', kind, detail: detail || '' });

  const label = { providers: 'API 端点', prompts: '提示词', mcpservers: 'MCP 服务器', skillrepos: 'Skill 仓库', clients: 'Agent 客户端', profiles: '方案', repos: '资源仓库' };

  for (const col of Object.keys(cols)) {
    const items = (Array.isArray(cols[col]) ? cols[col] : []).filter((x) => x && !x._deleted); // 墓碑只参与积压计数，不参与字段/重复/陈旧检查
    // 1) 关键字段缺失
    for (const it of items) {
      if (col === 'providers' && !it.baseUrl) addIssue(col, it.id, it.name, 'missing-field', '缺少 baseUrl，连通性测试无法执行');
      if (col === 'providers' && !it.apiKey) addIssue(col, it.id, it.name, 'missing-field', '缺少 API Key（本地模型可忽略）');
      if (col === 'mcpservers' && it.type === 'stdio' && !it.command) addIssue(col, it.id, it.name, 'missing-field', 'stdio 类型缺少启动命令');
      if ((col === 'mcpservers' || col === 'skillrepos') && it.type && it.type !== 'stdio' && it.type !== 'local' && !it.url) addIssue(col, it.id, it.name, 'missing-field', '缺少 URL / Git 地址');
      if (col === 'skillrepos' && it.type === 'local' && !it.path) addIssue(col, it.id, it.name, 'missing-field', '本地类型缺少路径');
      if (col === 'repos' && it.type === 'local' && !it.path) addIssue(col, it.id, it.name, 'missing-field', '本地仓库缺少路径');
      if (col === 'repos' && it.type === 'git' && !it.url) addIssue(col, it.id, it.name, 'missing-field', 'Git 仓库缺少地址');
    }
    // 2) 重名重复
    const byName = new Map();
    for (const it of items) {
      const k = String(it.name || '').trim().toLowerCase();
      if (!k) continue;
      if (!byName.has(k)) byName.set(k, []);
      byName.get(k).push(it);
    }
    for (const [, group] of byName) {
      if (group.length > 1) addIssue(col, group.map(g => g.id).join(','), group[0].name, 'duplicate', '同集合内 ' + group.length + ' 条同名记录');
    }
    // 3) 陈旧未更新（providers/mcpservers 才有连通意义；repos 看 lastSyncAt）
    if (col === 'providers' || col === 'mcpservers') {
      for (const it of items) {
        const t = Date.parse(it.updatedAt || it.createdAt || '') || 0;
        if (t && t < cutoff) addIssue(col, it.id, it.name, 'stale', '超过 ' + staleDays + ' 天未更新（' + new Date(t).toLocaleDateString() + '）');
      }
    }
    if (col === 'repos') {
      for (const it of items) {
        if (it.enabled && !it.lastSyncAt) addIssue(col, it.id, it.name, 'stale', '从未同步过，可点「同步」导入资源');
      }
    }
  }
  // 4) 墓碑积压（回收站体量）
  let tombstones = 0;
  for (const col of Object.keys(cols)) tombstones += (cols[col] || []).filter(x => x && x._deleted).length;
  if (tombstones > 0) addIssue('trash', '', '回收站', 'tombstones', tombstones + ' 条已删除记录待清理（墓碑保留期 30 天）');

  // 汇总
  const byKind = {};
  for (const it of issues) byKind[it.kind] = (byKind[it.kind] || 0) + 1;
  const score = Math.max(0, 100 - issues.length * 5);
  return {
    generatedAt: new Date().toISOString(),
    staleDays,
    counts: { providers: (cols.providers || []).length, mcpservers: (cols.mcpservers || []).length },
    issues,
    byKind,
    total: issues.length,
    score,
    summary: issues.length === 0 ? '全部资源状态良好' : (issues.length + ' 项待关注（' + Object.entries(byKind).map(([k, n]) => k + ' ' + n).join(' / ') + '）'),
    _labels: label,
  };
}

// Markdown 索引：把全部资源排成一份可分享/引用的目录（写盘由调用方决定）
function markdownIndex(all, opts) {
  const o = opts || {};
  const cols = (all && all.collections) || {};
  const esc = (s) => String(s == null ? '' : s).replace(/\|/g, '\\|').replace(/\n/g, ' ');
  const L = [];
  L.push('# AI 资源索引');
  L.push('');
  L.push('> 生成于 ' + new Date().toLocaleString() + '（ai-share）' + (o.homepage ? ' · 主页: ' + o.homepage : ''));
  L.push('');
  const sections = [
    ['providers', 'API 端点', (it) => ['`' + esc(it.name) + '`', esc(it.baseUrl || '—'), (it.models || []).slice(0, 4).map(esc).join(', ') || '—']],
    ['prompts', '提示词', (it) => ['`' + esc(it.name) + '`', esc((it.content || '').slice(0, 60).replace(/\s+/g, ' ')) + '…', esc((it.tags || []).join(', ')) || '—']],
    ['mcpservers', 'MCP 服务器', (it) => ['`' + esc(it.name) + '`', it.type === 'stdio' ? esc(it.command + ' ' + (it.args || []).join(' ')) : esc(it.url || '—'), it.enabled === false ? '停用' : '启用']],
    ['skillrepos', 'Skill 仓库', (it) => ['`' + esc(it.name) + '`', it.type === 'git' ? esc(it.url || '—') : esc(it.path || '—'), esc(it.description || '').slice(0, 60) || '—']],
    ['clients', 'Agent 客户端', (it) => ['`' + esc(it.name) + '`', esc(it.type || '—'), it.enabled === false ? '停用' : '启用']],
    ['repos', '资源仓库', (it) => ['`' + esc(it.name) + '`', it.type === 'git' ? esc(it.url || '—') : esc(it.path || '—'), it.lastSyncAt ? '同步于 ' + new Date(it.lastSyncAt).toLocaleDateString() : '未同步']],
  ];
  for (const [col, title, cols2] of sections) {
    const items = (cols[col] || []).filter(x => x && !x._deleted);
    L.push('## ' + title + '（' + items.length + '）');
    L.push('');
    if (!items.length) { L.push('（暂无）'); L.push(''); continue; }
    L.push('| 名称 | 位置/内容 | 备注 |');
    L.push('| --- | --- | --- |');
    for (const it of items) L.push('| ' + cols2(it).join(' | ') + ' |');
    L.push('');
  }
  const prof = (cols.profiles || []).filter(x => x && !x._deleted);
  if (prof.length) {
    L.push('## 共享方案（' + prof.length + '）');
    L.push('');
    for (const p of prof) L.push('- **' + esc(p.name) + '**' + (p.description ? ' — ' + esc(p.description) : ''));
    L.push('');
  }
  L.push('---');
  L.push('');
  L.push('*由 ai-share 自动生成；密钥不包含在本文件中。*');
  return L.join('\n');
}

module.exports = { healthReport, markdownIndex };
