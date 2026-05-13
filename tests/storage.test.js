// Tests for normalizeSettings() / normalizeFeedFilters() in shared/storage.js.
// storage.js calls chrome.storage at runtime but not at parse time, so we can
// load it after stubbing `chrome` on global.

const { loadPlainScript } = require('./load-plain-script');

// ── Minimal chrome stub (parse-time safety only) ───────────────────────────
if (!global.chrome) {
  global.chrome = {
    storage: {
      sync: { get: () => {}, set: () => {} },
      local: { get: () => {}, set: () => {} },
      onChanged: { addListener: () => {}, removeListener: () => {} },
    },
    runtime: { lastError: null },
  };
}

// Load constants first (HU must exist before storage.js parses).
loadPlainScript('shared/constants.js');
loadPlainScript('shared/normalize.js');
loadPlainScript('shared/presets.js');
loadPlainScript('shared/storage.js');

/* global normalizeSettings,
          getFeedCounter, setFeedCounter,
          getSettings, getSliderManagedTermIdsAtLevel,
          HU_PRESETS,
          getSessionTally, setSessionTally,
          isSettingsSyncChange, watchSettingsChanges */

// ── normalizeSettings top-level ───────────────────────────────────────────────

describe('normalizeSettings()', () => {
  test('returns fully populated object from empty input', () => {
    const s = normalizeSettings({});
    expect(typeof s.uiFilters).toBe('object');
    expect(typeof s.presetState).toBe('object');
    expect(Array.isArray(s.blacklist)).toBe(true);
  });

  test('seriousModeEnabled defaults to false on fresh install', () => {
    expect(normalizeSettings({}).seriousModeEnabled).toBe(false);
  });

  test('seriousModeEnabled: true round-trips correctly', () => {
    expect(normalizeSettings({ seriousModeEnabled: true }).seriousModeEnabled).toBe(true);
  });

  test('seriousModeEnabled: non-boolean truthy coerces to false', () => {
    expect(normalizeSettings({ seriousModeEnabled: 1 }).seriousModeEnabled).toBe(false);
  });

  test('slopSensitivityLevel defaults to Scorched Earth (4) on fresh install', () => {
    expect(normalizeSettings({}).slopSensitivityLevel).toBe(4);
  });

  test('slopSensitivityLevel preserves an explicit 0 (existing user preference)', () => {
    expect(normalizeSettings({ slopSensitivityLevel: 0 }).slopSensitivityLevel).toBe(0);
  });

  test('slopSensitivityLevel preserves an explicit mid-range value', () => {
    expect(normalizeSettings({ slopSensitivityLevel: 2 }).slopSensitivityLevel).toBe(2);
  });

  test('aiFilterEnabled defaults to true on fresh install', () => {
    expect(normalizeSettings({}).aiFilterEnabled).toBe(true);
  });

  test('aiFilterEnabled preserves an explicit false (existing user preference)', () => {
    expect(normalizeSettings({ aiFilterEnabled: false }).aiFilterEnabled).toBe(false);
  });

  test('aiFilterEnabled: non-boolean truthy falls through to default (true)', () => {
    expect(normalizeSettings({ aiFilterEnabled: 1 }).aiFilterEnabled).toBe(true);
  });
});

// ── getSettings legacy-key migration ─────────────────────────────────────────

describe('getSettings() — legacy storage key migration', () => {
  let syncStore;
  let syncSet;
  let syncRemove;

  beforeEach(() => {
    syncStore = {};
    syncSet = jest.fn(function (payload, cb) {
      Object.assign(syncStore, payload);
      if (typeof cb === 'function') cb();
    });
    syncRemove = jest.fn(function (key, cb) {
      if (Array.isArray(key)) {
        key.forEach(function (k) { delete syncStore[k]; });
      } else {
        delete syncStore[key];
      }
      if (typeof cb === 'function') cb();
    });

    global.chrome.storage.sync.get = function (keys, cb) {
      var out = {};
      if (Array.isArray(keys)) {
        keys.forEach(function (k) {
          if (Object.prototype.hasOwnProperty.call(syncStore, k)) {
            out[k] = syncStore[k];
          }
        });
      } else if (typeof keys === 'string') {
        if (Object.prototype.hasOwnProperty.call(syncStore, keys)) {
          out[keys] = syncStore[keys];
        }
      }
      cb(out);
    };
    global.chrome.storage.sync.set = syncSet;
    global.chrome.storage.sync.remove = syncRemove;
  });

  afterEach(() => {
    global.chrome.storage.sync.get = () => {};
    global.chrome.storage.sync.set = () => {};
    global.chrome.storage.sync.remove = undefined;
  });

  test('migrates legacy lcf_settings to hu_settings when modern key is absent', async () => {
    syncStore.lcf_settings = {
      enabled: false,
      blacklist: ['legacy-term'],
    };

    const settings = await getSettings();

    expect(settings.enabled).toBe(false);
    expect(settings.blacklist).toEqual(['legacy-term']);

    // Format 2: saveSettings writes multiple split keys in one call.
    expect(syncSet).toHaveBeenCalledTimes(1);
    expect(syncStore.hu_settings).toBeDefined();
    expect(syncStore.hu_settings._storageFormat).toBe(2);
    expect(syncStore.hu_settings.updatedAt).toBeGreaterThan(0);
    expect(syncStore.hu_settings.seriousModeEnabled).toBe(false);
    // blacklist now lives in its own split key, not in hu_settings.
    expect(syncStore.hu_settings_blacklist).toEqual(['legacy-term']);

    expect(syncRemove).toHaveBeenCalledWith('lcf_settings', expect.any(Function));
    expect(Object.prototype.hasOwnProperty.call(syncStore, 'lcf_settings')).toBe(false);
  });

  test('modern hu_settings takes precedence when both keys exist', async () => {
    // Simulate an old monolithic blob (no _storageFormat) — Path 2 migrates it.
    syncStore.hu_settings = {
      enabled: true,
      blacklist: ['modern-term'],
    };
    syncStore.lcf_settings = {
      enabled: false,
      blacklist: ['legacy-term'],
    };

    const settings = await getSettings();

    expect(settings.enabled).toBe(true);
    expect(settings.blacklist).toEqual(['modern-term']);
    // Format 2 migration: saveSettings is called once to rewrite the monolithic blob.
    expect(syncSet).toHaveBeenCalledTimes(1);
    // lcf_settings is NOT touched — only the modern key triggers migration.
    expect(syncRemove).not.toHaveBeenCalled();
  });

  test('invalid legacy payload is ignored and defaults are returned', async () => {
    syncStore.lcf_settings = 'bad-legacy-shape';

    const settings = await getSettings();

    expect(settings.enabled).toBe(true);
    expect(Array.isArray(settings.blacklist)).toBe(true);
    expect(settings.blacklist).toHaveLength(0);
    expect(syncSet).not.toHaveBeenCalled();
    expect(syncRemove).not.toHaveBeenCalled();
  });

  test('legacy key is not removed when split-format migration write fails', async () => {
    syncStore.lcf_settings = {
      enabled: false,
      blacklist: ['legacy-term'],
    };

    global.chrome.storage.sync.set = jest.fn(function (_payload, cb) {
      global.chrome.runtime.lastError = { message: 'quota exceeded' };
      if (typeof cb === 'function') cb();
      global.chrome.runtime.lastError = null;
    });

    const errSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
    try {
      const settings = await getSettings();
      expect(settings.enabled).toBe(false);
      expect(settings.blacklist).toEqual(['legacy-term']);
      expect(syncRemove).not.toHaveBeenCalled();
      expect(Object.prototype.hasOwnProperty.call(syncStore, 'lcf_settings')).toBe(true);
    } finally {
      errSpy.mockRestore();
    }
  });
});

describe('getSettings() — slider authority migration', () => {
  let syncStore;
  let syncSet;

  beforeEach(() => {
    syncStore = {};
    syncSet = jest.fn(function (payload, cb) {
      Object.assign(syncStore, payload);
      if (typeof cb === 'function') cb();
    });

    global.chrome.storage.sync.get = function (keys, cb) {
      var out = {};
      var list = Array.isArray(keys) ? keys : [keys];
      for (var i = 0; i < list.length; i++) {
        if (Object.prototype.hasOwnProperty.call(syncStore, list[i])) {
          out[list[i]] = syncStore[list[i]];
        }
      }
      cb(out);
    };
    global.chrome.storage.sync.set = syncSet;
    global.chrome.storage.sync.remove = jest.fn(function (_key, cb) {
      if (typeof cb === 'function') cb();
    });
  });

  afterEach(() => {
    global.chrome.storage.sync.get = () => {};
    global.chrome.storage.sync.set = () => {};
    global.chrome.storage.sync.remove = undefined;
  });

  test('maps exact cumulative slider-managed preset set to level 2 and drains presetState', async () => {
    var level2Ids = getSliderManagedTermIdsAtLevel(2);
    var state = {};
    for (var i = 0; i < HU_PRESETS.length; i++) {
      var cat = HU_PRESETS[i];
      var ids = [];
      for (var j = 0; j < cat.terms.length; j++) {
        if (level2Ids.indexOf(cat.terms[j].id) !== -1) ids.push(cat.terms[j].id);
      }
      state[cat.id] = ids;
    }

    syncStore.hu_settings = {
      _storageFormat: 2,
      version: 1,
      slopSensitivityLevel: 0,
    };
    syncStore.hu_settings_blacklist = [];
    syncStore.hu_settings_preset_state = state;

    var settings = await getSettings();

    expect(settings.slopSensitivityLevel).toBe(2);
    expect(settings.presetState).toEqual({});
    expect(settings.blacklist).toEqual([]);
  });

  test('moves unmatched slider-managed legacy preset terms into blacklist', async () => {
    syncStore.hu_settings = {
      _storageFormat: 2,
      version: 1,
      slopSensitivityLevel: 0,
    };
    syncStore.hu_settings_blacklist = [' custom term '];
    syncStore.hu_settings_preset_state = {
      'corporate-speak': ['unlock-cross-functional-synergies'],
    };

    var settings = await getSettings();

    expect(settings.slopSensitivityLevel).toBe(0);
    expect(settings.blacklist).toContain(' custom term ');
    expect(settings.blacklist).toContain('unlock cross-functional synergies');
    expect(settings.presetState).toEqual({});
  });

  test('migration is idempotent once version is current', async () => {
    syncStore.hu_settings = {
      _storageFormat: 2,
      version: HU.DEFAULT_SETTINGS.version,
      slopSensitivityLevel: 2,
    };
    syncStore.hu_settings_blacklist = ['already-there'];
    syncStore.hu_settings_preset_state = {};

    var settings = await getSettings();

    expect(syncSet).not.toHaveBeenCalled();
    expect(settings.slopSensitivityLevel).toBe(2);
    expect(settings.blacklist).toEqual(['already-there']);
    expect(settings.presetState).toEqual({});
  });
});

// ── New feed filter boolean normalization ─────────────────────────────────────



// ── getFeedCounter / setFeedCounter ──────────────────────────────────────────

describe('getFeedCounter() / setFeedCounter()', () => {
  let stored = {};

  beforeEach(() => {
    stored = {};
    global.chrome.storage.local.set = (payload, cb) => {
      Object.assign(stored, payload);
      if (cb) cb();
    };
    global.chrome.storage.local.get = (key, cb) => {
      cb({ [key]: stored[key] });
    };
  });

  test('getFeedCounter returns null when no counter stored', async () => {
    expect(await getFeedCounter()).toBeNull();
  });

  test('setFeedCounter writes shown + hidden to local storage', () => {
    setFeedCounter({ shown: 12, hidden: 5 });
    /* global HU */
    expect(stored[HU.FEED_COUNTER_KEY]).toEqual({ shown: 12, hidden: 5 });
  });

  test('getFeedCounter reads back what setFeedCounter wrote', async () => {
    setFeedCounter({ shown: 7, hidden: 3 });
    const counter = await getFeedCounter();
    expect(counter).toEqual({ shown: 7, hidden: 3 });
  });

  test('getFeedCounter returns null for missing key (not undefined)', async () => {
    const counter = await getFeedCounter();
    expect(counter).toBeNull();
  });
});

// ── Local UI state helpers ───────────────────────────────────────────────────

// ── Session tally helpers ────────────────────────────────────────────────────

describe('getSessionTally() / setSessionTally()', () => {
  let localStore = {};

  beforeEach(() => {
    localStore = {};
    global.chrome.storage.local.get = (key, cb) => {
      cb({ [key]: localStore[key] });
    };
    global.chrome.storage.local.set = (obj, cb) => {
      Object.assign(localStore, obj);
      if (typeof cb === 'function') cb();
    };
  });

  afterEach(() => {
    global.chrome.storage.local.get = () => {};
    global.chrome.storage.local.set = () => {};
  });

  test('returns empty object when tally key is absent', async () => {
    expect(await getSessionTally()).toEqual({});
  });

  test('writes and reads per-kind tally', async () => {
    var tally = { post: 4, 'ai-filter': 2, 'ai-slop': 1 };
    setSessionTally(tally);
    expect(await getSessionTally()).toEqual(tally);
  });
});


// ── normalizeUiFilters() — direct ─────────────────────────────────────────────
// Only four flags survive the post-card-only product surface:
//   auditMode, dimMode, showHiddenReasons → hidden-item presentation
//   showFeedCounter                       → live capsule visibility

describe('normalizeUiFilters() — direct', () => {
  function uiFilters(raw) {
    return normalizeSettings({ uiFilters: raw }).uiFilters;
  }

  const KEEP_FLAGS = ['auditMode', 'dimMode', 'showHiddenReasons', 'showFeedCounter'];

  test('exactly the four post-card-only flags exist', () => {
    expect(Object.keys(uiFilters(undefined)).sort()).toEqual(KEEP_FLAGS.slice().sort());
  });

  test('dimMode defaults to true (Minimize is the default hidden-item mode)', () => {
    expect(uiFilters(undefined).dimMode).toBe(true);
  });

  test('dimMode: explicit false round-trips correctly (user picked Hide)', () => {
    expect(uiFilters({ dimMode: false }).dimMode).toBe(false);
  });

  test('dimMode: non-boolean truthy coerces to false', () => {
    expect(uiFilters({ dimMode: 1 }).dimMode).toBe(false);
  });

  test('auditMode defaults to false; dimMode flips to false when auditMode is set', () => {
    expect(uiFilters({ auditMode: true }).auditMode).toBe(true);
    expect(uiFilters({ auditMode: true }).dimMode).toBe(false);
  });

  ['showHiddenReasons', 'showFeedCounter'].forEach(flag => {
    test(`${flag} defaults to false`, () => {
      expect(uiFilters(undefined)[flag]).toBe(false);
    });
    test(`${flag}: true round-trips correctly`, () => {
      expect(uiFilters({ [flag]: true })[flag]).toBe(true);
    });
    test(`${flag}: non-boolean truthy coerces to false`, () => {
      expect(uiFilters({ [flag]: 1 })[flag]).toBe(false);
    });
  });

  test('removed legacy flags are dropped, not preserved', () => {
    const result = uiFilters({
      hideSidebarAds: true,
      hideMessagingShell: true,
      hidePremiumBanners: true,
      hideJobsPremium: true,
      focusMode: true,
    });
    expect(result.hideSidebarAds).toBeUndefined();
    expect(result.hideMessagingShell).toBeUndefined();
    expect(result.hidePremiumBanners).toBeUndefined();
    expect(result.focusMode).toBeUndefined();
  });
});




// ── normalizeSettings() — version migration ───────────────────────────────────

describe('normalizeSettings() — version migration', () => {
  test('defaults to current version on fresh install', () => {
    expect(normalizeSettings({}).version).toBe(HU.DEFAULT_SETTINGS.version);
  });

  test('upgrades old version to current version', () => {
    expect(normalizeSettings({ version: 10 }).version).toBe(HU.DEFAULT_SETTINGS.version);
  });

  test('keeps version if already at current', () => {
    expect(normalizeSettings({ version: HU.DEFAULT_SETTINGS.version }).version).toBe(HU.DEFAULT_SETTINGS.version);
  });

  test('does not downgrade a higher stored version', () => {
    const future = HU.DEFAULT_SETTINGS.version + 1;
    expect(normalizeSettings({ version: future }).version).toBe(future);
  });
});

// ── Item 25: Notification feed filter keys ────────────────────────────────────


// ── saveSettings split-format contract ───────────────────────────────────────

describe('saveSettings() — split-format payload contract', () => {
  let syncSet;

  function fullSettingsShape() {
    return normalizeSettings({
      enabled: false,
      slopSensitivityLevel: 2,
      aiFilterEnabled: true,
      seriousModeEnabled: true,
      blacklist: ['noise phrase'],
      presetState: { all: true },
      uiFilters: { auditMode: true },
    });
  }

  beforeEach(() => {
    syncSet = jest.fn(function (_payload, cb) {
      if (typeof cb === 'function') cb();
    });
    global.chrome.storage.sync.set = syncSet;
    global.chrome.runtime.lastError = null;
  });

  afterEach(() => {
    global.chrome.storage.sync.set = () => {};
    global.chrome.runtime.lastError = null;
  });

  test('writes all expected split sync keys with format-2 core payload', async () => {
    var settings = fullSettingsShape();
    var ok = await saveSettings(settings);
    expect(ok).toBe(true);
    expect(syncSet).toHaveBeenCalledTimes(1);

    var payload = syncSet.mock.calls[0][0];
    expect(Object.keys(payload).sort()).toEqual(HU.SETTINGS_SYNC_KEYS.slice().sort());
    expect(payload.hu_settings._storageFormat).toBe(2);
    expect(payload.hu_settings.enabled).toBe(false);
    expect(payload.hu_settings.updatedAt).toBeGreaterThan(0);
    expect(payload.hu_settings.uiFilters.auditMode).toBe(true);
    expect(payload.hu_settings_blacklist).toEqual(['noise phrase']);
  });

  test('split field map contract remains aligned with expected payload keys', async () => {
    await saveSettings(fullSettingsShape());
    var payload = syncSet.mock.calls[0][0];
    var fieldKeys = HU.SETTINGS_SPLIT_FIELD_MAP.map(function (s) { return s.key; }).sort();
    expect(fieldKeys).toEqual([
      'hu_settings_blacklist',
      'hu_settings_preset_state',
    ]);
    expect(fieldKeys.every(function (k) { return Object.prototype.hasOwnProperty.call(payload, k); })).toBe(true);

    var syncKeys = HU.SETTINGS_SYNC_KEYS.slice().sort();
    var requiredKeys = ['hu_settings'].concat(fieldKeys).sort();
    expect(syncKeys).toEqual(requiredKeys);
  });

  test('resolves false when chrome.runtime.lastError is set by sync write', async () => {
    syncSet = jest.fn(function (_payload, cb) {
      global.chrome.runtime.lastError = { message: 'quota exceeded' };
      if (typeof cb === 'function') cb();
      global.chrome.runtime.lastError = null;
    });
    global.chrome.storage.sync.set = syncSet;

    var errSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
    try {
      var ok = await saveSettings(fullSettingsShape());
      expect(ok).toBe(false);
      expect(syncSet).toHaveBeenCalledTimes(1);
    } finally {
      errSpy.mockRestore();
    }
  });
});

describe('settings sync watcher helpers', () => {
  test('isSettingsSyncChange detects split settings keys only', () => {
    expect(isSettingsSyncChange({ [HU.SETTINGS_BLACKLIST_KEY]: { newValue: [] } }, 'sync')).toBe(true);
    expect(isSettingsSyncChange({ [HU.STORAGE_KEY]: { newValue: {} } }, 'sync')).toBe(true);
    expect(isSettingsSyncChange({ unrelated: { newValue: {} } }, 'sync')).toBe(false);
    expect(isSettingsSyncChange({ [HU.STORAGE_KEY]: { newValue: {} } }, 'local')).toBe(false);
  });

  test('watchSettingsChanges reassembles settings via getSettings on sync change', async () => {
    var listeners = [];
    var removeListener = jest.fn(function (fn) {
      listeners = listeners.filter(function (l) { return l !== fn; });
    });

    global.chrome.storage.onChanged.addListener = jest.fn(function (fn) {
      listeners.push(fn);
    });
    global.chrome.storage.onChanged.removeListener = removeListener;
    global.chrome.storage.sync.set = jest.fn(function (_payload, cb) {
      if (typeof cb === 'function') cb();
    });

    var syncStore = {};
    syncStore[HU.STORAGE_KEY] = {
      _storageFormat: HU.SETTINGS_STORAGE_FORMAT,
      version: HU.DEFAULT_SETTINGS.version,
      enabled: true,
      slopSensitivityLevel: 3,
      aiFilterEnabled: false,
      seriousModeEnabled: false,
      uiFilters: { auditMode: true, dimMode: false },
      updatedAt: Date.now(),
    };
    syncStore[HU.SETTINGS_BLACKLIST_KEY] = [];
    syncStore[HU.SETTINGS_PRESET_STATE_KEY] = {};

    global.chrome.storage.sync.get = jest.fn(function (keys, cb) {
      var out = {};
      var list = Array.isArray(keys) ? keys : [keys];
      for (var i = 0; i < list.length; i++) {
        if (Object.prototype.hasOwnProperty.call(syncStore, list[i])) {
          out[list[i]] = syncStore[list[i]];
        }
      }
      cb(out);
    });

    var onSettings = jest.fn();
    var stop = watchSettingsChanges(onSettings);
    expect(typeof stop).toBe('function');
    expect(listeners.length).toBe(1);

    listeners[0]({ [HU.STORAGE_KEY]: { newValue: { touched: true } } }, 'sync');
    await Promise.resolve();
    await Promise.resolve();

    expect(onSettings).toHaveBeenCalledTimes(1);
    var received = onSettings.mock.calls[0][0];
    expect(received.uiFilters.auditMode).toBe(true);
    expect(received.uiFilters.dimMode).toBe(false);

    stop();
    expect(removeListener).toHaveBeenCalledTimes(1);
  });
});
