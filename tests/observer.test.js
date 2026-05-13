// OpenSlop — Unit tests for content/observer.js
//
// Strategy: load observer.js into the global context after stubbing the browser
// APIs it needs (Node.TEXT_NODE, MutationObserver, location, HU constants).
// Fake timers give deterministic control over debounce / max-flush timing.

const { loadPlainScript } = require('./load-plain-script');

// ── Browser-API stubs ─────────────────────────────────────────────────────────

// Node.TEXT_NODE is 3 in all browsers.
if (!global.Node) global.Node = { TEXT_NODE: 3 };

// Minimal connected-element factory.
function makeEl(connected = true) {
  return {
    nodeType:    1,             // ELEMENT_NODE
    isConnected: connected,
    parentElement: null,
  };
}

// Minimal text-node factory whose parentElement is a connected element.
function makeTextNode(connected = true) {
  const el = makeEl(connected);
  return { nodeType: 3, parentElement: el, el };
}

// Track MutationObserver constructor calls so tests can simulate mutations.
let lastObserverCallback = null;
let lastObserveTarget    = null;
let lastObserveOptions   = null;
let disconnectCalled     = false;

global.MutationObserver = class MockMutationObserver {
  constructor(cb) { lastObserverCallback = cb; }
  observe(target, options) {
    lastObserveTarget  = target;
    lastObserveOptions = options;
  }
  disconnect() { disconnectCalled = true; }
};

// Stub location as a mutable object (jsdom / node both work).
if (!global.location) global.location = { href: 'https://www.linkedin.com/feed/' };

// Stub document.body (only used by observer.start()).
if (!global.document) global.document = {};
if (!global.document.body) global.document.body = makeEl();

// Load HU constants (contains HU.SCAN.*) then observer.js.
// HU may already be in global from a prior test file; re-load is idempotent.
loadPlainScript('shared/constants.js');
loadPlainScript('content/observer.js');

/* global createObserver */

// ── Helpers ───────────────────────────────────────────────────────────────────

function triggerMutations(mutations) {
  lastObserverCallback(mutations, null);
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('createObserver() — debounce behaviour', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    global.location.href = 'https://www.linkedin.com/feed/';
  });

  afterEach(() => {
    jest.runAllTimers();
    jest.useRealTimers();
  });

  test('flush is not called synchronously on mutation', () => {
    const onFlush = jest.fn();
    createObserver(onFlush).start();

    triggerMutations([{ target: makeEl(), addedNodes: [] }]);

    expect(onFlush).not.toHaveBeenCalled();
  });

  test('flush fires after DEBOUNCE_MS with no further mutations', () => {
    /* global HU */
    const onFlush = jest.fn();
    createObserver(onFlush).start();

    triggerMutations([{ target: makeEl(), addedNodes: [] }]);
    jest.advanceTimersByTime(HU.SCAN.DEBOUNCE_MS);

    expect(onFlush).toHaveBeenCalledTimes(1);
  });

  test('rapid mutations reset the debounce — flush waits until mutations settle', () => {
    const onFlush = jest.fn();
    createObserver(onFlush).start();

    // Trigger mutations with gaps shorter than DEBOUNCE_MS so each resets the timer.
    // Keep total elapsed well under MAX_FLUSH_MS so the max cap does not fire.
    const gap = Math.floor(HU.SCAN.DEBOUNCE_MS / 2);
    triggerMutations([{ target: makeEl(), addedNodes: [] }]);
    jest.advanceTimersByTime(gap);
    triggerMutations([{ target: makeEl(), addedNodes: [] }]);
    jest.advanceTimersByTime(gap);
    triggerMutations([{ target: makeEl(), addedNodes: [] }]);

    // No flush yet — debounce keeps getting reset.
    expect(onFlush).not.toHaveBeenCalled();

    // Let the debounce settle.
    jest.advanceTimersByTime(HU.SCAN.DEBOUNCE_MS);
    expect(onFlush).toHaveBeenCalledTimes(1);
  });
});

describe('createObserver() — max-flush hard cap', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    global.location.href = 'https://www.linkedin.com/feed/';
  });

  afterEach(() => {
    jest.runAllTimers();
    jest.useRealTimers();
  });

  test('flush fires at MAX_FLUSH_MS even when mutations keep arriving', () => {
    const onFlush = jest.fn();
    createObserver(onFlush).start();

    // Trigger a mutation, then keep re-triggering before debounce fires.
    triggerMutations([{ target: makeEl(), addedNodes: [] }]);
    // Advance just past MAX_FLUSH_MS (without reaching a full DEBOUNCE gap).
    jest.advanceTimersByTime(HU.SCAN.MAX_FLUSH_MS + 1);

    expect(onFlush).toHaveBeenCalledTimes(1);
  });

  test('max timer is armed only once per flush cycle', () => {
    const onFlush = jest.fn();
    createObserver(onFlush).start();

    triggerMutations([{ target: makeEl(), addedNodes: [] }]);
    triggerMutations([{ target: makeEl(), addedNodes: [] }]);
    triggerMutations([{ target: makeEl(), addedNodes: [] }]);

    // Only one flush should happen when max fires.
    jest.advanceTimersByTime(HU.SCAN.MAX_FLUSH_MS + 1);
    expect(onFlush).toHaveBeenCalledTimes(1);
  });
});

describe('createObserver() — SPA URL-change detection', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    global.location.href = 'https://www.linkedin.com/feed/';
  });

  afterEach(() => {
    jest.runAllTimers();
    jest.useRealTimers();
  });

  test('flush with fullScan=true when location.href changes between mutations and flush', () => {
    const onFlush = jest.fn();
    createObserver(onFlush).start();

    triggerMutations([{ target: makeEl(), addedNodes: [] }]);

    // Simulate LinkedIn SPA navigation before the debounce fires.
    global.location.href = 'https://www.linkedin.com/in/someone/';
    jest.advanceTimersByTime(HU.SCAN.DEBOUNCE_MS);

    expect(onFlush).toHaveBeenCalledTimes(1);
    expect(onFlush).toHaveBeenCalledWith({ fullScan: true, roots: [] });
  });

  test('subsequent flush after URL change is NOT a full scan if URL stable', () => {
    const onFlush = jest.fn();
    createObserver(onFlush).start();

    // First flush: URL change → fullScan.
    triggerMutations([{ target: makeEl(), addedNodes: [] }]);
    global.location.href = 'https://www.linkedin.com/in/someone/';
    jest.advanceTimersByTime(HU.SCAN.DEBOUNCE_MS);

    // Second flush: same URL, few dirty roots → partial scan.
    triggerMutations([{ target: makeEl(), addedNodes: [] }]);
    jest.advanceTimersByTime(HU.SCAN.DEBOUNCE_MS);

    expect(onFlush).toHaveBeenCalledTimes(2);
    expect(onFlush.mock.calls[1][0].fullScan).toBe(false);
  });
});

describe('createObserver() — fullScan threshold', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    global.location.href = 'https://www.linkedin.com/feed/';
  });

  afterEach(() => {
    jest.runAllTimers();
    jest.useRealTimers();
  });

  test('fullScan=false when dirty roots are below threshold', () => {
    const onFlush = jest.fn();
    createObserver(onFlush).start();

    const mutations = [];
    for (let i = 0; i < HU.SCAN.DIRTY_ROOTS_FULL_SCAN_THRESHOLD; i++) {
      mutations.push({ target: makeEl(), addedNodes: [] });
    }
    triggerMutations(mutations);
    jest.advanceTimersByTime(HU.SCAN.DEBOUNCE_MS);

    expect(onFlush).toHaveBeenCalledTimes(1);
    expect(onFlush.mock.calls[0][0].fullScan).toBe(false);
  });

  test('fullScan=true when dirty roots exceed threshold', () => {
    const onFlush = jest.fn();
    createObserver(onFlush).start();

    const mutations = [];
    for (let i = 0; i < HU.SCAN.DIRTY_ROOTS_FULL_SCAN_THRESHOLD + 1; i++) {
      mutations.push({ target: makeEl(), addedNodes: [] });
    }
    triggerMutations(mutations);
    jest.advanceTimersByTime(HU.SCAN.DEBOUNCE_MS);

    expect(onFlush).toHaveBeenCalledTimes(1);
    expect(onFlush.mock.calls[0][0].fullScan).toBe(true);
  });

  test('dirty roots are deduped — same element added twice counts once', () => {
    const onFlush = jest.fn();
    createObserver(onFlush).start();

    const el = makeEl();
    // Trigger with the same element many times over the threshold.
    const mutations = [];
    for (let i = 0; i < HU.SCAN.DIRTY_ROOTS_FULL_SCAN_THRESHOLD + 5; i++) {
      mutations.push({ target: el, addedNodes: [] });
    }
    triggerMutations(mutations);
    jest.advanceTimersByTime(HU.SCAN.DEBOUNCE_MS);

    // All mutations point to the same element, so roots array has length 1 → partial scan.
    expect(onFlush.mock.calls[0][0].fullScan).toBe(false);
    expect(onFlush.mock.calls[0][0].roots).toHaveLength(1);
  });
});

describe('createObserver() — dirty root filtering', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    global.location.href = 'https://www.linkedin.com/feed/';
  });

  afterEach(() => {
    jest.runAllTimers();
    jest.useRealTimers();
  });

  test('disconnected elements are not added to dirty roots', () => {
    const onFlush = jest.fn();
    createObserver(onFlush).start();

    const disconnectedEl = makeEl(false);
    triggerMutations([{ target: disconnectedEl, addedNodes: [] }]);
    jest.advanceTimersByTime(HU.SCAN.DEBOUNCE_MS);

    // flush still fires but roots array is empty → partial scan with 0 roots.
    expect(onFlush).toHaveBeenCalledTimes(1);
    expect(onFlush.mock.calls[0][0].roots).toHaveLength(0);
  });

  test('text node mutations add the parentElement, not the text node itself', () => {
    const onFlush = jest.fn();
    createObserver(onFlush).start();

    const tn = makeTextNode(true);
    triggerMutations([{ target: tn, addedNodes: [] }]);
    jest.advanceTimersByTime(HU.SCAN.DEBOUNCE_MS);

    expect(onFlush.mock.calls[0][0].roots[0]).toBe(tn.el);
  });

  test('addedNodes are also queued as dirty roots', () => {
    const onFlush = jest.fn();
    createObserver(onFlush).start();

    const added = makeEl();
    triggerMutations([{ target: makeEl(), addedNodes: [added] }]);
    jest.advanceTimersByTime(HU.SCAN.DEBOUNCE_MS);

    expect(onFlush.mock.calls[0][0].roots).toContain(added);
  });
});

describe('createObserver() — disconnect()', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    disconnectCalled = false;
    global.location.href = 'https://www.linkedin.com/feed/';
  });

  afterEach(() => {
    jest.runAllTimers();
    jest.useRealTimers();
  });

  test('disconnect() cancels pending timers — flush is never called', () => {
    const onFlush = jest.fn();
    const obs = createObserver(onFlush);
    obs.start();

    triggerMutations([{ target: makeEl(), addedNodes: [] }]);
    obs.disconnect();
    jest.runAllTimers();

    expect(onFlush).not.toHaveBeenCalled();
  });

  test('disconnect() calls the underlying observer.disconnect()', () => {
    const obs = createObserver(jest.fn());
    obs.start();
    obs.disconnect();
    expect(disconnectCalled).toBe(true);
  });
});

describe('createObserver() — start() wires correct observe options', () => {
  beforeEach(() => {
    lastObserveTarget  = null;
    lastObserveOptions = null;
  });

  test('observes document.body with childList + subtree + characterData + attributes', () => {
    createObserver(jest.fn()).start();

    expect(lastObserveTarget).toBe(document.body);
    expect(lastObserveOptions.childList).toBe(true);
    expect(lastObserveOptions.subtree).toBe(true);
    expect(lastObserveOptions.characterData).toBe(true);
    expect(lastObserveOptions.attributes).toBe(true);
  });

  test('attributeFilter watches text-extraction attrs only', () => {
    createObserver(jest.fn()).start();

    const filter = lastObserveOptions.attributeFilter;
    expect(filter).toContain('aria-label');
    expect(filter).toContain('title');
    expect(filter).toContain('alt');
    expect(filter).toContain('data-testid');
    expect(filter).toHaveLength(4);
  });
});
