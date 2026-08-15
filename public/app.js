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
    inner = `<input id="f_${f.key}" type="password" value="${esc(v)}" placeholder="••••••"/>`;
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
}
function closeModal() { $('#modal').classList.add('hidden'); }
$('#modalClose').onclick = closeModal;

/* ---------- 通用列表视图 ---------- */
async function renderCollection(col) {
  const schema = SCHEMAS[col];
  $('#pageTitle').textContent = schema.label;
  const impBtn = (col === 'mcpservers' || col === 'skillrepos' || col === 'prompts') ? `<button class="btn" id="impBtn">从客户端导入</button>` : '';
  const syncBtn = (col === 'repos') ? `<button class="btn" id="syncAllBtn">同步全部启用仓库</button>` : '';
  $('#topActions').innerHTML = impBtn + syncBtn + `<button class="btn primary" id="newBtn">+ 新建</button>`;
  $('#newBtn').onclick = () => openForm(col, null, () => renderCollection(col));
  if (col === 'mcpservers') $('#impBtn').onclick = openImportFromClient;
  else if (col === 'skillrepos') $('#impBtn').onclick = openImportSkillFromClient;
  else if (col === 'prompts') $('#impBtn').onclick = openImportPromptFromClient;
  else if (col === 'repos') $('#syncAllBtn').onclick = syncAllRepos;

  const view = $('#view');
  // 加载状态占位：数据量大时先给反馈，避免白屏等待
  view.innerHTML = `<div class="empty">加载中…</div>`;

  let items;
  try {
    items = await api.list(col);
  } catch (e) {
    view.innerHTML = `<div class="empty">加载失败：${esc(e.message)}</div>`;
    return;
  }
  if (!items.length) { view.innerHTML = `<div class="empty">暂无数据，点击右上角「新建」添加。</div>`; return; }

  const rowHtml = it => {
    let desc = schema.descField === '_desc'
      ? (col === 'repos'
        ? (it.type === 'git' ? (it.url || '（未填 Git 地址）') : (it.path || '（未填本地路径）'))
        : (it.type === 'stdio' ? `${it.command} ${(it.args || []).join(' ')}` : it.url))
      : it[schema.descField] || '';
    const tags = schema.tagsField ? (it[schema.tagsField] || []).map(t => `<span class="tag">${esc(t)}</span>`).join('') : '';
    const pill = ('enabled' in it) ? `<span class="pill ${it.enabled ? 'on' : 'off'}">${it.enabled ? '启用' : '停用'}</span>` : '';
    const extra = (col === 'repos') ? `<button class="btn sm" data-sync="${it.id}">同步</button>` : '';
    const syncInfo = (col === 'repos' && it.lastSyncAt) ? `<div class="desc sub">上次同步：${esc(new Date(it.lastSyncAt).toLocaleString())}</div>` : '';
    return `<div class="row">
      <div class="meta"><div class="title">${esc(it[schema.titleField])} ${pill}</div><div class="desc">${esc(desc)}</div>${syncInfo}${tags}</div>
      <div class="ops">${extra}<button class="btn sm" data-edit="${it.id}">编辑</button><button class="btn sm danger" data-del="${it.id}">删除</button></div>
    </div>`;
  };
  // 关键词匹配：名称 / 描述 / 标签
  const matches = (it, q) => {
    const hay = [it[schema.titleField], (schema.descField === '_desc' ? '' : it[schema.descField]), (it[schema.tagsField] || []).join(' ')].join(' ').toLowerCase();
    return hay.includes(q);
  };
  const bindRows = (root) => {
    root.querySelectorAll('[data-edit]').forEach(b => b.onclick = async () => {
      try { const it = await api.get(col, b.dataset.edit); openForm(col, it, () => renderCollection(col)); }
      catch (e) { toast('获取详情失败：' + e.message); }
    });
    root.querySelectorAll('[data-del]').forEach(b => b.onclick = () => {
      confirmModal('确认删除', '删除后不可恢复，确定删除该条记录？', () => {
        api.remove(col, b.dataset.del).then(() => { toast('已删除'); renderCollection(col); }).catch(e => toast('删除失败：' + e.message));
      });
    });
    root.querySelectorAll('[data-sync]').forEach(b => b.onclick = () => syncRepo(b.dataset.sync));
  };

  view.innerHTML = `<div class="section-desc">集中维护 ${schema.label}，可在「共享 / 导出」中一键应用到各客户端。</div>
    <input id="listSearch" class="search" type="text" placeholder="搜索 ${schema.label}…" autocomplete="off"/>
    <div class="list" id="listBox"></div>`;
  const listBox = $('#listBox');
  const paint = (list) => { listBox.innerHTML = list.length ? list.map(rowHtml).join('') : '<div class="empty">无匹配结果</div>'; bindRows(listBox); };
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
  renderCollection('repos');
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
  renderCollection('repos');
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
      renderCollection('mcpservers');
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
      renderCollection('skillrepos');
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
      renderCollection('prompts');
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
        <button class="btn sm" data-dl="${i}">下载 mcp.json</button>
        <button class="btn sm primary" data-write="${i}">写入客户端</button>
      </div>
    </div></div>`).join('');

  const jsonOf = i => JSON.stringify(data.configs[i].content, null, 2);
  out.querySelectorAll('[data-copy]').forEach(b => b.onclick = () => { navigator.clipboard.writeText(jsonOf(b.dataset.copy)); toast('已复制'); });
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
   </div>`;
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

/* ---------- 导航 ---------- */
const PAGES = {
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
};
function navTo(key) {
  document.querySelectorAll('.nav-item').forEach(n => n.classList.toggle('active', n.dataset.k === key));
  PAGES[key]();
}
function buildNav() {
  const items = [
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
function boot() {
  buildNav();
  renderVault();
  navTo('profiles');
}
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', boot, { once: true });
} else {
  boot();
}
