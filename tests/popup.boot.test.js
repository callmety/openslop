/**
 * @jest-environment jsdom
 */

// OpenSlop — Popup boot smoke tests (minimal, post-strip-down)
//
// The popup surface is now: Home tab (AI filter toggle + slop slider) +
// Donut tab (chart + legend). This file asserts the boot path renders both
// tabs and that the dock contains exactly those two buttons.

const fs   = require('fs');
const path = require('path');

function readSrc(relPath) {
  return fs.readFileSync(path.join(__dirname, '..', relPath), 'utf8');
}

function flushPromises() {
  return new Promise(resolve => setTimeout(resolve, 0));
}

function evalInWindow(code) {
  window.eval(code);
}

function makeChrome() {
  const storage = {
    sync: {
      hu_settings: {
        _storageFormat: 2,
        version: 14,
        enabled: true,
        slopSensitivityLevel: 0,
        aiFilterEnabled: false,
        updatedAt: Date.now(),
      },
      hu_settings_blacklist: [],
    },
    local: {},
  };

  function makeArea(seed) {
    return {
      get(keys, cb) {
        const out = {};
        const list = Array.isArray(keys) ? keys : (keys ? [keys] : Object.keys(seed));
        list.forEach(k => { if (k in seed) out[k] = seed[k]; });
        cb(out);
      },
      set(items, cb) { Object.assign(seed, items); if (cb) cb(); },
      remove(keys, cb) {
        const list = Array.isArray(keys) ? keys : [keys];
        list.forEach(k => delete seed[k]);
        if (cb) cb();
      },
      clear(cb) { for (const k in seed) delete seed[k]; if (cb) cb(); },
    };
  }

  return {
    runtime: {
      lastError: null,
      getURL: (p) => p,
    },
    storage: {
      sync: makeArea(storage.sync),
      local: makeArea(storage.local),
      onChanged: { addListener: jest.fn() },
    },
  };
}

async function bootPopup() {
  const html = fs.readFileSync(path.join(__dirname, '..', 'popup', 'popup.html'), 'utf8');
  document.documentElement.innerHTML = html;
  window.chrome = makeChrome();

  evalInWindow(readSrc('shared/constants.js'));
  evalInWindow(readSrc('shared/normalize.js'));
  evalInWindow(readSrc('shared/storage.js'));
  evalInWindow(readSrc('shared/chrome-api.js'));
  evalInWindow(readSrc('shared/presets.js'));
  evalInWindow(readSrc('popup/popup.js'));

  await flushPromises();
  await flushPromises();
}

describe('OpenSlop popup boot', () => {
  test('boots without throwing', async () => {
    await bootPopup();
    expect(document.getElementById('panelTemp')).not.toBeNull();
  });

  test('there is no bottom tab dock', async () => {
    await bootPopup();
    expect(document.querySelector('.dock')).toBeNull();
    expect(document.querySelectorAll('.dock__tab').length).toBe(0);
  });

  test('single pane contains AI filter, slop slider, and donut', async () => {
    await bootPopup();
    const pane = document.getElementById('panelTemp');
    expect(pane).not.toBeNull();
    expect(pane.querySelector('#aiFilterMount')).not.toBeNull();
    expect(pane.querySelector('#slopSensitivityMount')).not.toBeNull();
    expect(pane.querySelector('#donutSvg')).not.toBeNull();
    expect(pane.querySelector('#donutLegend')).not.toBeNull();
  });

});
