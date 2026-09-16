'use strict';
// 本地自动备份：按固定间隔把全部资源写成带时间戳的 JSON 快照，滚动保留最近 N 份，支持一键回滚。
//
// 与「网络同步」的区别：同步解决多机一致（会把删除/修改传播出去），
// 本地快照解决「单机误操作」——导入错备份、误删、改坏配置都能退回上一个时间点。
// 快照是明文（与备份导出一致），落在数据目录下的 backups/，不要随仓库分发。
const fs = require('fs');
const path = require('path');
const { writeJsonAtomic } = require('./fsutil');

const DEFAULTS = {
  enabled: false,
  intervalHours: 12,
  keep: 10,
  dir: '', // 留空表示数据目录下的 backups/
};

// 快照名只允许文件名字符，杜绝 ../ 之类的路径穿越
const NAME_RE = /^[A-Za-z0-9._-]+$/;
const FILE_RE = /^ai-share-\d{8}-\d{6}(-\d+)?\.json$/;

function dataDir() {
  // 延迟读取，确保测试里 AI_SHARE_DATA_DIR 已生效
  return require('./store').DATA_DIR;
}
function cfgFile() {
  return path.join(dataDir(), 'backup.json');
}
function dirOf(cfg) {
  return cfg && cfg.dir ? path.resolve(cfg.dir) : path.join(dataDir(), 'backups');
}

function getConfig() {
  try {
    return Object.assign({}, DEFAULTS, JSON.parse(fs.readFileSync(cfgFile(), 'utf8')));
  } catch (e) {
    return Object.assign({}, DEFAULTS);
  }
}

function saveConfig(patch) {
  const next = Object.assign(getConfig(), patch || {});
  // 约束：保留 1~50 份，间隔 1~720 小时，避免误填 0 变成「写满磁盘」或「疯狂写盘」。
  // 用 Number.isFinite 判断，避免 0 被 `||` 当成「未填写」而误回退到默认值。
  const num = (v, d) => (Number.isFinite(Number(v)) ? Number(v) : d);
  next.keep = Math.min(50, Math.max(1, Math.round(num(next.keep, DEFAULTS.keep))));
  next.intervalHours = Math.min(720, Math.max(1, Math.round(num(next.intervalHours, DEFAULTS.intervalHours))));
  writeJsonAtomic(cfgFile(), next);
  return next;
}

function stamp(d) {
  const p = (n) => String(n).padStart(2, '0');
  return (
    String(d.getFullYear()) + p(d.getMonth() + 1) + p(d.getDate()) +
    '-' + p(d.getHours()) + p(d.getMinutes()) + p(d.getSeconds())
  );
}

function snapshotCount(payload) {
  const cols = (payload && payload.collections) || {};
  return Object.values(cols).reduce((acc, v) => acc + (Array.isArray(v) ? v.length : 0), 0);
}

// 生成一份快照。reason 仅用于事后区分来源（manual / auto / before-restore）。
function createSnapshot(reason) {
  const store = require('./store');
  const cfg = getConfig();
  const dir = dirOf(cfg);
  fs.mkdirSync(dir, { recursive: true });

  const base = 'ai-share-' + stamp(new Date());
  let name = base + '.json';
  let i = 1;
  while (fs.existsSync(path.join(dir, name))) name = base + '-' + i++ + '.json'; // 同秒内重复 → 加序号

  const target = path.join(dir, name);
  const payload = Object.assign(
    { kind: 'ai-share-snapshot', takenAt: new Date().toISOString(), reason: reason || 'manual' },
    store.exportAll()
  );
  writeJsonAtomic(target, payload);

  const rotated = rotate(cfg);
  const meta = { name, size: fs.statSync(target).size, at: payload.takenAt, count: snapshotCount(payload) };
  saveConfig({
    lastBackupAt: payload.takenAt,
    lastResult: '成功：' + name + '（' + meta.count + ' 项）',
    lastCount: rotated.kept,
  });
  return { ok: true, rotated: rotated.removed, snapshot: meta, dir };
}

function listSnapshots() {
  const cfg = getConfig();
  const dir = dirOf(cfg);
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir)
    .filter((f) => FILE_RE.test(f))
    .map((f) => {
      const full = path.join(dir, f);
      const st = fs.statSync(full);
      let takenAt = st.mtime.toISOString();
      let count = null;
      let collections = null;
      try {
        const j = JSON.parse(fs.readFileSync(full, 'utf8'));
        takenAt = j.takenAt || takenAt;
        collections = {};
        for (const [k, v] of Object.entries(j.collections || {})) collections[k] = Array.isArray(v) ? v.length : 0;
        count = snapshotCount(j);
      } catch (e) {
        /* 解析失败标记为损坏，界面会提示 */
      }
      return { name: f, size: st.size, takenAt, count, collections, corrupt: count === null };
    })
    .sort((a, b) => new Date(b.takenAt) - new Date(a.takenAt));
}

// 滚动清理：保留最近 keep 份，其余删除
function rotate(cfg) {
  const c = cfg || getConfig();
  const keep = Math.max(1, Number(c.keep) || DEFAULTS.keep);
  const all = listSnapshots();
  const removed = [];
  for (const s of all.slice(keep)) {
    const full = path.join(dirOf(c), s.name);
    try {
      fs.unlinkSync(full);
      removed.push(s.name);
    } catch (e) {
      /* 忽略删除失败 */
    }
  }
  return { kept: Math.min(keep, all.length), removed, total: all.length };
}

function deleteSnapshot(name) {
  if (!NAME_RE.test(name)) return { error: '无效的快照名' };
  const cfg = getConfig();
  const full = path.join(dirOf(cfg), name);
  if (!fs.existsSync(full)) return { error: '快照不存在' };
  fs.unlinkSync(full);
  return { ok: true, removed: name };
}

// 回滚到某份快照：先把当前状态存成一份新快照（避免回滚本身成为不可逆操作）
function restoreSnapshot(name, mode) {
  if (!NAME_RE.test(name) || !FILE_RE.test(name)) return { error: '无效的快照名' };
  const store = require('./store');
  const cfg = getConfig();
  const full = path.join(dirOf(cfg), name);
  if (!fs.existsSync(full)) return { error: '快照不存在' };

  let payload;
  try {
    payload = JSON.parse(fs.readFileSync(full, 'utf8'));
  } catch (e) {
    return { error: '快照文件损坏，无法恢复' };
  }
  if (!payload || !payload.collections) return { error: '快照格式不正确' };

  let safety = null;
  try {
    safety = createSnapshot('before-restore').snapshot;
  } catch (e) {
    /* 兜底失败不阻断恢复，但会在返回值里说明 */
  }

  const r = store.restoreAll(payload.collections, mode === 'replace' ? 'replace' : 'merge');
  saveConfig({ lastResult: '已从 ' + name + ' 回滚（' + (mode === 'replace' ? '覆盖' : '合并') + '）' });
  return Object.assign({ ok: true, restored: name, count: snapshotCount(payload), safety }, r);
}

/* ---------- 定时自动快照 ---------- */
let timer = null;
function stopAuto() {
  if (timer) {
    clearInterval(timer);
    timer = null;
  }
}
function startAuto(override) {
  stopAuto();
  const cfg = Object.assign(getConfig(), override || {});
  if (!cfg.enabled) return { running: false };
  const hours = Math.min(720, Math.max(1, Math.round(Number(cfg.intervalHours) || DEFAULTS.intervalHours)));
  const ms = hours * 3600 * 1000;
  timer = setInterval(() => {
    try {
      createSnapshot('auto');
    } catch (e) {
      saveConfig({ lastResult: '失败：' + ((e && e.message) || e) }); // 定时任务不许抛出
    }
  }, ms);
  if (timer.unref) timer.unref(); // 不阻止进程退出（测试友好）
  return { running: true, intervalHours: hours };
}
function autoStatus() {
  const cfg = getConfig();
  return {
    running: !!timer,
    enabled: !!cfg.enabled,
    intervalHours: cfg.intervalHours,
    keep: cfg.keep,
    dir: dirOf(cfg),
    lastBackupAt: cfg.lastBackupAt || null,
    lastResult: cfg.lastResult || null,
    count: listSnapshots().length,
  };
}

module.exports = {
  DEFAULTS, getConfig, saveConfig, createSnapshot, listSnapshots, rotate,
  deleteSnapshot, restoreSnapshot, startAuto, stopAuto, autoStatus, dirOf,
};
