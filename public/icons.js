/* AI Share · 内联 SVG 图标（SF Symbols 风格线性图标）
   统一 viewBox="0 0 24 24" + stroke=currentColor，颜色随上下文继承，深浅色主题零适配。
   全局提供 icon(name, size)：icon('home', 17) 返回 svg 字符串；name 见 ICONS，缺省 18px。
   app.js 与 index.html 共用；新增图标只需在 ICONS 里加一条。 */
(function () {
  'use strict';
  var ICONS = {
    home:   '<path d="M4 10.6 12 3.8l8 6.8"/><path d="M5.8 9.4V20h12.4V9.4"/><path d="M9.8 20v-5h4.4v5"/>',
    plug:   '<path d="M9 3v4M15 3v4M7 7h10v3.2a5 5 0 0 1-10 0zM12 15.2v4.4M8.4 21h7.2"/>',
    chat:   '<path d="M20.2 11.4c0 3.9-3.7 7-8.2 7-1 0-2-.15-2.9-.43L4.8 19.8l1.2-3.2a6.3 6.3 0 0 1-2.2-4.9c0-3.9 3.7-7 8.2-7s8.2 3.1 8.2 7z"/>',
    puzzle: '<path d="M5 8.5A1.5 1.5 0 0 1 6.5 7H9.8Q12 4.6 14.2 7H17.5A1.5 1.5 0 0 1 19 8.5V11.6C21.3 11.6 21.3 16.4 19 16.4V19A1.5 1.5 0 0 1 17.5 20.5H6.5A1.5 1.5 0 0 1 5 19Z"/>',
    box:    '<path d="M12 3.2 21 8v8l-9 4.8L3 16V8z"/><path d="M3.4 8.2 12 12.7l8.6-4.5"/><path d="M12 12.7v8.1"/>',
    display:'<path d="M3.2 4.4h17.6v11.2H3.2z"/><path d="M9 20.2h6M12 15.6v4.6"/>',
    folder: '<path d="M3.4 6.6h5.4l2 2.6h9.8v10.2H3.4z"/>',
    sliders:'<path d="M4.4 7h15.2M4.4 12h15.2M4.4 17h15.2"/><circle cx="9.2" cy="7" r="2.1"/><circle cx="14.8" cy="12" r="2.1"/><circle cx="7.4" cy="17" r="2.1"/>',
    export: '<path d="M4.8 8.6v9.8a1.6 1.6 0 0 0 1.6 1.6h11.2a1.6 1.6 0 0 0 1.6-1.6V8.6"/><path d="M12 3.6v9.4"/><path d="M8.6 7 12 3.6 15.4 7"/>',
    sync:   '<path d="M4 9.2h13.4M14 6.2l3 3-3 3"/><path d="M20 14.8H6.6M10 11.8l-3 3 3 3"/>',
    backup: '<path d="M12 3.6v9.8M8.4 9.2l3.6 3.6 3.6-3.6"/><path d="M4.6 16.4v2.4a1.6 1.6 0 0 0 1.6 1.6h11.6a1.6 1.6 0 0 0 1.6-1.6v-2.4"/>',
    trash:  '<path d="M4.4 6.6h15.2M9.4 6.6V4.4h5.2v2.2"/><path d="M6.2 6.6 7.2 20.4h9.6l1-13.8"/><path d="M10 10.4v6.2M14 10.4v6.2"/>',
    search: '<circle cx="10.8" cy="10.8" r="6.4"/><path d="M15.6 15.6 20.4 20.4"/>',
    number: '<path d="M4.6 6.6h14.8M4.6 12h14.8M4.6 17.4h9.2"/>',
    lock:   '<path d="M6.2 10.6h11.6v9.2H6.2z"/><path d="M8.6 10.6V7.8a3.4 3.4 0 0 1 6.8 0v2.8"/>',
    unlock: '<path d="M6.2 10.6h11.6v9.2H6.2z"/><path d="M8.6 10.6V7.8a3.4 3.4 0 0 1 6.4-1.6"/>'
  };
  window.icon = function (name, size) {
    var s = size || 18;
    return '<svg class="ic-svg" viewBox="0 0 24 24" width="' + s + '" height="' + s +
      '" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
      (ICONS[name] || '') + '</svg>';
  };
})();
