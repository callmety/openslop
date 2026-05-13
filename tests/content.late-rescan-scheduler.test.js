const { JSDOM } = require('jsdom');
const { loadPlainScript } = require('./load-plain-script');

describe('content/modules/late-rescan-scheduler.js', () => {
  var dom;

  beforeEach(() => {
    jest.useFakeTimers();
    dom = new JSDOM('<!doctype html><html><body></body></html>');
    global.window = dom.window;
    global.document = dom.window.document;

    delete global.__HUCS__;
    delete window.__HUCS__;
    loadPlainScript('content/modules/contracts.js');
    loadPlainScript('content/modules/late-rescan-scheduler.js');
  });

  afterEach(() => {
    jest.useRealTimers();
    if (dom && dom.window) dom.window.close();
  });

  function createScheduler(flushed) {
    return window.__HUCS__.modules.lateRescanScheduler.create({
      delayMs: 25,
      setTimeout: setTimeout,
      clearTimeout: clearTimeout,
      onFlushRoot: function (root) {
        flushed.push(root);
      },
    });
  }

  test('dedupes roots and flushes in insertion order', () => {
    var flushed = [];
    var scheduler = createScheduler(flushed);
    var a = { id: 'a', isConnected: true };
    var b = { id: 'b', isConnected: true };

    scheduler.schedule([a, b, a, null]);
    jest.advanceTimersByTime(30);

    expect(flushed).toEqual([a, b]);
  });

  test('collapses burst schedules into latest timer flush', () => {
    var flushed = [];
    var scheduler = createScheduler(flushed);
    var a = { id: 'a', isConnected: true };
    var b = { id: 'b', isConnected: true };

    scheduler.schedule([a]);
    jest.advanceTimersByTime(10);
    scheduler.schedule([b]);
    jest.advanceTimersByTime(20);
    expect(flushed).toEqual([]);

    jest.advanceTimersByTime(10);
    expect(flushed).toEqual([a, b]);
  });

  test('checks connectivity at flush time', () => {
    var flushed = [];
    var scheduler = createScheduler(flushed);
    var a = { id: 'a', isConnected: true };
    var b = { id: 'b', isConnected: true };

    scheduler.schedule([a, b]);
    b.isConnected = false;
    jest.advanceTimersByTime(30);

    expect(flushed).toEqual([a]);
  });

  test('re-entrant schedule from flush callback lands in next batch', () => {
    var flushed = [];
    var late;
    var scheduler = window.__HUCS__.modules.lateRescanScheduler.create({
      delayMs: 25,
      setTimeout: setTimeout,
      clearTimeout: clearTimeout,
      onFlushRoot: function (root) {
        flushed.push(root);
        if (root.id === 'a') scheduler.schedule([late]);
      },
    });
    var a = { id: 'a', isConnected: true };
    late = { id: 'late', isConnected: true };

    scheduler.schedule([a]);
    jest.advanceTimersByTime(30);
    expect(flushed).toEqual([a]);

    jest.advanceTimersByTime(30);
    expect(flushed).toEqual([a, late]);
  });
});
