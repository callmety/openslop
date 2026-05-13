(function () {
  'use strict';

  var root = (typeof window !== 'undefined' && window) || globalThis;

  var ns = root.__HUCS__;
  if (!ns || !ns.modules) {
    throw new Error('OpenSlop module contracts are required before scan-candidates.js');
  }

  function createScanCandidates(deps) {
    deps = deps || {};

    var selectors = deps.selectors || {};
    var resolveFeedCard = deps.resolveFeedCard;

    function safeMatches(node, selector) {
      if (!node || !node.matches || !selector) return false;
      try {
        return node.matches(selector);
      } catch {
        return false;
      }
    }

    function safeQuerySelectorAll(node, selector) {
      if (!node || !node.querySelectorAll || !selector) return [];
      try {
        return node.querySelectorAll(selector);
      } catch {
        return [];
      }
    }

    function safeClosest(node, selector) {
      if (!node || !node.closest || !selector) return null;
      try {
        return node.closest(selector);
      } catch {
        return null;
      }
    }

    function collectMatches(rootNode, selector) {
      var out = [];
      if (rootNode.nodeType === 1 && safeMatches(rootNode, selector)) {
        out.push(rootNode);
      }
      var found = safeQuerySelectorAll(rootNode, selector);
      for (var i = 0; i < found.length; i++) {
        out.push(found[i]);
      }
      return out;
    }

    function findEnclosingPostCard(node) {
      var el = (node && node.nodeType === 1) ? node : (node && node.parentElement);
      if (!el || !el.closest) return null;
      var inner = safeClosest(el, selectors.postContainer);
      return inner ? resolveFeedCard(inner) : null;
    }

    function collectResolvedPostCards(rootNode) {
      var out = [];
      var seen = new Set();

      function pushCard(card) {
        if (!card || seen.has(card)) return;
        seen.add(card);
        out.push(card);
      }

      pushCard(findEnclosingPostCard(rootNode));

      var items = collectMatches(rootNode, selectors.feedCardItem);
      for (var j = 0; j < items.length; j++) {
        var resolved = resolveFeedCard(items[j]);
        if (resolved !== items[j] || safeMatches(items[j], selectors.postContainer)) {
          pushCard(resolved);
        }
      }

      var posts = collectMatches(rootNode, selectors.postContainer);
      for (var i = 0; i < posts.length; i++) {
        pushCard(resolveFeedCard(posts[i]));
      }

      return out;
    }

    return {
      collectMatches: collectMatches,
      findEnclosingPostCard: findEnclosingPostCard,
      collectResolvedPostCards: collectResolvedPostCards,
    };
  }

  ns.modules.scanCandidates = {
    create: createScanCandidates,
  };
})();
