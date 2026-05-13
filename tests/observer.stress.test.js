// OpenSlop — Stress tests for content/observer.js
//
// Complements observer.test.js (unit behaviour) with high-load scenarios:
//   • 500–1000 rapid mutations coalesce via debounce / max-flush cap
//   • Dirty-root deduplication holds up at scale
//   • fullScan threshold fires correctly across large mutation sets
//   • URL change mid-burst forces a full scan
//   • Rapid connect/disconnect cycles leave no timer leaks
//   • disconnect() after a 1000-mutation burst blocks all pending callbacks

const { loadPlainScript } = require('./load-plain-script');

// ── Browser-API stubs ─────────────────────────────────────────────────────────

if (!global.Node) global.Node = { TEXT_NODE: 3 };

function makeEl(connected = true) {
  return { nodeType: 1, isConnected: connected, parentElement: null };
}

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

if (!global.location) global.location = { href: 'https://www.linkedin.com/feed/' };
if (!global.document) global.document = {};
if (!global.document.body) global.document.body = makeEl();

loadPlainScript('shared/constants.js');
loadPlainScript('content/observer.js');

/* global createObserver, HU */

// ── Helpers ───────────────────────────────────────────────────────────────────

function triggerMutations(mutations) {
  lastObserverCallback(mutations, null);
}

function makeMutations(targets, addedNodes = []) {
  return targets.map(function (t) { return { target: t, addedNodes: addedNodes }; });
}

function makeRoots(count) {
  var roots = [];
  for (var i = 0; i < count; i++) roots.push(makeEl());
  return roots;
}

// Build `total` mutations cycling across `roots`.
function buildBurst(roots, total, withAddedNodes) {
  var mutations = [];
  for (var i = 0; i < total; i++) {
    var target     = roots[i % roots.length];
    var addedNodes = withAddedNodes
      ? [roots[(i + 1) % roots.length]]
      : [];
    mutations.push({ target: target, addedNodes: addedNodes });
  }
  return mutations;
}

// ── Stress suite: coalescing ──────────────────────────────────────────────────

describe('createObserver() — stress: mutation coalescing', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    disconnectCalled = false;
    global.location.href = 'https://www.linkedin.com/feed/';
  });

  afterEach(() => {
    jest.runAllTimers();
    jest.useRealTimers();
  });

  test('500 mutations in one batch produce exactly one flush', () => {
    const onFlush = jest.fn();
    createObserver(onFlush).start();

    const roots     = makeRoots(10);
    const mutations = buildBurst(roots, 500, false);

    triggerMutations(mutations);
    jest.advanceTimersByTime(HU.SCAN.DEBOUNCE_MS);

    expect(onFlush).toHaveBeenCalledTimes(1);
  });

  test('1000 mutations in one batch produce exactly one flush', () => {
    const onFlush = jest.fn();
    createObserver(onFlush).start();

    const roots     = makeRoots(5);
    const mutations = buildBurst(roots, 1000, false);

    triggerMutations(mutations);
    jest.advanceTimersByTime(HU.SCAN.DEBOUNCE_MS);

    expect(onFlush).toHaveBeenCalledTimes(1);
  });

  // Rapidly re-trigger mutations so the debounce keeps resetting; the hard
  // max-flush cap should force exactly one early flush.
  test('continuous mutations at sub-debounce gaps are capped by MAX_FLUSH_MS', () => {
    const onFlush = jest.fn();
    createObserver(onFlush).start();

    const root = makeEl();
    const gap  = Math.floor(HU.SCAN.DEBOUNCE_MS / 3); // well under debounce window

    // Send batches spaced `gap` ms apart until we pass MAX_FLUSH_MS.
    let elapsed = 0;
    while (elapsed < HU.SCAN.MAX_FLUSH_MS) {
      triggerMutations([{ target: root, addedNodes: [] }]);
      jest.advanceTimersByTime(gap);
      elapsed += gap;
    }

    // The max-flush cap should have fired exactly once.
    // (flush() clears both timers, so the debounce is cancelled too — no second flush.)
    expect(onFlush).toHaveBeenCalledTimes(1);

    // Confirm no further flushes fire without new mutations.
    jest.advanceTimersByTime(HU.SCAN.DEBOUNCE_MS);
    expect(onFlush).toHaveBeenCalledTimes(1);
  });

  test('total flush count is far fewer than total mutation batches', () => {
    const onFlush = jest.fn();
    createObserver(onFlush).start();

    const root  = makeEl();
    const gap   = 20; // less than DEBOUNCE_MS (150)
    const iters = 30; // 30 × 20 ms = 600 ms > MAX_FLUSH_MS (500)

    for (let i = 0; i < iters; i++) {
      triggerMutations([{ target: root, addedNodes: [] }]);
      jest.advanceTimersByTime(gap);
    }

    jest.advanceTimersByTime(HU.SCAN.DEBOUNCE_MS);

    // 30 batches → at most 2 flushes (one max-flush + one settling debounce)
    expect(onFlush.mock.calls.length).toBeLessThanOrEqual(2);
    expect(onFlush.mock.calls.length).toBeLessThan(iters);
  });
});

// ── Stress suite: dirty-root deduplication at scale ──────────────────────────

describe('createObserver() — stress: dirty-root deduplication', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    global.location.href = 'https://www.linkedin.com/feed/';
  });

  afterEach(() => {
    jest.runAllTimers();
    jest.useRealTimers();
  });

  test('900 mutations across 3 elements deduplicate to exactly 3 dirty roots', () => {
    const onFlush = jest.fn();
    createObserver(onFlush).start();

    const roots     = makeRoots(3);
    const mutations = buildBurst(roots, 900, true);

    triggerMutations(mutations);
    jest.advanceTimersByTime(HU.SCAN.DEBOUNCE_MS);

    expect(onFlush).toHaveBeenCalledTimes(1);
    const { fullScan, roots: flushedRoots } = onFlush.mock.calls[0][0];
    expect(fullScan).toBe(false);
    expect(flushedRoots).toHaveLength(3);
    expect(flushedRoots).toEqual(expect.arrayContaining(roots));
  });

  test('1000 mutations across 1 element stay as exactly 1 dirty root (no fullScan)', () => {
    const onFlush = jest.fn();
    createObserver(onFlush).start();

    const root      = makeEl();
    const mutations = buildBurst([root], 1000, false);

    triggerMutations(mutations);
    jest.advanceTimersByTime(HU.SCAN.DEBOUNCE_MS);

    expect(onFlush).toHaveBeenCalledTimes(1);
    expect(onFlush.mock.calls[0][0].fullScan).toBe(false);
    expect(onFlush.mock.calls[0][0].roots).toHaveLength(1);
    expect(onFlush.mock.calls[0][0].roots[0]).toBe(root);
  });

  test('mutations at exactly DIRTY_ROOTS_FULL_SCAN_THRESHOLD unique roots stay partial', () => {
    const onFlush = jest.fn();
    createObserver(onFlush).start();

    const N       = HU.SCAN.DIRTY_ROOTS_FULL_SCAN_THRESHOLD;
    const roots   = makeRoots(N);
    // Send many mutations but only N distinct targets.
    const mutations = buildBurst(roots, N * 25, false);

    triggerMutations(mutations);
    jest.advanceTimersByTime(HU.SCAN.DEBOUNCE_MS);

    expect(onFlush).toHaveBeenCalledTimes(1);
    expect(onFlush.mock.calls[0][0].fullScan).toBe(false);
    expect(onFlush.mock.calls[0][0].roots).toHaveLength(N);
  });

  test('mutations at threshold+1 unique roots force fullScan=true at scale', () => {
    const onFlush = jest.fn();
    createObserver(onFlush).start();

    const N       = HU.SCAN.DIRTY_ROOTS_FULL_SCAN_THRESHOLD + 1;
    const roots   = makeRoots(N);
    const mutations = buildBurst(roots, N * 25, true);

    triggerMutations(mutations);
    jest.advanceTimersByTime(HU.SCAN.DEBOUNCE_MS);

    expect(onFlush).toHaveBeenCalledTimes(1);
    expect(onFlush.mock.calls[0][0].fullScan).toBe(true);
    expect(onFlush.mock.calls[0][0].roots).toHaveLength(N);
  });
});

// ── Stress suite: URL change mid-burst ───────────────────────────────────────

describe('createObserver() — stress: URL change mid-burst', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    global.location.href = 'https://www.linkedin.com/feed/';
  });

  afterEach(() => {
    jest.runAllTimers();
    jest.useRealTimers();
  });

  test('URL change during a 500-mutation burst forces fullScan on the next flush', () => {
    const onFlush = jest.fn();
    createObserver(onFlush).start();

    const roots = makeRoots(20);

    // Phase 1: send 300 mutations then change URL.
    triggerMutations(buildBurst(roots, 300, false));
    global.location.href = 'https://www.linkedin.com/in/someone/';

    // Phase 2: send 200 more mutations without flushing yet.
    triggerMutations(buildBurst(roots, 200, false));

    jest.advanceTimersByTime(HU.SCAN.DEBOUNCE_MS);

    expect(onFlush).toHaveBeenCalledTimes(1);
    expect(onFlush).toHaveBeenCalledWith({ fullScan: true, roots: [] });
  });

  test('flush after URL-change burst clears dirty roots; next flush is partial', () => {
    const onFlush = jest.fn();
    createObserver(onFlush).start();

    // Burst 1: URL changes → full scan.
    triggerMutations(buildBurst(makeRoots(10), 200, false));
    global.location.href = 'https://www.linkedin.com/mynetwork/';
    jest.advanceTimersByTime(HU.SCAN.DEBOUNCE_MS);

    // Burst 2: URL stable, few roots → partial scan.
    const oneRoot = makeEl();
    triggerMutations([{ target: oneRoot, addedNodes: [] }]);
    jest.advanceTimersByTime(HU.SCAN.DEBOUNCE_MS);

    expect(onFlush).toHaveBeenCalledTimes(2);
    expect(onFlush.mock.calls[1][0].fullScan).toBe(false);
    expect(onFlush.mock.calls[1][0].roots).toHaveLength(1);
    expect(onFlush.mock.calls[1][0].roots[0]).toBe(oneRoot);
  });
});

// ── Stress suite: rapid connect/disconnect cycles ─────────────────────────────

describe('createObserver() — stress: connect/disconnect lifecycle', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    disconnectCalled = false;
    global.location.href = 'https://www.linkedin.com/feed/';
  });

  afterEach(() => {
    jest.runAllTimers();
    jest.useRealTimers();
  });

  test('50 rapid start/disconnect cycles leave zero pending timers', () => {
    for (let i = 0; i < 50; i++) {
      const obs = createObserver(jest.fn());
      obs.start();

      // Queue some mutations on each cycle.
      triggerMutations(buildBurst(makeRoots(5), 20, false));

      obs.disconnect();

      expect(jest.getTimerCount()).toBe(0);
    }
  });

  test('disconnect() after 1000-mutation burst prevents all pending flushes', () => {
    const onFlush = jest.fn();
    const obs = createObserver(onFlush);
    obs.start();

    triggerMutations(buildBurst(makeRoots(50), 1000, true));

    obs.disconnect();
    jest.runAllTimers();

    expect(onFlush).not.toHaveBeenCalled();
    expect(jest.getTimerCount()).toBe(0);
  });

  test('re-start after disconnect works correctly', () => {
    const onFlush = jest.fn();
    const obs = createObserver(onFlush);

    obs.start();
    triggerMutations(buildBurst(makeRoots(3), 100, false));
    obs.disconnect();
    jest.runAllTimers();
    expect(onFlush).not.toHaveBeenCalled();

    // Re-start — should accept new mutations and flush normally.
    obs.start();
    triggerMutations([{ target: makeEl(), addedNodes: [] }]);
    jest.advanceTimersByTime(HU.SCAN.DEBOUNCE_MS);
    expect(onFlush).toHaveBeenCalledTimes(1);
  });
});
