// OpenSlop — Blacklist Matcher
// ─────────────────────────────────────────────────────────────────────────────
// Compiles a blacklist array into an optimized in-memory matcher.
//
// Matching semantics:
//   • Hashtag terms (starting with #):
//       "#aislop" matches "#AISlop" but NOT "#aisloppy"
//   • Plain phrases:
//       "ai slop" matches "this is AI Slop!" but NOT "paid"
//       Whitespace in terms flexibly matches any whitespace sequence in text.
//
// All comparisons are Unicode-aware and case-insensitive (iu flags).
// ─────────────────────────────────────────────────────────────────────────────

/* global normalizeText, escapeRegex, canonicalizeBlacklistTerm */
/* exported compileBlacklist */

// ── Exact-match regex builder ─────────────────────────────────────────────────

/**
 * Compile one normalized blacklist term into a boundary-aware RegExp.
 *
 * @param  {string} normalizedTerm  Already normalized via normalizeText()
 * @returns {RegExp|null}
 */
function buildTermRegex(normalizedTerm) {
  if (!normalizedTerm) return null;

  // Escape special regex chars, then allow flexible whitespace matching
  var escaped = escapeRegex(normalizedTerm).replace(/\s+/g, '\\s+');

  if (normalizedTerm.charAt(0) === '#') {
    // Hashtag: must be preceded by start-of-string or a non-word char,
    // and followed by end-of-string or a non-word char.
    // This prevents "#aislop" from matching inside "#aisloppy".
    return new RegExp(
      '(?:^|[^\\p{L}\\p{N}_])' + escaped + '(?=$|[^\\p{L}\\p{N}_])',
      'iu'
    );
  }

  // Plain phrase: word boundary on both sides.
  // The leading boundary also excludes '#' so phrases don't false-match inside hashtags.
  return new RegExp(
    '(?:^|[^\\p{L}\\p{N}_#])' + escaped + '(?=$|[^\\p{L}\\p{N}_])',
    'iu'
  );
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Compile an entire blacklist array into a single matcher object.
 * Call this once on boot and again whenever the blacklist changes.
 *
 * @param  {string[]} blacklist  Raw user-entered terms from storage
 * @returns {{ matches: function(string): boolean, firstMatch: function(string): string|null, isEmpty: boolean }}
 */
function compileBlacklist(blacklist) {
  if (!Array.isArray(blacklist) || blacklist.length === 0) {
    return {
      isEmpty:     true,
      matches:     function () { return false; },
      firstMatch:  function () { return null; },
    };
  }

  // Deduplicate using canonical keys.
  var seen       = {};
  var plainTerms = [];   // normalized term strings
  var plainRaws  = [];   // original raw term strings, parallel to plainTerms

  for (var i = 0; i < blacklist.length; i++) {
    var raw = blacklist[i];
    if (!raw || typeof raw !== 'string') continue;
    var key = canonicalizeBlacklistTerm(raw);
    if (!key || seen[key]) continue;
    seen[key] = true;

    var n = normalizeText(raw);
    if (n) { plainTerms.push(n); plainRaws.push(raw); }
  }

  // Compile exact regexes per plain term.
  // Parallel arrays: regexes[j] was compiled from plainRaws[j].
  var regexes   = [];
  var regexRaws = [];
  for (var j = 0; j < plainTerms.length; j++) {
    var re = buildTermRegex(plainTerms[j]);
    if (re) { regexes.push(re); regexRaws.push(plainRaws[j]); }
  }

  if (regexes.length === 0) {
    return {
      isEmpty:     true,
      matches:     function () { return false; },
      firstMatch:  function () { return null; },
    };
  }

  return {
    isEmpty: false,

    /**
     * Test raw DOM text against all compiled patterns.
     *
     * @param  {string} rawText
     * @returns {boolean}
     */
    matches: function (rawText) {
      if (!rawText) return false;
      var normalizedLower = normalizeText(rawText);
      for (var k = 0; k < regexes.length; k++) {
        if (regexes[k].test(normalizedLower)) return true;
      }
      return false;
    },

    /**
     * Return the raw term string that first matched, or null if no match.
     * Used to populate the `data-hu-slop-trigger` attribute for inspection
     * and to surface in the popup's session donut tooltips.
     *
     * @param  {string} rawText
     * @returns {string|null}
     */
    firstMatch: function (rawText) {
      if (!rawText) return null;
      var normalizedLower = normalizeText(rawText);
      for (var k = 0; k < regexes.length; k++) {
        if (regexes[k].test(normalizedLower)) return regexRaws[k];
      }
      return null;
    },
  };
}
