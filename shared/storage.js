// OpenSlop — Storage Utilities
// ─────────────────────────────────────────────────────────────────────────────
// Thin wrappers around chrome.storage.sync (settings) and
// chrome.storage.local (ephemeral UI state like active popup tab).
// All functions return Promises for clean async boot.
// ─────────────────────────────────────────────────────────────────────────────

/* global HU, HU_PRESETS,
          getPresetEnabledIds, getSliderManagedTermIdsAtLevel,
          canonicalizeBlacklistTerm */
/* exported getSettings, saveSettings, getFeedCounter, setFeedCounter, normalizeSettings, setSessionTally, getSessionTally, isSettingsSyncChange, watchSettingsChanges */

// ── Settings Normalizer ───────────────────────────────────────────────────────

/**
 * Normalize a raw slopSensitivityLevel value to an integer 0–4.
 * Non-numbers, strings, NaN, out-of-range values all become 0.
 *
 * @param {*} value
 * @returns {number}
 */
function normalizeSlopSensitivityLevel(value) {
  var n = Number(value);
  if (!isFinite(n)) return 0;
  n = Math.floor(n);
  if (n < 0 || n > 4) return 0;
  return n;
}

/**
 * Build lookup maps for preset term IDs and category IDs.
 * @returns {{ termById: Object, categoryById: Object }}
 */
function buildPresetLookups() {
  var termById = {};
  var categoryById = {};
  for (var i = 0; i < HU_PRESETS.length; i++) {
    var cat = HU_PRESETS[i];
    categoryById[cat.id] = cat;
    for (var j = 0; j < cat.terms.length; j++) {
      termById[cat.terms[j].id] = cat.terms[j];
    }
  }
  return { termById: termById, categoryById: categoryById };
}

/**
 * Canonicalize and dedupe a blacklist, preserving first-seen raw form.
 * @param {*} raw
 * @returns {string[]}
 */
function normalizeBlacklist(raw) {
  if (!Array.isArray(raw)) return [];
  var out = [];
  var seen = {};
  for (var i = 0; i < raw.length; i++) {
    if (typeof raw[i] !== 'string') continue;
    var canonical = canonicalizeBlacklistTermForStorage(raw[i]);
    if (!canonical || seen[canonical]) continue;
    seen[canonical] = true;
    out.push(raw[i]);
  }
  return out;
}

function canonicalizeBlacklistTermForStorage(raw) {
  if (typeof canonicalizeBlacklistTerm === 'function') {
    return canonicalizeBlacklistTerm(raw);
  }
  if (typeof raw !== 'string') return '';
  return raw.replace(/\s+/g, ' ').trim().toLowerCase();
}

/**
 * Add raw terms to blacklist when their canonical form is not already present.
 * Preserves existing raw entries and appends only net-new canonical terms.
 * @param {string[]} blacklist
 * @param {string[]} rawTerms
 * @returns {string[]}
 */
function appendTermsToBlacklistDedup(blacklist, rawTerms) {
  var out = Array.isArray(blacklist) ? blacklist.slice() : [];
  var seen = {};
  for (var i = 0; i < out.length; i++) {
    var c0 = canonicalizeBlacklistTermForStorage(out[i]);
    if (c0) seen[c0] = true;
  }
  for (var j = 0; j < rawTerms.length; j++) {
    if (typeof rawTerms[j] !== 'string') continue;
    var c = canonicalizeBlacklistTermForStorage(rawTerms[j]);
    if (!c || seen[c]) continue;
    seen[c] = true;
    out.push(rawTerms[j]);
  }
  return out;
}

/**
 * Return true if every ID in subset exists in superset set map.
 * @param {Object} subsetMap
 * @param {Object} supersetMap
 * @returns {boolean}
 */
function isSubsetMap(subsetMap, supersetMap) {
  var keys = Object.keys(subsetMap);
  for (var i = 0; i < keys.length; i++) {
    if (!supersetMap[keys[i]]) return false;
  }
  return true;
}

/**
 * Compare two string arrays for strict positional equality.
 *
 * @param {*} a
 * @param {*} b
 * @returns {boolean}
 */
function areEqualStringArrays(a, b) {
  if (!Array.isArray(a) || !Array.isArray(b)) return false;
  if (a.length !== b.length) return false;
  for (var i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) return false;
  }
  return true;
}

/**
 * Compare two presetState-like maps semantically (key set + ordered IDs),
 * ignoring object insertion order differences.
 *
 * @param {*} a
 * @param {*} b
 * @returns {boolean}
 */
function areEqualPresetStateMaps(a, b) {
  if (!a || typeof a !== 'object' || Array.isArray(a)) return false;
  if (!b || typeof b !== 'object' || Array.isArray(b)) return false;

  var aKeys = Object.keys(a).sort();
  var bKeys = Object.keys(b).sort();
  if (aKeys.length !== bKeys.length) return false;

  for (var i = 0; i < aKeys.length; i++) {
    if (aKeys[i] !== bKeys[i]) return false;
    if (!areEqualStringArrays(a[aKeys[i]], b[bKeys[i]])) return false;
  }
  return true;
}

/**
 * One-time migration toward slider-first slop architecture.
 *
 * Rules:
 * 1) Every category's enabled term IDs fold into the slider/blacklist (the
 *    popup has no surface to write presetState, so this is just a one-way
 *    drain of legacy storage).
 * 2) Slider-managed preset IDs map to the highest cumulative slider level
 *    whose term-ID set is fully contained in the enabled IDs.
 * 3) Any remaining enabled terms are migrated to blacklist so user intent
 *    is preserved exactly.
 * 4) Legacy aiSlopThreshold is mapped to a minimum slider level, then reset.
 *
 * Idempotent via settingsVersion gate.
 *
 * @param {object} settings
 * @returns {{ changed: boolean, migratedTermCount: number }}
 */
function migrateSliderAuthority(settings) {
  if (!settings || typeof settings !== 'object') return { changed: false, migratedTermCount: 0 };

  if (!Array.isArray(HU_PRESETS) ||
      typeof getPresetEnabledIds !== 'function' ||
      typeof getSliderManagedTermIdsAtLevel !== 'function') {
    return { changed: false, migratedTermCount: 0 };
  }

  var targetVersion = HU.DEFAULT_SETTINGS.version;
  var oldLevel = normalizeSlopSensitivityLevel(settings.slopSensitivityLevel);
  var oldBlacklist = normalizeBlacklist(settings.blacklist);
  var oldPresetState = (settings.presetState && typeof settings.presetState === 'object')
    ? settings.presetState
    : {};

  var lookups = buildPresetLookups();
  var termById = lookups.termById;

  var sliderEnabledIdSet = {};

  for (var ci = 0; ci < HU_PRESETS.length; ci++) {
    var cat = HU_PRESETS[ci];
    var enabledIds = getPresetEnabledIds(settings, cat.id);
    for (var ei = 0; ei < enabledIds.length; ei++) {
      sliderEnabledIdSet[enabledIds[ei]] = true;
    }
  }

  // Highest cumulative slider level fully represented by enabled IDs.
  var mappedLevel = 0;
  for (var level = 1; level <= 4; level++) {
    var idsAtLevel = getSliderManagedTermIdsAtLevel(level);
    var requiredSet = {};
    for (var li = 0; li < idsAtLevel.length; li++) {
      requiredSet[idsAtLevel[li]] = true;
    }
    if (isSubsetMap(requiredSet, sliderEnabledIdSet)) mappedLevel = level;
  }

  // Remaining slider-managed IDs after taking the mapped cumulative level.
  var mappedSet = {};
  var mappedIds = getSliderManagedTermIdsAtLevel(mappedLevel);
  for (var mi = 0; mi < mappedIds.length; mi++) {
    mappedSet[mappedIds[mi]] = true;
  }

  var spilloverTerms = [];
  var sliderEnabledIds = Object.keys(sliderEnabledIdSet);
  for (var si = 0; si < sliderEnabledIds.length; si++) {
    var termId = sliderEnabledIds[si];
    if (mappedSet[termId]) continue;
    var termObj = termById[termId];
    if (termObj && typeof termObj.text === 'string') {
      spilloverTerms.push(termObj.text);
    }
  }

  var nextLevel = Math.max(oldLevel, mappedLevel);
  var nextBlacklist = appendTermsToBlacklistDedup(oldBlacklist, spilloverTerms);

  settings.slopSensitivityLevel = nextLevel;
  settings.blacklist = nextBlacklist;
  settings.presetState = {};
  settings.version = targetVersion;

  var changed = false;
  if (oldLevel !== nextLevel) changed = true;
  if (!areEqualPresetStateMaps(oldPresetState, {})) changed = true;
  if (oldBlacklist.length !== nextBlacklist.length) {
    changed = true;
  } else {
    for (var bi = 0; bi < oldBlacklist.length; bi++) {
      if (oldBlacklist[bi] !== nextBlacklist[bi]) {
        changed = true;
        break;
      }
    }
  }

  return { changed: changed, migratedTermCount: spilloverTerms.length };
}

/**
 * Deep-normalize a raw stored settings blob into a complete, safe settings
 * object. Handles first-install (no stored data), partial migrations, and
 * nested-object shallow-merge issues. Always returns fully populated defaults
 * for any missing key — including new keys added after a user's initial install.
 *
 * @param {*} stored  Raw value from chrome.storage.sync (may be anything)
 * @returns {{ version: number, enabled: boolean, blacklist: string[], presetState: object, uiFilters: object, updatedAt: number }}
 */
function normalizeSettings(stored) {
  if (!stored || typeof stored !== 'object' || Array.isArray(stored)) {
    stored = {};
  }

  var isPlainObj = function (v) {
    return v && typeof v === 'object' && !Array.isArray(v);
  };

  return {
    version:          (function () {
      var sv = typeof stored.version === 'number' ? stored.version : 0;
      return sv < HU.DEFAULT_SETTINGS.version ? HU.DEFAULT_SETTINGS.version : sv;
    }()),
    enabled:          stored.enabled !== false,
    blacklist:        Array.isArray(stored.blacklist) ? stored.blacklist.slice() : [],
    presetState:      isPlainObj(stored.presetState) ? Object.assign({}, stored.presetState) : {},
    // Missing field → DEFAULT_SETTINGS (fresh install gets the new default).
    // Present field → normalize/coerce the user's stored preference as-is.
    slopSensitivityLevel: (stored.slopSensitivityLevel === undefined)
      ? HU.DEFAULT_SETTINGS.slopSensitivityLevel
      : normalizeSlopSensitivityLevel(stored.slopSensitivityLevel),
    aiFilterEnabled: (typeof stored.aiFilterEnabled === 'boolean')
      ? stored.aiFilterEnabled
      : HU.DEFAULT_SETTINGS.aiFilterEnabled,
    seriousModeEnabled: stored.seriousModeEnabled === true,
    uiFilters:      normalizeUiFilters(stored.uiFilters),
    updatedAt:      typeof stored.updatedAt === 'number' ? stored.updatedAt : 0,
  };
}

// ── UI Filter Normalizer ──────────────────────────────────────────────────────
// Only four flags survive the post-card-only product surface:
//   auditMode, dimMode, showHiddenReasons → hidden-item presentation
//   showFeedCounter                       → live capsule visibility

function normalizeUiFilters(raw) {
  var src = (raw && typeof raw === 'object' && !Array.isArray(raw)) ? raw : {};
  return {
    // Minimize is the default hidden-item mode: collapse the card and show
    // the reason strip. Users can pick Audit or Hide explicitly.
    dimMode:           Object.prototype.hasOwnProperty.call(src, 'dimMode')
                         ? src.dimMode === true
                         : !(src.auditMode === true),
    auditMode:         src.auditMode         === true,
    showHiddenReasons: src.showHiddenReasons === true,
    showFeedCounter:   src.showFeedCounter   === true,
  };
}

function isSettingsSyncChange(changes, area) {
  if (area !== 'sync' || !changes || typeof changes !== 'object') return false;
  var splitKeys = HU.SETTINGS_SYNC_KEYS || [];
  for (var i = 0; i < splitKeys.length; i++) {
    if (Object.prototype.hasOwnProperty.call(changes, splitKeys[i])) return true;
  }
  return false;
}

function watchSettingsChanges(onSettings) {
  if (typeof onSettings !== 'function') return function () {};

  var listener = function (changes, area) {
    if (!isSettingsSyncChange(changes, area)) return;
    getSettings().then(function (settings) {
      onSettings(settings, changes, area);
    });
  };

  chrome.storage.onChanged.addListener(listener);
  return function stopWatch() {
    if (!chrome.storage || !chrome.storage.onChanged || !chrome.storage.onChanged.removeListener) return;
    chrome.storage.onChanged.removeListener(listener);
  };
}

// ── Sync Settings ─────────────────────────────────────────────────────────────

// Legacy sync key used before the LCF → HU namespace rename.
// getSettings() auto-migrates this key to HU.STORAGE_KEY on first read.
var LEGACY_SETTINGS_STORAGE_KEY = 'lcf_settings';

/**
 * Load persisted settings from sync storage, deep-merged with defaults.
 * Handles format 2 (split-key), legacy monolithic hu_settings, and the
 * even-older lcf_settings key. Safe to call on first install.
 *
 * Format 2 (current): hu_settings holds only core scalars; large arrays and
 * filter objects live in separate sync keys. Old monolithic blobs are
 * silently upgraded to format 2 on first read so the quota error can never
 * recur.
 *
 * @returns {Promise<{ version: number, enabled: boolean, blacklist: string[], presetState: object, uiFilters: object, updatedAt: number }>}
 */
function getSettings() {
  return new Promise(function (resolve) {
    var allSyncKeys = [LEGACY_SETTINGS_STORAGE_KEY].concat(HU.SETTINGS_SYNC_KEYS);

    chrome.storage.sync.get(allSyncKeys, function (result) {
      var modernRaw = result[HU.STORAGE_KEY];
      var legacyRaw = result[LEGACY_SETTINGS_STORAGE_KEY];

      // ── Path 1: already in split format 2 ───────────────────────────────────
      if (modernRaw && typeof modernRaw === 'object' && !Array.isArray(modernRaw) &&
          modernRaw._storageFormat === HU.SETTINGS_STORAGE_FORMAT) {

        var assembled = Object.assign({}, modernRaw);
        delete assembled._storageFormat;


        var splitFields = HU.SETTINGS_SPLIT_FIELD_MAP || [];
        for (var sf = 0; sf < splitFields.length; sf++) {
          assembled[splitFields[sf].field] = result[splitFields[sf].key];
        }

        var normalized = normalizeSettings(assembled);
        var migration = migrateSliderAuthority(normalized);
        if (!migration.changed) {
          resolve(normalized);
          return;
        }
        saveSettings(normalized).then(function () {
          resolve(normalized);
        });
        return;
      }

      // ── Path 2: old monolithic hu_settings blob — migrate to format 2 ───────
      if (modernRaw && typeof modernRaw === 'object' && !Array.isArray(modernRaw)) {
        var migrated2 = normalizeSettings(modernRaw);
        migrateSliderAuthority(migrated2);
        // Rewrite in split format so the quota error can never recur.
        saveSettings(migrated2).then(function () {
          resolve(migrated2);
        });
        return;
      }

      // ── Path 3: legacy lcf_settings blob — migrate once ──────────────────────
      if (legacyRaw && typeof legacyRaw === 'object' && !Array.isArray(legacyRaw)) {
        var migrated3 = normalizeSettings(legacyRaw);
        migrateSliderAuthority(migrated3);
        saveSettings(migrated3).then(function (saved) {
          if (saved === false) {
            // Keep legacy key until we successfully write split-format keys.
            resolve(migrated3);
            return;
          }
          if (!chrome.storage.sync.remove) {
            resolve(migrated3);
            return;
          }
          chrome.storage.sync.remove(LEGACY_SETTINGS_STORAGE_KEY, function () {
            resolve(migrated3);
          });
        });
        return;
      }

      // ── Path 4: first install — no data stored ───────────────────────────────
      var fresh = normalizeSettings({});
      migrateSliderAuthority(fresh);
      resolve(fresh);
    });
  });
}

/**
 * Persist a settings object to sync storage using the split-key format
 * (format 2) so no single chrome.storage.sync item approaches the 8,192-byte
 * per-item quota limit.
 *

 * hu_settings — small core scalars + uiFilters
 * hu_settings_blacklist — keyword/preset blacklist
 *
 * @param {{ version: number, blacklist: string[], presetState: object }} settings
 * @returns {Promise<boolean>}  true on successful sync write; false on runtime error
 */
function saveSettings(settings) {
  return new Promise(function (resolve) {
    settings = normalizeSettings(settings || {});

    var forSync = Object.assign({}, settings, { updatedAt: Date.now() });

    var payload = {};

    // Core key: scalars + uiFilters (~1-2 KB total, well under the 8 KB cap).
    payload[HU.STORAGE_KEY] = {
      _storageFormat:       HU.SETTINGS_STORAGE_FORMAT,
      version:              forSync.version,
      enabled:              forSync.enabled,
      slopSensitivityLevel: forSync.slopSensitivityLevel,
      aiFilterEnabled:      forSync.aiFilterEnabled,
      seriousModeEnabled:   forSync.seriousModeEnabled === true,
      uiFilters:            forSync.uiFilters || {},
      updatedAt:            forSync.updatedAt,
    };

    // Large array / object keys — one per field.
    var splitFieldMap = HU.SETTINGS_SPLIT_FIELD_MAP || [];
    for (var i = 0; i < splitFieldMap.length; i++) {
      var spec = splitFieldMap[i];
      var raw = forSync[spec.field];
      var defaultValue = spec.defaultValue;
      if (Array.isArray(defaultValue)) {
        payload[spec.key] = Array.isArray(raw) ? raw : [];
      } else {
        payload[spec.key] = (raw && typeof raw === 'object') ? raw : {};
      }
    }

    chrome.storage.sync.set(payload, function () {
      if (chrome.runtime.lastError) {
        if (typeof window !== 'undefined') {
          window.__HU_LAST_SAVE_ERROR = chrome.runtime.lastError.message;
        }
        // Resolve false (not reject) so callers can surface save errors without
        // breaking the existing fire-and-forget Promise chains.
        resolve(false);
        return;
      }
      resolve(true);
    });
  });
}

// ── Feed Counter ──────────────────────────────────────────────────────────────

/**
 * Write the session feed counter to local storage.
 * Called by the content script's debounced flush; fire-and-forget.
 *
 * @param {{ shown: number, hidden: number }} counter
 */
function setFeedCounter(counter) {
  var payload = {};
  payload[HU.FEED_COUNTER_KEY] = { shown: counter.shown, hidden: counter.hidden };
  chrome.storage.local.set(payload);
}

/**
 * Read the session feed counter from local storage.
 * Returns a Promise so the popup can await the value cleanly.
 *
 * @returns {Promise<{ shown: number, hidden: number } | null>}
 */
function getFeedCounter() {
  return new Promise(function (resolve) {
    chrome.storage.local.get(HU.FEED_COUNTER_KEY, function (result) {
      resolve(result[HU.FEED_COUNTER_KEY] || null);
    });
  });
}

// ── Session Tally (chrome.storage.local) ──────────────────────────────────────
// Live per-kind hidden count for the current browsing session.
// Written by the content script on every hide (debounced); read by the popup.

/**
 * Write the current session's per-kind tally to local storage.
 * @param {Object} tally  { [kind]: number }
 */
function setSessionTally(tally) {
  var payload = {};
  payload[HU.SESSION_TALLY_KEY] = tally;
  chrome.storage.local.set(payload);
}

/**
 * Read the current session's per-kind tally from local storage.
 * @returns {Promise<Object>}
 */
function getSessionTally() {
  return new Promise(function (resolve) {
    chrome.storage.local.get(HU.SESSION_TALLY_KEY, function (result) {
      resolve(result[HU.SESSION_TALLY_KEY] || {});
    });
  });
}



