/**
 * @jest-environment jsdom
 */

// Accessibility audit of popup.html static structure using axe-core.
// Tests the initial HTML as rendered before popup.js executes —
// this covers all structural/semantic rules (roles, labels, landmarks, headings).
// Color contrast is skipped: jsdom has no layout engine, so contrast checks
// require a real browser; the dark-theme CSS is intentionally high-contrast.

const { axe, toHaveNoViolations } = require('jest-axe');
const fs   = require('fs');
const path = require('path');

expect.extend(toHaveNoViolations);

let html;

beforeAll(() => {
  const htmlPath = path.join(__dirname, '..', 'popup', 'popup.html');
  html = fs.readFileSync(htmlPath, 'utf8');
});

function readSrc(relPath) {
  return fs.readFileSync(path.join(__dirname, '..', relPath), 'utf8');
}

function evalInWindow(code) {
  window.eval(code);
}

function flushPromises() {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

function makeChromeStub() {
  const syncStore = {
    hu_settings: {
      _storageFormat: 2,
      version: 14,
      enabled: true,
      slopSensitivityLevel: 0,
      aiFilterEnabled: false,
      seriousModeEnabled: false,
      updatedAt: Date.now(),
    },
    hu_settings_blacklist: ['seed-term'],
    hu_settings_preset_state: {},
  };

  return {
    storage: {
      sync: {
        get: jest.fn((keys, cb) => {
          const out = {};
          const keyList = Array.isArray(keys) ? keys : [keys];
          for (let i = 0; i < keyList.length; i++) {
            if (Object.prototype.hasOwnProperty.call(syncStore, keyList[i])) {
              out[keyList[i]] = syncStore[keyList[i]];
            }
          }
          cb(out);
        }),
        set: jest.fn((_payload, cb) => { if (cb) cb(); }),
      },
      local: {
        get: jest.fn((_key, cb) => cb({})),
        set: jest.fn((_payload, cb) => { if (cb) cb(); }),
      },
      onChanged: { addListener: jest.fn() },
    },
    runtime: {
      lastError: null,
      getURL: jest.fn((p) => 'chrome-extension://test-id/' + p),
      onMessage: { addListener: jest.fn() },
    },
  };
}

async function bootPopup() {
  document.documentElement.innerHTML = html;
  window.chrome = makeChromeStub();

  evalInWindow(readSrc('shared/constants.js'));
  evalInWindow(readSrc('shared/normalize.js'));
  evalInWindow(readSrc('shared/storage.js'));
  evalInWindow(readSrc('shared/chrome-api.js'));
  evalInWindow(readSrc('shared/presets.js'));
  evalInWindow(readSrc('popup/popup.js'));

  await flushPromises();
  await flushPromises();
}

test('popup.html has no axe accessibility violations (static structure)', async () => {
  document.documentElement.innerHTML = html;

  const results = await axe(document.body, {
    rules: {
      // jsdom cannot compute CSS color values — skip contrast check.
      // The popup uses a dark theme with intentionally high-contrast text.
      'color-contrast': { enabled: false },
    },
  });

  expect(results).toHaveNoViolations();
});

test('booted popup has no axe accessibility violations', async () => {
  await bootPopup();

  const results = await axe(document.body, {
    rules: {
      'color-contrast': { enabled: false },
    },
  });

  expect(results).toHaveNoViolations();
});

