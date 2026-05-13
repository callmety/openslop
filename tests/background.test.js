// OpenSlop — Background service worker tests
//
// The background worker no longer handles any image-caching messages.
// These tests verify that the worker loads cleanly, registers its message
// listener, and silently ignores all message types (including legacy ones
// that may be sent by a cached content script in an older tab).

const { loadPlainScript } = require('./load-plain-script');

// ── Helpers ───────────────────────────────────────────────────────────────────

function setupBackground() {
  global._bgOnMessage = null;
  global.chrome = {
    runtime: {
      onStartup: {
        addListener: jest.fn(),
      },
      onInstalled: {
        addListener: jest.fn(),
      },
      onMessage: {
        addListener: jest.fn(function (fn) {
          global._bgOnMessage = fn;
        }),
      },
    },
    storage: {
      local: {
        get: jest.fn((key, cb) => {
          if (typeof cb === 'function') cb({ [key]: undefined });
        }),
        set: jest.fn(),
      },
    },
  };

  loadPlainScript('background.js');
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('background — service worker', () => {
  beforeEach(() => {
    jest.restoreAllMocks();
    setupBackground();
  });

  test('registers a message listener on load', () => {
    expect(global.chrome.runtime.onMessage.addListener).toHaveBeenCalledTimes(1);
    expect(typeof global._bgOnMessage).toBe('function');
  });

  test('seeds popup session id and registers startup/installed refresh hooks', () => {
    expect(global.chrome.storage.local.get).toHaveBeenCalledWith('hu_popup_session_id', expect.any(Function));
    expect(global.chrome.runtime.onStartup.addListener).toHaveBeenCalledTimes(1);
    expect(global.chrome.runtime.onInstalled.addListener).toHaveBeenCalledTimes(1);
    expect(global.chrome.storage.local.set).toHaveBeenCalledWith(expect.objectContaining({
      hu_popup_session_id: expect.any(String),
    }));
  });

  test('does not call sendResponse for unknown message types', () => {
    var called = false;
    global._bgOnMessage({ type: 'hu:unknown' }, {}, function () { called = true; });
    expect(called).toBe(false);
  });

  test('does not call sendResponse for legacy hu:cache-muted-avatar', () => {
    global.chrome.storage.local.set.mockClear();
    var called = false;
    global._bgOnMessage(
      { type: 'hu:cache-muted-avatar', payload: { entityKey: '/in/jane/', imageUrl: 'https://cdn.example.com/photo.jpg' } },
      {},
      function () { called = true; }
    );
    expect(called).toBe(false);
    expect(global.chrome.storage.local.set).not.toHaveBeenCalled();
  });

  test('does not call sendResponse for legacy hu:cache-own-avatar', () => {
    global.chrome.storage.local.set.mockClear();
    var called = false;
    global._bgOnMessage(
      { type: 'hu:cache-own-avatar', payload: { imageUrl: 'https://cdn.example.com/avatar.jpg' } },
      {},
      function () { called = true; }
    );
    expect(called).toBe(false);
    expect(global.chrome.storage.local.set).not.toHaveBeenCalled();
  });

  test('handles null message gracefully without throwing', () => {
    expect(() => {
      global._bgOnMessage(null, {}, function () {});
    }).not.toThrow();
  });
});
