'use strict';
// 隔离测试：sync.json 配置落盘为原子写（不残留 .tmp，覆盖前留 .bak），且指向临时 data 目录
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const tmpData = fs.mkdtempSync(path.join(os.tmpdir(), 'aishare-synccfg-'));
process.env.AI_SHARE_DATA_DIR = tmpData;

const sync = require('../lib/sync');

let passed = 0;
function ok(name, cond) { assert.ok(cond, name); console.log('  ✓ ' + name); passed++; }

sync.saveConfig({ intervalMinutes: 15 });
const cfg = path.join(tmpData, 'sync.json');
ok('sync.json 已写入', fs.existsSync(cfg));
ok('内容为合法 JSON 且值正确', JSON.parse(fs.readFileSync(cfg, 'utf8')).intervalMinutes === 15);

sync.saveConfig({ intervalMinutes: 25 });
ok('覆盖后值已更新', JSON.parse(fs.readFileSync(cfg, 'utf8')).intervalMinutes === 25);
ok('覆盖前生成 .bak', fs.existsSync(cfg + '.bak'));
ok('.bak 为上一版本', JSON.parse(fs.readFileSync(cfg + '.bak', 'utf8')).intervalMinutes === 15);
ok('原子写：无 .tmp 残留', !fs.readdirSync(tmpData).some(f => f.endsWith('.tmp')));

console.log('全部通过：' + passed + ' 项');
