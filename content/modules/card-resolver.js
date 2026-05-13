(function () {
  'use strict';

  var root = (typeof window !== 'undefined' && window) || globalThis;

  var ns = root.__HUCS__;
  if (!ns || !ns.modules) {
    throw new Error('OpenSlop module contracts are required before card-resolver.js');
  }

  function resolveFeedCard(node, selectors) {
    selectors = selectors || {};
    var el = (node && node.nodeType === 1) ? node : (node && node.parentElement);
    if (!el || !el.closest) return node;

    function safeClosest(rootNode, selector) {
      if (!rootNode || !rootNode.closest || !selector) return null;
      try {
        return rootNode.closest(selector);
      } catch {
        return null;
      }
    }

    var outer = safeClosest(el, selectors.searchResultOuter);
    if (outer) return outer;

    var li = safeClosest(el, selectors.feedCardItem);
    var list = li ? safeClosest(li, selectors.feedCardList) : null;
    if (li && list) {
      // SDUI feed variants wrap role=listitem inside a FeedType shell
      // that owns tile spacing/background. Hide the nearest FeedType wrapper
      // so promoted cards don't leave a visible blank tile shell behind.
      var cur = li.parentElement;
      while (cur && cur !== list) {
        var key = cur.getAttribute && cur.getAttribute('componentkey');
        if (key && /FeedType_/i.test(key)) return cur;
        cur = cur.parentElement;
      }
      return li;
    }

    return node;
  }

  ns.modules.cardResolver = {
    resolveFeedCard: resolveFeedCard,
  };
})();
