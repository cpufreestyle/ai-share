'use strict';
// 文件写入工具：原子落盘，供 store / export / sync 共用。
const fs = require('fs');
const path = require('path');

// 原子写文件：写同目录临时文件 → fsync → rename（同分区 rename 是原子操作）。
// 直接覆盖目标文件一旦中途崩溃/磁盘满会截断；写前把当前内容留作 .bak 便于人工回滚。
function writeFileAtomic(target, data) {
  const tmp = path.join(path.dirname(target), '.' + path.basename(target) + '.tmp');
  const payload = Buffer.isBuffer(data) ? data : Buffer.from(String(data), 'utf8');
  const fd = fs.openSync(tmp, 'w');
  try {
    fs.writeFileSync(fd, payload);
    fs.fsyncSync(fd); // 确保数据真正落盘，避免断电后拿到空/半成品文件
  } catch (e) {
    try { fs.closeSync(fd); } catch (e2) { /* noop */ }
    try { fs.unlinkSync(tmp); } catch (e3) { /* noop */ }
    throw e;
  }
  fs.closeSync(fd);
  try { if (fs.existsSync(target)) fs.copyFileSync(target, target + '.bak'); } catch (e) { /* noop */ }
  try {
    fs.renameSync(tmp, target);
  } catch (e) {
    try { fs.unlinkSync(tmp); } catch (e2) { /* noop */ }
    throw e;
  }
}

function writeJsonAtomic(target, obj) {
  writeFileAtomic(target, JSON.stringify(obj, null, 2));
}

module.exports = { writeFileAtomic, writeJsonAtomic };
