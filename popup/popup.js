// OpenSlop — Popup
// ─────────────────────────────────────────────────────────────────────────────
// The toolbar UI. Writes settings to chrome.storage.sync on every mutation;
// the content script reacts live via storage.onChanged, so no message-passing
// is required.
//
// Architecture note — intentional single IIFE:
//   In MV3 plain-script loading, separate popup files cannot share closed-over
//   scope. Splitting would force UI state onto `window` (unacceptable) or
//   demand a bootstrap factory (complexity > value for a popup). The file
//   stays as one IIFE; the section banners below mark logical boundaries.
//
// Section map:
//   §1   DOM References          — cached getElementById
//   §2   Private State           — currentSettings, latest counters/tally
//   §8   Session Feed Counter    — 1s poll + reactive update of live capsule
//   §16  Persist                 — saveSettings wrapper
//   §19  Bootstrap               — getSettings then build cards
//   §25b Donut Panel             — live category donut + metric dropdown
//   §26b Slop Sensitivity Slider — "Slop Sensitivity" card (0–4 slider + forecast)
//   §26c AI Filter Toggle        — "Hide AI Posts" switch card
//   §26d Hidden-Item Mode        — Audit / Minimize / Hide segmented control
//
// Section numbers are non-contiguous: gaps mark surfaces that were removed
// (status banner, power toggle, quick-setup bulk actions, my-list CRUD,
// muted-entity panels, history calendar, quick-links menu, profile
// overview). New sections should pick the smallest unused integer.
// ─────────────────────────────────────────────────────────────────────────────

/* global HU,
          getSettings, saveSettings, getFeedCounter,
          getSlopSensitivityDescriptor,
          getSessionTally,
          HUChromeAPI */

(function () {
  'use strict';

  // ═══════════════════════════════════════════════════════════════════════════
  // §1 DOM REFERENCES
  // ═══════════════════════════════════════════════════════════════════════════

  var liveCapsule       = document.getElementById('liveCapsule');
  var liveCapsuleShown  = document.getElementById('liveCapsuleShown');
  var liveCapsuleHidden = document.getElementById('liveCapsuleHidden');

  // ── Donut legend labels ──────────────────────────────────────────────────
  // Mirrors content-script.js KIND_LABELS — must stay in sync because the
  // popup and content script load as separate IIFEs with no shared scope.
  // Every kind the post-evaluator emits gets a label here.
  var REVIEW_KIND_LABELS = {
    'ai-filter':    'AI post',
    'ai-slop':      'AI slop',
    'post':         'Keyword match',
    'serious-mode': 'Humor post',
    'unknown':      'Hidden',
  };

  function statsKindLabel(kind) {
    return REVIEW_KIND_LABELS[kind] ||
      String(kind || 'Hidden')
        .replace(/[-_]+/g, ' ')
        .replace(/\b[a-z]/g, function (m) { return m.toUpperCase(); });
  }

  function toDonutTitleCase(label) {
    return String(label || '').replace(/[A-Za-z]+/g, function (word) {
      var upper = word.toUpperCase();
      if (upper === 'AI') return upper;
      return word.charAt(0).toUpperCase() + word.slice(1).toLowerCase();
    });
  }

  function statsColor(kind) {
    var palette = (HU && HU.ACTIVITY_KIND_COLORS) || {};
    return palette[kind] || '#94A3B8';
  }

  function buildTempCategoryShell(opts) {
    var shell = document.createElement('section');
    shell.className = 'temp-category' + (opts.cardClass ? ' ' + opts.cardClass : '');
    if (opts.color) shell.style.setProperty('--cat-color', opts.color);
    if (opts.title) shell.title = opts.title;
    var header = document.createElement('div');
    header.className = 'temp-category__header' +
      (opts.headerClass ? ' ' + opts.headerClass : '') +
      (opts.staticHeader ? ' temp-category__header--static' : '');
    var iconTile = document.createElement('span');
    iconTile.className = 'temp-category__icon-tile';
    iconTile.setAttribute('aria-hidden', 'true');
    iconTile.innerHTML = opts.iconSvg || '';
    var copy = document.createElement('div');
    copy.className = 'temp-category__copy';
    var nameEl = document.createElement('span');
    nameEl.className = 'temp-category__name';
    nameEl.textContent = opts.label;
    var controls = document.createElement('div');
    controls.className = 'temp-category__controls';
    copy.appendChild(nameEl);
    header.appendChild(iconTile);
    header.appendChild(copy);
    header.appendChild(controls);
    shell.appendChild(header);
    var body = null;
    if (opts.withBody !== false) {
      body = document.createElement('div');
      body.className = 'temp-category__body' + (opts.bodyClass ? ' ' + opts.bodyClass : '');
      shell.appendChild(body);
    }
    return { shell: shell, header: header, iconTile: iconTile, copy: copy,
             nameEl: nameEl, controls: controls, body: body };
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // §2 PRIVATE STATE
  // ═══════════════════════════════════════════════════════════════════════════

  var currentSettings  = null;
  var counterInterval  = null;

  var chromeApi = (typeof HUChromeAPI === 'object' && HUChromeAPI) ? HUChromeAPI : {};

  function addStorageChangeListener(listener) {
    if (typeof chromeApi.addStorageChangeListener === 'function') {
      return chromeApi.addStorageChangeListener(listener);
    }
    return function () {};
  }

  // Cached so the storage-change listener can fill in whichever side
  // (counter | tally) didn't change without a fresh fetch.
  var latestFeedCounter  = null;
  var latestSessionTally = {};


  // ═══════════════════════════════════════════════════════════════════════════
  // §8 SESSION FEED COUNTER
  // ═══════════════════════════════════════════════════════════════════════════

  // Applies counter + tally values to the live UI surfaces.
  // Called from the 1s poll and the reactive storage listener.
  function applyCounterUi(counter, tally) {
    latestFeedCounter  = counter || null;
    latestSessionTally = tally  || {};

    var shown  = (counter && typeof counter.shown  === 'number') ? counter.shown  : '—';
    var hidden = (counter && typeof counter.hidden === 'number') ? counter.hidden : '—';

    if (liveCapsuleShown)  liveCapsuleShown.textContent  = shown;
    if (liveCapsuleHidden) liveCapsuleHidden.textContent = hidden;
  }

  function fetchAndDisplayCounter() {
    Promise.all([
      getFeedCounter().catch(function () { return null; }),
      getSessionTally().catch(function () { return {}; }),
    ]).then(function (results) {
      applyCounterUi(results[0], results[1]);
    });
  }

  // Reactive listener: fires as soon as the content script writes updated
  // counter/tally values to local storage — no waiting for the next poll tick.
  addStorageChangeListener(function (changes, area) {
    if (area !== 'local') return;
    var counterChanged = Object.prototype.hasOwnProperty.call(changes, HU.FEED_COUNTER_KEY);
    var tallyChanged   = Object.prototype.hasOwnProperty.call(changes, HU.SESSION_TALLY_KEY);
    if (!counterChanged && !tallyChanged) return;

    var counter = counterChanged ? (changes[HU.FEED_COUNTER_KEY].newValue  || null) : latestFeedCounter;
    var tally   = tallyChanged   ? (changes[HU.SESSION_TALLY_KEY].newValue || {})   : latestSessionTally;
    applyCounterUi(counter, tally);
  });

  function stopCounterPolling() {
    if (counterInterval !== null) {
      clearInterval(counterInterval);
      counterInterval = null;
    }
  }

  function startCounterPolling() {
    stopCounterPolling();
    var uf = currentSettings.uiFilters || {};
    // Live capsule visibility gated on showFeedCounter
    if (liveCapsule) {
      if (uf.showFeedCounter) {
        liveCapsule.removeAttribute('hidden');
      } else {
        liveCapsule.setAttribute('hidden', '');
      }
    }
    // Always run the poller — header ring needs it regardless of showFeedCounter
    fetchAndDisplayCounter();
    counterInterval = setInterval(fetchAndDisplayCounter, 1000);
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // §16 PERSIST
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Save current settings and invoke callback on success.
   * The content script reacts via storage.onChanged — no message needed.
   * @param {function} [callback]
   * @returns {Promise<void>}
   */
  function persist(callback) {
    return saveSettings(currentSettings)
      .then(function (saved) {
        if (saved === false) return;
        if (typeof callback === 'function') callback();
      })
      .catch(function () { /* no user-facing surface for save errors */ });
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // §19 BOOTSTRAP
  // ═══════════════════════════════════════════════════════════════════════════

  getSettings().then(function (settings) {
    currentSettings = settings;

    if (!currentSettings.uiFilters || typeof currentSettings.uiFilters !== 'object') {
      currentSettings.uiFilters = Object.assign({}, HU.DEFAULT_SETTINGS.uiFilters);
    }

    buildSlopSliderCard();
    buildAiFilterCard();
    buildHiddenModeCard();
    startCounterPolling();
    openDonutPanel();
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // §25b DONUT PANEL — Live category donut chart with per-kind icons
  // ═══════════════════════════════════════════════════════════════════════════

  var donutSvg           = document.getElementById('donutSvg');
  var donutTotal         = document.getElementById('donutTotal');
  var donutLegend        = document.getElementById('donutLegend');
  var donutInterval      = null;

  // Ring geometry — viewBox is 200×200, center at (100,100)
  var DONUT_R              = 88;   // outer radius  (leaves 12px margin to viewBox edge)
  var DONUT_HOLE           = 58;   // inner radius  (ring width = 30px)
  var DONUT_CX             = 100;
  var DONUT_CY             = 100;
  var DONUT_GAP            = 2.5;  // gap between segments in px
  var DONUT_ICON_SIZE      = 14;   // icon rendered at 14px (paths in 24×24 space)
  var DONUT_ICON_SCALE     = DONUT_ICON_SIZE / 24;
  // Minimum slice fraction to render an icon (arc must be wide enough to hold it)
  var DONUT_MIN_ICON_FRAC  = 0.07;
  var SERIOUS_MODE_SMILE_FACE_ICON_PATH =
    '<circle cx="12" cy="12" r="10"/>' +
    '<line x1="9" y1="10" x2="9.01" y2="10"/>' +
    '<line x1="15" y1="10" x2="15.01" y2="10"/>' +
    '<path d="M8 14.7c1.1 1.45 2.55 2.3 4 2.3s2.9-.85 4-2.3"/>';

  // Per-kind icon paths (Feather/Lucide 24×24 stroke icons). Keyed by the
  // kind strings the engine emits — see content-script.js KIND_LABELS.
  // stroke="inherit" fill="none" are set on the parent <g>.
  var AI_ROBOT_ICON_PATH =
    '<path d="M3 20v-5.5a9 9 0 0 1 18 0V20"/>' +
    '<circle cx="9" cy="15" r="1"/>' +
    '<circle cx="15" cy="15" r="1"/>' +
    '<line x1="6.5" y1="10" x2="3.5" y2="6"/>' +
    '<line x1="17.5" y1="10" x2="20.5" y2="6"/>';
  var DONUT_KIND_ICON_PATH = {
    'ai-filter':    AI_ROBOT_ICON_PATH,
    'ai-slop':      AI_ROBOT_ICON_PATH,
    'post':         '<polygon points="22 3 2 3 10 12.46 10 19 14 21 14 12.46 22 3"/>',
    'serious-mode': SERIOUS_MODE_SMILE_FACE_ICON_PATH,
  };

  function stopDonutPolling() {
    if (donutInterval) { clearInterval(donutInterval); donutInterval = null; }
  }

  function renderDonut() {
    getSessionTally().then(function (tally) {
      tally = tally || {};

      // Build kind→count from live tally
      var counts = {};
      for (var k in tally) {
        if (Object.prototype.hasOwnProperty.call(tally, k) && tally[k] > 0) {
          counts[k] = (counts[k] || 0) + tally[k];
        }
      }

      var slices = [];
      for (var key in counts) {
        if (Object.prototype.hasOwnProperty.call(counts, key)) {
          slices.push({ kind: key, count: counts[key] });
        }
      }
      slices.sort(function (a, b) { return b.count - a.count; });

      var total = slices.reduce(function (s, x) { return s + x.count; }, 0);

      if (donutTotal) donutTotal.textContent = total > 0 ? total.toLocaleString() : '—';
      if (!donutSvg || !donutLegend) return;

      // ── Empty state ─────────────────────────────────────────────────────────
      // Gray donut + zero-count tiles for the two product surfaces (AI filter,
      // slop slider). Tiles always present so the popup never looks broken
      // before the first hide event lands.
      if (total === 0 || slices.length === 0) {
        var ringR = (DONUT_R + DONUT_HOLE) / 2;
        donutSvg.innerHTML =
          '<circle cx="' + DONUT_CX + '" cy="' + DONUT_CY + '" r="' + ringR + '"' +
          ' fill="none" stroke="rgba(255,255,255,0.07)" stroke-width="' + (DONUT_R - DONUT_HOLE) + '"/>';
        var emptyKinds = ['ai-filter', 'ai-slop'];
        var emptyHtml = '';
        for (var ei = 0; ei < emptyKinds.length; ei++) {
          var ek = emptyKinds[ei];
          emptyHtml +=
            '<li class="donut-legend__item donut-legend__item--zero">' +
              '<span class="donut-legend__swatch" style="background:' + statsColor(ek) + '"></span>' +
              '<span class="donut-legend__label">' + toDonutTitleCase(statsKindLabel(ek)) + '</span>' +
              '<span class="donut-legend__count">0</span>' +
            '</li>';
        }
        donutLegend.innerHTML = emptyHtml;
        return;
      }

      // ── Build SVG ───────────────────────────────────────────────────────────
      var ringR       = (DONUT_R + DONUT_HOLE) / 2;
      var circ        = 2 * Math.PI * ringR;
      var gapFraction = DONUT_GAP / circ;
      var offset      = 0;

      // Two-pass: segments first (behind), icons second (in front)
      var segHtml  = '';
      var iconHtml = '';

      for (var i = 0; i < slices.length; i++) {
        var fraction = slices[i].count / total;
        var color    = statsColor(slices[i].kind);
        var dash     = Math.max(0, (fraction - gapFraction) * circ);

        // Segment arc
        segHtml +=
          '<circle cx="' + DONUT_CX + '" cy="' + DONUT_CY + '"' +
          ' r="' + ringR + '"' +
          ' fill="none"' +
          ' stroke="' + color + '"' +
          ' stroke-width="' + (DONUT_R - DONUT_HOLE) + '"' +
          ' stroke-dasharray="' + dash.toFixed(2) + ' ' + (circ - dash).toFixed(2) + '"' +
          ' stroke-dashoffset="' + (-offset * circ).toFixed(2) + '"/>';

        // Icon — only if segment is large enough to hold it
        if (fraction >= DONUT_MIN_ICON_FRAC) {
          var midAngle = (offset + fraction / 2) * 2 * Math.PI;
          var iconX    = (DONUT_CX + ringR * Math.cos(midAngle)).toFixed(2);
          var iconY    = (DONUT_CY + ringR * Math.sin(midAngle)).toFixed(2);
          var iconPath = DONUT_KIND_ICON_PATH[slices[i].kind] || '';

          if (iconPath) {
            // translate to midpoint → counter-rotate 90° (undoes CSS rotate(-90deg))
            // → scale icon from 24×24 to DONUT_ICON_SIZE → center it at origin
            iconHtml +=
              '<g transform="translate(' + iconX + ',' + iconY + ') rotate(90)' +
              ' scale(' + DONUT_ICON_SCALE.toFixed(4) + ')' +
              ' translate(-12,-12)"' +
              ' fill="none"' +
              ' stroke="rgba(255,255,255,0.92)"' +
              ' stroke-width="' + (2 / DONUT_ICON_SCALE).toFixed(2) + '"' +
              ' stroke-linecap="round"' +
              ' stroke-linejoin="round">' +
              iconPath +
              '</g>';
          }
        }

        offset += fraction;
      }

      donutSvg.innerHTML = segHtml + iconHtml;

      // ── Legend ──────────────────────────────────────────────────────────────
      var legendHtml = '';
      for (var j = 0; j < slices.length; j++) {
        var s   = slices[j];
        var pct = Math.round((s.count / total) * 100);
        var col = statsColor(s.kind);
        var lbl = toDonutTitleCase(statsKindLabel(s.kind));
        legendHtml +=
          '<li class="donut-legend__item">' +
            '<span class="donut-legend__swatch" style="background:' + col + '"></span>' +
            '<span class="donut-legend__label">' + lbl + '</span>' +
            '<span class="donut-legend__pct">' + pct + '%</span>' +
            '<span class="donut-legend__count">' + s.count.toLocaleString() + '</span>' +
          '</li>';
      }
      donutLegend.innerHTML = legendHtml;
    });
  }

  function openDonutPanel() {
    stopDonutPolling();
    renderDonut();
    donutInterval = setInterval(renderDonut, 1000);
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // §26b SLOP SENSITIVITY SLIDER CARD
  // ═══════════════════════════════════════════════════════════════════════════
  // Hero card at the top of panelTemp. Additive post-only filter layer.
  // Persists to settings.slopSensitivityLevel (integer 0–4).

  var slopSensitivityMount = document.getElementById('slopSensitivityMount');

  var SLOP_STOP_LABELS = ['Off', '😌', '😐', '😤', '🔥'];

  /**
   * Update or render the slop sensitivity slider card in the Temp panel.
   * Safe to call multiple times — replaces content in-place.
   */
  // ── Slop debug drawer state ───────────────────────────────────────────────
  var slopDebugOpen = false;

  var SLOP_STRUCTURAL_INFO = {
    'sentence-ladder': {
      name: 'Sentence Ladder',
      description: 'Posts with 13–30 lines where 90%+ are 1–5 words, 80%+ end with punctuation, avg line is ≤32 chars, and bullet lines are rare (≤10%) — extreme "each breath gets its own line" dramatic formatting.',
    },
    'extended-broetry': {
      name: 'Extended Broetry',
      description: 'Long-form broetry (13–30 lines) with 85%+ of lines being 1–8 words, avg line ≤42 chars, and few bullet lines (≤15%) — the extra-long dramatic story format the standard broetry detector misses.',
    },
    'numbered-micro-listicle': {
      name: 'Numbered Micro-Listicle',
      description: 'Posts with a sequential numbered run starting at 1 (e.g. "1." or "1)"), ≥5 items of 1–8 words and ≤60 chars each, covering ≥80% of non-empty lines — the "substanceless listicle" pattern.',
    },
    'broetry': {
      name: 'Broetry structure',
      description: 'Posts with 4–12 lines where 75%+ of lines are 2–8 words, avg line ≤48 chars, and list markers don\'t dominate (≤40%) — the classic one-thought-per-line "broetry" poem format.',
    },
    'emoji-bullet-stack': {
      name: 'Emoji Bullet Stack',
      description: 'Posts with ≥5 short emoji/symbol bullet lines (1–10 words, ≤60 chars each) making up ≥70% of non-empty lines — the "emoji checklist with no substance" pattern.',
    },
    'ellipsis-pacing': {
      name: 'Ellipsis Pacing',
      description: 'Posts where … or ... appears ≥4 times in the first 220 chars, with ≤38 words in that span and 75%+ of inter-ellipsis gaps being ≤6 words — the "wait for it… dramatic pause… reveal" suspense device.',
    },
    'ai-contrastive-pair': {
      name: 'AI Contrastive Pair',
      description: 'Consecutive sentence pair where the first (3–12 words) contains a negation ("doesn\'t", "isn\'t") and the second (2–12 words) opens with "It", "This", "That", or "They" — the "X doesn\'t ____. It ____." AI-voice formula.',
    },
    'hook-body-cta': {
      name: 'Hook / Body / CTA Rhythm',
      description: 'Posts split into: 1–2 short hook lines (1–6 words each) → blank → 2–5 medium body lines (6–22 words each) → blank → 1 short closer (1–8 words, CTA/question/prompt) — the formulaic feed-post engagement-bait structure.',
    },
    'question-fragment-opener': {
      name: 'Question Fragment Opener',
      description: 'Posts (4–10 lines) where the first line is a 4–12-word question and the next non-empty line is a 1–3-word answer fragment ending with punctuation — the "What makes a great leader? Consistency." pattern.',
    },
    'three-beat-arc': {
      name: 'Three-Beat Arc',
      description: 'Consecutive "I ____. Then/Next/After that ____. Now/Today ____." beats (2–12 words each) as adjacent lines or sentences — the before/during/after revelation arc.',
    },
    'number-hook-opener': {
      name: 'Number Hook Opener',
      description: 'Posts (4–9 lines, ≤70 words) where the first line is a standalone percentage, currency, or multiplier (e.g. "10x") followed by a blank line and a 3–12-word follow-on sentence — the fake data-storytelling hook.',
    },
    'math-bold': {
      name: 'Math-bold Unicode',
      description: 'Posts where ≥8 characters from the Unicode Mathematical Alphanumeric Symbols block (U+1D400–U+1D7FF) appear in the first 280 chars and make up ≥40% of the non-space characters — a common trick to fake "bold text" in feeds that don\'t support rich formatting.',
    },
    'micro-paragraph-cascade': {
      name: 'Micro-Paragraph Cascade',
      description: 'Posts of 18–45 non-empty lines split into 10–26 blank-line-separated sections where ≥60% of sections are a single isolated line, ≥80% are 1–2 lines, avg ≤1.7 lines/section, and blank lines make up ≥28% of all lines — the "paragraph-per-breath" essay format where each sentence gets its own breathing room as a rhetorical device.',
    },
    'brochure-lexicon-cluster': {
      name: 'Brochure Lexicon Cluster',
      description: 'Posts with dense clusters of AI-brochure buzzwords, filler phrases, and promotional euphemisms. Fires only when multiple distinct tells co-occur at meaningful density, not for one-off word choice.',
    },
    'em-dash-pacing': {
      name: 'Em-Dash Pacing',
      description: 'Posts where spaced em/en dashes ( — / – ) are used as dramatic cadence breaks: ≥3 dash breaks in the first 260 chars, ≤50 words in that span, and mostly short inter-dash segments (≤6 words).',
    },
    'inline-not-about-reframe-stack': {
      name: 'Inline Not-About Reframe Stack',
      description: 'Repeated inline reframes in the form "it\'s not (just) about X, it\'s about Y." A single instance can be normal writing; this fires when the pattern stacks (2+ times) in one post.',
    },
    'triple-enumeration-stack': {
      name: 'Triple Enumeration Stack',
      description: 'Repeated short three-item cadence units (e.g., "Clarity, consistency, confidence.") outside bullet/list formatting. Requires multiple triad units, not a single list sentence.',
    },
    'title-case-heading-stack': {
      name: 'Title-Case Heading Stack',
      description: 'Runs of 4+ single-line title-case pseudo-headings separated by blank lines, with surrounding prose context. Targets formulaic heading stacks, not normal outline posts.',
    },
    'contrastive-reframe-stack': {
      name: 'Contrastive Reframe Stack',
      description: 'Posts containing ≥2 binary reframe pairs — consecutive sentences where the first contains a negation (3–14 words) and the second opens with a pivot pronoun (it/this/that/they) or a corrective tail (not/instead/rather). A single such pair is common in good prose; a density of two or more signals a post built from reusable AI-optimised rhetorical beats.',
    },
    'rhetorical-hinge-reveal': {
      name: 'Rhetorical Hinge Reveal',
      description: 'A mid-post escalation device: a single-line question (2–7 words) used as a tension hinge, followed immediately by a blunt single-line payoff (1–5 words). E.g. "And the worst part?" → "It works." The hinge must appear after ≥3 non-empty lines of prior content and before at least one more section — it\'s a mid-post beat, not an opener or closer.',
    },
    'anaphoric-fragment-stack': {
      name: 'Anaphoric Fragment Stack',
      description: 'A run of ≥3 adjacent non-empty lines (each 2–14 words) that all open with the same 1–2 token prefix — e.g. "No friction. / No rough edges. / No real opinion…" or "The same story. / The same lesson. / The same voice." These unmarked repetition stacks are a hallmark of AI-cadence writing; they\'re missed by bullet detectors (no markers) and broetry (lines may be longer than typical broetry).',
    },
    'same-stem-antithesis-pair': {
      name: 'Same-Stem Antithesis Pair',
      description: 'Adjacent lines or sentence-units (4–16 words each) that share a 2–3 token prefix, where the first tail contains a negation and the second tail is a non-negated restatement with a different core predicate — e.g. "The real tell isn\'t confidence. The real tell is clarity." Missed by standard contrastive detectors because the second unit restates the same stem rather than pivoting to "it" or "this".',
    },
    'some-others-binary-pair': {
      name: 'Some / Others Binary Pair',
      description: 'An isolated two-line binary contrast where line 1 starts with "some", "some people", or "some of", and line 2 starts with "others", "others are", "other people", or "while others" (3–12 words each). Only fires when the pair appears as a 2-line section or two consecutive 1-line sections — the tight layout guard prevents matching in-paragraph prose.',
    },
    'compressed-inversion-payoff': {
      name: 'Compressed Inversion Payoff',
      description: 'Adjacent lines or sentence-units where S1 is a 5–12-word negated claim and S2 is a 2–4-word terse payoff whose final token is a bare copula or auxiliary verb (is/are/was/were/do/does/did/can/will) — e.g. "Content was never the bottleneck. Thinking was." The second unit must not start with a pronoun and must not itself contain negation.',
    },
  };

  function _slopForecastText(desc) {
    if (!desc || desc.categoryCount === 0) return 'Scope: off — no extra filtering.';
    var parts = ['Scope: ' + desc.categoryCount + ' ' + (desc.categoryCount === 1 ? 'category' : 'categories')];
    parts.push(desc.curatedTermCount + ' ' + (desc.curatedTermCount === 1 ? 'term' : 'terms'));
    if (desc.structuralCount > 0) {
      parts.push(desc.structuralCount + ' structural ' + (desc.structuralCount === 1 ? 'signal' : 'signals'));
    }
    return parts.join(' · ');
  }

  function _renderSlopDebugDrawer(drawer, level) {
    drawer.innerHTML = '';

    var levelsSection = document.createElement('div');
    levelsSection.className = 'slop-debug-section';

    var levelsHeading = document.createElement('p');
    levelsHeading.className   = 'slop-debug-heading';
    levelsHeading.textContent = 'What each level adds';
    levelsSection.appendChild(levelsHeading);

    var catMap = {};
    for (var ci = 0; ci < HU_PRESETS.length; ci++) {
      catMap[HU_PRESETS[ci].id] = HU_PRESETS[ci];
    }

    for (var li = 1; li <= 4; li++) {
      var levelCfg = HU_SLOP_LEVELS[li];
      var prevCfg  = HU_SLOP_LEVELS[li - 1];

      var prevCatSet = {};
      for (var pi = 0; pi < prevCfg.categoryIds.length; pi++) {
        prevCatSet[prevCfg.categoryIds[pi]] = true;
      }
      var addedCats = [];
      for (var ai = 0; ai < levelCfg.categoryIds.length; ai++) {
        if (!prevCatSet[levelCfg.categoryIds[ai]]) addedCats.push(levelCfg.categoryIds[ai]);
      }

      var prevStructSet = {};
      for (var psi = 0; psi < prevCfg.structural.length; psi++) {
        prevStructSet[prevCfg.structural[psi]] = true;
      }
      var addedStructural = [];
      for (var asi = 0; asi < levelCfg.structural.length; asi++) {
        if (!prevStructSet[levelCfg.structural[asi]]) addedStructural.push(levelCfg.structural[asi]);
      }

      var isCurrentLevel = (li === level);
      var isBelowCurrent = (li <= level);

      var levelBlock = document.createElement('div');
      levelBlock.className = 'slop-debug-level' +
        (isCurrentLevel ? ' slop-debug-level--current' : '') +
        (isBelowCurrent ? ' slop-debug-level--active' : ' slop-debug-level--inactive');

      var levelHeader = document.createElement('div');
      levelHeader.className = 'slop-debug-level__header';

      var levelLabel = document.createElement('span');
      levelLabel.className   = 'slop-debug-level__label';
      levelLabel.textContent = levelCfg.emoji + ' ' + levelCfg.label;

      levelHeader.appendChild(levelLabel);

      if (isCurrentLevel) {
        var currentPip = document.createElement('span');
        currentPip.className   = 'slop-debug-level__current-pip';
        currentPip.textContent = 'active';
        levelHeader.appendChild(currentPip);
      }

      levelBlock.appendChild(levelHeader);

      if (addedCats.length > 0 || addedStructural.length > 0) {
        var addedList = document.createElement('ul');
        addedList.className = 'slop-debug-added-list';

        for (var ki = 0; ki < addedCats.length; ki++) {
          var cat = catMap[addedCats[ki]];
          if (!cat) continue;

          var catItem = document.createElement('li');
          catItem.className = 'slop-debug-cat-item';

          var catToggle = document.createElement('button');
          catToggle.type      = 'button';
          catToggle.className = 'slop-debug-cat-toggle';
          catToggle.setAttribute('aria-expanded', 'false');
          catToggle.innerHTML =
            '<span class="slop-debug-cat-label">' +
              (cat.emoji ? cat.emoji + ' ' : '') + cat.label +
            '</span>' +
            '<span class="slop-debug-cat-count">' + cat.terms.length + ' terms</span>' +
            '<svg class="slop-debug-cat-chevron" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 6l4 4 4-4"/></svg>';

          var termList = document.createElement('ul');
          termList.className = 'slop-debug-term-list';
          termList.setAttribute('hidden', '');

          for (var ti = 0; ti < cat.terms.length; ti++) {
            var term = cat.terms[ti];
            var termLi = document.createElement('li');
            termLi.className   = 'slop-debug-term';
            termLi.textContent = term.text;
            termList.appendChild(termLi);
          }

          catToggle.addEventListener('click', (function (toggle, list) {
            return function () {
              var isOpen = toggle.getAttribute('aria-expanded') === 'true';
              toggle.setAttribute('aria-expanded', isOpen ? 'false' : 'true');
              toggle.classList.toggle('slop-debug-cat-toggle--open', !isOpen);
              if (isOpen) { list.setAttribute('hidden', ''); }
              else        { list.removeAttribute('hidden'); }
            };
          }(catToggle, termList)));

          catItem.appendChild(catToggle);
          catItem.appendChild(termList);
          addedList.appendChild(catItem);
        }

        for (var sii = 0; sii < addedStructural.length; sii++) {
          var sig     = addedStructural[sii];
          var sigInfo = SLOP_STRUCTURAL_INFO[sig];

          var sigItem = document.createElement('li');
          sigItem.className = 'slop-debug-cat-item';

          var sigToggle = document.createElement('button');
          sigToggle.type      = 'button';
          sigToggle.className = 'slop-debug-cat-toggle';
          sigToggle.setAttribute('aria-expanded', 'false');
          sigToggle.innerHTML =
            '<span class="slop-debug-cat-label">' +
              '⚙ ' + (sigInfo ? sigInfo.name : sig) +
            '</span>' +
            '<span class="slop-debug-cat-count">structural</span>' +
            '<svg class="slop-debug-cat-chevron" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 6l4 4 4-4"/></svg>';

          var sigDesc = document.createElement('p');
          sigDesc.className   = 'slop-debug-structural-desc';
          sigDesc.textContent = sigInfo ? sigInfo.description : sig;
          sigDesc.setAttribute('hidden', '');

          sigToggle.addEventListener('click', (function (toggle, desc) {
            return function () {
              var isOpen = toggle.getAttribute('aria-expanded') === 'true';
              toggle.setAttribute('aria-expanded', isOpen ? 'false' : 'true');
              toggle.classList.toggle('slop-debug-cat-toggle--open', !isOpen);
              if (isOpen) { desc.setAttribute('hidden', ''); }
              else        { desc.removeAttribute('hidden'); }
            };
          }(sigToggle, sigDesc)));

          sigItem.appendChild(sigToggle);
          sigItem.appendChild(sigDesc);
          addedList.appendChild(sigItem);
        }

        levelBlock.appendChild(addedList);
      }

      levelsSection.appendChild(levelBlock);
    }

    drawer.appendChild(levelsSection);
  }

  function buildSlopSliderCard() {
    if (!slopSensitivityMount || !currentSettings) return;

    var level = currentSettings.slopSensitivityLevel || 0;
    var desc  = getSlopSensitivityDescriptor(level, currentSettings);

    var ui = buildTempCategoryShell({
      cardClass: 'slop-slider-card',
      color: '#0a66c2',
      label: 'Slop Sensitivity',
      staticHeader: true,
      bodyClass: 'slop-slider-card__body',
      iconSvg:
        '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
          '<line x1="4" y1="21" x2="4" y2="14"/>' +
          '<line x1="4" y1="10" x2="4" y2="3"/>' +
          '<line x1="12" y1="21" x2="12" y2="12"/>' +
          '<line x1="12" y1="8" x2="12" y2="3"/>' +
          '<line x1="20" y1="21" x2="20" y2="16"/>' +
          '<line x1="20" y1="12" x2="20" y2="3"/>' +
          '<line x1="1" y1="14" x2="7" y2="14"/>' +
          '<line x1="9" y1="8" x2="15" y2="8"/>' +
          '<line x1="17" y1="16" x2="23" y2="16"/>' +
        '</svg>',
    });

    var card = ui.shell;
    var controls = ui.controls;
    var body = ui.body;

    var helpBtn = document.createElement('button');
    helpBtn.type      = 'button';
    helpBtn.className = 'temp-category__icon-btn slop-slider-card__help-btn';
    helpBtn.id        = 'slopHelpBtn';
    helpBtn.setAttribute('aria-expanded', slopDebugOpen ? 'true' : 'false');
    helpBtn.setAttribute('aria-controls', 'slopDebugDrawer');
    helpBtn.setAttribute('aria-label', 'Show what each level adds');
    helpBtn.textContent = '?';

    var badgeEl = document.createElement('span');
    badgeEl.className   = 'temp-category__count-pill slop-slider-card__level-badge';
    badgeEl.id          = 'slopLevelBadge';
    badgeEl.textContent = desc.emoji + '\u00A0' + desc.label;
    badgeEl.setAttribute('aria-label', 'Current slop sensitivity: ' + desc.label);
    controls.appendChild(badgeEl);
    controls.appendChild(helpBtn);

    // ── Rail + stop labels ────────────────────────────────────────────────
    var railWrap = document.createElement('div');
    railWrap.className = 'slop-slider-card__rail-wrap';

    var slider = document.createElement('input');
    slider.type      = 'range';
    slider.min       = '0';
    slider.max       = '4';
    slider.step      = '1';
    slider.value     = String(level);
    slider.className = 'slop-slider-card__range';
    slider.id        = 'slopSlider';
    slider.setAttribute('aria-label', 'Slop sensitivity');
    slider.setAttribute('aria-valuenow', String(level));
    slider.setAttribute('aria-valuetext', desc.label);
    slider.setAttribute('aria-describedby', 'slopForecast');
    slider.style.setProperty('--slop-pct', String(level * 25) + '%');

    var stopLabels = document.createElement('div');
    stopLabels.className      = 'slop-slider-card__stops';
    stopLabels.setAttribute('aria-hidden', 'true');
    for (var si = 0; si <= 4; si++) {
      var stopEl = document.createElement('span');
      stopEl.className   = 'slop-slider-card__stop' + (si === level ? ' slop-slider-card__stop--active' : '');
      stopEl.textContent = SLOP_STOP_LABELS[si];
      stopLabels.appendChild(stopEl);
    }

    railWrap.appendChild(slider);
    railWrap.appendChild(stopLabels);
    body.appendChild(railWrap);

    // ── Forecast line ─────────────────────────────────────────────────────
    var forecast = document.createElement('p');
    forecast.className   = 'slop-slider-card__forecast';
    forecast.id          = 'slopForecast';
    forecast.textContent = _slopForecastText(desc);
    body.appendChild(forecast);

    // ── Debug drawer ──────────────────────────────────────────────────────
    var drawer = document.createElement('div');
    drawer.className = 'slop-debug-drawer';
    drawer.id        = 'slopDebugDrawer';
    if (!slopDebugOpen) drawer.setAttribute('hidden', '');
    _renderSlopDebugDrawer(drawer, level);
    body.appendChild(drawer);

    // ── Slider events ─────────────────────────────────────────────────────
    var lastSavedLevel = level;

    slider.addEventListener('input', function () {
      var v    = parseInt(this.value, 10);
      var d    = getSlopSensitivityDescriptor(v, currentSettings);
      this.style.setProperty('--slop-pct', String(v * 25) + '%');
      this.setAttribute('aria-valuenow', String(v));
      this.setAttribute('aria-valuetext', d.label);

      var badge = document.getElementById('slopLevelBadge');
      var fc    = document.getElementById('slopForecast');
      var dr    = document.getElementById('slopDebugDrawer');

      if (badge) badge.textContent = d.emoji + '\u00A0' + d.label;
      if (fc)    fc.textContent    = _slopForecastText(d);

      // Re-render drawer content when level changes while open
      if (dr && slopDebugOpen) {
        _renderSlopDebugDrawer(dr, v);
      }

      // Update stop labels active state
      var stops = railWrap.querySelectorAll('.slop-slider-card__stop');
      for (var i = 0; i < stops.length; i++) {
        stops[i].classList.toggle('slop-slider-card__stop--active', i === v);
      }
    });

    slider.addEventListener('change', function () {
      if (!currentSettings || currentSettings.enabled === false) return;
      var v = parseInt(this.value, 10);
      if (v === lastSavedLevel) return;
      lastSavedLevel = v;
      currentSettings.slopSensitivityLevel = v;
      persist();
    });

    // ── Help button click ─────────────────────────────────────────────────
    helpBtn.addEventListener('click', function () {
      slopDebugOpen = !slopDebugOpen;
      this.setAttribute('aria-expanded', slopDebugOpen ? 'true' : 'false');
      var dr = document.getElementById('slopDebugDrawer');
      if (!dr) return;
      if (slopDebugOpen) {
        // Lock popup to its current height so opening the drawer doesn't
        // resize the extension, then hide every other panel surface so the
        // drawer can scroll inside the freed space.
        var lockedHeight = document.body.offsetHeight;
        document.body.style.height = lockedHeight + 'px';
        document.body.classList.add('help-open');
        dr.removeAttribute('hidden');
        var currentLevel = currentSettings.slopSensitivityLevel || 0;
        _renderSlopDebugDrawer(dr, currentLevel);
      } else {
        document.body.classList.remove('help-open');
        document.body.style.height = '';
        dr.setAttribute('hidden', '');
      }
    });

    slopSensitivityMount.innerHTML = '';
    slopSensitivityMount.appendChild(card);
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // §26c AI FILTER TOGGLE CARD
  // ═══════════════════════════════════════════════════════════════════════════
  // Hides posts containing the exact string "AI" (case-sensitive) and posts
  // from authors whose job title contains "AI".
  // Persists to settings.aiFilterEnabled (boolean).

  var aiFilterMount = document.getElementById('aiFilterMount');

  function buildTempHeaderToggleCard(opts) {
    var ui = buildTempCategoryShell({
      cardClass: opts.cardClass + (opts.enabled ? ' ' + opts.cardClass + '--on' : ''),
      color: opts.color,
      title: opts.tooltip,
      label: opts.label,
      iconSvg: opts.iconSvg,
      staticHeader: true,
      withBody: false,
    });

    var card = ui.shell;
    var controls = ui.controls;

    var switchWrap = document.createElement('label');
    switchWrap.className = 'hu-switch';
    switchWrap.title = opts.tooltip;

    var switchInput = document.createElement('input');
    switchInput.type = 'checkbox';
    switchInput.className = 'hu-switch__input';
    switchInput.checked = opts.enabled;
    switchInput.setAttribute('aria-label', opts.ariaLabel || opts.label);

    var switchSlider = document.createElement('span');
    switchSlider.className = 'hu-switch__slider';

    switchWrap.appendChild(switchInput);
    switchWrap.appendChild(switchSlider);
    controls.appendChild(switchWrap);

    return { card: card, switchInput: switchInput };
  }

  function buildAiFilterCard() {
    if (!aiFilterMount || !currentSettings) return;

    var enabled = !!currentSettings.aiFilterEnabled;
    var tooltip = 'Hide posts mentioning "AI" and authors whose title includes "AI".';

    var iconSvg =
      '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" ' +
        'stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" ' +
        'aria-hidden="true">' +
        (DONUT_KIND_ICON_PATH['ai-filter'] || '') +
      '</svg>';

    var ui = buildTempHeaderToggleCard({
      cardClass: 'ai-filter-card',
      color: '#ef4444',
      enabled: enabled,
      tooltip: tooltip,
      label: 'Hide AI Posts',
      ariaLabel: 'Hide AI posts',
      iconSvg: iconSvg,
    });
    var card = ui.card;
    var switchInput = ui.switchInput;

    // ── Event ─────────────────────────────────────────────────────────────
    switchInput.addEventListener('change', function () {
      if (!currentSettings || currentSettings.enabled === false) {
        this.checked = !this.checked; // revert the checkbox visually
        return;
      }
      currentSettings.aiFilterEnabled = this.checked;
      card.classList.toggle('ai-filter-card--on', this.checked);
      persist();
    });

    aiFilterMount.innerHTML = '';
    aiFilterMount.appendChild(card);
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // §26d HIDDEN-ITEM MODE CARD (Audit / Minimize / Hide)
  // ═══════════════════════════════════════════════════════════════════════════
  // Three-way segmented control governing how matched posts are presented:
  //   audit    → keep card visible with amber outline + reason strip
  //   minimize → collapse card body to a thin reason strip (dimMode)
  //   hide     → remove from layout (default)
  // Maps to two existing booleans in uiFilters: auditMode and dimMode.

  var hiddenModeMount = document.getElementById('hiddenModeMount');

  function getHiddenItemMode(settings) {
    var uf = (settings && settings.uiFilters) || {};
    if (uf.auditMode) return 'audit';
    if (uf.dimMode)   return 'minimize';
    return 'hide';
  }

  function setHiddenItemMode(settings, mode) {
    if (!settings.uiFilters || typeof settings.uiFilters !== 'object') {
      settings.uiFilters = {};
    }
    settings.uiFilters.auditMode = (mode === 'audit');
    settings.uiFilters.dimMode   = (mode === 'minimize');
  }

  function buildHiddenModeCard() {
    if (!hiddenModeMount || !currentSettings) return;

    var mode = getHiddenItemMode(currentSettings);

    var ui = buildTempCategoryShell({
      cardClass: 'hidden-mode-card',
      color: '#64748b',
      title: 'How matched posts are presented in your feed.',
      label: '',
      iconSvg: '',
      staticHeader: true,
      withBody: false,
    });

    var segmented = document.createElement('div');
    segmented.className = 'hu-segmented';
    segmented.setAttribute('role', 'radiogroup');
    segmented.setAttribute('aria-label', 'Matched-post action mode');

    function makeButton(value, label, tooltip) {
      var btn = document.createElement('button');
      var isActive = (mode === value);
      btn.type        = 'button';
      btn.className   = 'hu-segmented__btn' + (isActive ? ' hu-segmented__btn--active' : '');
      btn.title       = tooltip;
      btn.textContent = label;
      btn.setAttribute('role', 'radio');
      btn.setAttribute('aria-checked', isActive ? 'true' : 'false');
      btn.addEventListener('click', function () {
        if (!currentSettings || currentSettings.enabled === false) return;
        if (getHiddenItemMode(currentSettings) === value) return;
        setHiddenItemMode(currentSettings, value);
        persist(buildHiddenModeCard);
      });
      return btn;
    }

    segmented.appendChild(makeButton('audit',    'Audit',    'Keep matched posts visible with an amber outline + reason strip.'));
    segmented.appendChild(makeButton('minimize', 'Minimize', 'Collapse matched post bodies to a thin reason strip.'));
    segmented.appendChild(makeButton('hide',     'Hide',     'Remove matched posts from the feed entirely.'));
    ui.controls.appendChild(segmented);

    hiddenModeMount.innerHTML = '';
    hiddenModeMount.appendChild(ui.shell);
  }


})();
