(function () {
  'use strict';

  var root = (typeof window !== 'undefined' && window) || globalThis;

  var ns = root.__HUCS__;
  if (!ns || !ns.modules) {
    throw new Error('OpenSlop module contracts are required before card-meta.js');
  }

  function normalizeCardText(text) {
    return (text || '').replace(/\s+/g, ' ').trim();
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

  function getCardMetaText(card, selectors) {
    selectors = Array.isArray(selectors) ? selectors : [];
    var seen = {};
    var parts = [];
    for (var i = 0; i < selectors.length; i++) {
      var nodes = safeQuerySelectorAll(card, selectors[i]);
      for (var j = 0; j < nodes.length; j++) {
        var text = normalizeCardText(nodes[j].textContent);
        if (text && !seen[text]) {
          seen[text] = true;
          parts.push(text);
        }
      }
    }
    return parts.join(' ');
  }

  function getCardPostAndMetaText(card, deps) {
    var extractText = deps && deps.extractText;
    var postTextSelectors = deps && deps.postTextSelectors;
    var getMetaText = deps && deps.getCardMetaText;
    return normalizeCardText(
      extractText(card, postTextSelectors) + ' ' + getMetaText(card)
    );
  }

  function getReactorHeaderText(card, actorHeaderSelector) {
    if (!actorHeaderSelector) return '';
    var el = safeQuerySelector(card, actorHeaderSelector);
    return el ? normalizeCardText(el.textContent) : '';
  }

  function buttonTextMatchInCard(card, re, actionButtonSelector) {
    var nodes = safeQuerySelectorAll(card, actionButtonSelector);
    for (var i = 0; i < nodes.length; i++) {
      var text = normalizeCardText(
        (nodes[i].getAttribute('aria-label') || '') + ' ' + (nodes[i].textContent || '')
      );
      if (re.test(text)) return true;
    }
    return false;
  }

  function getPrimaryActorHref(card, actorScopes, entityLinkSelector) {
    var scopes = actorScopes || [];
    var scopeNodes;
    var links;
    var i;
    var j;
    for (i = 0; i < scopes.length; i++) {
      scopeNodes = safeQuerySelectorAll(card, scopes[i]);
      for (j = 0; j < scopeNodes.length; j++) {
        links = safeQuerySelectorAll(scopeNodes[j], entityLinkSelector);
        if (links.length) return links[0].getAttribute('href') || '';
      }
    }
    links = safeQuerySelectorAll(card, entityLinkSelector);
    if (links.length) return links[0].getAttribute('href') || '';
    return '';
  }

  ns.modules.cardMeta = {
    normalizeCardText: normalizeCardText,
    getCardMetaText: getCardMetaText,
    getCardPostAndMetaText: getCardPostAndMetaText,
    getReactorHeaderText: getReactorHeaderText,
    buttonTextMatchInCard: buttonTextMatchInCard,
    getPrimaryActorHref: getPrimaryActorHref,
  };
})();
