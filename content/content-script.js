// OpenSlop — Content Script
// ─────────────────────────────────────────────────────────────────────────────
// Scanning strategy (2026):
//   1. Find post cards via data-urn (most stable host hook)
//   2. Find comment rows via article.comments-comment-entity
//   3. For each container, extract text from known inner text nodes
//   4. If any text node matches the blacklist → hide the whole container
//
// This is more reliable than finding text nodes first and climbing up,
// because data-urn gives us the definitive card boundary directly.
//
// Architecture note — intentional single IIFE:
//   This file is deliberately kept as one private IIFE rather than split into
//   multiple manifest-loaded files.  In MV3 plain-script loading, separate
//   files cannot share a closed-over scope, so splitting would force all
//   runtime state into window-global scope (unacceptable) or require a
//   bootstrap factory pattern (significant additional complexity with low ROI).
//   The internal organisation follows a top-down logical flow; see the section
//   banners below for the module boundaries.
//
// Section map (numbering is intentionally non-contiguous — gaps mark
// surfaces that have been removed; the body section banners below are
// authoritative):
//   §1  Private State            — per-tab runtime variables
//   §4  Session Feed Counter     — shown/hidden totals + tally writes
//   §7  Text Extraction          — card text helpers
//   §8  Card-scoped Helpers      — normalise, meta text, buttons
//   §15 Reason Strip             — "why hidden" sibling overlay
//   §16 Hide / Reveal / Dim      — DOM state application
//   §17 UI Filter Application    — tombstone; applyUiFilters() is now a no-op
//   §18 AI-Slop Scorer           — deterministic heuristic scorer
//   §19 Core Evaluators          — getPostDecision, evaluatePost
//   §22 Root Scanner             — scanRoot, fullScan, collectMatches
//   §23 Observer Integration     — mutation-driven scan scheduling
//   §24 Storage Change Listener  — live settings sync
//   §26 Bootstrap                — init on settings load
// ─────────────────────────────────────────────────────────────────────────────

/* global HU, getSettings, setFeedCounter, setSessionTally, compileBlacklist, createObserver, getEffectiveBlacklist, getSlopSensitivityTerms, getSlopHeuristicThreshold, watchSettingsChanges */

(function () {
  'use strict';

  // ═══════════════════════════════════════════════════════════════════════════
  // §1 PRIVATE STATE
  // ═══════════════════════════════════════════════════════════════════════════
  // All mutable runtime state is declared here so its lifecycle and ownership
  // is visible in one place.  Nothing in this IIFE escapes to window scope.

  var enabled              = true;
  var matcher              = compileBlacklist([]);
  var slopMatcher          = compileBlacklist([]);   // slider-only post-only matcher
  var slopSensitivityLevel = 0;                      // mirrors settings.slopSensitivityLevel
  var aiFilterEnabled      = false;                  // mirrors settings.aiFilterEnabled
  var seriousModeEnabled   = false;                  // mirrors settings.seriousModeEnabled
  var uiFilters            = Object.assign({}, HU.DEFAULT_SETTINGS.uiFilters);

  function makeHideDecision(kind, extras) {
    return Object.assign({ kind: kind || '' }, extras || {});
  }

  function normalizeHideDecision(value) {
    if (value && typeof value === 'object') return makeHideDecision(value.kind, value);
    return makeHideDecision(value || '');
  }

  var __huModules = (window.__HUCS__ && window.__HUCS__.modules) || null;
  if (!__huModules) {
    throw new Error('OpenSlop content modules missing: expected content/modules/contracts.js before content-script.js');
  }

  var __textExtractors = __huModules.textExtractors;
  var __cardMeta = __huModules.cardMeta;
  var __cardResolver = __huModules.cardResolver;
  var __postEvaluator = __huModules.postEvaluator;
  var __scanCandidates = __huModules.scanCandidates;
  var __lateRescanScheduler = __huModules.lateRescanScheduler;

  if (!__textExtractors || !__cardMeta || !__cardResolver || !__postEvaluator || !__scanCandidates || !__lateRescanScheduler) {
    throw new Error('OpenSlop content modules incomplete: check manifest content script module order');
  }

  // ── Manually Revealed Cards ────────────────────────────────────────────────
  // Cards the user explicitly un-hid via the reason strip's "Show" button.
  // WeakSet prevents a GC-safe skip on re-evaluation.

  var manuallyRevealedCards = new WeakSet();

  // ═══════════════════════════════════════════════════════════════════════════
  // §4 SESSION FEED COUNTER
  // ═══════════════════════════════════════════════════════════════════════════
  // Tracks per-element counter state via data-hu-counter-state so that
  // re-evaluating the same card never double-counts, and newly visible cards
  // (which were never hidden) are correctly counted as "shown".

  var feedCounter = { shown: 0, hidden: 0 };
  var sessionKindTally = {};
  var COUNTER_STATE_ATTR = 'data-hu-counter-state';

  var counterFlushTimer = null;

  function flushCounter() {
    setFeedCounter(feedCounter);
    setSessionTally(sessionKindTally);
  }

  // Clear any stale tally from a previous session on page load.
  setSessionTally({});

  function setCounterState(el, nextState) {
    if (!el) return;
    var prevState = el.getAttribute(COUNTER_STATE_ATTR);
    if (prevState === nextState) return;
    if (prevState === 'shown')  feedCounter.shown  = Math.max(0, feedCounter.shown  - 1);
    if (prevState === 'hidden') feedCounter.hidden = Math.max(0, feedCounter.hidden - 1);
    if (nextState === 'shown')  feedCounter.shown++;
    if (nextState === 'hidden') feedCounter.hidden++;
    el.setAttribute(COUNTER_STATE_ATTR, nextState);
    clearTimeout(counterFlushTimer);
    counterFlushTimer = setTimeout(flushCounter, 200);
  }

  // ── Boot sequencing guard ────────────────────────────────────────────────
  // The host hydrates large React trees after document_idle. If we mutate the
  // DOM too early (hide/show/layout attrs) React may throw hydration/runtime
  // errors and leave the page in a broken state. Delay first mutations until
  // after the window load event + a short settle window.
  var bootRuntimeStarted = false;
  var bootStartTimer     = null;
  var BOOT_START_DELAY_MS = 1200;

  // ── Debug Tracing ────────────────────────────────────────────────────────
  // Toggle via:
  //   1) URL param on the page: ?hu_debug=1
  //   2) chrome.storage.local key: { hu_debug: true }
  // Debug logs are intentionally verbose and should stay opt-in.
  var DEBUG_STORAGE_KEY = 'hu_debug';
  var debugEnabled      = /(?:\?|&)hu_debug=1(?:&|$)/.test(window.location.search || '');
  var debugSeq          = 0;
  var debugHideTally    = {};
  var debugHideTimer    = null;

  function debugLog(eventName, payload) {
    if (!debugEnabled) return;
    try {
      var entry = {
        seq: ++debugSeq,
        ts: Date.now(),
        event: eventName,
        payload: payload || {},
      };
      var buf = window.__HU_DEBUG_BUFFER;
      if (!Array.isArray(buf)) buf = [];
      buf.push(entry);
      if (buf.length > 2000) buf.splice(0, buf.length - 2000);
      window.__HU_DEBUG_BUFFER = buf;
    } catch {}
  }

  function describeRootNode(root) {
    if (!root) return 'null';
    if (root === document) return 'document';
    if (root === document.body) return 'body';
    var tag = root.tagName ? root.tagName.toLowerCase() : 'node';
    var id  = root.id ? ('#' + root.id) : '';
    var cls = '';
    if (root.classList && root.classList.length) {
      cls = '.' + Array.from(root.classList).slice(0, 2).join('.');
    }
    return tag + id + cls;
  }

  function flushDebugHideTally() {
    debugHideTimer = null;
    var keys = Object.keys(debugHideTally);
    if (!keys.length) return;
    debugLog('hide.tally', debugHideTally);
    debugHideTally = {};
  }

  function debugCountHide(kind) {
    if (!debugEnabled) return;
    kind = kind || 'unknown';
    debugHideTally[kind] = (debugHideTally[kind] || 0) + 1;
    if (!debugHideTimer) {
      debugHideTimer = setTimeout(flushDebugHideTally, 2000);
    }
  }

  function applySettingsToRuntime(settings) {
    enabled              = settings.enabled !== false;
    matcher              = compileBlacklist(getEffectiveBlacklist(settings));
    slopSensitivityLevel = typeof settings.slopSensitivityLevel === 'number' ? settings.slopSensitivityLevel : 0;
    slopMatcher          = compileBlacklist(getSlopSensitivityTerms(settings));
    aiFilterEnabled      = !!settings.aiFilterEnabled;
    seriousModeEnabled   = !!settings.seriousModeEnabled;
    uiFilters            = settings.uiFilters || Object.assign({}, HU.DEFAULT_SETTINGS.uiFilters);
  }

  function loadDebugFlag(done) {
    if (debugEnabled) {
      debugLog('debug.enabled', { source: 'query', path: window.location.pathname });
      done();
      return;
    }
    try {
      chrome.storage.local.get(DEBUG_STORAGE_KEY, function (result) {
        var raw = result ? result[DEBUG_STORAGE_KEY] : false;
        debugEnabled = (raw === true || raw === 1 || raw === '1' || raw === 'true');
        if (debugEnabled) {
          debugLog('debug.enabled', { source: 'storage', raw: raw, path: window.location.pathname });
        }
        done();
      });
    } catch {
      done();
    }
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // §7 TEXT EXTRACTION
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Extract the best available text content from a container element.
   * Tries each selector in the provided list in order.
   * Falls back to the container's own textContent if nothing matches.
   *
   * @param {Element}  container
   * @param {string[]} textSelectors
   * @returns {string}
   */
  function extractText(container, textSelectors) {
    return __textExtractors.extractText(container, textSelectors, HU.SELECTORS.postFooter);
  }

  /**
   * Extract post body text preserving newlines — used by structural detectors
   * that depend on line structure (broetry, sentence-ladder, etc.).
   * Unlike extractText(), nodes are joined with '\n' and inner whitespace is
   * only collapsed horizontally, so the host's hard-break formatting survives.
   *
   * @param {Element} container
   * @param {string[]} textSelectors
   * @returns {string}
   */
  function extractStructuralText(container, textSelectors) {
    return __textExtractors.extractStructuralText(container, textSelectors);
  }

  function resolveFeedCard(node) {
    return __cardResolver.resolveFeedCard(node, {
      searchResultOuter: HU.SELECTORS.searchResultOuter,
      feedCardItem: HU.SELECTORS.feedCardItem,
      feedCardList: HU.SELECTORS.feedCardList,
    });
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // §8 CARD-SCOPED HELPERS
  // ═══════════════════════════════════════════════════════════════════════════
  // normalizeCardText is the canonical text-normalizer for DOM card content.
  // Must be used for ALL card text normalization inside this IIFE (not
  // normalizeText, which is the external shared/normalize.js function).

  function normalizeCardText(text) {
    return __cardMeta.normalizeCardText(text);
  }

  function getCardMetaText(card) {
    return __cardMeta.getCardMetaText(card, HU.SELECTORS.postMetaText || []);
  }

  function getReactorHeaderText(card) {
    return __cardMeta.getReactorHeaderText(card, HU.SELECTORS.actorHeaderText);
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // §15 REASON STRIP
  // ═══════════════════════════════════════════════════════════════════════════
  // A sibling DOM element injected adjacent to a collapsed/hidden card that shows
  // a human-readable reason and a "Show" button. Lives outside the card so it
  // remains visible and clickable while the card body is display:none.

  var reasonStripMap = new WeakMap();

  // Reason-strip labels for the kinds the engine can actually emit. The
  // post-evaluator (content/modules/post-evaluator.js) returns exactly four
  // kind strings — 'ai-filter', 'ai-slop', 'post' (custom-blacklist /
  // preset-state hit), and 'serious-mode' — plus an 'unknown' fallback when
  // a hide decision lacks a kind (see setHide() below). Anything else falls
  // through to the raw key in formatHideKindLabel().
  var KIND_LABELS = {
    'ai-filter':    'AI post',
    'ai-slop':      'AI slop',
    'post':         'Keyword match',
    'serious-mode': 'Humor post',
    'unknown':      'Hidden',
  };

  function formatHideKindLabel(kind) {
    return KIND_LABELS[kind] || kind;
  }

  function ensureReasonStrip(el, kind) {
    // Reuse existing strip if the element is the same.
    if (reasonStripMap.has(el)) {
      var existing = reasonStripMap.get(el);
      // Update label in case kind changed.
      var existingLabel = existing.querySelector('.hu-reason-strip__label');
      if (existingLabel) existingLabel.textContent = formatHideKindLabel(kind);
      if (existing.parentNode) return; // already in DOM
      el.parentNode.insertBefore(existing, el);
      return;
    }

    var strip = document.createElement('div');
    strip.className = 'hu-reason-strip';

    var label = document.createElement('span');
    label.className   = 'hu-reason-strip__label';
    label.textContent = formatHideKindLabel(kind);

    var showBtn = document.createElement('button');
    showBtn.type      = 'button';
    showBtn.className = 'hu-reason-strip__show';
    showBtn.textContent = 'Show';
    showBtn.setAttribute('aria-label', 'Show this filtered post');

    showBtn.addEventListener('click', function () {
      var isRevealed = showBtn.textContent === 'Hide';
      if (isRevealed) {
        // Re-hide: remove from manually-revealed set and re-apply hide
        manuallyRevealedCards.delete(el);
        showBtn.textContent = 'Show';
        showBtn.setAttribute('aria-label', 'Show this filtered post');
        showBtn.classList.remove('hu-reason-strip__show--revealed');
        strip.classList.remove('hu-reason-strip--expanded');
        // Re-apply the hidden/dimmed state without touching the strip
        el.classList.add(HU.HIDDEN_CLASS);
        el.setAttribute(HU.HIDDEN_ATTR, '1');
        el.removeAttribute(HU.DIMMED_ATTR);
      } else {
        // Reveal: mark as manually revealed, show post, keep strip
        manuallyRevealedCards.add(el);
        showBtn.textContent = 'Hide';
        showBtn.setAttribute('aria-label', 'Hide this post again');
        showBtn.classList.add('hu-reason-strip__show--revealed');
        strip.classList.add('hu-reason-strip--expanded');
        el.classList.remove(HU.HIDDEN_CLASS);
        el.removeAttribute(HU.HIDDEN_ATTR);
        el.removeAttribute(HU.DIMMED_ATTR);
      }
    });

    strip.appendChild(label);
    strip.appendChild(showBtn);

    reasonStripMap.set(el, strip);
    if (el.parentNode) {
      el.parentNode.insertBefore(strip, el);
    }
  }

  function removeReasonStrip(el) {
    if (!reasonStripMap.has(el)) return;
    var strip = reasonStripMap.get(el);
    if (strip.parentNode) strip.parentNode.removeChild(strip);
    reasonStripMap.delete(el);
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // §16 HIDE / REVEAL / DIM
  // ═══════════════════════════════════════════════════════════════════════════

  var AUDIT_ATTR = 'data-hu-audit';

  function hideElement(el, decisionOrKind) {
    var decision = normalizeHideDecision(decisionOrKind);
    var kind = decision.kind;

    if (!el) return;
    // Never re-suppress a card the user explicitly revealed.
    if (manuallyRevealedCards.has(el)) return;

    // Capture pre-mutation geometry. If the element sits above the user's
    // current viewport, shrinking it would yank visible content upward ("hop").
    // We measure the combined card+strip footprint before and after, then
    // window.scrollBy the delta so what the user is reading stays in place.
    var preRect = el.getBoundingClientRect();
    var wasAboveViewport = preRect.bottom <= 0;
    var preHeight = preRect.height;
    var preStripHeight = 0;
    if (wasAboveViewport && reasonStripMap.has(el)) {
      var preStrip = reasonStripMap.get(el);
      if (preStrip && preStrip.parentNode) {
        preStripHeight = preStrip.getBoundingClientRect().height;
      }
    }

    el.setAttribute(HU.KIND_ATTR, kind || 'unknown');

    // Only record genuinely new hide events — skip re-evaluations of already-hidden cards.
    if (!el.hasAttribute(HU.HIDDEN_ATTR) && !el.hasAttribute(HU.DIMMED_ATTR)) {
      // Expose the specific slop detector that flagged this card on the DOM
      // so a debugger (or test) can inspect why the engine decided to hide it.
      if (kind === 'ai-slop' && decision.slopTrigger) {
        el.setAttribute('data-hu-slop-trigger', decision.slopTrigger);
      }
      var tallyKey = kind || 'unknown';
      sessionKindTally[tallyKey] = (sessionKindTally[tallyKey] || 0) + 1;
      debugCountHide(kind);
    }

    // Audit mode: highlight matched cards without hiding them.
    // The card stays fully visible; a data attribute drives a CSS highlight rule.
    // Reason strips are still shown so users can see why each card matched.
    if (uiFilters.auditMode) {
      el.classList.remove(HU.HIDDEN_CLASS);
      el.removeAttribute(HU.HIDDEN_ATTR);
      el.removeAttribute(HU.DIMMED_ATTR);
      el.setAttribute(AUDIT_ATTR, '1');
      ensureReasonStrip(el, kind);
      return;
    }

    // Remove audit highlight if audit mode was just turned off.
    el.removeAttribute(AUDIT_ATTR);

    if (uiFilters.dimMode) {
      // Dim/collapse mode: hide card body (display:none); strip stays visible above it.
      el.classList.remove(HU.HIDDEN_CLASS);
      el.removeAttribute(HU.HIDDEN_ATTR);
      el.setAttribute(HU.DIMMED_ATTR, '1');
      ensureReasonStrip(el, kind);
    } else {
      // Full hide mode: remove from layout. Optionally show a reason strip.
      el.setAttribute(HU.HIDDEN_ATTR, '1');
      el.classList.add(HU.HIDDEN_CLASS);
      el.removeAttribute(HU.DIMMED_ATTR);
      if (uiFilters.showHiddenReasons) {
        ensureReasonStrip(el, kind);
      } else {
        removeReasonStrip(el);
      }
    }

    // Scroll-anchor compensation. If the card was above the user's viewport,
    // adjust scroll by the height delta so visible content doesn't hop.
    if (wasAboveViewport) {
      var postElHeight = (el.hasAttribute(HU.HIDDEN_ATTR) || el.hasAttribute(HU.DIMMED_ATTR))
        ? 0
        : el.getBoundingClientRect().height;
      var postStripHeight = 0;
      if (reasonStripMap.has(el)) {
        var postStrip = reasonStripMap.get(el);
        if (postStrip && postStrip.parentNode) {
          postStripHeight = postStrip.getBoundingClientRect().height;
        }
      }
      var delta = (postElHeight + postStripHeight) - (preHeight + preStripHeight);
      if (delta < -1) window.scrollBy(0, delta);
    }
  }

  function unhideElement(el) {
    if (!el) return;
    el.classList.remove(HU.HIDDEN_CLASS);
    el.removeAttribute(HU.HIDDEN_ATTR);
    el.removeAttribute(HU.DIMMED_ATTR);
    el.removeAttribute(HU.KIND_ATTR);
    el.removeAttribute(AUDIT_ATTR);
    removeReasonStrip(el);
  }

  function unhideAll() {
    var managed, dimmed, audited, i;
    managed = document.querySelectorAll('[' + HU.HIDDEN_ATTR + ']');
    for (i = 0; i < managed.length; i++) {
      unhideElement(managed[i]);
    }
    dimmed = document.querySelectorAll('[' + HU.DIMMED_ATTR + ']');
    for (i = 0; i < dimmed.length; i++) {
      unhideElement(dimmed[i]);
    }
    audited = document.querySelectorAll('[' + AUDIT_ATTR + ']');
    for (i = 0; i < audited.length; i++) {
      unhideElement(audited[i]);
    }
    // Remove any orphaned reason strips (e.g. after the card was removed from DOM).
    var strips = document.querySelectorAll('.hu-reason-strip');
    for (i = 0; i < strips.length; i++) {
      if (strips[i].parentNode) strips[i].parentNode.removeChild(strips[i]);
    }
  }

  function removeAttrFromAll(attrName) {
    if (!attrName) return;
    var nodes = document.querySelectorAll('[' + attrName + ']');
    for (var i = 0; i < nodes.length; i++) {
      nodes[i].removeAttribute(attrName);
    }
  }

  function clearRuntimeUiMarkers() {
    // Engine is post-card-only; the per-card hidden/dimmed/audit attrs are
    // cleared by unhideAll(). The session counter state is the only other
    // runtime marker the engine writes.
    removeAttrFromAll(COUNTER_STATE_ATTR);
  }

  function disableOpenSlopOnPage() {
    unhideAll();
    clearRuntimeUiMarkers();
  }

  // §17 — UI Filter Application — REMOVED.
  // The popup's product surface is post-card-only (AI filter + slop slider +
  // hidden-item mode). The 42-detector site-specific feed-filter engine and
  // its DOM-tagging machinery were removed; nothing the popup writes drives
  // any html-level toggles. `applyUiFilters` is preserved as a no-op so §24's
  // settings-change listener and §26 bootstrap can call it without changes.
  function applyUiFilters() { /* intentionally empty */ }

  // ═══════════════════════════════════════════════════════════════════════════
  // §18 AI-SLOP SCORER
  // ═══════════════════════════════════════════════════════════════════════════
  // Deterministic heuristic — no ML. Scores a post 0–100 based on low-signal
  // writing patterns. All signals are post-body-only to minimise false positives.

  var SLOP_CTA_RE = /\b(?:drop (?:a|your)|type ['"]?\w+['"]?|link in (?:bio|comments?)|comment below|save this post|share this (?:with|post)|what do you think\??|repost (?:this|if)|follow (?:me|for more)|agree\?|thoughts\?|am i (?:alone|wrong)\??|who (?:else|agrees)\?)\b/gi;
  var SLOP_HASHTAG_END_RE = /((?:\s*#\w+){3,})\s*$/;
  // Common AI-brochure lexical tells from real-world slop copy.
  // These are used as clustered signals only (never single-hit triggers).
  var SLOP_BROCHURE_TELL_PATTERNS = [
    { key: 'delve',                          re: /\bdelve\b/gi,                                       isPhrase: false },
    { key: 'tapestry',                       re: /\btapestry\b/gi,                                    isPhrase: false },
    { key: 'foster',                         re: /\bfoster\b/gi,                                      isPhrase: false },
    { key: 'landscape',                      re: /\blandscape\b/gi,                                   isPhrase: false },
    { key: 'realm',                          re: /\brealm\b/gi,                                       isPhrase: false },
    { key: 'intricate',                      re: /\bintricate\b/gi,                                   isPhrase: false },
    { key: 'pivotal',                        re: /\bpivotal\b/gi,                                     isPhrase: false },
    { key: 'underscore',                     re: /\bunderscor(?:e|es|ed|ing)\b/gi,                    isPhrase: false },
    { key: 'vibrant',                        re: /\bvibrant\b/gi,                                     isPhrase: false },
    { key: 'quietly',                        re: /\bquietly\b/gi,                                     isPhrase: false },
    { key: 'whispers',                       re: /\bwhispers?\b/gi,                                   isPhrase: false },
    { key: 'vital-role',                     re: /\bplays a vital role\b/gi,                          isPhrase: true },
    { key: 'pivotal-moment',                 re: /\bmarks a pivotal moment\b/gi,                      isPhrase: true },
    { key: 'importance',                     re: /\bunderscores? (?:its|their) importance\b/gi,      isPhrase: true },
    { key: 'broader-trends',                 re: /\breflects broader trends\b/gi,                     isPhrase: true },
    { key: 'marketing-boasts',               re: /\bboasts\b/gi,                                      isPhrase: false },
    { key: 'marketing-nestled',              re: /\bnestled\b/gi,                                     isPhrase: false },
    { key: 'marketing-vibrant-community',    re: /\bvibrant community\b/gi,                           isPhrase: true },
    { key: 'marketing-showcasing',           re: /\bshowcasing\b/gi,                                  isPhrase: false },
    { key: 'marketing-testament',            re: /\btestament to\b/gi,                                isPhrase: true },
    { key: 'marketing-rich-heritage',        re: /\brich heritage\b/gi,                               isPhrase: true },
    { key: 'copula-serves-as',               re: /\bserves as\b/gi,                                   isPhrase: true },
    { key: 'copula-stands-as',               re: /\bstands as\b/gi,                                   isPhrase: true },
  ];

  // Emoji detection: matches most Unicode emoji (covers BMP + supplementary planes).
  var EMOJI_RE = /[\u{1F000}-\u{1FFFF}\u{2600}-\u{27BF}\u{2300}-\u{23FF}\u{2702}-\u{27B0}\uD83C\uD83D\uD83E]/gu;

  // Math-bold Unicode range: U+1D400–U+1D7FF (Mathematical Alphanumeric Symbols).
  var MATH_BOLD_START = 0x1D400;
  var MATH_BOLD_END   = 0x1D7FF;

  // ── Structural Detector Shared Constants ──────────────────────────────────
  // Emoji/symbol characters commonly used as bullet substitutes on the host.
  // Note: skin-tone modifiers (\uFE0F, \u{1F3FB}-\u{1F3FF}) and ZWJ sequences
  // are intentionally tolerated by the trailing \s+ — partial coverage is acceptable.
  var STRUCT_EMOJI_BULLET_RE = /^\s*(?:[•▪▫◦‣⁃▶▷→↳➜➝➞➤➥➦➧➨✓✔☑✅🔥✨💡📌🔹🔸⭐🌟🎯👉🚀💥]|[\u{1F300}-\u{1F9FF}\u{2600}-\u{27BF}])[\uFE0F\u{1F3FB}-\u{1F3FF}]?\s+/u;
  // Anchored to line start for both parts — prevents false matches mid-line.
  var STRUCT_TRADITIONAL_BULLET_RE = /^(?:[-•*]|\d+\.\s)/;
  var STRUCT_NUMBERED_ITEM_RE = /^(\d{1,2})[.)]\s+(.+)$/;
  var STRUCT_ELLIPSIS_RE = /(?:\.\.\.|…)/g;
  var STRUCT_SPACED_EM_DASH_RE = /\s[—–]\s/g;
  var STRUCT_INLINE_NOT_ABOUT_REFRAME_RE = /\b(?:it|this|that)(?:['\u2019]s| is| isn['\u2019]?t| is not)\s+(?:not(?:\s+just)?\s+)?about\s+[^.!?;:\n]{3,48}?\s*(?:,|;|[—–])\s*(?:it|this|that)(?:['\u2019]s| is)\s+about\s+[^.!?;:\n]{3,48}(?=$|[.!?])/i;
  var STRUCT_SHORT_TRIPLE_RE = /^(?:[\p{L}\p{N}][\p{L}\p{N}'’/-]*(?:\s+[\p{L}\p{N}][\p{L}\p{N}'’/-]*){0,2}),\s+(?:[\p{L}\p{N}][\p{L}\p{N}'’/-]*(?:\s+[\p{L}\p{N}][\p{L}\p{N}'’/-]*){0,2}),\s+(?:(?:and|or)\s+)?(?:[\p{L}\p{N}][\p{L}\p{N}'’/-]*(?:\s+[\p{L}\p{N}][\p{L}\p{N}'’/-]*){0,2})[.!?…]?$/u;
  var STRUCT_TITLECASE_SMALL_WORDS = {
    a: true,
    an: true,
    and: true,
    as: true,
    at: true,
    by: true,
    for: true,
    from: true,
    in: true,
    of: true,
    on: true,
    or: true,
    the: true,
    to: true,
    with: true,
  };
  var STRUCT_NEGATION_RE = /\b(?:doesn[''\u2019]t|does not|don[''\u2019]t|do not|didn[''\u2019]t|did not|isn[''\u2019]t|is not|aren[''\u2019]t|are not|wasn[''\u2019]t|was not|weren[''\u2019]t|were not|can[''\u2019]?t|cannot|won[''\u2019]t|will not|never)\b/i;
  // Bare number hook: percentage, currency, or short multiplier only — bare
  // plain integers excluded (too many legitimate uses: slide numbers, page refs).
  var STRUCT_BARE_NUMBER_HOOK_RE = /^(?:[$€£]\s*\d[\d,.]{0,6}|\d{1,3}(?:[.,]\d{3})*%|\d{1,2}[xX])$/;

  // ── Structural Detector Shared Helpers ────────────────────────────────────

  /**
   * Replace standalone horizontal-rule lines (---, ***, ___, or mixed 3+ chars)
   * with empty lines so they don't pollute line counts, bullet ratios, or compact
   * text in any structural detector. Called once in getSliderStructuralTrigger
   * before passing text to all detectors except math-bold (which needs raw text).
   */
  function _structStripRuleDividers(rawText) {
    return (rawText || '').replace(/^[^\S\r\n]*[-*_]{3,}[^\S\r\n]*\r?$/gm, '');
  }

  function _structGetTrimmedLines(rawText) {
    var src = (rawText || '').replace(/\r/g, '').split('\n');
    var out = [];
    for (var i = 0; i < src.length; i++) out.push(src[i].trim());
    return out;
  }

  function _structGetNonEmptyLines(rawText) {
    var lines = _structGetTrimmedLines(rawText);
    var out = [];
    for (var i = 0; i < lines.length; i++) {
      if (lines[i]) out.push(lines[i]);
    }
    return out;
  }

  function _structGetCompactText(rawText) {
    return (rawText || '').replace(/\r/g, ' ').replace(/\s+/g, ' ').trim();
  }

  function _structWordCount(text) {
    var m = (text || '').trim().match(/[\p{L}\p{N}]+(?:[''/-][\p{L}\p{N}]+)*/gu);
    return m ? m.length : 0;
  }

  function _structLineEndsLikeSentence(line) {
    return /[.!?…]['")[\]]*$/.test(line || '');
  }

  function _structIsBulletLine(line) {
    return STRUCT_TRADITIONAL_BULLET_RE.test(line || '') ||
           STRUCT_EMOJI_BULLET_RE.test(line || '');
  }

  function _structIsShortPromptCloser(line) {
    line = (line || '').trim();
    if (!line) return false;
    if (/\?$/.test(line)) return true;
    if (/^[👇⬇↘➡️]/u.test(line)) return true;
    return false;
  }

  function _structGetSentenceUnits(rawText) {
    var compact = _structGetCompactText(rawText);
    if (!compact) return [];
    return compact.match(/[^.!?…]+[.!?…]+|[^.!?…]+$/g) || [];
  }

  function _structCollectPatternDensity(text, patterns) {
    var total = 0;
    var distinct = 0;
    var phraseHits = 0;
    var i;

    for (i = 0; i < patterns.length; i++) {
      var re = patterns[i].re;
      re.lastIndex = 0;

      var local = 0;
      var m;
      while ((m = re.exec(text)) !== null) {
        local++;
        // Safety: avoid infinite loops for any future zero-length regex.
        if (m.index === re.lastIndex) re.lastIndex++;
      }
      re.lastIndex = 0;

      if (!local) continue;
      distinct++;
      total += local;
      if (patterns[i].isPhrase) phraseHits += local;
    }

    return {
      total: total,
      distinct: distinct,
      phraseHits: phraseHits,
    };
  }

  /**
   * Split rawText into blank-line-separated sections.
   * Each section is an array of trimmed non-empty lines.
   * Used by micro-paragraph-cascade, rhetorical-hinge-reveal.
   *
   * @param {string} rawText
   * @returns {string[][]}  Array of sections; each section is a non-empty line array.
   */
  function _structGetSections(rawText) {
    var lines = _structGetTrimmedLines(rawText);
    var sections = [];
    var current = [];
    var i;
    for (i = 0; i < lines.length; i++) {
      if (lines[i] === '') {
        if (current.length > 0) {
          sections.push(current);
          current = [];
        }
      } else {
        current.push(lines[i]);
      }
    }
    if (current.length > 0) sections.push(current);
    return sections;
  }

  // ── Structural Detectors ──────────────────────────────────────────────────

  /**
   * L1 — "Sentence Ladder": extreme one-sentence-per-line formatting.
   * 13–30 non-empty lines; 90% are 1–5 words; 80% end with sentence punctuation;
   * avg line ≤32 chars; almost no bullets.
   * Thresholds are deliberately tight so this fires safely at the lowest slider level.
   */
  function hasSentenceLadder(rawText) {
    var lines = _structGetNonEmptyLines(rawText);
    var total = lines.length;
    if (total < 13 || total > 30) return false;

    var shortLines = 0, sentenceEnded = 0, bulletLines = 0, totalLen = 0;
    var i, wc;
    for (i = 0; i < total; i++) {
      wc = _structWordCount(lines[i]);
      if (wc >= 1 && wc <= 5) shortLines++;
      if (_structLineEndsLikeSentence(lines[i])) sentenceEnded++;
      if (_structIsBulletLine(lines[i])) bulletLines++;
      totalLen += lines[i].length;
    }

    if ((shortLines    / total) < 0.90) return false;
    if ((sentenceEnded / total) < 0.80) return false;
    if ((bulletLines   / total) > 0.10) return false;
    if ((totalLen      / total) > 32)   return false;
    return true;
  }

  /**
   * L2 — "Extended Broetry": long-form broetry the 4–12-line detector misses.
   * 13–30 lines; 85% are 1–8 words; avg ≤42 chars; few bullets.
   * Ordering in SLIDER_STRUCTURAL_DETECTORS means sentence-ladder fires first
   * at its tighter thresholds; this catches the remaining long-broetry cases.
   */
  function hasExtendedBroetry(rawText) {
    var lines = _structGetNonEmptyLines(rawText);
    var total = lines.length;
    if (total < 13 || total > 30) return false;

    var shortLines = 0, bulletLines = 0, totalLen = 0;
    var i, wc;
    for (i = 0; i < total; i++) {
      wc = _structWordCount(lines[i]);
      if (wc >= 1 && wc <= 8) shortLines++;
      if (_structIsBulletLine(lines[i])) bulletLines++;
      totalLen += lines[i].length;
    }

    if ((shortLines  / total) < 0.85) return false;
    if ((bulletLines / total) > 0.15) return false;
    if ((totalLen    / total) > 42)   return false;
    return true;
  }

  /**
   * L2 — "Numbered Micro-Listicle": 1. 2. 3. listicles with tiny entries.
   * Finds the longest clean sequential run starting at 1; requires ≥5 valid items
   * (1–8 words, ≤60 chars each) that dominate ≥80% of non-empty lines.
   * Non-numbered lines (headers, footers) are tolerated; a single bad numbered
   * item breaks the current run but does not abort the whole detector.
   */
  function hasNumberedMicroListicle(rawText) {
    var lines = _structGetNonEmptyLines(rawText);
    if (lines.length < 5) return false;

    var bestRun = 0, currentRun = 0, expected = 1;
    var i, m, wc;
    for (i = 0; i < lines.length; i++) {
      m = lines[i].match(STRUCT_NUMBERED_ITEM_RE);
      if (!m) continue; // non-numbered line — tolerated, doesn't break run

      var num  = parseInt(m[1], 10);
      var body = (m[2] || '').trim();
      wc = _structWordCount(body);

      if (num === expected && wc >= 1 && wc <= 8 && body.length <= 60) {
        currentRun++;
        expected++;
      } else {
        // Out-of-sequence or oversized item — restart run tracking
        if (currentRun > bestRun) bestRun = currentRun;
        currentRun = 0;
        expected = num + 1;
      }
    }
    if (currentRun > bestRun) bestRun = currentRun;

    if (bestRun < 5) return false;
    if ((bestRun / lines.length) < 0.80) return false;
    return true;
  }

  /**
   * Compute the broetry score for raw post text (0–25).
   * Fires when ≥4 non-empty lines exist, ≤12 total, ≥75% are 2–8 words,
   * avg line length ≤48 chars, and no bullet/list markers on most lines.
   * Returns 25 if all criteria met, 0 otherwise.
   *
   * @param {string} rawText  Raw post body text (not normalized)
   * @returns {number}
   */
  function getBroetryScore(rawText) {
    if (!rawText) return 0;
    var lines = rawText.split('\n').map(function (l) { return l.trim(); }).filter(Boolean);
    var total = lines.length;
    if (total < 4 || total > 12) return 0;

    var shortWordLines = 0;
    var totalLen = 0;
    var bulletLines = 0;
    var bulletRe = /^[-•*]|\d+\.\s/;
    var li;
    for (li = 0; li < lines.length; li++) {
      var wc = lines[li].split(/\s+/).filter(Boolean).length;
      if (wc >= 2 && wc <= 8) shortWordLines++;
      totalLen += lines[li].length;
      if (bulletRe.test(lines[li])) bulletLines++;
    }
    if (shortWordLines / total < 0.75) return 0;
    if (totalLen / total > 48) return 0;
    if (bulletLines / total > 0.4) return 0;
    return 25;
  }

  /**
   * L3 — "Emoji Bullet Stack": emoji/symbol bullets as a content shell.
   * ≥5 short emoji-bullet lines; ≥70% of non-empty lines are short bullets.
   * Long bullet bodies are skipped (not counted), not aborting.
   */
  function hasEmojiBulletStack(rawText) {
    var lines = _structGetNonEmptyLines(rawText);
    var total = lines.length;
    if (total < 5 || total > 16) return false;

    var bulletLines = 0;
    var i, body, wc;
    for (i = 0; i < total; i++) {
      if (!STRUCT_EMOJI_BULLET_RE.test(lines[i])) continue;
      body = lines[i].replace(STRUCT_EMOJI_BULLET_RE, '').trim();
      wc = _structWordCount(body);
      // Skip lines with long bodies — they are not slop bullet lines,
      // but don't abort: real slop posts often have one slightly longer line.
      if (wc < 1 || wc > 10 || body.length > 60) continue;
      bulletLines++;
    }

    if (bulletLines < 5) return false;
    if ((bulletLines / total) < 0.70) return false;
    return true;
  }

  /**
   * L3 — "Ellipsis Pacing": … used as a suspense/pacing device every few words.
   * ≥4 ellipses in the first 220 chars; ≤38 words in that span;
   * most inter-ellipsis gaps are ≤6 words.
   */
  function hasEllipsisPacing(rawText) {
    var span = _structGetCompactText(rawText).slice(0, 220);
    if (!span) return false;

    var ellipses = span.match(STRUCT_ELLIPSIS_RE) || [];
    if (ellipses.length < 4) return false;
    if (_structWordCount(span) > 38) return false;

    var parts = span.split(/(?:\.\.\.|…)/);
    var shortGaps = 0, i;
    for (i = 0; i < parts.length; i++) {
      if (_structWordCount(parts[i]) <= 6) shortGaps++;
    }

    if ((shortGaps / parts.length) < 0.75) return false;
    return true;
  }

  /**
   * L4 — "Em Dash Pacing": dramatic cadence built from repeated em/en dash splits.
   * Looks at the first 260 chars: at least 3 spaced dash breaks, no long-form prose,
   * and mostly short inter-dash segments.
   */
  function hasEmDashPacing(rawText) {
    var span = _structGetCompactText(rawText).slice(0, 260);
    if (!span) return false;

    var dashMatches = span.match(STRUCT_SPACED_EM_DASH_RE) || [];
    if (dashMatches.length < 3) return false;
    if (_structWordCount(span) > 50) return false;

    var segments = span.split(STRUCT_SPACED_EM_DASH_RE);
    var shortSegments = 0;
    for (var i = 0; i < segments.length; i++) {
      if (_structWordCount(segments[i]) <= 6) shortSegments++;
    }
    if ((shortSegments / segments.length) < 0.75) return false;
    return true;
  }

  /**
   * L4 — "Inline Not-About Reframe Stack": repeated
   * "it's not (just) about X, it's about Y" sentence templates.
   * A single occurrence can be normal prose; two or more in one post is a strong tell.
   */
  function hasInlineNotAboutReframeStack(rawText) {
    var compact = _structGetCompactText(rawText);
    if (!compact) return false;

    var sentences = _structGetSentenceUnits(compact);
    var hits = 0;
    for (var i = 0; i < sentences.length; i++) {
      var unit = sentences[i].trim();
      var wc = _structWordCount(unit);
      if (wc < 7 || wc > 24) continue;
      if (!STRUCT_INLINE_NOT_ABOUT_REFRAME_RE.test(unit)) continue;
      hits++;
      if (hits >= 2) return true;
    }
    return false;
  }

  /**
   * L4 — "Triple Enumeration Stack": repeated short 3-item cadence lines
   * (e.g., "Clarity, consistency, confidence.") outside bullet/list formatting.
   * Fires on 2+ triple units across lines/sentence units.
   */
  function hasTripleEnumerationStack(rawText) {
    var lineHits = 0;
    var sentenceHits = 0;
    var i;

    var lines = _structGetNonEmptyLines(rawText);
    for (i = 0; i < lines.length; i++) {
      if (_structIsBulletLine(lines[i])) continue;
      var lwc = _structWordCount(lines[i]);
      if (lwc < 3 || lwc > 14) continue;
      if (!STRUCT_SHORT_TRIPLE_RE.test(lines[i])) continue;
      lineHits++;
      if (lineHits >= 2) return true;
    }

    var sentences = _structGetSentenceUnits(_structGetCompactText(rawText));
    for (i = 0; i < sentences.length; i++) {
      var s = (sentences[i] || '').trim();
      var swc = _structWordCount(s);
      if (swc < 3 || swc > 14) continue;
      if (!STRUCT_SHORT_TRIPLE_RE.test(s)) continue;
      sentenceHits++;
      if (sentenceHits >= 2) return true;
    }

    return false;
  }

  /**
   * L4 — "AI Contrastive Pair": "X doesn't ____. It ____." / "X isn't about ____. It's about ____."
   * Consecutive sentence pair where the first contains a negation and the second
   * opens with It/This/That/They. No whole-post word cap — the pattern can appear
   * anywhere in a longer post; local sentence word counts are the real guard.
   */
  function hasAiContrastivePair(rawText) {
    var compact = _structGetCompactText(rawText);
    if (!compact) return false;

    var sentences = _structGetSentenceUnits(compact);
    if (sentences.length < 2) return false;

    var i, s1, s2, wc1, wc2;
    for (i = 0; i < sentences.length - 1; i++) {
      s1 = sentences[i].trim();
      s2 = sentences[i + 1].trim();
      wc1 = _structWordCount(s1);
      wc2 = _structWordCount(s2);

      if (wc1 < 3 || wc1 > 12) continue;
      if (wc2 < 2 || wc2 > 12) continue;
      if (!STRUCT_NEGATION_RE.test(s1)) continue;
      if (!/^(?:it|it[''\u2019]s|it is|this|this is|that|that[''\u2019]s|that is|they|they[''\u2019]re|they are)\b/i.test(s2)) continue;

      return true;
    }
    return false;
  }

  /**
   * L4 — "Hook / Body / CTA Rhythm": short hook → medium body → short prompt closer.
   * Exactly two blank-line-separated sections; hook = 1–2 lines (≤6 words each);
   * body = 2–5 lines (6–22 words each); closer = 1 line (1–8 words, CTA-shaped).
   */
  function hasHookBodyCtaRhythm(rawText) {
    var rawLines = _structGetTrimmedLines(rawText);
    var firstBlank = -1, lastBlank = -1, i;

    for (i = 0; i < rawLines.length; i++) {
      if (rawLines[i] === '') { firstBlank = i; break; }
    }
    if (firstBlank < 1) return false;

    for (i = rawLines.length - 2; i >= 0; i--) {
      if (rawLines[i] === '') { lastBlank = i; break; }
    }
    if (lastBlank <= firstBlank) return false;

    var hookLines = [], bodyLines = [], tailLines = [];
    for (i = 0; i < firstBlank; i++) {
      if (rawLines[i]) hookLines.push(rawLines[i]);
    }
    for (i = firstBlank + 1; i < lastBlank; i++) {
      if (rawLines[i]) bodyLines.push(rawLines[i]);
    }
    for (i = lastBlank + 1; i < rawLines.length; i++) {
      if (rawLines[i]) tailLines.push(rawLines[i]);
    }

    if (hookLines.length < 1 || hookLines.length > 2) return false;
    if (bodyLines.length < 2 || bodyLines.length > 5) return false;
    if (tailLines.length !== 1) return false;

    var hookWords = 0, bodyWords = 0, hwc, bwc;
    for (i = 0; i < hookLines.length; i++) {
      hwc = _structWordCount(hookLines[i]);
      if (hwc < 1 || hwc > 6) return false;
      hookWords += hwc;
    }
    for (i = 0; i < bodyLines.length; i++) {
      bwc = _structWordCount(bodyLines[i]);
      if (bwc < 6 || bwc > 22) return false;   // widened from 7–18 to tolerate real posts
      if (bodyLines[i].length > 160) return false;
      bodyWords += bwc;
    }

    var closer = tailLines[0];
    var cwc = _structWordCount(closer);
    if (cwc < 1 || cwc > 8) return false;
    // Broader closer detection: question, arrow emoji, or matches SLOP_CTA_RE
    if (!_structIsShortPromptCloser(closer) && !SLOP_CTA_RE.test(closer)) return false;
    SLOP_CTA_RE.lastIndex = 0; // reset global regex state after test()
    if ((bodyWords / bodyLines.length) <= (hookWords / hookLines.length)) return false;

    return true;
  }

  /**
   * L4 — "Question Fragment Opener": rhetorical question + one-word/short answer line.
   * First non-empty line is a 4–12 word question; next non-empty line is 1–3 words
   * and ends with punctuation. A blank line between them is preferred but not required,
   * since text extraction doesn't always preserve blank lines.
   * Post is 4–10 non-empty lines total.
   */
  function hasQuestionFragmentOpener(rawText) {
    var lines = _structGetNonEmptyLines(rawText);

    if (lines.length < 4 || lines.length > 10) return false;

    var opener   = lines[0];
    var fragment = lines[1];

    if (!/\?$/.test(opener)) return false;

    var owc = _structWordCount(opener);
    var fwc = _structWordCount(fragment);

    if (owc < 4 || owc > 12) return false;
    if (fwc < 1 || fwc > 3)  return false;
    if (!/[.!?…]$/.test(fragment)) return false;

    return true;
  }

  /**
   * L4 — "Three-Beat Arc": "I ____. Then ____. Now ____." revelation structure.
   * Consecutive sentence beats or lines matching I → Then/Next/After that → Now/Today,
   * each 2–12 words. No whole-post word cap — the arc can appear inside a longer post.
   */
  function hasThreeBeatArc(rawText) {
    if (!rawText) return false;

    var i, a, b, c;

    // Line-by-line check — preferred; works on both compact and structured text.
    var lines = _structGetNonEmptyLines(rawText);
    for (i = 0; i < lines.length - 2; i++) {
      a = lines[i]; b = lines[i + 1]; c = lines[i + 2];
      if (!/^I\b/i.test(a)) continue;
      if (!/^(?:Then|Next|After that)\b/i.test(b)) continue;
      if (!/^(?:Now|Today)\b/i.test(c)) continue;
      if (_structWordCount(a) < 2 || _structWordCount(a) > 12) continue;
      if (_structWordCount(b) < 2 || _structWordCount(b) > 12) continue;
      if (_structWordCount(c) < 2 || _structWordCount(c) > 12) continue;
      return true;
    }

    // Sentence-unit fallback — catches the pattern in prose paragraphs.
    var compact = _structGetCompactText(rawText);
    var units = _structGetSentenceUnits(compact);
    for (i = 0; i < units.length - 2; i++) {
      a = units[i].trim();
      b = units[i + 1].trim();
      c = units[i + 2].trim();
      if (!/^I\b/i.test(a)) continue;
      if (!/^(?:Then|Next|After that)\b/i.test(b)) continue;
      if (!/^(?:Now|Today)\b/i.test(c)) continue;
      if (_structWordCount(a) < 2 || _structWordCount(a) > 12) continue;
      if (_structWordCount(b) < 2 || _structWordCount(b) > 12) continue;
      if (_structWordCount(c) < 2 || _structWordCount(c) > 12) continue;
      return true;
    }

    return false;
  }

  /**
   * L4 — "Number Hook Opener": bare number/stat/metric on its own line as a hook.
   * First non-empty line matches a standalone number/percentage/currency/multiplier;
   * a blank line follows; next line is 3–12 words and not a bullet.
   * Post is 4–9 non-empty lines and ≤70 words total.
   */
  function hasNumberHookOpener(rawText) {
    var rawLines = _structGetTrimmedLines(rawText);
    var nonEmpty = [], indices = [], i;
    for (i = 0; i < rawLines.length; i++) {
      if (!rawLines[i]) continue;
      nonEmpty.push(rawLines[i]);
      indices.push(i);
    }

    if (nonEmpty.length < 4 || nonEmpty.length > 9) return false;
    if (!STRUCT_BARE_NUMBER_HOOK_RE.test(nonEmpty[0])) return false;
    if ((indices[1] - indices[0]) < 2) return false; // require blank line after number

    var second = nonEmpty[1];
    var swc = _structWordCount(second);
    if (swc < 3 || swc > 12) return false;
    if (_structIsBulletLine(second)) return false;
    if (_structWordCount(_structGetCompactText(rawText)) > 70) return false;

    return true;
  }

  /**
   * L4 — "Math-Bold Unicode": posts using U+1D400–U+1D7FF mathematical alphanumeric
   * symbols to fake bold/italic text formatting. ≥8 such chars AND ≥40% of the
   * first 280 non-space characters are from this block.
   * Must operate on raw text before NFKC normalisation flattens these code points.
   */
  function hasMathBoldUnicode(rawText) {
    if (!rawText) return false;
    var chars = Array.from(rawText).slice(0, 280);
    var mathBoldCount = 0, nonSpaceCount = 0, ci, cp;
    for (ci = 0; ci < chars.length; ci++) {
      cp = chars[ci].codePointAt(0);
      if (cp === 32 || cp === 9 || cp === 10 || cp === 13) continue;
      nonSpaceCount++;
      if (cp >= MATH_BOLD_START && cp <= MATH_BOLD_END) mathBoldCount++;
    }
    return mathBoldCount >= 8 && nonSpaceCount > 0 && (mathBoldCount / nonSpaceCount) >= 0.4;
  }

  /**
   * L3 — "Micro-Paragraph Cascade": the "paragraph-per-breath" essay-slop format.
   * A post built from many tiny blank-line-separated sections, most of which are a
   * single isolated sentence or fragment. This pattern escapes broetry/sentence-ladder
   * because lines vary in length and the post is longer, but the rhetorical unit is
   * the single-sentence island — not the paragraph or the argument.
   *
   * Fires when ALL of:
   *   - 18–45 non-empty lines (longer than broetry can handle)
   *   - 10–26 blank-separated sections
   *   - blank-line ratio ≥ 0.28 of all raw lines
   *   - ≥ 60% of sections are single-line
   *   - ≥ 80% of sections are 1–2 lines
   *   - avg lines per section ≤ 1.7
   *   - bullet lines ≤ 25% of non-empty lines (a small cluster is common in this style)
   */
  function hasMicroParagraphCascade(rawText) {
    var sections   = _structGetSections(rawText);
    var numSections = sections.length;
    if (numSections < 10 || numSections > 26) return false;

    var nonEmptyLines = _structGetNonEmptyLines(rawText);
    var totalNonEmpty = nonEmptyLines.length;
    if (totalNonEmpty < 18 || totalNonEmpty > 45) return false;

    var rawLines   = _structGetTrimmedLines(rawText);
    var totalRaw   = rawLines.length;
    var blankCount = 0, i;
    for (i = 0; i < totalRaw; i++) {
      if (rawLines[i] === '') blankCount++;
    }
    if (blankCount / totalRaw < 0.28) return false;

    var singleLineSections = 0, oneOrTwoLineSections = 0, totalSectionLines = 0;
    for (i = 0; i < numSections; i++) {
      var len = sections[i].length;
      totalSectionLines += len;
      if (len === 1) singleLineSections++;
      if (len <= 2) oneOrTwoLineSections++;
    }
    if ((singleLineSections   / numSections) < 0.60) return false;
    if ((oneOrTwoLineSections / numSections) < 0.80) return false;
    if ((totalSectionLines    / numSections) > 1.70) return false;

    var bulletLines = 0;
    for (i = 0; i < totalNonEmpty; i++) {
      if (_structIsBulletLine(nonEmptyLines[i])) bulletLines++;
    }
    if ((bulletLines / totalNonEmpty) > 0.25) return false;

    return true;
  }

  /**
   * L4 — "Contrastive Reframe Stack": a whole post composed from binary reframes.
   * Each reframe is a pair where S1 contains negation (3–14 words) and S2 opens
   * with a pronoun pivot (it/this/that/they, 2–12 words), OR S2 is a corrective
   * tail opener (not/but/instead, 1–6 words). A single such pair is common in good
   * prose; a density of ≥ 2 across a post, or bookending opener AND closer, is a
   * reliable AI-optimisation signal.
   *
   * Fires when:
   *   - ≥ 2 reframe pairs anywhere in the post, OR
   *   - 1 reframe pair in the first 4 sentence-units AND 1 in the last 4
   */
  function hasContrastiveReframeStack(rawText) {
    var compact   = _structGetCompactText(rawText);
    if (!compact) return false;
    var sentences = _structGetSentenceUnits(compact);
    if (sentences.length < 3) return false;

    var PIVOT_RE      = /^(?:it|it[''\u2019]s|it is|this|this is|that|that[''\u2019]s|that is|they|they[''\u2019]re|they are)\b/i;
    var CORRECTIVE_RE = /^(?:not|but not|instead|rather)\b/i;

    var hits = [];
    var i, s1, s2, wc1, wc2;
    for (i = 0; i < sentences.length - 1; i++) {
      s1  = sentences[i].trim();
      s2  = sentences[i + 1].trim();
      wc1 = _structWordCount(s1);
      wc2 = _structWordCount(s2);

      // Pattern A — classic negation → pivot pronoun reframe
      if (wc1 >= 3 && wc1 <= 14 && wc2 >= 2 && wc2 <= 12 &&
          STRUCT_NEGATION_RE.test(s1) && PIVOT_RE.test(s2)) {
        hits.push(i);
        continue;
      }

      // Pattern B — negation → corrective tail (e.g. "Not replace it.")
      if (wc1 >= 3 && wc1 <= 14 && wc2 >= 1 && wc2 <= 6 &&
          STRUCT_NEGATION_RE.test(s1) && CORRECTIVE_RE.test(s2)) {
        hits.push(i);
        continue;
      }
    }

    if (hits.length === 0) return false;

    // Fire on ≥ 2 total reframes anywhere in the post
    if (hits.length >= 2) return true;

    // Fire on opener + closer bookend: one hit in the first 4 sentence-units AND
    // another in the last 4 (catches posts that open AND close with a reframe).
    var n         = sentences.length;
    var hasOpener = false, hasCloser = false, hi;
    for (hi = 0; hi < hits.length; hi++) {
      if (hits[hi] < 4)       hasOpener = true;
      if (hits[hi] >= n - 5)  hasCloser = true;
    }
    if (hasOpener && hasCloser) return true;

    return false;
  }

  /**
   * L4 — "Same-Stem Antithesis Pair": adjacent lines (or sentence-units as fallback)
   * sharing a 2–3 token prefix where the first tail contains a negation and the
   * second tail is a non-negated restatement with a different core predicate.
   * Catches "The real tell isn't X. / The real tell is Y." — missed by the
   * contrastive detectors because the second unit starts with "The", not "It/This".
   *
   * Line pass first; sentence-unit fallback second.
   * Each unit: 4–16 words. Shared prefix: 2 or 3 tokens (never 1).
   * Tail 1: contains STRUCT_NEGATION_RE. Tail 2: must NOT contain STRUCT_NEGATION_RE.
   * Normalised predicate cores must differ (prevents "isn't speed / is speed").
   */
  function hasSameStemAntithesisPair(rawText) {
    var TOKEN_RE = /[\p{L}\p{N}]+(?:[''\u2019/-][\p{L}\p{N}]+)*/gu;

    function extractTokens(text) {
      var m = (text || '').match(TOKEN_RE);
      return m ? m.map(function (t) { return t.toLowerCase(); }) : [];
    }

    function stripNegHead(t) {
      return t
        .replace(/^(?:doesn[''\u2019]?t|does not|don[''\u2019]?t|do not|didn[''\u2019]?t|did not|isn[''\u2019]?t|is not|aren[''\u2019]?t|are not|wasn[''\u2019]?t|was not|weren[''\u2019]?t|were not|can[''\u2019]?t|cannot|won[''\u2019]?t|will not|never)\s*/i, '')
        .replace(/^(?:is|are|was|were|do|does|did|can|will)\s*/i, '')
        .trim();
    }

    function stripPosHead(t) {
      return t.replace(/^(?:is|are|was|were|do|does|did|can|will)\s*/i, '').trim();
    }

    function checkPair(u1, u2) {
      if (!u1 || !u2) return false;
      if (/\?$/.test(u1) || /\?$/.test(u2)) return false;
      var wc1 = _structWordCount(u1);
      var wc2 = _structWordCount(u2);
      if (wc1 < 4 || wc1 > 16) return false;
      if (wc2 < 4 || wc2 > 16) return false;

      var t1 = extractTokens(u1);
      var t2 = extractTokens(u2);

      // Try 3-token prefix first, then 2-token
      var prefixLen = 0;
      if (t1.length >= 5 && t2.length >= 5 &&
          t1[0] === t2[0] && t1[1] === t2[1] && t1[2] === t2[2]) {
        prefixLen = 3;
      } else if (t1.length >= 4 && t2.length >= 4 &&
                 t1[0] === t2[0] && t1[1] === t2[1]) {
        prefixLen = 2;
      }
      if (prefixLen < 2) return false;

      var tail1 = t1.slice(prefixLen).join(' ');
      var tail2 = t2.slice(prefixLen).join(' ');
      if (!tail1 || !tail2) return false;
      if (tail1.split(' ').length < 2 || tail1.split(' ').length > 10) return false;
      if (tail2.split(' ').length < 2 || tail2.split(' ').length > 10) return false;

      if (!STRUCT_NEGATION_RE.test(tail1)) return false;
      if (STRUCT_NEGATION_RE.test(tail2))  return false;

      var core1 = stripNegHead(tail1);
      var core2 = stripPosHead(tail2);
      if (!core1 || !core2 || core1 === core2) return false;

      return true;
    }

    var i;

    // Pass 1: adjacent non-empty lines
    var lines = _structGetNonEmptyLines(rawText);
    for (i = 0; i < lines.length - 1; i++) {
      if (_structIsBulletLine(lines[i]) || _structIsBulletLine(lines[i + 1])) continue;
      if (checkPair(lines[i], lines[i + 1])) return true;
    }

    // Pass 2: adjacent sentence-units (catches prose paragraphs)
    var compact   = _structGetCompactText(rawText);
    var sentences = _structGetSentenceUnits(compact);
    for (i = 0; i < sentences.length - 1; i++) {
      if (checkPair(sentences[i].trim(), sentences[i + 1].trim())) return true;
    }

    return false;
  }

  /**
   * L4 — "Some / Others Binary Pair": the stock AI binary split construction.
   * Line 1 starts with "some"/"some people"/"some of".
   * Line 2 starts with "others"/"others are"/"other people"/"while others".
   * Only fires when the pair appears as a 2-line section OR two consecutive
   * 1-line sections — tight layout guard eliminates in-paragraph false positives.
   * Each line: 3–12 words; neither line is a bullet.
   */
  function hasSomeOthersBinaryPair(rawText) {
    var SOME_RE   = /^(?:some(?:\s+people)?|some\s+of)\b/i;
    var OTHERS_RE = /^(?:others(?:\s+are)?|other\s+people|while\s+others)\b/i;

    function checkLine(l1, l2) {
      if (!l1 || !l2) return false;
      if (!SOME_RE.test(l1) || !OTHERS_RE.test(l2)) return false;
      if (_structIsBulletLine(l1) || _structIsBulletLine(l2)) return false;
      if (/\?$/.test(l1) || /\?$/.test(l2)) return false;
      var wc1 = _structWordCount(l1);
      var wc2 = _structWordCount(l2);
      return wc1 >= 3 && wc1 <= 12 && wc2 >= 3 && wc2 <= 12;
    }

    var sections = _structGetSections(rawText);
    var i;
    for (i = 0; i < sections.length; i++) {
      // Layout A: a 2-line section
      if (sections[i].length === 2) {
        if (checkLine(sections[i][0], sections[i][1])) return true;
      }
      // Layout B: two consecutive 1-line sections
      if (sections[i].length === 1 && i + 1 < sections.length && sections[i + 1].length === 1) {
        if (checkLine(sections[i][0], sections[i + 1][0])) return true;
      }
    }
    return false;
  }

  /**
   * L4 — "Compressed Inversion Payoff": a negated claim followed by a terse
   * bare-aux payoff. E.g. "Content was never the bottleneck. / Thinking was."
   * Missed by contrastive detectors because S2 starts with a noun, not a pronoun.
   *
   * S1: 5–12 words, contains STRUCT_NEGATION_RE.
   * S2: 2–4 words, ends with sentence punctuation, last token is a bare aux/copula
   *     (is/are/was/were/do/does/did/can/will), does NOT contain negation, does NOT
   *     start with a pronoun (guards against "It is." false positives).
   *
   * Line pass first; sentence-unit fallback second.
   */
  function hasCompressedInversionPayoff(rawText) {
    var AUX_SET = { is: true, are: true, was: true, were: true,
                    do: true, does: true, did: true, can: true, will: true };
    var PRONOUN_START_RE = /^(?:it|this|that|they|there|here|he|she|we|you|i)\b/i;
    var TOKEN_RE = /[\p{L}\p{N}]+(?:[''\u2019/-][\p{L}\p{N}]+)*/gu;

    function checkPair(s1, s2) {
      s1 = (s1 || '').trim();
      s2 = (s2 || '').trim();
      if (!s1 || !s2) return false;

      var wc1 = _structWordCount(s1);
      var wc2 = _structWordCount(s2);
      if (wc1 < 5 || wc1 > 12) return false;
      if (wc2 < 2 || wc2 > 4)  return false;

      if (!STRUCT_NEGATION_RE.test(s1))  return false;
      if (STRUCT_NEGATION_RE.test(s2))   return false;
      if (PRONOUN_START_RE.test(s2))     return false;
      if (!_structLineEndsLikeSentence(s2)) return false;

      var tokens2 = s2.match(TOKEN_RE);
      if (!tokens2 || tokens2.length === 0) return false;
      var lastTok = tokens2[tokens2.length - 1].toLowerCase();
      return !!AUX_SET[lastTok];
    }

    var i;

    // Pass 1: adjacent non-empty lines
    var lines = _structGetNonEmptyLines(rawText);
    for (i = 0; i < lines.length - 1; i++) {
      if (_structIsBulletLine(lines[i]) || _structIsBulletLine(lines[i + 1])) continue;
      if (checkPair(lines[i], lines[i + 1])) return true;
    }

    // Pass 2: adjacent sentence-units (catches prose paragraphs)
    var compact   = _structGetCompactText(rawText);
    var sentences = _structGetSentenceUnits(compact);
    for (i = 0; i < sentences.length - 1; i++) {
      if (checkPair(sentences[i], sentences[i + 1])) return true;
    }

    return false;
  }

  /**
   * L4 — "Rhetorical Hinge Reveal": a mid-post escalation question followed
   * immediately by a blunt payoff line. E.g. "And the worst part?" → "It works."
   * This is a favourite slop beat: manufacture tension, deliver a one-liner.
   * Only fires mid-post (≥ 3 non-empty lines before the hinge section); requires
   * at least one more section after the reveal so the post continues past the beat.
   *
   * Hinge section: exactly 1 line, 2–7 words, ends with '?'
   * Reveal section: exactly 1 line, 1–5 words, ends with sentence punctuation
   */
  function hasRhetoricalHingeReveal(rawText) {
    var sections    = _structGetSections(rawText);
    var numSections = sections.length;
    if (numSections < 4) return false;   // need hinge, reveal, plus context on both sides

    var nonEmptyBefore = 0;
    var i, hinge, reveal, hwc, rwc;
    for (i = 0; i < numSections - 1; i++) {
      hinge  = sections[i];
      reveal = sections[i + 1];

      // Hinge: exactly one line, 2–7 words, ends with '?'
      if (hinge.length !== 1) { nonEmptyBefore += hinge.length; continue; }
      var hingeLine = hinge[0];
      if (!/\?$/.test(hingeLine)) { nonEmptyBefore += 1; continue; }
      hwc = _structWordCount(hingeLine);
      if (hwc < 2 || hwc > 7) { nonEmptyBefore += 1; continue; }

      // Must have at least 3 non-empty lines before this hinge (it's mid-post)
      if (nonEmptyBefore < 3) { nonEmptyBefore += 1; continue; }

      // Reveal: exactly one line, 1–5 words, ends with sentence punctuation
      if (reveal.length !== 1) { nonEmptyBefore += 1; continue; }
      var revealLine = reveal[0];
      rwc = _structWordCount(revealLine);
      if (rwc < 1 || rwc > 5) { nonEmptyBefore += 1; continue; }
      if (!_structLineEndsLikeSentence(revealLine)) { nonEmptyBefore += 1; continue; }

      // At least one more section must follow the reveal
      if (i + 2 >= numSections) { nonEmptyBefore += 1; continue; }

      return true;
    }

    return false;
  }

  /**
   * L4 — "Anaphoric Fragment Stack": 3+ adjacent lines that all open with the
   * same 1–2 token prefix, each line being 2–14 words, covering a meaningful
   * run inside the post. Catches the "No friction. / No rough edges. / No real
   * opinion…" and "The same X / The same Y / The same Z" patterns that are
   * hallmarks of AI-optimised cadence writing but are missed by bullet detectors
   * (these lines have no bullet markers) and broetry (lines may be longer).
   *
   * Requires at least one run of ≥ 3 consecutive non-empty lines where:
   *   - each line is 2–14 words
   *   - each shares the same lowercased first token (common case: "no", "the", "same")
   *     OR the same lowercased first 2 tokens
   *   - the run is not entirely bullet lines
   */
  function hasAnaphoricFragmentStack(rawText) {
    var lines    = _structGetNonEmptyLines(rawText);
    var total    = lines.length;
    if (total < 4) return false;   // need at least 4 non-empty lines to form a stack inside a post

    var i, j, wc, tok1, tok2;

    for (i = 0; i < total - 2; i++) {
      wc = _structWordCount(lines[i]);
      if (wc < 2 || wc > 14) continue;

      // Extract normalised first token and first-two-token prefix for line i
      var m = (lines[i] || '').trim().match(/^([\p{L}\p{N}]+(?:[''/-][\p{L}\p{N}]+)*)\s+([\p{L}\p{N}]+(?:[''/-][\p{L}\p{N}]+)*)?/u);
      if (!m) continue;
      tok1 = m[1].toLowerCase();
      tok2 = (m[1] + (m[2] ? ' ' + m[2] : '')).toLowerCase();

      // Skip very generic single-word prefixes that create too many false positives
      // ('i', 'the', 'a', 'and', 'but', 'or', 'so') when used alone — require tok2
      var useOnlyTok2 = /^(?:i|the|a|an|and|but|or|so|if|in|on|at|it|my|we|you)$/.test(tok1);

      var runLen    = 1;
      var allBullets = _structIsBulletLine(lines[i]);

      for (j = i + 1; j < total && runLen < 8; j++) {
        wc = _structWordCount(lines[j]);
        if (wc < 2 || wc > 14) break;

        var mj = (lines[j] || '').trim().match(/^([\p{L}\p{N}]+(?:[''/-][\p{L}\p{N}]+)*)\s+([\p{L}\p{N}]+(?:[''/-][\p{L}\p{N}]+)*)?/u);
        if (!mj) break;
        var jTok1 = mj[1].toLowerCase();
        var jTok2 = (mj[1] + (mj[2] ? ' ' + mj[2] : '')).toLowerCase();

        var prefixMatch = useOnlyTok2
          ? (jTok2 === tok2)
          : (jTok1 === tok1 || jTok2 === tok2);

        if (!prefixMatch) break;

        if (!_structIsBulletLine(lines[j])) allBullets = false;
        runLen++;
      }

      if (runLen >= 3 && !allBullets) return true;
      // Skip past this run to avoid re-examining its interior
      i += (runLen - 1);
    }

    return false;
  }

  function _structLooksLikeTitleCaseHeading(line) {
    line = (line || '').trim();
    if (!line) return false;
    if (_structIsBulletLine(line)) return false;
    if (_structLineEndsLikeSentence(line)) return false;
    if (/\bhttps?:\/\//i.test(line)) return false;
    if (/#\w/.test(line)) return false;

    var wc = _structWordCount(line);
    if (wc < 2 || wc > 6) return false;

    var tokens = line.match(/[\p{L}\p{N}][\p{L}\p{N}'’/-]*/gu);
    if (!tokens || !tokens.length) return false;

    var titleLike = 0;
    for (var i = 0; i < tokens.length; i++) {
      var tok = tokens[i];
      var lower = tok.toLowerCase();

      if (STRUCT_TITLECASE_SMALL_WORDS[lower]) {
        titleLike++;
        continue;
      }
      if (/^[A-Z0-9&]{2,}$/.test(tok)) {
        titleLike++;
        continue;
      }
      if (/^[A-Z][a-z0-9'’/-]*$/.test(tok)) {
        titleLike++;
        continue;
      }
    }

    return (titleLike / tokens.length) >= 0.80;
  }

  /**
   * L4 — "Title-Case Heading Stack": 4+ consecutive single-line sections whose
   * lines look like title-case pseudo-headings.
   */
  function hasTitleCaseHeadingStack(rawText) {
    var sections = _structGetSections(rawText);
    if (sections.length < 4) return false;

    var hasProseSection = false;
    for (var ps = 0; ps < sections.length; ps++) {
      if (sections[ps].length !== 1) {
        var proseText = sections[ps].join(' ');
        if (_structWordCount(proseText) >= 10) {
          hasProseSection = true;
          break;
        }
      }
    }
    if (!hasProseSection) return false;

    var run = 0;
    for (var i = 0; i < sections.length; i++) {
      if (sections[i].length === 1 && _structLooksLikeTitleCaseHeading(sections[i][0])) {
        run++;
        if (run >= 4) return true;
      } else {
        run = 0;
      }
    }

    return false;
  }

  /**
   * L4 — "Brochure Lexicon Cluster": dense concentration of AI-brochure buzzwords,
   * filler phrases, and marketing euphemisms from known slop patterns.
   */
  function hasBrochureLexiconCluster(rawText) {
    var compact = _structGetCompactText(rawText);
    if (!compact) return false;

    var wc = _structWordCount(compact);
    if (wc < 35 || wc > 220) return false;

    var density = _structCollectPatternDensity(compact, SLOP_BROCHURE_TELL_PATTERNS);
    if (density.distinct < 3) return false;
    if (density.total >= 8 && density.distinct >= 4) return true;
    if (density.total >= 6 && density.phraseHits >= 2) return true;
    return false;
  }

  // ── Structural Detector Registry ──────────────────────────────────────────
  // Each entry: { name, level, test }
  // Detectors are evaluated in order; first match wins.
  // Level = minimum slopSensitivityLevel required for this detector to fire.
  // Note: math-bold must receive rawText BEFORE NFKC normalisation — it is wired
  // directly to extractStructuralText() output which preserves raw code points.

  // Slop structural detectors. `level` is the minimum slider level at which
  // each detector fires. Detectors are ordered so the more-specific ones run
  // first within a level (a card matching multiple patterns reports the
  // first hit). 2026-05 weighting: moved the highest-signal AI-prose tells
  // (em-dash pacing, brochure-lexicon cluster, three-beat arc, number hook,
  // etc.) down to L2/L3 so each level visibly catches more than the last,
  // instead of all the real work happening at L4.
  var SLIDER_STRUCTURAL_DETECTORS = [
    { name: 'sentence-ladder',              level: 1, test: hasSentenceLadder },
    { name: 'extended-broetry',             level: 2, test: hasExtendedBroetry },
    { name: 'numbered-micro-listicle',      level: 2, test: hasNumberedMicroListicle },
    { name: 'em-dash-pacing',               level: 2, test: hasEmDashPacing },
    { name: 'brochure-lexicon-cluster',     level: 2, test: hasBrochureLexiconCluster },
    { name: 'three-beat-arc',               level: 2, test: hasThreeBeatArc },
    { name: 'broetry',                      level: 3, test: function (t) { return getBroetryScore(t) >= 25; } },
    { name: 'emoji-bullet-stack',           level: 3, test: hasEmojiBulletStack },
    { name: 'ellipsis-pacing',              level: 3, test: hasEllipsisPacing },
    { name: 'micro-paragraph-cascade',      level: 3, test: hasMicroParagraphCascade },
    { name: 'triple-enumeration-stack',     level: 3, test: hasTripleEnumerationStack },
    { name: 'number-hook-opener',           level: 3, test: hasNumberHookOpener },
    { name: 'title-case-heading-stack',     level: 3, test: hasTitleCaseHeadingStack },
    { name: 'anaphoric-fragment-stack',     level: 3, test: hasAnaphoricFragmentStack },
    { name: 'inline-not-about-reframe-stack', level: 4, test: hasInlineNotAboutReframeStack },
    { name: 'contrastive-reframe-stack',    level: 4, test: hasContrastiveReframeStack },
    { name: 'same-stem-antithesis-pair',    level: 4, test: hasSameStemAntithesisPair },
    { name: 'some-others-binary-pair',      level: 4, test: hasSomeOthersBinaryPair },
    { name: 'compressed-inversion-payoff',  level: 4, test: hasCompressedInversionPayoff },
    { name: 'ai-contrastive-pair',          level: 4, test: hasAiContrastivePair },
    { name: 'hook-body-cta',                level: 4, test: hasHookBodyCtaRhythm },
    { name: 'question-fragment-opener',     level: 4, test: hasQuestionFragmentOpener },
    { name: 'rhetorical-hinge-reveal',      level: 4, test: hasRhetoricalHingeReveal },
    { name: 'math-bold',                    level: 4, test: hasMathBoldUnicode, usesRawText: true },
  ];

  /**
   * Return the structural detector name fired by the slop sensitivity slider,
   * or '' if no structural signal matches.
   * Called only from getPostDecision() when slopSensitivityLevel > 0.
   * Operates on raw text content BEFORE normalizeText() so math-bold Unicode
   * is not flattened by NFKC normalisation.
   *
   * @param {string} rawText  Raw post body text
   * @returns {string}  Detector name (e.g. 'em-dash-pacing') or ''
   */
  function getSliderStructuralTrigger(rawText) {
    if (!rawText) return '';

    // Strip standalone rule-divider lines (---, ***, ___) once before all detectors.
    // math-bold is the only exception: it must see the raw pre-NFKC text (usesRawText: true).
    var normalizedText = _structStripRuleDividers(rawText);

    for (var i = 0; i < SLIDER_STRUCTURAL_DETECTORS.length; i++) {
      var det = SLIDER_STRUCTURAL_DETECTORS[i];
      if (slopSensitivityLevel < det.level) continue;
      var textForDetector = det.usesRawText ? rawText : normalizedText;
      if (!det.test(textForDetector)) continue;
      return det.name;
    }

    return '';
  }

  function scoreLexicalTellDensity(rawText) {
    var compact = normalizeCardText(rawText || '');
    if (!compact) return 0;
    if (_structWordCount(compact) < 20) return 0;

    var density = _structCollectPatternDensity(compact, SLOP_BROCHURE_TELL_PATTERNS);
    var points = 0;

    if (density.total >= 6 && density.distinct >= 3) {
      points += 12;
    } else if (density.total >= 4 && density.distinct >= 3) {
      points += 8;
    }
    if (density.phraseHits >= 2) points += 8;

    return Math.min(20, points);
  }

  function scorePostForAiSlop(card) {
    var text = (extractText(card, HU.SELECTORS.postText) || '').trim();
    if (!text) return 0;

    var score = 0;

    // ── Emoji density ──────────────────────────────────────────────────────
    var emojiMatches = text.match(EMOJI_RE) || [];
    var emojiCount   = emojiMatches.length;
    var charLen      = text.length;
    var emojiRatio   = charLen > 0 ? emojiCount / charLen : 0;
    if      (emojiRatio > 0.08) score += 30;
    else if (emojiRatio > 0.04) score += 20;
    else if (emojiRatio > 0.01) score += 10;

    // ── Hashtag cluster at the end of the post ─────────────────────────────
    if (SLOP_HASHTAG_END_RE.test(text)) score += 25;

    // ── Broetry: reuse shared helper for consistency ───────────────────────
    score += getBroetryScore(text);

    // ── CTA phrases ────────────────────────────────────────────────────────
    var ctaMatches = text.match(SLOP_CTA_RE) || [];
    score += Math.min(30, ctaMatches.length * 10);

    // ── Dense brochure/buzzword phrase clusters ────────────────────────────
    score += scoreLexicalTellDensity(text);

    return Math.min(100, score);
  }

  function buildPostContext(card) {
    var structuralPostText = null;
    var rawPostText = extractText(card, HU.SELECTORS.postText);

    return {
      card: card,
      rawPostText: rawPostText,
      getStructuralPostText: function () {
        if (structuralPostText === null) {
          structuralPostText = extractStructuralText(card, HU.SELECTORS.postText);
        }
        return structuralPostText;
      },
    };
  }

  var __postDecisionEvaluator = __postEvaluator.create({
    makeHideDecision: makeHideDecision,
    buildPostContext: buildPostContext,
    isSeriousModeFunny: isSeriousModeFunny,
    isAiFiltered: isAiFiltered,
    getSliderStructuralTrigger: getSliderStructuralTrigger,
    scorePostForAiSlop: scorePostForAiSlop,
    getSlopHeuristicThreshold: getSlopHeuristicThreshold,
    getRuntimeState: function () {
      return {
        matcher: matcher,
        slopMatcher: slopMatcher,
        slopSensitivityLevel: slopSensitivityLevel,
        aiFilterEnabled: aiFilterEnabled,
        seriousModeEnabled: seriousModeEnabled,
      };
    },
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // §19 CORE EVALUATORS
  // ═══════════════════════════════════════════════════════════════════════════
  // getPostDecision: pure function, returns a structured hide decision.
  // evaluatePost:   idempotent — applies hide/unhide to an already-resolved card.

  // ── AI Filter detector ────────────────────────────────────────────────────
  // Uses the same compileBlacklist() machinery as My List so matching semantics
  // are identical: Unicode-aware, case-insensitive, NFKC-normalized, zero-width-
  // stripped, broad Unicode boundary (not a narrow hardcoded punctuation set).
  // Checks post body text, card meta/header text, and actor description nodes.
  //
  // Terms covered:
  //   'AI'    → standalone word: "using AI", "AI tools", "AI-powered", "AI's"
  //   '#AI'   → hashtag form: "#AI", "#AItools" (exact hashtag boundary)
  //   regex   → dotted form A.I., compounds OpenAI/GenAI/AI/ML, LLM, ChatGPT,
  //             "artificial intelligence", "machine learning" (post-boundary)
  var aiMatcher = compileBlacklist([
    'AI',
    '#AI',
    '#ArtificialIntelligence',
    'LLM',
    'ChatGPT',
    'artificial intelligence',
    'machine learning',
    '/(?:^|[^\\p{L}\\p{N}_#])(?:gen|open|gpt|claude|gemini|copilot|llama)[\\s-]?ai(?=$|[^\\p{L}\\p{N}_])/iu',
    '/(?:^|[^\\p{L}\\p{N}_#])a[.]i[.](?=$|[^\\p{L}\\p{N}_])/iu',
    '/(?:^|[^\\p{L}\\p{N}_#])ai[/\\\\]ml(?=$|[^\\p{L}\\p{N}_])/iu',
  ]);

  function isAiFiltered(card, rawPostText) {
    var metaText = getCardMetaText(card);
    // 1. Post body text
    if (aiMatcher.matches(rawPostText)) return true;

    // 2. Card header / meta text (catches "Suggested", actor subheader, etc.)
    if (aiMatcher.matches(metaText)) return true;

    // 3. Actor job-title/description nodes (catches headline in feed + reshares)
    // 2026: headline text lives in aria-label, not textContent.
    // Selector source: HU.SELECTORS.actorDescription (constants.js).
    var descSelectors = HU.SELECTORS.actorDescription || [];
    for (var i = 0; i < descSelectors.length; i++) {
      var els = card.querySelectorAll(descSelectors[i]);
      for (var j = 0; j < els.length; j++) {
        var raw = (els[j].getAttribute('aria-label') || '') + ' ' + (els[j].textContent || '');
        if (aiMatcher.matches(raw)) return true;
      }
    }

    return false;
  }

  // The host's "Funny" reaction internal name is "entertainment".
  // "maybe" = Insightful (different reaction — do NOT include).
  // Header text uses present tense: "Mitch Lenzen finds this funny".
  // Asset paths: entertainment-consumption / entertainment-consumption-ring.
  var SERIOUS_MODE_FUNNY_RE = /\b(?:found|finds) this funny\b/i;
  var SERIOUS_MODE_SVG_RE   = /\bentertainment-consumption/i;
  var SERIOUS_MODE_LAUGH_EMOJI_RE = /[\u{1F602}\u{1F923}]/u; // 😂 / 🤣

  /**
   * Returns true if this card signals humor — a connection reacted "funny",
   * the card includes laughter emoji, or the funny reaction icon is present.
   *
   * @param {Element} card
   * @returns {boolean}
   */
  function isSeriousModeFunny(card) {
    // 1. Header/meta + post body text.
    var signalText = normalizeCardText(
      getReactorHeaderText(card) + ' ' +
      getCardMetaText(card) + ' ' +
      extractText(card, HU.SELECTORS.postText)
    );
    if (SERIOUS_MODE_FUNNY_RE.test(signalText)) return true;
    if (SERIOUS_MODE_LAUGH_EMOJI_RE.test(signalText)) return true;

    // 2. Accessibility/tooltip attributes frequently carry reaction labels.
    var attrs = card.querySelectorAll('[aria-label], [title], img[alt]');
    for (var a = 0; a < attrs.length; a++) {
      var attrText = normalizeCardText(
        (attrs[a].getAttribute('aria-label') || '') + ' ' +
        (attrs[a].getAttribute('title') || '') + ' ' +
        (attrs[a].getAttribute('alt') || '')
      );
      if (!attrText) continue;
      if (SERIOUS_MODE_FUNNY_RE.test(attrText)) return true;
      if (SERIOUS_MODE_LAUGH_EMOJI_RE.test(attrText)) return true;
    }

    // 3. Host reaction SVG ids (entertainment-consumption-ring-small).
    var svgs = card.querySelectorAll('svg[id]');
    for (var i = 0; i < svgs.length; i++) {
      if (SERIOUS_MODE_SVG_RE.test(svgs[i].id)) return true;
    }

    // 4. use[href] or use[xlink:href] referencing the funny reaction sprite
    var uses = card.querySelectorAll('use');
    for (var j = 0; j < uses.length; j++) {
      var href = uses[j].getAttribute('href') || uses[j].getAttribute('xlink:href') || '';
      if (SERIOUS_MODE_SVG_RE.test(href)) return true;
    }

    // 5. Img-based reaction sprites on some surfaces.
    var imgs = card.querySelectorAll('img[src], img[data-delayed-url], img[data-ghost-url]');
    for (var k = 0; k < imgs.length; k++) {
      var src =
        (imgs[k].getAttribute('src') || '') + ' ' +
        (imgs[k].getAttribute('data-delayed-url') || '') + ' ' +
        (imgs[k].getAttribute('data-ghost-url') || '');
      if (SERIOUS_MODE_SVG_RE.test(src)) return true;
    }

    return false;
  }

  function getPostDecision(card) {
    return __postDecisionEvaluator.getPostDecision(card);
  }

  /**
   * Idempotent post evaluator — re-runnable at any time, including on cards
   * that are already hidden. This lets late-arriving DOM mutations (e.g. the
   * "1st" degree badge rendering after the card shell appears)
   * correct a stale hidden state without waiting for a settings toggle.
   *
   * Caller must pass the already-resolved outer card element (not a raw node).
   * @param {Element} card
   */
  function evaluatePost(card) {
    // Skip inner nested cards that live inside an already-managed outer card.
    // This prevents reshared/reposted mini-posts from getting their own
    // reason strip separate from the outer card's strip.
    var outerManaged = card.parentElement && card.parentElement.closest(
      '[' + HU.HIDDEN_ATTR + '],[' + HU.DIMMED_ATTR + '],[' + HU.KIND_ATTR + ']'
    );
    if (outerManaged) return;

    var decision = getPostDecision(card);
    if (decision.kind) {
      hideElement(card, decision);
      setCounterState(card, 'hidden');
    } else {
      unhideElement(card);
      setCounterState(card, 'shown');
    }
  }


  // ═══════════════════════════════════════════════════════════════════════════
  // §22 ROOT SCANNER
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * querySelectorAll does not include root itself — this helper does.
   * @param {Element|Document} root
   * @param {string} selector
   * @returns {Element[]}
   */
  var __scanCandidateCollector = __scanCandidates.create({
    selectors: {
      postContainer: HU.SELECTORS.postContainer,
      feedCardItem: HU.SELECTORS.feedCardItem,
    },
    resolveFeedCard: resolveFeedCard,
    normalizeCardText: normalizeCardText,
    document: document,
  });

  /**
   * Scan all post cards in the given root for AI filter + slop slider hits.
   * @param {Element|Document} root
   */
  function scanRoot(root) {
    if (!enabled) return;

    var t0 = debugEnabled ? Date.now() : 0;

    // Post-card-only product surface — resolve each post card and evaluate it.
    // Resolve to the true outer card boundary first, then deduplicate so each
    // card is evaluated exactly once even when multiple inner nodes (e.g.
    // fie-impression-container + nested data-urn div) match the selector.
    // Inner-node mutations (e.g. late-arriving "1st" badge text) re-evaluate
    // the enclosing card via the resolver.
    var hasFilter = !matcher.isEmpty || slopSensitivityLevel > 0 || aiFilterEnabled || seriousModeEnabled || uiFilters.showFeedCounter;
    if (hasFilter) {
      var posts = __scanCandidateCollector.collectResolvedPostCards(root);
      for (var i = 0; i < posts.length; i++) {
        evaluatePost(posts[i]);
      }
    }

    if (debugEnabled) {
      debugLog('scan.root', {
        root: describeRootNode(root),
        ms: Date.now() - t0,
      });
    }
  }

  function fullScan() {
    var t0 = debugEnabled ? Date.now() : 0;
    scanRoot(document);
    if (debugEnabled) {
      debugLog('scan.full', { ms: Date.now() - t0 });
    }
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // §23 OBSERVER INTEGRATION
  // ═══════════════════════════════════════════════════════════════════════════
  // The host hydrates feed cards in two stages: it first inserts a shell
  // element, then injects inner content (actor name, "Promoted" label, "1st"
  // badge, etc.) via subsequent mutations.  The immediate scanRoot() catches
  // cards whose content is already present, but late-arriving inner nodes
  // (especially promoted labels and activity headers) require a second pass.
  //
  // The delayed rescan mirrors the boot-time setTimeout(fullScan, 1000) that
  // already exists for the same reason, but is scoped to newly added roots so
  // it doesn't re-walk the whole document on every infinite-scroll batch.

  var __lateRescan = __lateRescanScheduler.create({
    delayMs: HU.SCAN.LATE_RESCAN_MS,
    setTimeout: setTimeout,
    clearTimeout: clearTimeout,
    onFlushRoot: function (root) {
      scanRoot(root);
    },
  });

  function scheduleLateRescan(roots) {
    __lateRescan.schedule(roots);
  }

  var obs = createObserver(function (payload) {
    if (payload.fullScan) {
      fullScan();
      scheduleLateRescan([document.body]);
      return;
    }
    var roots = payload.roots;
    for (var i = 0; i < roots.length; i++) {
      if (roots[i] && roots[i].isConnected) {
        scanRoot(roots[i]);
      }
    }
    scheduleLateRescan(roots);
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // §24 STORAGE CHANGE LISTENER
  // ═══════════════════════════════════════════════════════════════════════════
  // Sync settings updates are routed through shared/storage.js watcher helpers
  // so split-key detection and full settings reassembly stay centralized.

  chrome.storage.onChanged.addListener(function (changes, area) {
    if (area === 'local' && changes[DEBUG_STORAGE_KEY]) {
      var nv = changes[DEBUG_STORAGE_KEY].newValue;
      debugEnabled = (nv === true || nv === 1 || nv === '1' || nv === 'true');
      if (debugEnabled) {
        debugLog('debug.toggled', { enabled: true, source: 'storage.onChanged' });
      }
      return;
    }
  });

  watchSettingsChanges(function (settings) {
    applySettingsToRuntime(settings);

    debugLog('settings.changed', {
      enabled: enabled,
      blacklist: settings.blacklist.length,
    });

    // Settings state is always updated above (matchers, AI filter, slop slider,
    // hidden-item mode). DOM mutations are only safe once the boot runtime has
    // started — before that, React hydration may still be running and early DOM
    // changes cause errors. Note: getSettings() may write back to sync during
    // boot, which fires this listener before bootRuntimeStarted is true — the
    // guard must only block DOM side-effects, not the state sync above.
    if (!bootRuntimeStarted) return;

    if (!enabled) {
      disableOpenSlopOnPage();
      return;
    }

    applyUiFilters();
    unhideAll();
    fullScan();
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // §26 BOOTSTRAP
  // ═══════════════════════════════════════════════════════════════════════════

  function startRuntime() {
    if (bootRuntimeStarted) return;
    bootRuntimeStarted = true;

    debugLog('runtime.start', {
      path: window.location.pathname,
      readyState: document.readyState,
      enabled: enabled,
    });

    if (!enabled) {
      disableOpenSlopOnPage();
    } else {
      applyUiFilters();
      fullScan();
    }

    obs.start();

    // Safety rescan: the host renders card shells before injecting social-context
    // text (e.g. the "1st" degree badge). The initial fullScan() may classify a
    // card before its badge arrives. A delayed rescan lets the now-idempotent
    // evaluatePost() correct any stale hidden state once the DOM settles.
    setTimeout(function () {
      if (enabled) fullScan();
    }, 1000);
  }

  function scheduleRuntimeStart() {
    function armStartTimer() {
      clearTimeout(bootStartTimer);
      bootStartTimer = setTimeout(startRuntime, BOOT_START_DELAY_MS);
      debugLog('runtime.scheduled', {
        delayMs: BOOT_START_DELAY_MS,
        readyState: document.readyState,
      });
    }

    if (document.readyState === 'complete') {
      armStartTimer();
      return;
    }

    window.addEventListener('load', armStartTimer, { once: true });
    // Fallback: some SPA transitions can miss a meaningful load edge.
    setTimeout(armStartTimer, BOOT_START_DELAY_MS + 1800);
  }

  window.addEventListener('error', function (evt) {
    debugLog('window.error', {
      message: evt && evt.message ? evt.message : '',
      source: evt && evt.filename ? evt.filename : '',
      line: evt && typeof evt.lineno === 'number' ? evt.lineno : 0,
      column: evt && typeof evt.colno === 'number' ? evt.colno : 0,
    });
  }, true);

  window.addEventListener('unhandledrejection', function (evt) {
    var reason = evt && evt.reason;
    debugLog('window.unhandledrejection', {
      reason: (reason && reason.message) ? reason.message : String(reason || ''),
    });
  }, true);

  getSettings().then(function (settings) {
    applySettingsToRuntime(settings);
    loadDebugFlag(function () {
      debugLog('settings.loaded', {
        enabled: enabled,
        blacklist: settings.blacklist.length,
      });
      scheduleRuntimeStart();
    });
  });

})();
