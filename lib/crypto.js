'use strict';
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const KEY_FILE = path.join(__dirname, '..', 'data', '.key');

// activeKey 优先（主密码解锁后），否则回退到本地 key 文件（兼容未启用主密码的旧数据）
let activeKey = null;

function baseKey() {
  if (fs.existsSync(KEY_FILE)) return fs.readFileSync(KEY_FILE);
  const k = crypto.randomBytes(32);
  fs.mkdirSync(path.dirname(KEY_FILE), { recursive: true });
  fs.writeFileSync(KEY_FILE, k, { mode: 0o600 });
  return k;
}
function getKey() { return activeKey || baseKey(); }
function setKey(k) { activeKey = k; }
function clearKey() { activeKey = null; }
function hasKey() { return activeKey !== null; }

function encrypt(plain) {
  if (plain === '' || plain == null) return plain;
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', getKey(), iv);
  const ct = Buffer.concat([cipher.update(String(plain), 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return 'v1:' + Buffer.concat([iv, tag, ct]).toString('base64');
}

function decrypt(cipher) {
  if (!cipher || typeof cipher !== 'string' || !cipher.startsWith('v1:')) return cipher;
  try {
    const buf = Buffer.from(cipher.slice(3), 'base64');
    const iv = buf.slice(0, 12), tag = buf.slice(12, 28), ct = buf.slice(28);
    const decipher = crypto.createDecipheriv('aes-256-gcm', getKey(), iv);
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(ct), decipher.final()]).toString('utf8');
  } catch (e) {
    return cipher; // 解密失败（未解锁 / 密码错误）时原样返回密文
  }
}

function deriveKey(password, salt) { return crypto.pbkdf2Sync(password, salt, 120000, 32, 'sha256'); }
function genSalt() { return crypto.randomBytes(16); }

module.exports = { encrypt, decrypt, getKey, setKey, clearKey, hasKey, deriveKey, genSalt };
