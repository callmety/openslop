(function () {
  'use strict';

  var root = (typeof window !== 'undefined' && window) || globalThis;

  var ns = root.__HUCS__;
  if (!ns || typeof ns !== 'object') {
    ns = { modules: {} };
    root.__HUCS__ = ns;
    return;
  }

  if (!ns.modules || typeof ns.modules !== 'object') {
    ns.modules = {};
  }
})();
