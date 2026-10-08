/* =============================================================================
 * 合成大菲比 · 本地存档（最高分 / 音量 / 图鉴解锁）
 * ========================================================================== */
window.SKD = window.SKD || {};

(function (SKD) {
  'use strict';

  var KEY = SKD.CONFIG.storageKey;

  function safeParse(txt) {
    try { return JSON.parse(txt) || {}; } catch (e) { return {}; }
  }

  SKD.Store = {
    data: (function () {
      try {
        return safeParse(window.localStorage.getItem(KEY));
      } catch (e) { return {}; }
    })(),

    get: function (k, dflt) {
      return this.data[k] === undefined ? dflt : this.data[k];
    },

    set: function (k, v) {
      this.data[k] = v;
      this.flush();
    },

    flush: function () {
      try { window.localStorage.setItem(KEY, JSON.stringify(this.data)); } catch (e) { /* 隐私模式忽略 */ }
    }
  };
})(window.SKD);
