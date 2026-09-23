'use strict';

/* ---------- API ---------- */
// 统一请求封装：非 2xx 时抛错（含服务端 error 信息），响应非 JSON 时兜底为空对象
async function jfetch(url, opts) {
  const res = await fetch(url, opts);
  let data = {};
  try { data = await res.json(); } catch (e) { data = {}; }
  if (!res.ok) throw new Error(data.error || ('HTTP ' + res.status));
  return data;
}
const api = {
  list: c => jfetch('/api/' + c),
  get: (c, id) => jfetch(`/api/${c}/${id}`),
  create: (c, body) => jfetch('/api/' + c, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }),
  update: (c, id, body) => jfetch(`/api/${c}/${id}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }),
  remove: (c, id) => jfetch(`/api/${c}/${id}`, { method: 'DELETE' }),
  purgeTombstone: (c, id) => jfetch(`/api/${c}/${id}/tombstone`, { method: 'DELETE' }),
  bulkDelete: (c, ids) => jfetch(`/api/${c}/bulk-delete`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ids }) }),
  bulkRestore: (items) => jfetch('/api/trash/bulk-restore', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ items }) }),
  bulkPurge: (items) => jfetch('/api/trash/bulk-purge', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ items }) }),
  bulkEnabled: (c, ids, enabled) => jfetch(`/api/${c}/bulk-enabled`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ids, enabled }) }),
  trashPurgeAll: () => jfetch('/api/trash/purge-all', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' }),
  planExport: (id) => jfetch(`/api/export/${id}/plan`, { method: 'POST' }),
  scanSecrets: () => jfetch('/api/security/scan-secrets', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' }),
  planExport: (id) => jfetch(`/api/export/${id}/plan`, { method: 'POST' }),
  scanSecrets: () => jfetch('/api/security/scan-secrets', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' }),
  planExport: (id) => jfetch(`/api/export/${id}/plan`, { method: 'POST' }),
  scanSecrets: () => jfetch('/api/security/scan-secrets', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' }),
  planExport: (id) => jfetch(`/api/export/${id}/plan`, { method: 'POST' }),
  scanSecrets: () => jfetch('/api/security/scan-secrets', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' }),
  planExport: (id) => jfetch(`/api/export/${id}/plan`, { method: 'POST' }),
  scanSecrets: () => jfetch('/api/security/scan-secrets', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' }),
  planExport: (id) => jfetch(`/api/export/${id}/plan`, { method: 'POST' }),
  scanSecrets: () => jfetch('/api/security/scan-secrets', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' }),
  planExport: (id) => jfetch(`/api/export/${id}/plan`, { method: 'POST' }),
  scanSecrets: () => jfetch('/api/security/scan-secrets', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' }),
  planExport: (id) => jfetch(`/api/export/${id}/plan`, { method: 'POST' }),
  scanSecrets: () => jfetch('/api/security/scan-secrets', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' }),
  export: id => jfetch('/api/export/' + id),
  apply: id => jfetch(`/api/export/${id}/apply`, { method: 'POST' }),
  postBundle: bundle => jfetch('/api/profiles/import', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ bundle }) }),
};

/* ---------- 密钥保险库（主密码） ---------- */
function renderVault() {
  const el = document.getElementById('status');
  fetch('/api/vault/status').then(r => r.json()).then(s => {
    if (s.enabled && s.locked) {
      el.innerHTML = `🔒 <input id="vp" type="password" placeholder="主密码" style="width:88px"/> <button class="btn sm" id="vUnlock">解锁</button>`;
      document.getElementById('vUnlock').onclick = async () => {
        const r = await fetch('/api/vault/unlock', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ password: document.getElementById('vp').value }) }).then(x => x.json());
        if (r.ok) { toast('已解锁'); renderVault(); } else toast(r.error || '密码错误');
      };
    } else if (s.enabled && !s.locked) {
      el.innerHTML = `🔓 密钥已解锁 <button class="btn sm" id="vLock">锁定</button>`;
      document.getElementById('vLock').onclick = () => fetch('/api/vault/lock', { method: 'POST' }).then(() => { toast('已锁定'); renderVault(); });
    } else {
      el.innerHTML = `🔒 <button class="btn sm" id="vSet">启用主密码</button>`;
      document.getElementById('vSet').onclick = openVaultSet;
    }
  }).catch(() => { el.textContent = '● 本地服务已连接'; });
}
/* ---------- 数据目录展示 ---------- */
// 数据目录由 DATA_DIR 推导（可用环境变量 AI_SHARE_DATA_DIR 覆盖），
// 并不位于程序安装目录；这里显式展示，避免误判数据存放位置。
function renderDataDir() {
  const el = document.getElementById('dataDir');
  if (!el) return;
  fetch('/api/system/info').then(r => r.json()).then(s => {
    el.innerHTML = '<span title="' + s.dataDir + '">📁 数据目录 <code>' + s.dataDir + '</code></span>';
  }).catch(() => { el.textContent = ''; });
}

function openVaultSet() {
  const body = document.getElementById('modalBody');
  body.innerHTML = `<div class="field"><label>设置主密码</label><input id="vpw" type="password" placeholder="用于解锁密钥"/></div>
    <div class="hint">启用后，密钥将以主密码派生密钥加密；重启服务需先输入密码才能读取密钥。</div>`;
  document.getElementById('modalTitle').textContent = '启用主密码';
  document.getElementById('modal').classList.remove('hidden');
  document.getElementById('modalSave').onclick = async () => {
    const pw = document.getElementById('vpw').value;
    if (!pw) return toast('请输入密码');
    const r = await fetch('/api/vault/set', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ password: pw }) }).then(x => x.json());
    if (r.ok) { closeModal(); toast('主密码已启用'); renderVault(); } else toast('失败');
  };
}

function toast(msg) {
  const t = document.getElementById('toast');
  if (!t) return;
  // 先写入内容，待下一帧布局稳定后再显示，规避部分 WebView 内核
  // 在元素由 display:none 切到显示瞬间读取几何信息导致的崩溃。
  t.textContent = msg;
  if (t._raf) cancelAnimationFrame(t._raf);
  t._raf = requestAnimationFrame(() => {
    t.classList.remove('hidden');
    clearTimeout(t._t); t._t = setTimeout(() => t.classList.add('hidden'), 2200);
  });
}
function esc(s) { return String(s ?? '').replace(/[&<>"]/g, m => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[m])); }
function $(sel) { return document.querySelector(sel); }

// 以应用内 modal 展示一段信息（替代原生 alert）
function showInfoModal(title, text) {
  const body = $('#modalBody');
  body.innerHTML = `<pre class="infotext">${esc(text)}</pre>`;
  $('#modalTitle').textContent = title;
  $('#modalSave').textContent = '关闭';
  $('#modalSave').onclick = closeModal;
  $('#modal').classList.remove('hidden');
}
// 应用内确认框（替代原生 confirm，兼容部分禁用 confirm 的 WebView）
function confirmModal(title, text, onOk, okLabel = '确认') {
  const body = $('#modalBody');
  body.innerHTML = `<p class="confirm-text">${esc(text)}</p>`;
  $('#modalTitle').textContent = title;
  $('#modalSave').textContent = okLabel;
  $('#modal').classList.remove('hidden');
  $('#modalSave').onclick = () => { closeModal(); onOk(); };
}

/* ---------- 集合 Schema ---------- */
const SCHEMAS = {
  providers: {
    label: 'API 端点', icon: '🔌', titleField: 'name', descField: 'baseUrl', tagsField: 'models',
    fields: [
      { key: 'name', label: '名称', type: 'text', required: true },
      { key: 'baseUrl', label: 'Base URL', type: 'text' },
      { key: 'apiKey', label: 'API Key', type: 'password' },
      { key: 'models', label: '模型列表', type: 'list', hint: '逗号分隔，如 gpt-4o, qwen2.5' },
      { key: 'notes', label: '备注', type: 'textarea' },
    ],
  },
  prompts: {
    label: '提示词', icon: '💬', titleField: 'name', descField: 'content', tagsField: 'tags',
    fields: [
      { key: 'name', label: '名称', type: 'text', required: true },
      { key: 'category', label: '分类', type: 'text' },
      { key: 'content', label: '提示词内容', type: 'textarea', rows: 5 },
      { key: 'tags', label: '标签', type: 'list' },
    ],
  },
  mcpservers: {
    label: 'MCP 服务器', icon: '🧩', titleField: 'name', descField: '_desc',
    fields: [
      { key: 'name', label: '名称', type: 'text', required: true },
      { key: 'type', label: '类型', type: 'select', options: ['stdio', 'sse', 'http'] },
      { key: 'command', label: '启动命令', type: 'text', showIf: t => t === 'stdio', hint: '如 npx / uvx' },
      { key: 'args', label: '参数', type: 'list', showIf: t => t === 'stdio' },
      { key: 'env', label: '环境变量', type: 'kv', showIf: t => t === 'stdio', hint: '每行 KEY=VALUE' },
      { key: 'url', label: 'URL', type: 'text', showIf: t => t !== 'stdio' },
      { key: 'headers', label: '请求头', type: 'kv', showIf: t => t !== 'stdio', hint: '每行 KEY=VALUE' },
      { key: 'enabled', label: '启用', type: 'checkbox' },
    ],
  },
  skillrepos: {
    label: 'Skill 仓库', icon: '📦', titleField: 'name', descField: 'description',
    // 被方案(profile)直接引用；是“已登记的 Skill 来源”，不是同步通道
    fields: [
      { key: 'name', label: '名称', type: 'text', required: true },
      { key: 'type', label: '类型', type: 'select', options: ['git', 'local'] },
      { key: 'url', label: 'Git 地址', type: 'text', showIf: t => t === 'git', hint: 'Skill 来源地址；该仓库会被方案直接引用' },
      { key: 'path', label: '本地路径', type: 'text', showIf: t => t === 'local', hint: '本地 Skill 目录（每子目录一个 SKILL.md）' },
      { key: 'description', label: '描述', type: 'textarea' },
    ],
  },
  clients: {
    label: 'Agent 客户端', icon: '🖥️', titleField: 'name', descField: 'configPath',
    fields: [
      { key: 'name', label: '名称', type: 'text', required: true },
      { key: 'type', label: '类型', type: 'select', options: ['claude', 'cursor', 'vscode', 'codebuddy', 'generic'] },
      { key: 'enabled', label: '启用', type: 'checkbox' },
      { key: 'configPath', label: '配置写入路径', type: 'text', hint: '支持占位符 {APPDATA} {USERPROFILE}' },
      { key: 'skillPaths', label: 'Skill 扫描路径', type: 'paths', hint: '每行一个本地目录，支持占位符 {APPDATA} {USERPROFILE}；留空则用内置默认路径扫描 Skill' },
      { key: 'promptPaths', label: '提示词扫描路径', type: 'paths', hint: '每行一个文件或目录（支持 .md/.mdc/.txt），覆盖内置的提示词/规则扫描源' },
      { key: 'description', label: '描述', type: 'textarea' },
    ],
  },
  repos: {
    label: '资源仓库(同步)', icon: '🗂️', titleField: 'name', descField: '_desc',
    // 通用“仓库扫描导入器”：主要登记“生成的软件项目目录”（d:\ai share\repo\ 下的本地目录），
    // 一个项目可同时包含 Skill/MCP/提示词，故 resourceType 为多选；同步到 skillrepos/mcpservers/prompts。
    // 与 skillrepos 的区别在于它是“同步通道”，不是被方案直接引用的来源。
    fields: [
      { key: 'name', label: '名称', type: 'text', required: true },
      { key: 'type', label: '来源类型', type: 'select', options: ['local', 'git'], hint: '主要用 local（生成的软件项目目录），git 仅作可选补充' },
      { key: 'url', label: 'Git 地址', type: 'text', showIf: t => t === 'git', hint: '远程仓库地址，如 https://github.com/...（同步时自动 clone 到本地缓存）' },
      { key: 'path', label: '本地路径', type: 'text', showIf: t => t === 'local', hint: '生成的软件项目目录，如 d:\\ai share\\repo\\my-project（支持 {APPDATA} {USERPROFILE} 占位符）' },
      { key: 'resourceType', label: '同步到（可多选）', type: 'select', multiple: true, options: ['skillrepos', 'mcpservers', 'prompts'], hint: '一个生成的软件项目里可能同时含 Skill/MCP/提示词，可多选；会分别扫描导入到对应集合' },
      { key: 'enabled', label: '启用', type: 'checkbox' },
      { key: 'description', label: '描述', type: 'textarea' },
    ],
  },
};

/* ---------- 字段转换 ---------- */
function toList(str) { return String(str || '').split(',').map(s => s.trim()).filter(Boolean); }
function fromList(arr) { return (arr || []).join(', '); }
function toKV(str) {
  const o = {};
  String(str || '').split('\n').forEach(line => {
    const i = line.indexOf('=');
    if (i > 0) o[line.slice(0, i).trim()] = line.slice(i + 1).trim();
  });
  return o;
}
function fromKV(obj) { return Object.entries(obj || {}).map(([k, v]) => `${k}=${v}`).join('\n'); }

/* ---------- 通用表单字段渲染 ---------- */
function fieldHtml(f, val, typeVal) {
  if (f.showIf && !f.showIf(typeVal)) return '';
  const v = val ?? '';
  let inner = '';
  if (f.type === 'textarea') {
    inner = `<textarea id="f_${f.key}" rows="${f.rows || 3}">${esc(v)}</textarea>`;
  } else if (f.type === 'select') {
    if (f.multiple) {
      const arr = Array.isArray(v) ? v : (v ? [v] : []);
      inner = `<select id="f_${f.key}" multiple size="${f.options.length}">${f.options.map(o => `<option ${arr.includes(o) ? 'selected' : ''}>${o}</option>`).join('')}</select>`;
    } else {
      inner = `<select id="f_${f.key}">${f.options.map(o => `<option ${o === v ? 'selected' : ''}>${o}</option>`).join('')}</select>`;
    }
  } else if (f.type === 'checkbox') {
    return `<div class="field check"><input type="checkbox" id="f_${f.key}" ${v ? 'checked' : ''}/><label for="f_${f.key}">${esc(f.label)}</label></div>`;
  } else if (f.type === 'list') {
    inner = `<input id="f_${f.key}" value="${esc(fromList(v))}"/>`;
  } else if (f.type === 'kv') {
    inner = `<textarea id="f_${f.key}" rows="3">${esc(fromKV(v))}</textarea>`;
  } else if (f.type === 'paths') {
    inner = `<textarea id="f_${f.key}" rows="3" placeholder="每行一个路径">${esc(Array.isArray(v) ? v.join('\n') : v)}</textarea>`;
  } else if (f.type === 'password') {
    inner = `<input id="f_${f.key}" type="password" value="${esc(v)}" placeholder="•••••" autocomplete="off"/>
      <div class="pwops"><button type="button" class="btn sm" data-pwtoggle="${f.key}">显示</button><button type="button" class="btn sm" data-pwcopy="${f.key}">复制</button></div>`;
  } else {
    inner = `<input id="f_${f.key}" value="${esc(v)}"/>`;
  }
  return `<div class="field"><label>${esc(f.label)}</label>${inner}${f.hint ? `<div class="hint">${esc(f.hint)}</div>` : ''}</div>`;
}

function readField(f) {
  const node = $('#f_' + f.key);
  if (!node) return undefined;
  if (f.type === 'checkbox') return node.checked;
  if (f.type === 'select' && f.multiple) return Array.from(node.selectedOptions).map(o => o.value);
  if (f.type === 'list') return toList(node.value);
  if (f.type === 'kv') return toKV(node.value);
  if (f.type === 'paths') return String(node.value).split('\n').map(s => s.trim()).filter(Boolean);
  return node.value;
}

/* ---------- Modal ---------- */
function openForm(col, item, onSave) {
  const schema = SCHEMAS[col];
  const isNew = !item;
  const cur = item || {};
  const body = $('#modalBody');
  const addDetectBtn = () => {
    if (col !== 'clients') return;
    const inp = $('#f_configPath'); if (!inp) return;
    const fieldEl = inp.closest('.field'); if (!fieldEl) return;
    if (fieldEl.querySelector('#detectBtn')) return;
    const b = document.createElement('button');
    b.id = 'detectBtn'; b.className = 'btn sm'; b.textContent = '自动探测'; b.style.marginTop = '6px';
    b.onclick = async () => {
      // 注意：点击发生在渲染之后，期间表单可能已重渲染或关闭，
      // 因此这里必须重新查询并判空，不能沿用闭包外的引用。
      const typeEl = $('#f_type');
      if (!typeEl) return;
      const det = await fetch('/api/detect/clients').then(r => r.json());
      const hit = det.find(d => d.type === typeEl.value);
      if (!hit) return toast('未找到该类型的默认路径模板');
      const pathEl = $('#f_configPath');
      if (!pathEl) return;
      pathEl.value = hit.configPath;
      const msg = `已填入路径${hit.installed ? '，客户端已安装' : ''}${hit.exists ? '，发现已有配置文件' : ''}`;
      toast(msg);
    };
    fieldEl.appendChild(b);
  };
  const render = (typeVal) => {
    body.innerHTML = schema.fields.map(f => fieldHtml(f, cur[f.key], typeVal)).join('');
    // 密钥字段：显示/隐藏切换 + 一键复制（放在 render 内，类型切换重渲染后仍有效）
    body.querySelectorAll('[data-pwtoggle]').forEach(b => b.onclick = () => {
      const inp = $('#f_' + b.dataset.pwtoggle); if (!inp) return;
      const show = inp.type === 'password';
      inp.type = show ? 'text' : 'password';
      b.textContent = show ? '隐藏' : '显示';
    });
    body.querySelectorAll('[data-pwcopy]').forEach(b => b.onclick = () => {
      const inp = $('#f_' + b.dataset.pwcopy); if (!inp) return;
      if (!inp.value) return toast('内容为空，无需复制');
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(inp.value).then(() => toast('已复制'), () => toast('复制失败，请手动选择'));
      } else { inp.select(); toast('已全选，请按 Ctrl+C 复制'); }
    });
    const typeSel = $('#f_type');
    if (typeSel) typeSel.onchange = () => { render(typeSel.value); addDetectBtn(); };
    addDetectBtn();
  };
  render(cur.type || (schema.fields.find(f => f.key === 'type') || {}).options?.[0]);
  $('#modalTitle').textContent = (isNew ? '新建' : '编辑') + ' · ' + schema.label;
  $('#modal').classList.remove('hidden');
  $('#modalSave').onclick = async () => {
    const out = {};
    let ok = true;
    schema.fields.forEach(f => {
      const val = readField(f);
      if (f.required && (val === '' || val === undefined)) { toast('请填写：' + f.label); ok = false; }
      if (val !== undefined) out[f.key] = val;
    });
    if (!ok) return;
    // 客户端保存时校验 skill/提示词 扫描路径是否存在（非阻断，仅提示）
    if (col === 'clients') {
      const paths = [...(out.skillPaths || []), ...(out.promptPaths || [])];
      if (paths.length) {
        try {
          const vr = await fetch('/api/paths/validate', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ paths }) }).then(r => r.json());
          const missing = (vr.results || []).filter(r => !r.exists).map(r => r.path);
          if (missing.length) toast('注意：' + missing.length + ' 个扫描路径不存在（已仍保存）');
        } catch (e) { /* 校验失败不影响保存 */ }
      }
    }
    const p = isNew ? api.create(col, out) : api.update(col, item.id, out);
    p.then(() => { closeModal(); onSave(); toast(isNew ? '已创建' : '已保存'); }).catch(e => toast('保存失败：' + e.message));
  };

  if (!isNew) {
    const relatedTitle = document.createElement('div');
    relatedTitle.className = 'card-h';
    relatedTitle.textContent = '相似资源';
    const relatedBody = document.createElement('div');
    relatedBody.className = 'card-b';
    relatedBody.innerHTML = '<div id="relatedBox" class="empty">加载中…</div>';
    body.appendChild(relatedTitle);
    body.appendChild(relatedBody);
    const loadRelated = async () => {
      const box = document.getElementById('relatedBox');
      if (!box) return;
      try {
        const q = encodeURIComponent(cur[schema.titleField] || '');
        const r = await fetch('/api/system/semantic-search?q=' + q + '&col=' + col + '&semantic=1').then(r => r.json());
        const items = (r.items || []).filter(x => x.item && x.item.id !== item.id).slice(0, 3);
        if (!items.length) { box.innerHTML = '未发现相似资源'; return; }
        box.innerHTML = '<div class="list">' + items.map(x => {
          const s = SCHEMAS[x.collection];
          return '<div class="row" data-col="' + x.collection + '" data-id="' + x.item.id + '"><div class="meta"><div class="title">' + esc(x.item[s.titleField]) + ' <span class="pill">' + esc(s.label) + '</span></div><div class="desc">' + esc(String(x.item[s.descField === '_desc' ? '_desc' : s.descField] || '')) + '</div></div><div class="ops"><button class="btn sm">打开</button></div></div>';
        }).join('') + '</div>';
        box.querySelectorAll('.row').forEach(row => row.onclick = () => {
          closeModal();
          setTimeout(() => openForm(row.dataset.col, { id: row.dataset.id }, () => renderCollection(col)), 0);
        });
      } catch (e) {
        box.innerHTML = '相似资源加载失败';
      }
    };
    loadRelated();
  }
}
function closeModal() { $('#modal').classList.add('hidden'); }
$('#modalClose').onclick = closeModal;

/* ---------- 通用列表视图 ---------- */
// SWR 缓存：再次进入同一集合时先用内存里的数据渲染（无白屏），随后后台静默校验，
// 校验结果与缓存一致就不重绘（保留用户的勾选与滚动位置）。
const listCache = new Map();
function invalidateList(col) { if (col) listCache.delete(col); else listCache.clear(); }
// 变更后刷新：先失效缓存再重绘，避免闪现旧数据
function refreshCollection(col) { listCache.delete(col); return renderCollection(col); }

async function renderCollection(col, prefetched) {
  const schema = SCHEMAS[col];
  $('#pageTitle').textContent = schema.label;
  const impBtn = (col === 'mcpservers' || col === 'skillrepos' || col === 'prompts') ? `<button class="btn" id="impBtn">从客户端导入</button>` : '';
  const syncBtn = (col === 'repos') ? `<button class="btn" id="syncAllBtn">同步全部启用仓库</button>` : '';
  $('#topActions').innerHTML = impBtn + syncBtn + (col === 'clients' ? `<button class="btn" id="scanSec">扫描明文密钥</button>` : '') + `<button class="btn primary" id="newBtn">+ 新建</button>`;
  $('#newBtn').onclick = () => openForm(col, null, () => refreshCollection(col));
  if (col === 'mcpservers') $('#impBtn').onclick = openImportFromClient;
  else if (col === 'skillrepos') $('#impBtn').onclick = openImportSkillFromClient;
  else if (col === 'prompts') $('#impBtn').onclick = openImportPromptFromClient;
  else if (col === 'repos') $('#syncAllBtn').onclick = syncAllRepos;
  if (col === 'clients') $('#scanSec').onclick = async () => {
    toast('正在扫描本地配置…');
    const r = await api.scanSecrets().catch(e => ({ error: e.message }));
    if (r.error) return toast('扫描失败：' + r.error);
    const lines = ['扫描 ' + r.scanned + ' 个文件：疑似明文密钥 ' + r.summary.total + ' 处'
      + '（已收口 ' + r.summary.inVault + ' / 未登记 ' + r.summary.unknown + '），涉及 ' + r.summary.files + ' 个文件', ''];
    if (!r.summary.total) lines.push('未发现明文密钥。');
    const shown = r.findings.slice(0, 60);
    for (const f of shown) lines.push('· ' + f.file + ':' + f.line + '  [' + f.name + ']  ' + f.masked + (f.inVault ? '（已收口）' : '（未登记）'));
    if (r.findings.length > shown.length) lines.push('… 其余 ' + (r.findings.length - shown.length) + ' 条略（可通过 /api/security/scan-secrets 获取全部）');
    for (const s of r.skipped || []) lines.push('跳过 ' + s.file + '：' + s.reason);
    if (r.truncated) lines.push('（结果被截断：文件数或命中数达到上限）');
    lines.push('', '提示：未登记的密钥建议收口到「API 端点」，避免散落在各配置文件里。');
    showInfoModal('明文密钥扫描', lines.join('\n'));
  };
  if (col === 'clients') $('#scanSec').onclick = async () => {
    toast('正在扫描本地配置…');
    const r = await api.scanSecrets().catch(e => ({ error: e.message }));
    if (r.error) return toast('扫描失败：' + r.error);
    const lines = ['扫描 ' + r.scanned + ' 个文件：疑似明文密钥 ' + r.summary.total + ' 处'
      + '（已收口 ' + r.summary.inVault + ' / 未登记 ' + r.summary.unknown + '），涉及 ' + r.summary.files + ' 个文件', ''];
    if (!r.summary.total) lines.push('未发现明文密钥。');
    const shown = r.findings.slice(0, 60);
    for (const f of shown) lines.push('· ' + f.file + ':' + f.line + '  [' + f.name + ']  ' + f.masked + (f.inVault ? '（已收口）' : '（未登记）'));
    if (r.findings.length > shown.length) lines.push('… 其余 ' + (r.findings.length - shown.length) + ' 条略（可通过 /api/security/scan-secrets 获取全部）');
    for (const s of r.skipped || []) lines.push('跳过 ' + s.file + '：' + s.reason);
    if (r.truncated) lines.push('（结果被截断：文件数或命中数达到上限）');
    lines.push('', '提示：未登记的密钥建议收口到「API 端点」，避免散落在各配置文件里。');
    showInfoModal('明文密钥扫描', lines.join('\n'));
  };
  if (col === 'clients') $('#scanSec').onclick = async () => {
    toast('正在扫描本地配置…');
    const r = await api.scanSecrets().catch(e => ({ error: e.message }));
    if (r.error) return toast('扫描失败：' + r.error);
    const lines = ['扫描 ' + r.scanned + ' 个文件：疑似明文密钥 ' + r.summary.total + ' 处'
      + '（已收口 ' + r.summary.inVault + ' / 未登记 ' + r.summary.unknown + '），涉及 ' + r.summary.files + ' 个文件', ''];
    if (!r.summary.total) lines.push('未发现明文密钥。');
    const shown = r.findings.slice(0, 60);
    for (const f of shown) lines.push('· ' + f.file + ':' + f.line + '  [' + f.name + ']  ' + f.masked + (f.inVault ? '（已收口）' : '（未登记）'));
    if (r.findings.length > shown.length) lines.push('… 其余 ' + (r.findings.length - shown.length) + ' 条略（可通过 /api/security/scan-secrets 获取全部）');
    for (const s of r.skipped || []) lines.push('跳过 ' + s.file + '：' + s.reason);
    if (r.truncated) lines.push('（结果被截断：文件数或命中数达到上限）');
    lines.push('', '提示：未登记的密钥建议收口到「API 端点」，避免散落在各配置文件里。');
    showInfoModal('明文密钥扫描', lines.join('\n'));
  };
  if (col === 'clients') $('#scanSec').onclick = async () => {
    toast('正在扫描本地配置…');
    const r = await api.scanSecrets().catch(e => ({ error: e.message }));
    if (r.error) return toast('扫描失败：' + r.error);
    const lines = ['扫描 ' + r.scanned + ' 个文件：疑似明文密钥 ' + r.summary.total + ' 处'
      + '（已收口 ' + r.summary.inVault + ' / 未登记 ' + r.summary.unknown + '），涉及 ' + r.summary.files + ' 个文件', ''];
    if (!r.summary.total) lines.push('未发现明文密钥。');
    const shown = r.findings.slice(0, 60);
    for (const f of shown) lines.push('· ' + f.file + ':' + f.line + '  [' + f.name + ']  ' + f.masked + (f.inVault ? '（已收口）' : '（未登记）'));
    if (r.findings.length > shown.length) lines.push('… 其余 ' + (r.findings.length - shown.length) + ' 条略（可通过 /api/security/scan-secrets 获取全部）');
    for (const s of r.skipped || []) lines.push('跳过 ' + s.file + '：' + s.reason);
    if (r.truncated) lines.push('（结果被截断：文件数或命中数达到上限）');
    lines.push('', '提示：未登记的密钥建议收口到「API 端点」，避免散落在各配置文件里。');
    showInfoModal('明文密钥扫描', lines.join('\n'));
  };
  if (col === 'clients') $('#scanSec').onclick = async () => {
    toast('正在扫描本地配置…');
    const r = await api.scanSecrets().catch(e => ({ error: e.message }));
    if (r.error) return toast('扫描失败：' + r.error);
    const lines = ['扫描 ' + r.scanned + ' 个文件：疑似明文密钥 ' + r.summary.total + ' 处'
      + '（已收口 ' + r.summary.inVault + ' / 未登记 ' + r.summary.unknown + '），涉及 ' + r.summary.files + ' 个文件', ''];
    if (!r.summary.total) lines.push('未发现明文密钥。');
    const shown = r.findings.slice(0, 60);
    for (const f of shown) lines.push('· ' + f.file + ':' + f.line + '  [' + f.name + ']  ' + f.masked + (f.inVault ? '（已收口）' : '（未登记）'));
    if (r.findings.length > shown.length) lines.push('… 其余 ' + (r.findings.length - shown.length) + ' 条略（可通过 /api/security/scan-secrets 获取全部）');
    for (const s of r.skipped || []) lines.push('跳过 ' + s.file + '：' + s.reason);
    if (r.truncated) lines.push('（结果被截断：文件数或命中数达到上限）');
    lines.push('', '提示：未登记的密钥建议收口到「API 端点」，避免散落在各配置文件里。');
    showInfoModal('明文密钥扫描', lines.join('\n'));
  };
  if (col === 'clients') $('#scanSec').onclick = async () => {
    toast('正在扫描本地配置…');
    const r = await api.scanSecrets().catch(e => ({ error: e.message }));
    if (r.error) return toast('扫描失败：' + r.error);
    const lines = ['扫描 ' + r.scanned + ' 个文件：疑似明文密钥 ' + r.summary.total + ' 处'
      + '（已收口 ' + r.summary.inVault + ' / 未登记 ' + r.summary.unknown + '），涉及 ' + r.summary.files + ' 个文件', ''];
    if (!r.summary.total) lines.push('未发现明文密钥。');
    const shown = r.findings.slice(0, 60);
    for (const f of shown) lines.push('· ' + f.file + ':' + f.line + '  [' + f.name + ']  ' + f.masked + (f.inVault ? '（已收口）' : '（未登记）'));
    if (r.findings.length > shown.length) lines.push('… 其余 ' + (r.findings.length - shown.length) + ' 条略（可通过 /api/security/scan-secrets 获取全部）');
    for (const s of r.skipped || []) lines.push('跳过 ' + s.file + '：' + s.reason);
    if (r.truncated) lines.push('（结果被截断：文件数或命中数达到上限）');
    lines.push('', '提示：未登记的密钥建议收口到「API 端点」，避免散落在各配置文件里。');
    showInfoModal('明文密钥扫描', lines.join('\n'));
  };
  if (col === 'clients') $('#scanSec').onclick = async () => {
    toast('正在扫描本地配置…');
    const r = await api.scanSecrets().catch(e => ({ error: e.message }));
    if (r.error) return toast('扫描失败：' + r.error);
    const lines = ['扫描 ' + r.scanned + ' 个文件：疑似明文密钥 ' + r.summary.total + ' 处'
      + '（已收口 ' + r.summary.inVault + ' / 未登记 ' + r.summary.unknown + '），涉及 ' + r.summary.files + ' 个文件', ''];
    if (!r.summary.total) lines.push('未发现明文密钥。');
    const shown = r.findings.slice(0, 60);
    for (const f of shown) lines.push('· ' + f.file + ':' + f.line + '  [' + f.name + ']  ' + f.masked + (f.inVault ? '（已收口）' : '（未登记）'));
    if (r.findings.length > shown.length) lines.push('… 其余 ' + (r.findings.length - shown.length) + ' 条略（可通过 /api/security/scan-secrets 获取全部）');
    for (const s of r.skipped || []) lines.push('跳过 ' + s.file + '：' + s.reason);
    if (r.truncated) lines.push('（结果被截断：文件数或命中数达到上限）');
    lines.push('', '提示：未登记的密钥建议收口到「API 端点」，避免散落在各配置文件里。');
    showInfoModal('明文密钥扫描', lines.join('\n'));
  };
  if (col === 'clients') $('#scanSec').onclick = async () => {
    toast('正在扫描本地配置…');
    const r = await api.scanSecrets().catch(e => ({ error: e.message }));
    if (r.error) return toast('扫描失败：' + r.error);
    const lines = ['扫描 ' + r.scanned + ' 个文件：疑似明文密钥 ' + r.summary.total + ' 处'
      + '（已收口 ' + r.summary.inVault + ' / 未登记 ' + r.summary.unknown + '），涉及 ' + r.summary.files + ' 个文件', ''];
    if (!r.summary.total) lines.push('未发现明文密钥。');
    const shown = r.findings.slice(0, 60);
    for (const f of shown) lines.push('· ' + f.file + ':' + f.line + '  [' + f.name + ']  ' + f.masked + (f.inVault ? '（已收口）' : '（未登记）'));
    if (r.findings.length > shown.length) lines.push('… 其余 ' + (r.findings.length - shown.length) + ' 条略（可通过 /api/security/scan-secrets 获取全部）');
    for (const s of r.skipped || []) lines.push('跳过 ' + s.file + '：' + s.reason);
    if (r.truncated) lines.push('（结果被截断：文件数或命中数达到上限）');
    lines.push('', '提示：未登记的密钥建议收口到「API 端点」，避免散落在各配置文件里。');
    showInfoModal('明文密钥扫描', lines.join('\n'));
  };

  const view = $('#view');
  // 有 enabled 字段的集合才显示批量启用/停用
  const hasEnabled = Array.isArray(schema.fields) && schema.fields.some(f => f.key === 'enabled');
  const seed = prefetched || listCache.get(col);
  let items;
  if (seed) {
    items = seed; // 命中缓存：直接进入渲染，无加载占位
  } else {
    // 首次进入：先给反馈，避免数据量大时白屏等待
    view.innerHTML = `<div class="empty">加载中…</div>`;
    try {
      items = await api.list(col);
    } catch (e) {
      view.innerHTML = `<div class="empty">加载失败：${esc(e.message)}</div>`;
      return;
    }
    listCache.set(col, items);
  }
  // 数据来自缓存时做一次后台校验（有变化才用新数据重绘）
  if (seed && !prefetched) {
    const before = seed;
    api.list(col).then((next) => {
      const changed = JSON.stringify(next) !== JSON.stringify(before);
      listCache.set(col, next);
      // 用户可能已切到别的页面，避免把内容画到错误的位置
      if (changed && $('#pageTitle').textContent === schema.label) renderCollection(col, next);
    }).catch(() => { /* 静默失败：继续用已渲染的缓存数据 */ });
  }
  if (!items.length) { view.innerHTML = `<div class="empty">暂无数据，点击右上角「新建」添加。</div>`; return; }

  // 客户端集合：补充真实探测出来的「是否已安装 / 是否已有配置文件」状态，
  // 避免用户以为「登记了就等于装好了」（探测只读本地文件，不产生副作用）。
  let clientDet = null;
  if (col === 'clients') {
    try { clientDet = await fetch('/api/detect/clients').then(r => r.json()); } catch (e) { clientDet = null; }
  }
  const detOf = (t) => (clientDet || []).find(d => d.type === t) || null;

  const rowHtml = it => {
    let desc = schema.descField === '_desc'
      ? (col === 'repos'
        ? (it.type === 'git' ? (it.url || '（未填 Git 地址）') : (it.path || '（未填本地路径）'))
        : (it.type === 'stdio' ? `${it.command} ${(it.args || []).join(' ')}` : it.url))
      : it[schema.descField] || '';
    const tags = schema.tagsField ? (it[schema.tagsField] || []).map(t => `<span class="tag">${esc(t)}</span>`).join('') : '';
    const pill = ('enabled' in it) ? `<span class="pill ${it.enabled ? 'on' : 'off'}">${it.enabled ? '启用' : '停用'}</span>` : '';
    const det = col === 'clients' ? detOf(it.type) : null;
    const installPill = det ? `<span class="pill ${det.installed ? 'on' : 'off'}">${det.installed ? '已安装' : '未安装'}</span>` : '';
    const cfgPill = (det && det.exists) ? '<span class="pill">已有配置文件</span>' : '';
    const extra = (col === 'repos' ? `<button class="btn sm" data-sync="${it.id}">同步</button>` : '')
      + (col === 'providers' ? `<button class="btn sm" data-test="${it.id}">测试</button>` : '')
      + (col === 'mcpservers' ? `<button class="btn sm" data-check="${it.id}">检查</button>` : '');
    const syncInfo = (col === 'repos' && it.lastSyncAt) ? `<div class="desc sub">上次同步：${esc(new Date(it.lastSyncAt).toLocaleString())}</div>` : '';
    return `<div class="row">
      <div class="meta"><div class="title">${esc(it[schema.titleField])} ${pill}${installPill}${cfgPill}</div><div class="desc">${esc(desc)}</div>${syncInfo}${tags}</div>
      <label class="selwrap"><input type="checkbox" class="sel" data-sel="${it.id}"/></label><div class="ops">${extra}<button class="btn sm" data-edit="${it.id}">编辑</button><button class="btn sm danger" data-del="${it.id}">删除</button></div>
    </div>`;
  };
  // 关键词匹配：名称 / 描述 / 标签
  const matches = (it, q) => {
    const hay = [it[schema.titleField], (schema.descField === '_desc' ? '' : it[schema.descField]), (it[schema.tagsField] || []).join(' ')].join(' ').toLowerCase();
    return hay.includes(q);
  };
  const bindRows = (root) => {
    root.querySelectorAll('[data-edit]').forEach(b => b.onclick = async () => {
      try { const it = await api.get(col, b.dataset.edit); openForm(col, it, () => refreshCollection(col)); }
      catch (e) { toast('获取详情失败：' + e.message); }
    });
    root.querySelectorAll('[data-del]').forEach(b => b.onclick = () => {
      confirmModal('确认删除', '删除后移入回收站（可在回收站恢复或彻底删除），确定删除该条记录？', () => {
        api.remove(col, b.dataset.del).then(() => { toast('已删除'); refreshCollection(col); }).catch(e => toast('删除失败：' + e.message));
      });
    });
    root.querySelectorAll('[data-sync]').forEach(b => b.onclick = () => syncRepo(b.dataset.sync));
    root.querySelectorAll('[data-test]').forEach(b => b.onclick = async () => {
      const id = b.dataset.test; b.disabled = true; const old = b.textContent; b.textContent = '测试中…';
      const r = await fetch('/api/providers/' + id + '/test', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' }).then(x => x.json()).catch(() => ({ ok: false, error: '请求失败' }));
      b.disabled = false; b.textContent = old;
      toast(r.ok ? ('连通（' + (r.status || '?') + '，' + (r.ms || '?') + 'ms）') : ('测试失败：' + (r.error || '未知')));
    });
    root.querySelectorAll('[data-check]').forEach(b => b.onclick = async () => {
      const id = b.dataset.check; b.disabled = true; const old = b.textContent; b.textContent = '检查中…';
      const r = await fetch('/api/mcpservers/' + id + '/check', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' }).then(x => x.json()).catch(() => ({ ok: false, error: '请求失败' }));
      b.disabled = false; b.textContent = old;
      toast(r.ok ? (r.kind === 'url' ? ('URL 可达（' + (r.status || '?') + '）') : (r.note || 'stdio 配置有效')) : ('检查未通过：' + (r.error || '未知')));
    });
  };

  view.innerHTML = `<div class="section-desc">集中维护 ${schema.label}，可在「共享 / 导出」中一键应用到各客户端。<span id="listCount" class="hint"></span></div>
    <input id="listSearch" class="search" type="text" placeholder="搜索 ${schema.label}…" autocomplete="off"/>
    <div class="batchbar hidden" id="batchBar"><label class="selall"><input type="checkbox" id="selAll"/> 全选</label><span id="selCount" class="hint">已选 0 项</span><span class="spacer"></span>${hasEnabled ? '<button class="btn sm" id="batchOn">启用</button><button class="btn sm" id="batchOff">停用</button>' : ''}<button class="btn sm danger" id="batchDel">删除（移入回收站）</button></div>
    <div class="list" id="listBox"></div>`
  const listBox = $('#listBox');
  const sel = new Set();
  let visible = items;
  let lastIdx = -1;
  const paint = (list) => {
    visible = list;
    listBox.innerHTML = list.length ? list.map(rowHtml).join('') : '<div class="empty">无匹配结果</div>';
    listBox.querySelectorAll('[data-sel]').forEach((c, i) => {
      c.checked = sel.has(c.dataset.sel);
      // Shift + 点击：整段范围选中/取消（对齐文件管理器习惯）
      c.onclick = (ev) => {
        if (ev.shiftKey && lastIdx >= 0) {
          const a = Math.min(lastIdx, i), b = Math.max(lastIdx, i);
          for (let k = a; k <= b; k++) { const it = visible[k]; if (it) { c.checked ? sel.add(it.id) : sel.delete(it.id); } }
          lastIdx = i;
          paint(visible);
          return;
        }
        c.checked ? sel.add(c.dataset.sel) : sel.delete(c.dataset.sel);
        lastIdx = i;
        updateBar();
      };
    });
    const lc = document.getElementById('listCount');
    if (lc) lc.textContent = list.length === items.length ? ('共 ' + items.length + ' 项') : ('筛选 ' + list.length + ' / ' + items.length + ' 项');
    bindRows(listBox);
    updateBar();
  };
  const updateBar = () => { const bar = document.getElementById('batchBar'); if (!bar) return; bar.classList.toggle('hidden', sel.size === 0); document.getElementById('selCount').textContent = '已选 ' + sel.size + ' 项'; const sa = document.getElementById('selAll'); if (sa) sa.checked = visible.length > 0 && visible.every(it => sel.has(it.id)); };
  // 全选只作用于「当前筛选出的」条目，避免筛选后误删未显示的记录
  document.getElementById('selAll').onchange = () => { const on = document.getElementById('selAll').checked; visible.forEach(it => on ? sel.add(it.id) : sel.delete(it.id)); paint(visible); };
  document.getElementById('batchDel').onclick = () => {
    if (!sel.size) return;
    const n = sel.size;
    confirmModal('确认批量删除', '将删除选中的 ' + n + ' 项（可在回收站恢复），确定？', async () => {
      try {
        const r = await api.bulkDelete(col, Array.from(sel));
        toast('已删除 ' + (r.removed || 0) + ' 项' + ((r.missing && r.missing.length) ? ('，' + r.missing.length + ' 项已不存在') : ''));
      } catch (e) { toast('批量删除失败：' + e.message); }
      sel.clear(); refreshCollection(col);
    });
  };
  const batchToggle = (id, enabled) => {
    const b = document.getElementById(id);
    if (!b) return;
    b.onclick = async () => {
      if (!sel.size) return;
      b.disabled = true;
      try {
        const r = await api.bulkEnabled(col, Array.from(sel), enabled);
        toast((enabled ? '已启用 ' : '已停用 ') + (r.changed || 0) + ' 项' + ((r.missing && r.missing.length) ? ('，' + r.missing.length + ' 项已不存在') : ''));
      } catch (e) { toast('操作失败：' + e.message); b.disabled = false; }
      refreshCollection(col);
    };
  };
  batchToggle('batchOn', true);
  batchToggle('batchOff', false);
  paint(items);
  $('#listSearch').oninput = () => {
    const q = $('#listSearch').value.trim().toLowerCase();
    paint(q ? items.filter(it => matches(it, q)) : items);
  };
}

/* ---------- 仓库同步 ---------- */
async function syncRepo(id) {
  toast('正在同步仓库…');
  const r = await fetch('/api/repos/' + id + '/sync', { method: 'POST' }).then(x => x.json());
  if (!r.ok) { toast('同步失败：' + (r.error || '未知')); return; }
  toast(`同步完成：新增 ${r.created}，更新 ${r.updated}` + ((r.warnings || []).length ? '；' + r.warnings.length + ' 条提示' : ''));
  if ((r.warnings || []).length) showInfoModal('同步提示 · ' + (r.name || ''), (r.warnings || []).join('\n'));
  refreshCollection('repos');
}
async function syncAllRepos() {
  let repos;
  try { repos = await api.list('repos'); }
  catch (e) { toast('加载仓库失败：' + e.message); return; }
  const enabled = repos.filter(r => r.enabled);
  if (!enabled.length) return toast('没有已启用的仓库');
  toast('正在同步全部仓库…');
  let totalCreated = 0, totalUpdated = 0; const warns = [];
  for (const r of enabled) {
    const res = await fetch('/api/repos/' + r.id + '/sync', { method: 'POST' }).then(x => x.json());
    if (res.ok) { totalCreated += res.created || 0; totalUpdated += res.updated || 0; (res.warnings || []).forEach(w => warns.push('[' + r.name + '] ' + w)); }
    else warns.push('[' + r.name + '] ' + (res.error || '同步失败'));
  }
  toast(`全部同步完成：新增 ${totalCreated}，更新 ${totalUpdated}`);
  if (warns.length) showInfoModal('同步结果', warns.join('\n'));
  refreshCollection('repos');
}

/* ---------- 从客户端导入 MCP 配置 ---------- */
async function openImportFromClient() {
  const body = $('#modalBody');
  const clients = await fetch('/api/detect/clients').then(r => r.json()).catch(() => []);
  const clientOpts = clients.length
    ? clients.map(c => `<option value="${c.type}">${esc(c.name)}${c.installed ? '（已安装）' : ''}${c.exists ? '（已有配置）' : ''}</option>`).join('')
    : ['claude', 'cursor', 'vscode', 'codebuddy'].map(t => `<option value="${t}">${t}</option>`).join('');
  body.innerHTML = `<div class="field"><label>选择客户端</label><select id="impType">${clientOpts}</select></div>
    <div class="hint" style="margin-bottom:10px">读取该客户端电脑上的真实 mcp 配置文件，将其中已有的服务器采集进来统一管理。</div>
    <div style="margin:6px 0"><button class="btn" id="impScan">扫描现有 MCP 配置</button></div>
    <div id="impPreview"></div>`;
  $('#modalTitle').textContent = '从客户端导入 MCP 配置';
  $('#modal').classList.remove('hidden');
  $('#impScan').onclick = async () => {
    const type = $('#impType').value;
    const btn = $('#impScan'); btn.disabled = true; btn.textContent = '扫描中…';
    const r = await fetch('/api/clients/' + type + '/scan').then(x => x.json()).catch(() => null);
    btn.disabled = false; btn.textContent = '扫描现有 MCP 配置';
    const preview = $('#impPreview');
    if (!r || !r.servers || !r.servers.length) { preview.innerHTML = `<div class="hint">未在该客户端配置中找到任何 MCP 服务器。</div>`; return; }
    preview.innerHTML = `<div class="hint">扫描到 ${r.servers.length} 个，来源：${esc(r.servers[0].sourcePath || '')}</div>` +
      r.servers.map(s => `<label class="improw"><input type="checkbox" class="impck" value="${esc(s.name)}" checked/> <b>${esc(s.name)}</b> <span class="pill ${s.type === 'stdio' ? 'off' : 'on'}">${s.type}</span> <span class="impmeta">${esc(s.type === 'stdio' ? (s.command + ' ' + (s.args || []).join(' ')) : s.url)}</span></label>`).join('') +
      `<div class="impactions"><button class="btn primary" id="impDo">导入选中（${r.servers.length}）</button></div>`;
    $('#impDo').onclick = async () => {
      const sel = Array.from(document.querySelectorAll('.impck:checked')).map(c => c.value);
      const rr = await fetch('/api/clients/' + type + '/import', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ selected: sel }) }).then(x => x.json());
      const created = (rr.results || []).filter(x => x.status === 'created').length;
      const updated = (rr.results || []).filter(x => x.status === 'updated').length;
      closeModal(); toast(`导入完成：新增 ${created}，更新 ${updated}`);
      refreshCollection('mcpservers');
    };
  };
}

/* ---------- 从客户端导入 Skill 配置 ---------- */
async function openImportSkillFromClient() {
  const body = $('#modalBody');
  const clients = await fetch('/api/detect/clients').then(r => r.json()).catch(() => []);
  const clientOpts = clients.length
    ? clients.map(c => `<option value="${c.type}">${esc(c.name)}${c.installed ? '（已安装）' : ''}${c.exists ? '（已有配置）' : ''}</option>`).join('')
    : ['claude', 'cursor', 'vscode', 'codebuddy'].map(t => `<option value="${t}">${t}</option>`).join('');
  body.innerHTML = `<div class="field"><label>选择客户端</label><select id="impType">${clientOpts}</select></div>
    <div class="hint" style="margin-bottom:10px">读取该客户端电脑上的本地 skill 目录（如 ~/.codebuddy/skills），逐个解析每个 skill 文件夹的 SKILL.md 并汇总进「Skill 仓库」。</div>
    <div style="margin:6px 0"><button class="btn" id="impScan">扫描本地 Skill</button></div>
    <div id="impPreview"></div>`;
  $('#modalTitle').textContent = '从客户端导入 Skill';
  $('#modal').classList.remove('hidden');
  $('#impScan').onclick = async () => {
    const type = $('#impType').value;
    const btn = $('#impScan'); btn.disabled = true; btn.textContent = '扫描中…';
    const r = await fetch('/api/clients/' + type + '/skills').then(x => x.json()).catch(() => null);
    btn.disabled = false; btn.textContent = '扫描本地 Skill';
    const preview = $('#impPreview');
    if (!r || !r.skills || !r.skills.length) { preview.innerHTML = `<div class="hint">未在该客户端 skill 目录中找到任何 Skill。</div>`; return; }
    preview.innerHTML = `<div class="hint">扫描到 ${r.skills.length} 个，来源：${esc(r.skills[0].sourcePath || '')}</div>` +
      r.skills.map(s => `<label class="improw"><input type="checkbox" class="impck" value="${esc(s.name)}" checked/> <b>${esc(s.name)}</b> <span class="impmeta">${esc(s.description || s.path)}</span></label>`).join('') +
      `<div class="impactions"><button class="btn primary" id="impDo">导入选中（${r.skills.length}）</button></div>`;
    $('#impDo').onclick = async () => {
      const sel = Array.from(document.querySelectorAll('.impck:checked')).map(c => c.value);
      const rr = await fetch('/api/clients/' + type + '/skills/import', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ selected: sel }) }).then(x => x.json());
      const created = (rr.results || []).filter(x => x.status === 'created').length;
      const updated = (rr.results || []).filter(x => x.status === 'updated').length;
      closeModal();
      toast(`导入完成：新增 ${created}，更新 ${updated}` + ((rr.warnings || []).length ? '；' + (rr.warnings || []).length + ' 个文件过大已跳过' : ''));
      refreshCollection('skillrepos');
    };
  };
}

/* ---------- 从客户端导入提示词/规则 ---------- */
async function openImportPromptFromClient() {
  const body = $('#modalBody');
  const clients = await fetch('/api/detect/clients').then(r => r.json()).catch(() => []);
  const clientOpts = clients.length
    ? clients.map(c => `<option value="${c.type}">${esc(c.name)}${c.installed ? '（已安装）' : ''}${c.exists ? '（已有配置）' : ''}</option>`).join('')
    : ['claude', 'cursor', 'vscode', 'codebuddy'].map(t => `<option value="${t}">${t}</option>`).join('');
  body.innerHTML = `<div class="field"><label>选择客户端</label><select id="impType">${clientOpts}</select></div>
    <div class="hint" style="margin-bottom:10px">读取该客户端电脑上的提示词/规则文件（如 CLAUDE.md、.cursor/rules/*.mdc、copilot-instructions.md），汇总进「提示词」资源。</div>
    <div style="margin:6px 0"><button class="btn" id="impScan">扫描本地提示词/规则</button></div>
    <div id="impPreview"></div>`;
  $('#modalTitle').textContent = '从客户端导入提示词';
  $('#modal').classList.remove('hidden');
  $('#impScan').onclick = async () => {
    const type = $('#impType').value;
    const btn = $('#impScan'); btn.disabled = true; btn.textContent = '扫描中…';
    const r = await fetch('/api/clients/' + type + '/prompts').then(x => x.json()).catch(() => null);
    btn.disabled = false; btn.textContent = '扫描本地提示词/规则';
    const preview = $('#impPreview');
    if (!r || !r.prompts || !r.prompts.length) { preview.innerHTML = `<div class="hint">未在该客户端找到任何提示词/规则文件。</div>`; return; }
    preview.innerHTML = `<div class="hint">扫描到 ${r.prompts.length} 个</div>` +
      r.prompts.map(s => `<label class="improw"><input type="checkbox" class="impck" value="${esc(s.name)}" checked/> <b>${esc(s.name)}</b> <span class="pill off">${esc(s.category || '来源')}</span> <span class="impmeta">${esc(s.path)}</span></label>`).join('') +
      `<div class="impactions"><button class="btn primary" id="impDo">导入选中（${r.prompts.length}）</button></div>`;
    $('#impDo').onclick = async () => {
      const sel = Array.from(document.querySelectorAll('.impck:checked')).map(c => c.value);
      const rr = await fetch('/api/clients/' + type + '/prompts/import', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ selected: sel }) }).then(x => x.json());
      const created = (rr.results || []).filter(x => x.status === 'created').length;
      const updated = (rr.results || []).filter(x => x.status === 'updated').length;
      closeModal();
      toast(`导入完成：新增 ${created}，更新 ${updated}` + ((rr.warnings || []).length ? '；' + (rr.warnings || []).length + ' 个文件过大已跳过' : ''));
      refreshCollection('prompts');
    };
  };
}

/* ---------- Profile 编辑器 ---------- */
async function renderProfiles() {
  $('#pageTitle').textContent = '共享配置（切换方案）';
  let profiles;
  try { profiles = await api.list('profiles'); }
  catch (e) { $('#view').innerHTML = `<div class="empty">加载失败：${esc(e.message)}</div>`; return; }
  $('#topActions').innerHTML = `<button class="btn" id="importPf">导入方案文件</button><button class="btn primary" id="newBtn">+ 新建方案</button>`;
  $('#newBtn').onclick = () => editProfile(null);
  $('#importPf').onclick = () => {
    const inp = document.createElement('input'); inp.type = 'file'; inp.accept = 'application/json';
    inp.onchange = () => {
      const f = inp.files[0]; if (!f) return;
      const rd = new FileReader();
      rd.onload = () => {
        try {
          const bundle = JSON.parse(rd.result);
          api.postBundle(bundle).then(r => { toast(r.ok ? '方案已导入' : '导入失败'); renderProfiles(); }).catch(e => toast('导入失败：' + e.message));
        } catch (e) { toast('文件解析失败'); }
      };
      rd.readAsText(f);
    };
    inp.click();
  };

  const view = $('#view');
  if (!profiles.length) { view.innerHTML = `<div class="empty">还没有共享方案。新建后，可把 API、提示词、MCP、Skill 打包，一键切到任意客户端。</div>`; return; }
  const rows = profiles.map(p => `<div class="row">
    <div class="meta"><div class="title">${esc(p.name)}</div>
      <div class="desc">${[p.providerId && 'API', (p.promptIds || []).length && '提示词', (p.mcpServerIds || []).length && 'MCP', (p.skillRepoIds || []).length && 'Skill', (p.clientIds || []).length && '客户端'].filter(Boolean).join(' · ')}</div></div>
    <div class="ops">
      <button class="btn sm" data-bundle="${p.id}">导出方案</button>
      <button class="btn sm" data-export="${p.id}">共享/导出</button>
      <button class="btn sm" data-edit="${p.id}">编辑</button>
      <button class="btn sm danger" data-del="${p.id}">删除</button>
    </div></div>`).join('');
  view.innerHTML = `<div class="section-desc">一个「方案」= 一组可共享的资源组合，切换客户端时直接套用。可导出为单文件分享，或导入他人方案。</div><div class="list">${rows}</div>`;
  view.querySelectorAll('[data-edit]').forEach(b => b.onclick = async () => {
    try { const p = await api.get('profiles', b.dataset.edit); editProfile(p); }
    catch (e) { toast('获取方案失败：' + e.message); }
  });
  view.querySelectorAll('[data-export]').forEach(b => b.onclick = () => { currentProfile = b.dataset.export; renderExport(); navTo('export'); });
  view.querySelectorAll('[data-bundle]').forEach(b => b.onclick = async () => {
    const bundle = await fetch('/api/profiles/' + b.dataset.bundle + '/export').then(r => r.json());
    const blob = new Blob([JSON.stringify(bundle, null, 2)], { type: 'application/json' });
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = 'ai-share-profile.json'; a.click();
    toast('已导出方案文件');
  });
  view.querySelectorAll('[data-del]').forEach(b => b.onclick = () => {
    confirmModal('确认删除', '删除方案后不可恢复，确定删除？', () => {
      api.remove('profiles', b.dataset.del).then(() => { toast('已删除'); renderProfiles(); }).catch(e => toast('删除失败：' + e.message));
    });
  });
}

async function editProfile(p) {
  let providers, prompts, mcps, skills, clients;
  try {
    [providers, prompts, mcps, skills, clients] = await Promise.all([
      api.list('providers'), api.list('prompts'), api.list('mcpservers'), api.list('skillrepos'), api.list('clients')
    ]);
  } catch (e) { toast('加载资源失败：' + e.message); return; }
  const cur = p || { name: '', providerId: '', promptIds: [], mcpServerIds: [], skillRepoIds: [], clientIds: [], injectEnv: false };
  const checks = (items, sel, key) => items.map(i => `<label><input type="checkbox" class="ck" data-k="${key}" value="${i.id}" ${(sel || []).includes(i.id) ? 'checked' : ''}/> ${esc(i.name)}</label>`).join('') || '<span class="hint">（空）</span>';

  $('#view').innerHTML = `<div class="card"><div class="card-b">
    <div class="field"><label>方案名称</label><input id="p_name" value="${esc(cur.name)}"/></div>
    <div class="field"><label>默认 API 端点</label><select id="p_provider"><option value="">（不选）</option>${providers.map(x => `<option value="${x.id}" ${cur.providerId === x.id ? 'selected' : ''}>${esc(x.name)}</option>`).join('')}</select></div>
    <div class="layout">
      <div class="card"><div class="card-h">提示词</div><div class="card-b checks">${checks(prompts, cur.promptIds, 'promptIds')}</div></div>
      <div class="card"><div class="card-h">MCP 服务器</div><div class="card-b checks">${checks(mcps, cur.mcpServerIds, 'mcpServerIds')}</div></div>
    </div>
    <div class="layout">
      <div class="card"><div class="card-h">Skill 仓库</div><div class="card-b checks">${checks(skills, cur.skillRepoIds, 'skillRepoIds')}</div></div>
      <div class="card"><div class="card-h">目标客户端</div><div class="card-b checks">${checks(clients, cur.clientIds, 'clientIds')}</div></div>
    </div>
    <div class="field check" style="margin-top:14px"><input type="checkbox" id="p_env" ${cur.injectEnv ? 'checked' : ''}/><label for="p_env">将 API Base URL / Key 作为环境变量写入客户端配置</label></div>
    <div style="margin-top:14px"><button class="btn primary" id="p_save">保存方案</button></div>
  </div></div>`;
  $('#p_save').onclick = () => {
    const gather = k => Array.from(document.querySelectorAll(`.ck[data-k="${k}"]:checked`)).map(c => c.value);
    const out = { name: $('#p_name').value || '未命名方案', providerId: $('#p_provider').value, promptIds: gather('promptIds'), mcpServerIds: gather('mcpServerIds'), skillRepoIds: gather('skillRepoIds'), clientIds: gather('clientIds'), injectEnv: $('#p_env').checked };
    if (!out.name) return toast('请填写方案名称');
    const call = p ? api.update('profiles', p.id, out) : api.create('profiles', out);
    call.then(() => { toast('已保存'); renderProfiles(); }).catch(e => toast('保存失败：' + e.message));
  };
}

/* ---------- 导出 / 共享 ---------- */
let currentProfile = null;
async function renderExport() {
  $('#pageTitle').textContent = '共享 / 导出';
  let profiles;
  try { profiles = await api.list('profiles'); }
  catch (e) { $('#view').innerHTML = `<div class="empty">加载失败：${esc(e.message)}</div>`; return; }
  $('#topActions').innerHTML = `<button class="btn primary" id="applyAll">全部写入客户端</button>`;
  const view = $('#view');
  if (!profiles.length) { view.innerHTML = `<div class="empty">请先在「共享配置」中创建方案。</div>`; return; }
  if (!currentProfile) currentProfile = profiles[0].id;

  const sel = `<select id="pfSel">${profiles.map(p => `<option value="${p.id}" ${p.id === currentProfile ? 'selected' : ''}>${esc(p.name)}</option>`).join('')}</select>`;
  view.innerHTML = `<div class="section-desc">选择方案后，预览将写入各客户端的 mcp 配置，可复制、下载或直接写入磁盘。</div>
    <div class="field" style="max-width:320px">${sel}</div><div id="exportOut"></div>`;
  $('#pfSel').onchange = () => { currentProfile = $('#pfSel').value; loadExport(); };
  $('#applyAll').onclick = () => api.apply(currentProfile).then(r => {
    const lines = (r.results || []).map(x => `${x.ok ? '✓' : '✗'} ${x.clientName || x.clientId}: ${x.path || x.error}`);
    showInfoModal('写入结果', lines.join('\n'));
  }).catch(e => toast('写入失败：' + e.message));
  loadExport();
}

async function loadExport() {
  let data;
  try { data = await api.export(currentProfile); }
  catch (e) { $('#exportOut').innerHTML = `<div class="empty">加载失败：${esc(e.message)}</div>`; return; }
  const out = $('#exportOut');
  if (!data || !data.configs.length) { out.innerHTML = `<div class="empty">该方案未关联任何启用中的客户端。</div>`; return; }
  out.innerHTML = data.configs.map((c, i) => `<div class="card export-card">
    <div class="card-h">${esc(c.clientName)} <span class="pill on">${esc(c.clientType)}</span></div>
    <div class="card-b">
      <div class="path">→ ${esc(c.configPath)}</div>
      <div class="code" id="code_${i}">${esc(JSON.stringify(c.content, null, 2))}</div>
      <div class="ops" style="margin-top:8px">
        <button class="btn sm" data-copy="${i}">复制</button>
        <button class="btn sm" data-plan="${i}">预览差异</button>
        <button class="btn sm" data-plan="${i}">预览差异</button>
        <button class="btn sm" data-plan="${i}">预览差异</button>
        <button class="btn sm" data-plan="${i}">预览差异</button>
        <button class="btn sm" data-plan="${i}">预览差异</button>
        <button class="btn sm" data-plan="${i}">预览差异</button>
        <button class="btn sm" data-plan="${i}">预览差异</button>
        <button class="btn sm" data-plan="${i}">预览差异</button>
        <button class="btn sm" data-dl="${i}">下载 mcp.json</button>
        <button class="btn sm primary" data-write="${i}">写入客户端</button>
      </div>
    </div></div>`).join('');

  const jsonOf = i => JSON.stringify(data.configs[i].content, null, 2);
  out.querySelectorAll('[data-copy]').forEach(b => b.onclick = () => { navigator.clipboard.writeText(jsonOf(b.dataset.copy)); toast('已复制'); });
  out.querySelectorAll('[data-plan]').forEach(b => b.onclick = async () => {
    const r = await api.planExport(currentProfile).catch(e => ({ error: e.message }));
    if (r.error) return toast('获取计划失败：' + r.error);
    const lines = ['目标 ' + r.summary.targets + ' 个：新增 ' + r.summary.added + ' · 修改 ' + r.summary.changed + ' · 不变 ' + r.summary.unchanged + (r.summary.warnings ? (' · 警告 ' + r.summary.warnings) : ''), ''];
    for (const t of r.targets || []) {
      const st = { ok: '', 'new-file': '（新文件）', 'invalid-json': '（非法 JSON，将跳过）', 'no-path': '（未配置路径）' }[t.status] || '';
      lines.push('● ' + t.clientName + ' · ' + (t.path || '（无路径）') + ' ' + st);
      for (const a of t.mcpServers.add) lines.push('  + ' + a.name + '  ' + JSON.stringify(a.after));
      for (const c of t.mcpServers.change) lines.push('  ~ ' + c.name + '  ' + JSON.stringify(c.before) + '  →  ' + JSON.stringify(c.after));
      for (const s of t.mcpServers.same) lines.push('  = ' + s);
      for (const k of t.mcpServers.kept) lines.push('  · 保留（方案外）' + k);
      for (const a of t.env.add) lines.push('  + env.' + a.key + ' = ' + a.after);
      for (const c of t.env.change) lines.push('  ~ env.' + c.key + ' = ' + c.before + ' → ' + c.after);
      lines.push('');
    }
    lines.push('以上为写入计划预览，未改动任何文件；密钥已脱敏。');
    showInfoModal('写入计划 · ' + (r.profileName || ''), lines.join('\n'));
  });
  out.querySelectorAll('[data-plan]').forEach(b => b.onclick = async () => {
    const r = await api.planExport(currentProfile).catch(e => ({ error: e.message }));
    if (r.error) return toast('获取计划失败：' + r.error);
    const lines = ['目标 ' + r.summary.targets + ' 个：新增 ' + r.summary.added + ' · 修改 ' + r.summary.changed + ' · 不变 ' + r.summary.unchanged + (r.summary.warnings ? (' · 警告 ' + r.summary.warnings) : ''), ''];
    for (const t of r.targets || []) {
      const st = { ok: '', 'new-file': '（新文件）', 'invalid-json': '（非法 JSON，将跳过）', 'no-path': '（未配置路径）' }[t.status] || '';
      lines.push('● ' + t.clientName + ' · ' + (t.path || '（无路径）') + ' ' + st);
      for (const a of t.mcpServers.add) lines.push('  + ' + a.name + '  ' + JSON.stringify(a.after));
      for (const c of t.mcpServers.change) lines.push('  ~ ' + c.name + '  ' + JSON.stringify(c.before) + '  →  ' + JSON.stringify(c.after));
      for (const s of t.mcpServers.same) lines.push('  = ' + s);
      for (const k of t.mcpServers.kept) lines.push('  · 保留（方案外）' + k);
      for (const a of t.env.add) lines.push('  + env.' + a.key + ' = ' + a.after);
      for (const c of t.env.change) lines.push('  ~ env.' + c.key + ' = ' + c.before + ' → ' + c.after);
      lines.push('');
    }
    lines.push('以上为写入计划预览，未改动任何文件；密钥已脱敏。');
    showInfoModal('写入计划 · ' + (r.profileName || ''), lines.join('\n'));
  });
  out.querySelectorAll('[data-plan]').forEach(b => b.onclick = async () => {
    const r = await api.planExport(currentProfile).catch(e => ({ error: e.message }));
    if (r.error) return toast('获取计划失败：' + r.error);
    const lines = ['目标 ' + r.summary.targets + ' 个：新增 ' + r.summary.added + ' · 修改 ' + r.summary.changed + ' · 不变 ' + r.summary.unchanged + (r.summary.warnings ? (' · 警告 ' + r.summary.warnings) : ''), ''];
    for (const t of r.targets || []) {
      const st = { ok: '', 'new-file': '（新文件）', 'invalid-json': '（非法 JSON，将跳过）', 'no-path': '（未配置路径）' }[t.status] || '';
      lines.push('● ' + t.clientName + ' · ' + (t.path || '（无路径）') + ' ' + st);
      for (const a of t.mcpServers.add) lines.push('  + ' + a.name + '  ' + JSON.stringify(a.after));
      for (const c of t.mcpServers.change) lines.push('  ~ ' + c.name + '  ' + JSON.stringify(c.before) + '  →  ' + JSON.stringify(c.after));
      for (const s of t.mcpServers.same) lines.push('  = ' + s);
      for (const k of t.mcpServers.kept) lines.push('  · 保留（方案外）' + k);
      for (const a of t.env.add) lines.push('  + env.' + a.key + ' = ' + a.after);
      for (const c of t.env.change) lines.push('  ~ env.' + c.key + ' = ' + c.before + ' → ' + c.after);
      lines.push('');
    }
    lines.push('以上为写入计划预览，未改动任何文件；密钥已脱敏。');
    showInfoModal('写入计划 · ' + (r.profileName || ''), lines.join('\n'));
  });
  out.querySelectorAll('[data-plan]').forEach(b => b.onclick = async () => {
    const r = await api.planExport(currentProfile).catch(e => ({ error: e.message }));
    if (r.error) return toast('获取计划失败：' + r.error);
    const lines = ['目标 ' + r.summary.targets + ' 个：新增 ' + r.summary.added + ' · 修改 ' + r.summary.changed + ' · 不变 ' + r.summary.unchanged + (r.summary.warnings ? (' · 警告 ' + r.summary.warnings) : ''), ''];
    for (const t of r.targets || []) {
      const st = { ok: '', 'new-file': '（新文件）', 'invalid-json': '（非法 JSON，将跳过）', 'no-path': '（未配置路径）' }[t.status] || '';
      lines.push('● ' + t.clientName + ' · ' + (t.path || '（无路径）') + ' ' + st);
      for (const a of t.mcpServers.add) lines.push('  + ' + a.name + '  ' + JSON.stringify(a.after));
      for (const c of t.mcpServers.change) lines.push('  ~ ' + c.name + '  ' + JSON.stringify(c.before) + '  →  ' + JSON.stringify(c.after));
      for (const s of t.mcpServers.same) lines.push('  = ' + s);
      for (const k of t.mcpServers.kept) lines.push('  · 保留（方案外）' + k);
      for (const a of t.env.add) lines.push('  + env.' + a.key + ' = ' + a.after);
      for (const c of t.env.change) lines.push('  ~ env.' + c.key + ' = ' + c.before + ' → ' + c.after);
      lines.push('');
    }
    lines.push('以上为写入计划预览，未改动任何文件；密钥已脱敏。');
    showInfoModal('写入计划 · ' + (r.profileName || ''), lines.join('\n'));
  });
  out.querySelectorAll('[data-plan]').forEach(b => b.onclick = async () => {
    const r = await api.planExport(currentProfile).catch(e => ({ error: e.message }));
    if (r.error) return toast('获取计划失败：' + r.error);
    const lines = ['目标 ' + r.summary.targets + ' 个：新增 ' + r.summary.added + ' · 修改 ' + r.summary.changed + ' · 不变 ' + r.summary.unchanged + (r.summary.warnings ? (' · 警告 ' + r.summary.warnings) : ''), ''];
    for (const t of r.targets || []) {
      const st = { ok: '', 'new-file': '（新文件）', 'invalid-json': '（非法 JSON，将跳过）', 'no-path': '（未配置路径）' }[t.status] || '';
      lines.push('● ' + t.clientName + ' · ' + (t.path || '（无路径）') + ' ' + st);
      for (const a of t.mcpServers.add) lines.push('  + ' + a.name + '  ' + JSON.stringify(a.after));
      for (const c of t.mcpServers.change) lines.push('  ~ ' + c.name + '  ' + JSON.stringify(c.before) + '  →  ' + JSON.stringify(c.after));
      for (const s of t.mcpServers.same) lines.push('  = ' + s);
      for (const k of t.mcpServers.kept) lines.push('  · 保留（方案外）' + k);
      for (const a of t.env.add) lines.push('  + env.' + a.key + ' = ' + a.after);
      for (const c of t.env.change) lines.push('  ~ env.' + c.key + ' = ' + c.before + ' → ' + c.after);
      lines.push('');
    }
    lines.push('以上为写入计划预览，未改动任何文件；密钥已脱敏。');
    showInfoModal('写入计划 · ' + (r.profileName || ''), lines.join('\n'));
  });
  out.querySelectorAll('[data-plan]').forEach(b => b.onclick = async () => {
    const r = await api.planExport(currentProfile).catch(e => ({ error: e.message }));
    if (r.error) return toast('获取计划失败：' + r.error);
    const lines = ['目标 ' + r.summary.targets + ' 个：新增 ' + r.summary.added + ' · 修改 ' + r.summary.changed + ' · 不变 ' + r.summary.unchanged + (r.summary.warnings ? (' · 警告 ' + r.summary.warnings) : ''), ''];
    for (const t of r.targets || []) {
      const st = { ok: '', 'new-file': '（新文件）', 'invalid-json': '（非法 JSON，将跳过）', 'no-path': '（未配置路径）' }[t.status] || '';
      lines.push('● ' + t.clientName + ' · ' + (t.path || '（无路径）') + ' ' + st);
      for (const a of t.mcpServers.add) lines.push('  + ' + a.name + '  ' + JSON.stringify(a.after));
      for (const c of t.mcpServers.change) lines.push('  ~ ' + c.name + '  ' + JSON.stringify(c.before) + '  →  ' + JSON.stringify(c.after));
      for (const s of t.mcpServers.same) lines.push('  = ' + s);
      for (const k of t.mcpServers.kept) lines.push('  · 保留（方案外）' + k);
      for (const a of t.env.add) lines.push('  + env.' + a.key + ' = ' + a.after);
      for (const c of t.env.change) lines.push('  ~ env.' + c.key + ' = ' + c.before + ' → ' + c.after);
      lines.push('');
    }
    lines.push('以上为写入计划预览，未改动任何文件；密钥已脱敏。');
    showInfoModal('写入计划 · ' + (r.profileName || ''), lines.join('\n'));
  });
  out.querySelectorAll('[data-plan]').forEach(b => b.onclick = async () => {
    const r = await api.planExport(currentProfile).catch(e => ({ error: e.message }));
    if (r.error) return toast('获取计划失败：' + r.error);
    const lines = ['目标 ' + r.summary.targets + ' 个：新增 ' + r.summary.added + ' · 修改 ' + r.summary.changed + ' · 不变 ' + r.summary.unchanged + (r.summary.warnings ? (' · 警告 ' + r.summary.warnings) : ''), ''];
    for (const t of r.targets || []) {
      const st = { ok: '', 'new-file': '（新文件）', 'invalid-json': '（非法 JSON，将跳过）', 'no-path': '（未配置路径）' }[t.status] || '';
      lines.push('● ' + t.clientName + ' · ' + (t.path || '（无路径）') + ' ' + st);
      for (const a of t.mcpServers.add) lines.push('  + ' + a.name + '  ' + JSON.stringify(a.after));
      for (const c of t.mcpServers.change) lines.push('  ~ ' + c.name + '  ' + JSON.stringify(c.before) + '  →  ' + JSON.stringify(c.after));
      for (const s of t.mcpServers.same) lines.push('  = ' + s);
      for (const k of t.mcpServers.kept) lines.push('  · 保留（方案外）' + k);
      for (const a of t.env.add) lines.push('  + env.' + a.key + ' = ' + a.after);
      for (const c of t.env.change) lines.push('  ~ env.' + c.key + ' = ' + c.before + ' → ' + c.after);
      lines.push('');
    }
    lines.push('以上为写入计划预览，未改动任何文件；密钥已脱敏。');
    showInfoModal('写入计划 · ' + (r.profileName || ''), lines.join('\n'));
  });
  out.querySelectorAll('[data-plan]').forEach(b => b.onclick = async () => {
    const r = await api.planExport(currentProfile).catch(e => ({ error: e.message }));
    if (r.error) return toast('获取计划失败：' + r.error);
    const lines = ['目标 ' + r.summary.targets + ' 个：新增 ' + r.summary.added + ' · 修改 ' + r.summary.changed + ' · 不变 ' + r.summary.unchanged + (r.summary.warnings ? (' · 警告 ' + r.summary.warnings) : ''), ''];
    for (const t of r.targets || []) {
      const st = { ok: '', 'new-file': '（新文件）', 'invalid-json': '（非法 JSON，将跳过）', 'no-path': '（未配置路径）' }[t.status] || '';
      lines.push('● ' + t.clientName + ' · ' + (t.path || '（无路径）') + ' ' + st);
      for (const a of t.mcpServers.add) lines.push('  + ' + a.name + '  ' + JSON.stringify(a.after));
      for (const c of t.mcpServers.change) lines.push('  ~ ' + c.name + '  ' + JSON.stringify(c.before) + '  →  ' + JSON.stringify(c.after));
      for (const s of t.mcpServers.same) lines.push('  = ' + s);
      for (const k of t.mcpServers.kept) lines.push('  · 保留（方案外）' + k);
      for (const a of t.env.add) lines.push('  + env.' + a.key + ' = ' + a.after);
      for (const c of t.env.change) lines.push('  ~ env.' + c.key + ' = ' + c.before + ' → ' + c.after);
      lines.push('');
    }
    lines.push('以上为写入计划预览，未改动任何文件；密钥已脱敏。');
    showInfoModal('写入计划 · ' + (r.profileName || ''), lines.join('\n'));
  });
  out.querySelectorAll('[data-dl]').forEach(b => b.onclick = () => {
    const blob = new Blob([jsonOf(b.dataset.dl)], { type: 'application/json' });
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = 'mcp.json'; a.click();
  });
  out.querySelectorAll('[data-write]').forEach(b => b.onclick = () => {
    api.apply(currentProfile).then(r => {
      const x = (r.results || [])[b.dataset.write];
      if (x && x.ok) toast('已写入 ' + x.clientName); else toast('失败：' + (x?.error || '未知'));
    }).catch(e => toast('写入失败：' + e.message));
  });
}

/* ---------- 备份 / 迁移 ---------- */
async function renderBackup() {
  $('#pageTitle').textContent = '备份 / 迁移';
  $('#topActions').innerHTML = '';
  $('#view').innerHTML = `<div class="section-desc">导出全部资源为单个 JSON 备份文件，或导入他人/旧机的备份（可选合并或覆盖）。注意：备份文件中密钥为明文，请妥善保管。</div>
   <div class="layout">
     <div class="card"><div class="card-h">导出备份</div><div class="card-b">
       <p class="hint">下载包含全部资源的 ai-share-backup.json</p>
       <button class="btn primary" id="bkExport">导出全部备份</button>
     </div></div>
     <div class="card"><div class="card-h">导入备份</div><div class="card-b">
       <div class="field"><label>导入模式</label><select id="bkMode"><option value="merge">合并（按 id 合并，保留现有）</option><option value="replace">覆盖（以备份完全替换）</option></select></div>
       <input type="file" id="bkFile" accept="application/json"/>
       <button class="btn primary" id="bkImport" style="margin-top:10px">导入</button>
     </div></div>
     <div class="card"><div class="card-h">本地自动备份</div><div class="card-b">
       <div class="field"><label>快照目录</label><span id="bkDir" class="hint"></span></div>
       <div class="field check"><input type="checkbox" id="bkAutoEnabled"/><label for="bkAutoEnabled">按间隔自动创建本地快照</label></div>
       <div class="field"><label>间隔（小时）</label><input id="bkAutoHours" type="number" min="1" max="720"/></div>
       <div class="field"><label>保留份数</label><input id="bkAutoKeep" type="number" min="1" max="50"/></div>
       <button class="btn primary" id="bkAutoSave">保存设置</button>
       <button class="btn" id="bkSnapshotNow" style="margin-top:10px">立即创建快照</button>
       <div class="hint" id="bkAutoStatus" style="margin-top:8px;white-space:pre-line"></div>
     </div></div>
     <div class="card"><div class="card-h">数据体检</div><div class="card-b">
       <p class="hint">检查密钥字段是否被历史 bug 反复重复加密（会让数据文件异常膨胀，例如某条 API Key 涨到几 MB）。扫描只读，不会改动数据；修复前请先做个快照。</p>
       <button class="btn" id="hcScan">扫描</button>
       <button class="btn primary" id="hcFix" disabled>修复</button>
       <div class="hint" id="hcResult" style="margin-top:8px;white-space:pre-line"></div>
     </div></div>
   </div>
   <div class="card" style="margin-top:16px"><div class="card-h">本地快照（一键回滚）</div><div class="card-b">
     <div class="field"><label>回滚模式</label><select id="bkRestoreMode"><option value="merge">合并（保留快照外的记录）</option><option value="replace">覆盖（以快照完全替换）</option></select></div>
     <div class="hint" style="margin-bottom:8px">回滚前会自动存一份当前状态快照，可随时退回。</div>
     <div id="snapList"></div>
   </div></div>`;
  $('#bkExport').onclick = async () => {
    const data = await fetch('/api/backup/export').then(r => r.json());
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = 'ai-share-backup.json'; a.click();
    toast('已导出备份');
  };
  $('#bkImport').onclick = () => {
    const file = $('#bkFile').files[0]; if (!file) return toast('请先选择备份文件');
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const data = JSON.parse(reader.result);
        fetch('/api/backup/import', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ data, mode: $('#bkMode').value }) })
          .then(r => r.json()).then(r => toast(r.ok ? '导入成功' : '导入失败'));
      } catch (e) { toast('文件解析失败'); }
    };
    reader.readAsText(file);
  };

  // ---------- 本地自动备份卡片 ----------
  const snapFmt = (n) => (n ? new Date(n).toLocaleString() : '—');
  const loadAuto = async () => {
    const a = await fetch('/api/backup/auto').then(r => r.json()).catch(() => null);
    if (!a) return;
    $('#bkAutoEnabled').checked = !!(a.config && a.config.enabled);
    $('#bkAutoHours').value = (a.config && a.config.intervalHours) || 12;
    $('#bkAutoKeep').value = (a.config && a.config.keep) || 10;
    $('#bkDir').textContent = (a.status && a.status.dir) || '';
    $('#bkAutoStatus').textContent =
      '当前状态：' + ((a.status && a.status.running) ? '运行中' : '未运行') +
      '　最近一次：' + snapFmt(a.status && a.status.lastBackupAt) +
      ((a.status && a.status.lastResult) ? '\n' + a.status.lastResult : '');
  };
  $('#bkAutoSave').onclick = async () => {
    const body = { enabled: $('#bkAutoEnabled').checked, intervalHours: Number($('#bkAutoHours').value) || 12, keep: Number($('#bkAutoKeep').value) || 10 };
    const r = await fetch('/api/backup/auto', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }).then(x => x.json());
    toast(r.config ? '已保存自动备份设置' : '保存失败');
    loadAuto(); renderSnaps();
  };
  $('#bkSnapshotNow').onclick = async () => {
    toast('正在创建快照…');
    const r = await fetch('/api/backup/snapshot', { method: 'POST' }).then(x => x.json());
    toast(r.error ? ('创建失败：' + r.error) : ('已创建快照 ' + ((r.snapshot && r.snapshot.name) || '')));
    loadAuto(); renderSnaps();
  };

  const renderSnaps = async () => {
    const r = await fetch('/api/backup/snapshots').then(x => x.json()).catch(() => null);
    const list = (r && r.snapshots) || [];
    const el = $('#snapList');
    if (!list.length) { el.innerHTML = '<p class="hint">还没有快照。开启自动备份或点「立即创建快照」后会出现在这里。</p>'; return; }
    el.innerHTML = list.map(s => `
      <div style="display:flex;justify-content:space-between;align-items:center;padding:8px 10px;border:1px solid #2a2f45;border-radius:8px;margin-bottom:8px;background:#1b1f33">
        <div style="min-width:0">
          <div style="font-weight:600">${esc(s.name)}</div>
          <div class="hint">${(s.size / 1024).toFixed(1)} KB · ${snapFmt(s.takenAt)}${s.corrupt ? ' · 文件损坏' : ''}${s.count != null ? ' · ' + s.count + ' 项' : ''}</div>
        </div>
        <div style="display:flex;gap:6px;flex-shrink:0">
          ${s.corrupt ? '' : '<button class="btn small" data-restore="' + esc(s.name) + '">回滚</button>'}
          <button class="btn small" data-del="${esc(s.name)}" style="border-color:#7a2b2b;color:#ff9b9b">删除</button>
        </div>
      </div>`).join('');
    el.querySelectorAll('[data-restore]').forEach(b => b.onclick = async () => {
      if (!confirm('回滚到 ' + b.dataset.restore + '？回滚前会自动保存当前状态为安全快照。')) return;
      const mode = $('#bkRestoreMode').value;
      const r2 = await fetch('/api/backup/snapshots/restore', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: b.dataset.restore, mode }) }).then(x => x.json());
      toast(r2.error ? ('回滚失败：' + r2.error) : ('已回滚到 ' + b.dataset.restore));
      renderSnaps();
    });
    el.querySelectorAll('[data-del]').forEach(b => b.onclick = async () => {
      if (!confirm('删除快照 ' + b.dataset.del + '？此操作不可恢复。')) return;
      const r2 = await fetch('/api/backup/snapshots/' + encodeURIComponent(b.dataset.del), { method: 'DELETE' }).then(x => x.json());
      toast(r2.error ? ('删除失败：' + r2.error) : '已删除快照');
      renderSnaps();
    });
  };

  // ---------- 数据体检：密钥重复加密自查与修复 ----------
  const hcBytes = (b) => (b < 1024 ? b + ' B' : b < 1048576 ? (b / 1024).toFixed(1) + ' KB' : (b / 1048576).toFixed(1) + ' MB');
  const hcRun = async (apply) => {
    const btn = apply ? $('#hcFix') : $('#hcScan');
    const old = btn.textContent;
    btn.disabled = true; btn.textContent = apply ? '修复中…' : '扫描中…';
    let r = null;
    try {
      r = await fetch('/api/maintenance/repair-secrets', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ apply: !!apply }) }).then(x => x.json());
    } catch (e) { /* 下面统一处理 */ }
    btn.disabled = false; btn.textContent = old;
    const el = $('#hcResult');
    if (!r || r.error) { el.textContent = '检查失败：' + ((r && r.error) || '请求失败'); $('#hcFix').disabled = true; return; }
    const lines = [];
    let total = 0, saved = 0, unfixable = 0;
    for (const col of Object.keys(r.report || {})) {
      const info = r.report[col];
      if (info.fixed) { lines.push('· ' + col + '：' + info.fixed + ' 个字段被重复加密，最多套了 ' + Math.max.apply(null, (info.samples || [{ layers: 0 }]).map(s => s.layers)) + ' 层'); total += info.fixed; saved += info.savedBytes || 0; }
      if (info.unfixable) { lines.push('· ' + col + '：' + info.unfixable + ' 个字段无法自动解开（密钥不匹配），已跳过'); unfixable += info.unfixable; }
    }
    if (!total && !unfixable) { el.textContent = '检查完成：未发现重复加密的密钥字段。'; $('#hcFix').disabled = true; return; }
    el.textContent = (apply ? '已修复 ' : '发现问题：') + total + ' 个字段' + (saved ? ('，可减少约 ' + hcBytes(saved) + ' 数据') : '') + '。\n' + lines.join('\n');
    $('#hcFix').disabled = !(total > 0 && !apply);
    if (apply && total) toast('已修复 ' + total + ' 个字段，减少约 ' + hcBytes(saved));
  };
  $('#hcScan').onclick = () => hcRun(false);
  $('#hcFix').onclick = () => hcRun(true);
  $('#hcFix').disabled = true;

  loadAuto(); renderSnaps();
}

/* ---------- 网络双向同步 ---------- */
async function renderSync() {
  $('#pageTitle').textContent = '网络同步';
  $('#topActions').innerHTML = '';
  const c = await fetch('/api/sync/config').then(r => r.json()).catch(() => null);
  if (!c) { $('#view').innerHTML = '<div class="section-desc">读取同步配置失败</div>'; return; }

  const statusText = c.lastSyncAt
    ? `上次同步：${new Date(c.lastSyncAt).toLocaleString()}　${esc(c.lastResult || '')}`
    : '尚未同步过';

  $('#view').innerHTML = `<div class="section-desc">与自建同步服务端双向同步全部资源。同一条资源两端都改过时，<b>以修改时间较新的一方为准</b>；删除操作也会同步到其他设备。API Key 在上传前会用「同步密钥」加密，服务端只能看到密文。</div>
   <div class="layout">
     <div class="card"><div class="card-h">服务端设置</div><div class="card-b">
       <div class="field"><label>服务端地址</label><input id="syUrl" value="${esc(c.url || '')}" placeholder="http://192.168.1.10:4738"/>
         <div class="hint">自建服务端启动方式：<code>npm run sync-server</code></div></div>
       <div class="field"><label>访问令牌（可选）</label><input id="syToken" type="password" value="${c.token ? '__SET__' : ''}" placeholder="对应服务端 SYNC_TOKEN"/>
         <div class="hint">留空表示不启用鉴权；显示 __SET__ 表示已保存，直接保存不会改动原值</div></div>
       <div class="field"><label>同步密钥</label><input id="sySecret" type="password" value="${c.secret ? '__SET__' : ''}" placeholder="用于加密 API Key"/>
         <div class="hint"><b>所有设备必须填写相同的同步密钥</b>，否则无法解密对方的密钥字段</div></div>
       <button class="btn primary" id="sySave">保存设置</button>
     </div></div>
     <div class="card"><div class="card-h">自动同步</div><div class="card-b">
       <div class="field check"><input type="checkbox" id="syEnabled" ${c.enabled ? 'checked' : ''}/><label for="syEnabled">启用定时自动同步</label></div>
       <div class="field"><label>同步间隔（分钟）</label><input id="syInterval" type="number" min="1" value="${Number(c.intervalMinutes) || 15}"/></div>
       <div class="hint">当前状态：${c.auto && c.auto.running ? '<b>运行中</b>' : '未运行'}</div>
       <div class="hint" style="margin-top:8px">${statusText}</div>
       <button class="btn primary" id="syNow" style="margin-top:10px">立即同步</button>
     </div></div>
   </div>`;

  const save = async () => {
    const body = {
      url: $('#syUrl').value.trim(),
      token: $('#syToken').value,
      secret: $('#sySecret').value,
      enabled: $('#syEnabled').checked,
      intervalMinutes: Number($('#syInterval').value) || 15,
    };
    const r = await fetch('/api/sync/config', {
      method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
    }).then(x => x.json());
    return r;
  };

  $('#sySave').onclick = async () => { await save(); toast('已保存同步设置'); renderSync(); };
  $('#syNow').onclick = async () => {
    await save(); // 先落盘当前表单，避免用未保存的配置同步
    toast('正在同步…');
    const r = await fetch('/api/sync/now', { method: 'POST' }).then(x => x.json());
    if (r.ok) {
      const detail = Object.entries(r.stats || {}).map(([k, v]) => `${k}：拉取 ${v.pulled}，推送 ${v.pushed}`).join('\n') || '各集合均已是最新，无变更';
      showInfoModal('同步完成', `共拉取 ${r.pulled} 项，推送 ${r.pushed} 项\n\n${detail}`);
    } else {
      showInfoModal('同步失败', r.error || '未知错误');
    }
    renderSync();
  };
}

async function renderOverview() {
  $('#pageTitle').textContent = '概览';
  $('#topActions').innerHTML = '';
  $('#view').innerHTML = '<div class="empty">加载中…</div>';
  let stats;
  let health;
  try {
    [stats, health] = await Promise.all([
      fetch('/api/system/stats').then(r => r.json()),
      fetch('/api/system/health-report').then(r => r.json()).catch(() => null),
    ]);
  } catch (e) {
    $('#view').innerHTML = '<div class="empty">加载失败：' + (e && e.message) + '</div>';
    return;
  }
  const c = stats.counts || {};
  const cards = [
    ['🔌', 'API 端点', c.providers || 0],
    ['💬', '提示词', c.prompts || 0],
    ['🧩', 'MCP 服务器', c.mcpservers || 0],
    ['📦', 'Skill 仓库', c.skillrepos || 0],
    ['🖥️', 'Agent 客户端', c.clients || 0],
    ['🗂️', '资源仓库', c.repos || 0],
    ['🔀', '共享方案', c.profiles || 0],
    ['🧮', '资源总计', c.total || 0],
  ];
  const fmtBytes = (b) => (b == null ? '—' : (b < 1024 ? b + ' B' : b < 1048576 ? (b / 1024).toFixed(1) + ' KB' : (b / 1048576).toFixed(1) + ' MB'));
  const tpl = (icon, label, val) => `<div style="background:var(--panel);border:1px solid var(--border);border-radius:var(--radius);padding:16px;box-shadow:var(--shadow-sm)"><div style="font-size:22px">${icon}</div><div style="font-size:26px;font-weight:700;margin:6px 0 2px">${val}</div><div class="hint">${label}</div></div>`;
  const sp = stats.snapshots || {};
  const lastB = sp.lastBackupAt ? new Date(sp.lastBackupAt).toLocaleString() : '—';
  $('#view').innerHTML = `
    <div class="section-desc">本机 AI 资源总览。所有数据仅存于本机（${esc(stats.dataDir)}），不上传任何云端${stats.vaultEnabled ? '；密钥保险库已启用' : ''}。</div>
    <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(170px,1fr));gap:14px;margin-bottom:18px">
      ${cards.map(x => tpl(x[0], x[1], x[2])).join('')}
    </div>
    <div class="layout">
      <div class="card"><div class="card-h">本地快照与自动备份</div><div class="card-b">
        <div class="field"><label>自动备份</label><span class="pill ${sp.enabled ? 'on' : ''}">${sp.enabled ? '已开启' : '未开启'}</span></div>
        <div class="field"><label>已存快照</label><span>${sp.count || 0} 份</span></div>
        <div class="field"><label>最近快照</label><span class="hint">${lastB}</span></div>
        <div class="field"><label>数据占用</label><span class="hint">${fmtBytes(stats.storageBytes)}</span></div>
        <button class="btn primary" id="ovBackup" style="margin-top:6px">前往备份 / 迁移</button>
      </div></div>
      <div class="card"><div class="card-h">资源健康度</div><div class="card-b">
        <div class="field"><label>状态</label><span class="pill ${(health && health.total === 0) ? 'on' : ''}">${health ? (health.total === 0 ? '良好' : health.total + ' 项待关注') : '—'}</span></div>
        <div class="field"><label>健康分</label><span>${health ? health.score : '—'} / 100</span></div>
        ${(health && health.issues.length) ? '<div class="hint" style="margin:6px 0 10px">' + health.issues.slice(0, 5).map(i => '• [' + i.kind + '] ' + esc(i.name || i.collection) + '：' + esc(i.detail)).join('<br>') + ((health.issues.length > 5) ? '<br>… 共 ' + health.issues.length + ' 项' : '') + '</div>' : '<div class="hint" style="margin:6px 0 10px">未发现缺失字段 / 重复 / 陈旧记录</div>'}
        <button class="btn" id="ovHealthMd" style="margin-top:6px">查看 Markdown 资源索引</button>
      </div></div>
      <div class="card"><div class="card-h">快速操作</div><div class="card-b" style="display:flex;flex-direction:column;gap:10px">
        <button class="btn" id="ovCollect">🔍 一键采集本机资源</button>
        <button class="btn" id="ovExport">📤 共享 / 导出</button>
        <button class="btn" id="ovSync">🔄 网络同步</button>
      </div></div>
    </div>`;
  $('#ovBackup').onclick = () => navTo('backup');
  $('#ovExport').onclick = () => navTo('export');
  $('#ovSync').onclick = () => navTo('sync');
  $('#ovCollect').onclick = () => $('#collectBtn').click();
  $('#ovHealthMd').onclick = () => window.open('/api/export/markdown', '_blank');
}

/* ---------- 导航 ---------- */
const PAGES = {
  overview: renderOverview,
  providers: () => renderCollection('providers'),
  prompts: () => renderCollection('prompts'),
  mcpservers: () => renderCollection('mcpservers'),
  skillrepos: () => renderCollection('skillrepos'),
  clients: () => renderCollection('clients'),
  repos: () => renderCollection('repos'),
  profiles: renderProfiles,
  export: renderExport,
  sync: renderSync,
  backup: renderBackup,
  trash: renderTrash,
};
function navTo(key) {
  document.querySelectorAll('.nav-item').forEach(n => n.classList.toggle('active', n.dataset.k === key));
  PAGES[key]();
}
function buildNav() {
  const items = [
    { k: 'overview', label: '概览', icon: '🏠' },
    { k: 'providers', label: 'API 端点', icon: '🔌' },
    { k: 'prompts', label: '提示词', icon: '💬' },
    { k: 'mcpservers', label: 'MCP 服务器', icon: '🧩' },
    { k: 'skillrepos', label: 'Skill 仓库', icon: '📦' },
    { k: 'clients', label: 'Agent 客户端', icon: '🖥️' },
    { k: 'repos', label: '资源仓库(同步)', icon: '🗂️' },
    { k: 'profiles', label: '共享配置', icon: '🔀' },
    { k: 'export', label: '共享 / 导出', icon: '📤' },
    { k: 'sync', label: '网络同步', icon: '🔄' },
    { k: 'backup', label: '备份 / 迁移', icon: '💾' },
    { k: 'trash', label: '回收站', icon: '🗑️' },
  ];
  $('#nav').innerHTML = items.map(i => `<div class="nav-item" data-k="${i.k}"><span class="ic">${i.icon}</span>${i.label}</div>`).join('');
  $('#nav').querySelectorAll('.nav-item').forEach(n => n.onclick = () => navTo(n.dataset.k));
}

$('#collectBtn').onclick = async () => {
  toast('正在扫描本机客户端…');
  const r = await fetch('/api/collect', { method: 'POST' }).then(x => x.json());
  const lines = (r.clients || []).filter(c => c.found).map(c => `${c.name}：MCP ${c.mcpCount}（新 ${c.created}）｜Skill ${c.skillCount}（新 ${c.sCreated}）｜提示词 ${c.promptCount}（新 ${c.pCreated}）`);
  const msg = `采集完成：新增 MCP ${r.totalCreated} / 更新 ${r.totalUpdated}；新增 Skill ${r.totalSCreated} / 更新 ${r.totalSUpdated}；新增 提示词 ${r.totalPCreated} / 更新 ${r.totalPUpdated}` + (lines.length ? '\n' + lines.join('\n') : '\n未发现已安装客户端的配置');
  const body = $('#modalBody');
  body.innerHTML = `<pre class="infotext">${esc(msg)}</pre>
    <div style="margin-top:14px;display:flex;gap:10px;justify-content:flex-end">
      <button class="btn" id="colClose">关闭</button>
      <button class="btn primary" id="colWrite">一键写入客户端</button>
    </div>`;
  $('#modalTitle').textContent = '一键采集结果';
  $('#modal').classList.remove('hidden');
  $('#colClose').onclick = closeModal;
  $('#colWrite').onclick = async () => {
    closeModal();
    let profiles;
    try { profiles = await api.list('profiles'); }
    catch (e) { toast('加载方案失败：' + e.message); return; }
    currentProfile = (profiles[0] && profiles[0].id) || null;
    renderExport(); navTo('export');
    toast('已打开「共享 / 导出」，可点「全部写入客户端」');
  };
  const active = document.querySelector('.nav-item.active');
  if (active) navTo(active.dataset.k);
};
/* ---------- 全局错误兜底 ---------- */
// 便于定位偶发的运行时报错：把文件名/行号/调用栈打到控制台，
// 避免只看到一句无上下文的错误信息。
window.addEventListener('error', (e) => {
  const stack = (e.error && e.error.stack) || '';
  console.error('[ai-share] 未捕获错误:', e.message,
    'at', e.filename + ':' + e.lineno + ':' + e.colno,
    '| readyState=', document.readyState,
    '| target=', (e.target && e.target.tagName) || 'window');
  if (stack) console.error('[ai-share] stack:\n' + stack);
  // 若是 WebView 渲染层读取几何信息的崩溃，额外记录当前活动页与可见 modal/toast 状态
  if (/getBoundingClientRect|layout|geometry/i.test(e.message)) {
    console.error('[ai-share] 疑似 WebView 布局崩溃，上下文:',
      'activePage=', document.querySelector('.nav-item.active') && document.querySelector('.nav-item.active').dataset.k,
      'modalHidden=', document.getElementById('modal').classList.contains('hidden'),
      'toastHidden=', document.getElementById('toast').classList.contains('hidden'));
  }
});
window.addEventListener('unhandledrejection', (e) => {
  console.error('[ai-share] 未处理的 Promise 拒绝:', e.reason);
});

// 防御性初始化：DOM 就绪后再构建界面，规避部分 WebView 内核
// 在脚本执行时机差异下出现的布局/元素读取竞态。
/* ---------- 全局搜索（命令面板 Ctrl/Cmd+K） ---------- */
function initPalette() {
  if (document.getElementById('palette')) return;
  const el = document.createElement('div');
  el.id = 'palette';
  el.className = 'modal hidden';
  el.innerHTML = '<div class="modal-box" style="max-width:660px"><div class="modal-head"><span>全局搜索</span><button id="palClose">✕</button></div><div class="modal-body"><input id="palInput" class="search" style="max-width:none" placeholder="搜索任意资源（名称 / 描述 / 标签）…" autocomplete="off"/><label class="pill" style="margin-left:8px"><input id="palSemantic" type="checkbox"/> 语义搜索</label><div id="palResults" class="list" style="margin-top:10px"></div></div></div>';
  document.body.appendChild(el);
  const input = el.querySelector('#palInput');
  const results = el.querySelector('#palResults');
  let items = [], active = 0, loading = false;
  const close = () => el.classList.add('hidden');
  el.querySelector('#palClose').onclick = close;
  el.onclick = (e) => { if (e.target === el) close(); };
  const activate = async (col, id) => {
    close();
    navTo(col);
    try { const it = await api.get(col, id); openForm(col, it, () => renderCollection(col)); }
    catch (e) { toast('打开失败：' + e.message); }
  };
  const paint = (list) => {
    if (!list.length) { results.innerHTML = '<div class="empty">无匹配结果</div>'; return; }
    results.innerHTML = list.map(({ col, it }, i) => {
      const s = SCHEMAS[col];
      return '<div class="row pal-item ' + (i === active ? 'pal-active' : '') + '" data-col="' + col + '" data-id="' + it.id + '"><div class="meta"><div class="title">' + esc(it[s.titleField]) + ' <span class="pill">' + esc(s.label) + '</span></div><div class="desc">' + esc(String(it[s.descField === '_desc' ? '_desc' : s.descField] || '')) + '</div></div><div class="ops"><button class="btn sm">打开</button></div></div>';
    }).join('');
    results.querySelectorAll('.pal-item').forEach(r => r.onclick = () => activate(r.dataset.col, r.dataset.id));
  };
  const render = async (q) => {
    q = (q || '').trim().toLowerCase();
    const semantic = document.getElementById('palSemantic').checked;
    let matched = [];
    if (matched.length === 0 && semantic && q) {
      try { const r = await fetch('/api/system/semantic-search?q=' + encodeURIComponent(q) + '&semantic=1').then(r => r.json()); matched = (r.items || []).map(x => ({ col: x.collection, it: x.item })); }
      catch (e) {}
    }
    const textMatch = q ? items.filter(({ col, it }) => {
      const s = SCHEMAS[col];
      const hay = [it[s.titleField], it[s.descField === '_desc' ? '_desc' : s.descField], (it[s.tagsField] || []).join(' ')].join(' ').toLowerCase();
      return hay.includes(q);
    });
    if (!matched.length) matched = textMatch;
  }
    active = 0;
    paint(matched.slice(0, 50));
  };
  const load = async () => {
    if (loading) return; loading = true;
    items = [];
    for (const col of Object.keys(SCHEMAS).filter(c => c !== 'profiles')) {
      try { const arr = await api.list(col); items.push(...arr.map(it => ({ col, it }))); } catch (e) {}
    }
    loading = false;
    render(input.value);
  };
  input.oninput = () => render(input.value);
  input.onkeydown = (e) => {
    const els = results.querySelectorAll('.pal-item');
    if (e.key === 'ArrowDown') { e.preventDefault(); if (els.length) { els[active] && els[active].classList.remove('pal-active'); active = (active + 1) % els.length; els[active].classList.add('pal-active'); els[active].scrollIntoView({ block: 'nearest' }); } }
    else if (e.key === 'ArrowUp') { e.preventDefault(); if (els.length) { els[active] && els[active].classList.remove('pal-active'); active = (active - 1 + els.length) % els.length; els[active].classList.add('pal-active'); els[active].scrollIntoView({ block: 'nearest' }); } }
    else if (e.key === 'Enter') { e.preventDefault(); if (els[active]) activate(els[active].dataset.col, els[active].dataset.id); }
    else if (e.key === 'Escape') { e.preventDefault(); close(); }
  };
  document.addEventListener('keydown', (e) => {
    if ((e.ctrlKey || e.metaKey) && (e.key === 'k' || e.key === 'K')) { e.preventDefault(); el.classList.remove('hidden'); load(); setTimeout(() => input.focus(), 0); }
  });
  window.__palette = { open: () => { el.classList.remove('hidden'); load(); setTimeout(() => input.focus(), 0); }, close };
}

/* ---------- 回收站：恢复已删除（墓碑）记录 ---------- */
async function renderTrash() {
  $('#pageTitle').textContent = '回收站';
  $('#topActions').innerHTML = '<button class="btn danger" id="trashPurgeAll">清空回收站</button>';
  $('#trashPurgeAll').onclick = () => confirmModal('确认清空回收站', '将永久删除回收站内的全部墓碑（不可恢复），确定？', async () => {
    try { const r = await api.trashPurgeAll(); invalidateList(); toast('已清空 ' + (r.total || 0) + ' 项'); }
    catch (e) { toast('清空失败：' + e.message); }
    renderTrash();
  });
  const cols = Object.keys(SCHEMAS);
  let all = [];
  for (const col of cols) {
    try { const arr = await api.list(col + '/deleted'); all.push(...arr.map(it => ({ col, it }))); } catch (e) {}
  }
  const view = $('#view');
  if (!all.length) { view.innerHTML = '<div class="empty">回收站为空。删除的记录先保留为墓碑，可在此恢复（默认 30 天后自动清除）。</div>'; return; }
  view.innerHTML = '<div class="section-desc">各集合中已删除（墓碑）的记录，共 ' + all.length + ' 项。恢复后重新出现在原列表，并随同步传播。</div><div class="batchbar hidden" id="trashBar"><label class="selall"><input type="checkbox" id="selAllT"/> 全选</label><span id="trashCount" class="hint">已选 0 项</span><span class="spacer"></span><button class="btn sm" id="batchRes">恢复选中</button><button class="btn sm danger" id="batchPurge">彻底删除</button></div><div class="list">' + all.map(({ col, it }) => {
    const s = SCHEMAS[col];
    return '<div class="row"><label class="selwrap"><input type="checkbox" class="sel" data-tsel="' + col + ':' + it.id + '"/></label><div class="meta"><div class="title">' + esc(it[s.titleField]) + ' <span class="pill">' + esc(s.label) + '</span></div><div class="desc">删除于 ' + esc(new Date(it.updatedAt).toLocaleString()) + '</div></div><div class="ops"><button class="btn sm" data-res="' + col + ':' + it.id + '">恢复</button><button class="btn sm danger" data-purge="' + col + ':' + it.id + '">彻底删除</button></div></div>';
  }).join('') + '</div>';
  view.querySelectorAll('[data-res]').forEach(b => b.onclick = async () => {
    const sv = b.dataset.res, i = sv.indexOf(':'), col = sv.slice(0, i), id = sv.slice(i + 1);
    const r = await fetch('/api/' + col + '/' + id + '/restore', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' }).then(x => x.json()).catch(() => ({}));
    if (r && r.id) { invalidateList(); toast('已恢复'); renderTrash(); } else toast('恢复失败：' + (r.error || '未知'));
  });
  view.querySelectorAll('[data-purge]').forEach(b => b.onclick = () => {
    const sv = b.dataset.purge, i = sv.indexOf(':'), col = sv.slice(0, i), id = sv.slice(i + 1);
    confirmModal('确认彻底删除', '将永久删除该墓碑（不可恢复），确定？', async () => {
      try { await api.purgeTombstone(col, id); invalidateList(); toast('已彻底删除'); renderTrash(); }
      catch (e) { toast('彻底删除失败：' + e.message); }
    });
  });
  const tsel = new Set();
  const tbar = document.getElementById('trashBar');
  const tcount = document.getElementById('trashCount');
  const updateTBar = () => { if (!tbar) return; tbar.classList.toggle('hidden', tsel.size === 0); if (tcount) tcount.textContent = '已选 ' + tsel.size + ' 项'; const sa = document.getElementById('selAllT'); if (sa) sa.checked = all.length > 0 && all.every(({col,it}) => tsel.has(col + ':' + it.id)); };
  view.querySelectorAll('[data-tsel]').forEach(c => { c.onchange = () => { const v = c.dataset.tsel; c.checked ? tsel.add(v) : tsel.delete(v); updateTBar(); }; });
  document.getElementById('selAllT').onchange = () => { const on = document.getElementById('selAllT').checked; all.forEach(({col,it}) => { const v = col + ':' + it.id; on ? tsel.add(v) : tsel.delete(v); }); view.querySelectorAll('[data-tsel]').forEach(c => c.checked = on); updateTBar(); };
  document.getElementById('batchRes').onclick = () => {
    if (!tsel.size) return;
    const n = tsel.size;
    confirmModal('确认批量恢复', '将恢复选中的 ' + n + ' 项，确定？', async () => {
      const items = Array.from(tsel).map(v => { const i = v.indexOf(':'); return { col: v.slice(0, i), id: v.slice(i + 1) }; });
      try {
        const r = await api.bulkRestore(items);
        toast('已恢复 ' + (r.restored || 0) + ' 项' + ((r.missing && r.missing.length) ? ('，' + r.missing.length + ' 项已不存在') : ''));
      } catch (e) { toast('批量恢复失败：' + e.message); }
      tsel.clear(); invalidateList(); renderTrash(); // 恢复/彻底删除会影响原集合，连同列表缓存一起失效
    });
  };
  document.getElementById('batchPurge').onclick = () => {
    if (!tsel.size) return;
    const n = tsel.size;
    confirmModal('确认彻底删除', '将永久删除选中的 ' + n + ' 项墓碑（不可恢复），确定？', async () => {
      const items = Array.from(tsel).map(v => { const i = v.indexOf(':'); return { col: v.slice(0, i), id: v.slice(i + 1) }; });
      try {
        const r = await api.bulkPurge(items);
        toast('已彻底删除 ' + (r.purged || 0) + ' 项' + ((r.missing && r.missing.length) ? ('，' + r.missing.length + ' 项已不存在') : ''));
      } catch (e) { toast('批量彻底删除失败：' + e.message); }
      tsel.clear(); invalidateList(); renderTrash(); // 恢复/彻底删除会影响原集合，连同列表缓存一起失效
    });
  };
}

function boot() {
  buildNav();
  initPalette();
  renderVault();
  renderDataDir();
  navTo('overview');
}
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', boot, { once: true });
} else {
  boot();
}
