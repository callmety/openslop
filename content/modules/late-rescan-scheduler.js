(function () {
  'use strict';

  var root = (typeof window !== 'undefined' && window) || globalThis;

  var ns = root.__HUCS__;
  if (!ns || !ns.modules) {
    throw new Error('OpenSlop module contracts are required before late-rescan-scheduler.js');
  }

  function createLateRescanScheduler(deps) {
    deps = deps || {};

    var delayMs = deps.delayMs;
    var setTimeoutFn = deps.setTimeout;
    var clearTimeoutFn = deps.clearTimeout;
    var onFlushRoot = deps.onFlushRoot;

    var lateRoots = new Set();
    var lateRootTimer = null;

    function schedule(roots) {
      roots = Array.isArray(roots) ? roots : [];
      for (var i = 0; i < roots.length; i++) {
        if (roots[i]) lateRoots.add(roots[i]);
      }
      clearTimeoutFn(lateRootTimer);
      lateRootTimer = setTimeoutFn(function () {
        var batch = Array.from(lateRoots);
        lateRoots = new Set();
        for (var j = 0; j < batch.length; j++) {
          if (batch[j].isConnected) onFlushRoot(batch[j]);
        }
      }, delayMs);
    }

    return {
      schedule: schedule,
    };
  }

  ns.modules.lateRescanScheduler = {
    create: createLateRescanScheduler,
  };
})();
