(function () {
  'use strict';

  var root = (typeof window !== 'undefined' && window) || globalThis;

  var ns = root.__HUCS__;
  if (!ns || !ns.modules) {
    throw new Error('OpenSlop module contracts are required before text-extractors.js');
  }

  function safeQuerySelector(rootEl, selector) {
    if (!rootEl || !rootEl.querySelector || !selector) return null;
    try {
      return rootEl.querySelector(selector);
    } catch {
      return null;
    }
  }

  function safeQuerySelectorAll(rootEl, selector) {
    if (!rootEl || !rootEl.querySelectorAll || !selector) return [];
    try {
      return rootEl.querySelectorAll(selector);
    } catch {
      return [];
    }
  }

  function extractText(container, textSelectors, postFooterSelector) {
    for (var i = 0; i < textSelectors.length; i++) {
      var nodes = safeQuerySelectorAll(container, textSelectors[i]);
      if (!nodes || !nodes.length) continue;
      var parts = [];
      var seen = {};
      for (var j = 0; j < nodes.length; j++) {
        var text = (nodes[j].textContent || '').replace(/\s+/g, ' ').trim();
        if (!text || seen[text]) continue;
        seen[text] = true;
        parts.push(text);
      }
      if (parts.length) return parts.join(' ');
    }

    var footer = safeQuerySelector(container, postFooterSelector);
    if (footer) {
      var clone = container.cloneNode(true);
      var cloneFooter = safeQuerySelector(clone, postFooterSelector);
      if (cloneFooter && cloneFooter.parentNode) cloneFooter.parentNode.removeChild(cloneFooter);
      return clone.textContent;
    }

    return container.textContent;
  }

  function extractStructuralText(container, textSelectors) {
    for (var i = 0; i < textSelectors.length; i++) {
      var nodes = safeQuerySelectorAll(container, textSelectors[i]);
      if (!nodes || !nodes.length) continue;
      var parts = [];
      var seen = {};
      for (var j = 0; j < nodes.length; j++) {
        var raw = (nodes[j].innerText || nodes[j].textContent || '');
        var text = raw.replace(/[ \t]+/g, ' ').replace(/^ | $/gm, '').trim();
        if (!text || seen[text]) continue;
        seen[text] = true;
        parts.push(text);
      }
      if (parts.length) return parts.join('\n');
    }
    return '';
  }

  ns.modules.textExtractors = {
    extractText: extractText,
    extractStructuralText: extractStructuralText,
  };
})();
