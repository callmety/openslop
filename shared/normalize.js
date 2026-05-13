// OpenSlop — Text Normalization Utilities
// ─────────────────────────────────────────────────────────────────────────────
// All text extracted from the DOM passes through here before matching.
// Keeps comparisons consistent regardless of encoding, whitespace, or case.
// ─────────────────────────────────────────────────────────────────────────────

/* exported normalizeText, escapeRegex, canonicalizeBlacklistTerm */

/**
 * Normalize a string for consistent, case-insensitive comparison.
 *
 * Steps:
 *   1. NFKC Unicode normalization (e.g., ﬁ → fi, ½ → 1/2)
 *   2. Fold smart apostrophes, quotes, and dash variants to ASCII equivalents
 *   3. Strip zero-width and invisible formatting characters injected by the host
 *   4. Collapse all whitespace sequences to a single space
 *   5. Trim and lowercase
 *
 * @param {string} str
 * @returns {string}
 */
function normalizeText(str) {
  if (!str || typeof str !== 'string') return '';

  return str
    .normalize('NFKC')
    // Fold curly/smart apostrophes and single-quote variants → straight apostrophe
    .replace(/[‘’‚‛′‵ʻʼ]/g, "'")
    // Fold curly/smart double-quote variants → straight double quote
    .replace(/[“”„‟″‶]/g, '"')
    // Fold en/em dashes and other dash variants → hyphen-minus
    .replace(/[‐‑‒–—―−]/g, '-')
    // Strip invisible formatting chars the host and mobile keyboards inject
    .replace(/[­͏​-‏‪-‮⁠-⁩﻿]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

/**
 * Escape all regex metacharacters in a string so it can be embedded
 * safely inside a RegExp constructor.
 *
 * @param {string} str
 * @returns {string}
 */
function escapeRegex(str) {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Produce a canonical deduplication key for a blacklist term.
 * The key is the term's normalized lowercase text; two raw strings that
 * normalize to the same value share a canonical key and are treated as
 * duplicates by compileBlacklist().
 *
 * @param {string} raw
 * @returns {string}
 */
function canonicalizeBlacklistTerm(raw) {
  return normalizeText(raw);
}
