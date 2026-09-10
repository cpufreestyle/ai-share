'use strict';
// 防本地 CSRF 的纯判定函数（无副作用，便于单测）。
// 服务无鉴权且监听回环地址时，浏览器里的任意网页都能向本服务发起请求；
// 同源策略只阻止「读取响应」，不阻止「触发副作用」（如 POST /api/export/:id/apply 改写客户端配置）。
// 因此对所有 /api 请求：① 拒绝跨站来源；② 写请求要求 application/json（强制跨站预检）。

// 是否来自浏览器跨站请求。非浏览器客户端（Node / MCP 桥接器）不发 Origin，判为非同站、放行。
function isCrossSite(headers) {
  const h = headers || {};
  const origin = h.origin;
  if (origin === 'null') return true; // 沙箱 iframe / data: 等
  if (origin) {
    let host;
    try { host = new URL(origin).host; } catch (e) { return true; }
    if (host !== (h.host || '')) return true; // 来源与目标 Host 不同源
  }
  if (h['sec-fetch-site'] === 'cross-site') return true;
  return false;
}

// 写请求的内容类型是否可接受：
// 允许「无 Content-Type」（前端部分 bodyless POST，如 apply/remove）或 application/json；
// 拒绝 text/plain、application/x-www-form-urlencoded、multipart/form-data
// —— 这些正是「不触发 CORS 预检的简单请求」内容类型，跨站注入会利用它们。
function hasJsonContentType(headers) {
  const ct = String((headers || {})['content-type'] || '').toLowerCase();
  if (!ct) return true;
  return ct.startsWith('application/json');
}

module.exports = { isCrossSite, hasJsonContentType };
