'use strict';
// 跨进程互斥锁（哨兵文件 + 'wx' 独占创建），零依赖。
//
// 背景：所有 JSON 写入虽已原子化（临时文件 → fsync → rename），但「读 → 改 → 写」
// 是一个跨三步的序列。单进程内事件循环天然串行（store 的 CRUD 全同步），不会丢更新；
// 若同时跑两个实例（例如忘了关旧窗口又开一个），两个进程的读改写会交错，
// 后写完的一方会把对方的修改整体覆盖掉。这里用锁把整个序列包起来。
//
// 语义：
//   - 同进程可重入（按引用计数），避免未来在已持锁的代码里再次调用 CRUD 时自锁；
//   - 其它进程持锁时最多等待 timeout（默认 5s），超时抛错而不是强行写入；
//   - 持锁进程崩溃会留下哨兵文件：pid 不存在、或存在但已超过 staleMs 时视为陈旧锁并清理，
//     避免一次崩溃导致该集合永久不可写。
const fs = require('fs');
const path = require('path');

const STALE_MS = 15000; // 正常一次读改写远小于此，超过则大概率是崩溃残留
const WAIT_MS = 5000; // 等待其它进程释放的最长时间
const INTERVAL_MS = 20;

// 本进程已持有的锁（lockPath → 引用计数）
const held = new Map();

function sleepSync(ms) {
  try {
    // 主线程允许 Atomics.wait（Node ≥ 9）；个别环境不支持时退化为忙等
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
  } catch (e) {
    const end = Date.now() + ms;
    while (Date.now() < end) {
      /* busy wait */
    }
  }
}

function pidAlive(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0); // signal 0：仅探测存在性，不会真的发信号
    return true;
  } catch (e) {
    return e.code === 'EPERM'; // 无权限说明进程存在
  }
}

// 无法统计（已被别的进程清理）/ 已超过 staleMs / 持有者进程已消失 → 判为陈旧锁并删除。
// 年龄优先看文件 mtime 而不是文件内容里的时间戳：即使内容损坏也能做出判断。
function clearIfStale(lockPath, staleMs) {
  let st;
  try {
    st = fs.statSync(lockPath);
  } catch (e) {
    return true; // 文件已不存在，外层可直接重试
  }
  if (Date.now() - st.mtimeMs > staleMs) {
    try {
      fs.unlinkSync(lockPath);
      return true;
    } catch (e) {
      return false;
    }
  }
  let pid = NaN;
  try {
    pid = Number(JSON.parse(fs.readFileSync(lockPath, 'utf8')).pid);
  } catch (e) {
    /* 内容尚不可读：持有者刚创建就被抢占是极小概率，等它超过 staleMs 再清理 */
  }
  if (Number.isInteger(pid) && pid > 0 && !pidAlive(pid)) {
    try {
      fs.unlinkSync(lockPath);
      return true;
    } catch (e) {
      return false;
    }
  }
  return false;
}

function releaseRef(lockPath) {
  const n = (held.get(lockPath) || 1) - 1;
  if (n > 0) {
    held.set(lockPath, n);
    return;
  }
  held.delete(lockPath);
  try {
    fs.unlinkSync(lockPath);
  } catch (e) {
    /* 已被抢占或已删除，忽略 */
  }
}

// 获取 file 对应的写锁，返回 release 函数（必须调用，建议放 finally）。
function acquire(file, opts) {
  const o = opts || {};
  const lockPath = file + '.lock';
  const timeout = o.timeout == null ? WAIT_MS : o.timeout;
  const interval = o.interval == null ? INTERVAL_MS : o.interval;
  const staleMs = o.staleMs == null ? STALE_MS : o.staleMs;

  const cur = held.get(lockPath) || 0;
  if (cur > 0) {
    held.set(lockPath, cur + 1); // 同进程重入
    return () => releaseRef(lockPath);
  }

  try {
    fs.mkdirSync(path.dirname(lockPath), { recursive: true });
  } catch (e) {
    /* 目录不可建时创建锁文件会失败，由下面抛出 */
  }

  const deadline = Date.now() + timeout;
  for (;;) {
    try {
      // 'wx' 独占创建 + 一次写入：内容与文件同时可见，其它进程不会读到空哨兵
      fs.writeFileSync(lockPath, JSON.stringify({ pid: process.pid, ts: Date.now() }), { flag: 'wx' });
      held.set(lockPath, 1);
      return () => releaseRef(lockPath);
    } catch (e) {
      if (e.code !== 'EEXIST') throw e;
    }
    if (!clearIfStale(lockPath, staleMs)) {
      if (Date.now() >= deadline) {
        throw new Error('获取写锁超时，可能有另一个实例正在写入: ' + lockPath);
      }
      sleepSync(interval);
    }
  }
}

// 在锁内执行 fn：store 的每个读改写序列都走这里，返回的正是 fn 的返回值。
function withLock(file, fn, opts) {
  const release = acquire(file, opts);
  try {
    return fn();
  } finally {
    release();
  }
}

function isHeld(file) {
  return held.has(file + '.lock');
}

function reset() {
  // 仅供测试：清空本进程的持锁记录（不删哨兵文件，因为正常情况下 release 已删）
  held.clear();
}

module.exports = { acquire, withLock, isHeld, reset, STALE_MS, WAIT_MS };
