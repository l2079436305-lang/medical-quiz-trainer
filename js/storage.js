/* =========================================================================
 * storage.js — 本地持久化层（localStorage，完全本地，不上传任何数据）
 * ========================================================================= */

(function (root) {
  'use strict';

  var PREFIX = 'medquiz.v1.';
  var memory = {}; // 测试环境 / 隐私模式回退

  function available() {
    try {
      var k = PREFIX + '__test__';
      root.localStorage.setItem(k, '1');
      root.localStorage.removeItem(k);
      return true;
    } catch (e) {
      return false;
    }
  }

  function get(key, fallback) {
    try {
      var raw = available() ? root.localStorage.getItem(PREFIX + key) : (memory[key] || null);
      if (raw === null || raw === undefined) return fallback;
      return JSON.parse(raw);
    } catch (e) {
      return fallback;
    }
  }

  function set(key, value) {
    var raw = JSON.stringify(value);
    try {
      if (available()) root.localStorage.setItem(PREFIX + key, raw);
      else memory[key] = raw;
      return true;
    } catch (e) {
      // 容量超限等异常向上抛出，由 UI 提示
      if (e && (e.name === 'QuotaExceededError' || /quota/i.test(String(e.message || '')))) {
        var err = new Error('本地存储空间不足，无法保存。请导出题库后清理浏览器数据，或缩短题库内容。');
        err.quota = true;
        throw err;
      }
      throw e;
    }
  }

  function remove(key) {
    try { root.localStorage.removeItem(PREFIX + key); } catch (e) { /* noop */ }
    delete memory[key];
  }

  function clearAll() {
    var keys = ['bank', 'records', 'settings', 'session', 'history', 'daily'];
    keys.forEach(remove);
  }

  function usage() {
    if (!available()) return 0;
    var total = 0;
    try {
      for (var i = 0; i < root.localStorage.length; i++) {
        var k = root.localStorage.key(i);
        if (k && k.indexOf(PREFIX) === 0) total += (root.localStorage.getItem(k) || '').length * 2;
      }
    } catch (e) { /* noop */ }
    return total;
  }

  root.MQStorage = {
    KEYS: { BANK: 'bank', RECORDS: 'records', SETTINGS: 'settings', SESSION: 'session', HISTORY: 'history', DAILY: 'daily' },
    available: available,
    get: get,
    set: set,
    remove: remove,
    clearAll: clearAll,
    usage: usage
  };

})(typeof window !== 'undefined' ? window : globalThis);
