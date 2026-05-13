const { loadPlainScript } = require('./load-plain-script');

if (!global.chrome) {
  global.chrome = {
    storage: {
      sync: { get: () => {}, set: () => {} },
      local: { get: () => {}, set: () => {} },
      onChanged: { addListener: () => {} },
    },
    runtime: { lastError: null },
  };
}

loadPlainScript('shared/constants.js');
loadPlainScript('shared/normalize.js');
loadPlainScript('shared/presets.js');
loadPlainScript('shared/storage.js');

/* global HU, normalizeSettings, saveSettings */

describe('schema contracts — split-key ownership', () => {
  test('settings sync keys remain aligned with split field map', () => {
    const fieldKeys = (HU.SETTINGS_SPLIT_FIELD_MAP || []).map(function (spec) {
      return spec.key;
    });
    const expected = [HU.STORAGE_KEY].concat(fieldKeys).sort();
    const actual = (HU.SETTINGS_SYNC_KEYS || []).slice().sort();
    expect(actual).toEqual(expected);
  });

  test('saveSettings writes every split field-map key exactly once', async () => {
    const syncSet = jest.fn(function (_payload, cb) {
      if (typeof cb === 'function') cb();
    });
    global.chrome.storage.sync.set = syncSet;
    global.chrome.runtime.lastError = null;

    const settings = normalizeSettings({
      blacklist: ['noise phrase'],
      presetState: { all: true },
    });

    const ok = await saveSettings(settings);
    expect(ok).toBe(true);
    expect(syncSet).toHaveBeenCalledTimes(1);

    const payload = syncSet.mock.calls[0][0];
    const splitMap = HU.SETTINGS_SPLIT_FIELD_MAP || [];
    for (let i = 0; i < splitMap.length; i++) {
      expect(Object.prototype.hasOwnProperty.call(payload, splitMap[i].key)).toBe(true);
    }
  });
});
