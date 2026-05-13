// OpenSlop — shared browser API wrappers
// Centralizes popup/runtime chrome.* access behind promise-based helpers.

(function (root) {
  'use strict';

  function getChrome() {
    if (root && root.chrome) return root.chrome;
    if (typeof chrome !== 'undefined') return chrome;
    return null;
  }

  function addStorageChangeListener(listener) {
    var c = getChrome();
    if (!c || !c.storage || !c.storage.onChanged || typeof c.storage.onChanged.addListener !== 'function') {
      return function () {};
    }
    c.storage.onChanged.addListener(listener);
    return function () {
      if (c.storage.onChanged && typeof c.storage.onChanged.removeListener === 'function') {
        c.storage.onChanged.removeListener(listener);
      }
    };
  }

  root.HUChromeAPI = {
    addStorageChangeListener: addStorageChangeListener,
  };
}(typeof window !== 'undefined' ? window : globalThis));
