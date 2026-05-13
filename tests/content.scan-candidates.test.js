const { JSDOM } = require('jsdom');
const { loadPlainScript } = require('./load-plain-script');

describe('content/modules/scan-candidates.js', () => {
  var dom;

  function createCollector(overrides) {
    var baseSelectors = {
      postContainer: '.post',
      feedCardItem: '.post-item',
    };
    var base = {
      selectors: baseSelectors,
      resolveFeedCard: function (node) { return node; },
    };
    var cfg = Object.assign({}, base, overrides || {});
    cfg.selectors = Object.assign({}, baseSelectors, (overrides && overrides.selectors) || {});
    return window.__HUCS__.modules.scanCandidates.create(cfg);
  }

  beforeEach(() => {
    dom = new JSDOM('<!doctype html><html><body></body></html>', {
      url: 'https://www.linkedin.com/feed/',
    });

    global.window = dom.window;
    global.document = dom.window.document;
    global.Node = dom.window.Node;
    global.HTMLElement = dom.window.HTMLElement;

    delete global.__HUCS__;
    delete window.__HUCS__;
    loadPlainScript('content/modules/contracts.js');
    loadPlainScript('content/modules/scan-candidates.js');
  });

  afterEach(() => {
    if (dom && dom.window) dom.window.close();
  });

  test('collectMatches includes root match before descendant matches', () => {
    var collector = createCollector();
    document.body.innerHTML =
      '<div id="root" class="target">' +
        '<span id="a" class="target"></span>' +
        '<div><span id="b" class="target"></span></div>' +
      '</div>';

    var root = document.getElementById('root');
    var out = collector.collectMatches(root, '.target');

    expect(out.map(function (n) { return n.id; })).toEqual(['root', 'a', 'b']);
  });

  test('collectResolvedPostCards preserves enclosing-first and dedupes resolved cards', () => {
    document.body.innerHTML =
      '<div id="host">' +
        '<div id="outer" class="post-item post">' +
          '<div id="inner" class="post-item post"></div>' +
        '</div>' +
        '<div id="sibling" class="post-item post"></div>' +
      '</div>';

    var outer = document.getElementById('outer');
    var inner = document.getElementById('inner');
    var sibling = document.getElementById('sibling');

    var collector = createCollector({
      resolveFeedCard: function (node) {
        if (node.id === 'inner') return outer;
        return node;
      },
    });

    var fromInner = collector.collectResolvedPostCards(inner);
    expect(fromInner).toEqual([outer]);

    var fromHost = collector.collectResolvedPostCards(document.getElementById('host'));
    expect(fromHost).toEqual([outer, sibling]);
  });

  test('collectResolvedPostCards finds feedCardItem descendants from non-post shell roots', () => {
    document.body.innerHTML =
      '<div id="shell">' +
        '<div id="item-a" class="post-item"></div>' +
        '<div id="item-b" class="post-item"></div>' +
      '</div>';

    var shell = document.getElementById('shell');
    var collector = createCollector({
      selectors: {
        postContainer: '.post-only',
      },
      resolveFeedCard: function () {
        return shell;
      },
    });

    var out = collector.collectResolvedPostCards(document.getElementById('shell'));
    expect(out).toEqual([shell]);
  });

  test('collectResolvedPostCards ignores raw feedCardItem descendants that do not resolve upward', () => {
    document.body.innerHTML =
      '<div id="shell">' +
        '<div id="item-a" class="post-item"></div>' +
        '<div id="item-b" class="post-item"></div>' +
      '</div>';

    var collector = createCollector({
      selectors: {
        postContainer: '.post-only',
      },
      resolveFeedCard: function (node) {
        return node;
      },
    });

    var out = collector.collectResolvedPostCards(document.getElementById('shell'));
    expect(out).toEqual([]);
  });

  test('collectMatches fails open when selector parsing throws', () => {
    document.body.innerHTML =
      '<div id="root">' +
        '<div id="safe" class="target-safe"></div>' +
        '<div id="broken" class="target-broken"></div>' +
      '</div>';

    var originalMatches = window.Element.prototype.matches;
    var originalQuerySelectorAll = window.Element.prototype.querySelectorAll;

    window.Element.prototype.matches = function (selector) {
      if (selector === '.target-broken') {
        throw new window.DOMException('Malformed selector', 'SyntaxError');
      }
      return originalMatches.call(this, selector);
    };
    window.Element.prototype.querySelectorAll = function (selector) {
      if (selector === '.target-broken') {
        throw new window.DOMException('Malformed selector', 'SyntaxError');
      }
      return originalQuerySelectorAll.call(this, selector);
    };

    try {
      var collector = createCollector();
      var root = document.getElementById('root');

      var safeOut = collector.collectMatches(root, '.target-safe');
      expect(safeOut.map(function (n) { return n.id; })).toEqual(['safe']);

      var brokenOut = collector.collectMatches(root, '.target-broken');
      expect(brokenOut).toEqual([]);
    } finally {
      window.Element.prototype.matches = originalMatches;
      window.Element.prototype.querySelectorAll = originalQuerySelectorAll;
    }
  });

  test('findEnclosingPostCard fails open when closest selector parsing throws', () => {
    document.body.innerHTML =
      '<div id="outer" class="post"><span id="inner"></span></div>';

    var originalClosest = window.Element.prototype.closest;
    window.Element.prototype.closest = function (selector) {
      if (selector === '.post') {
        throw new window.DOMException('Malformed selector', 'SyntaxError');
      }
      return originalClosest.call(this, selector);
    };

    try {
      var collector = createCollector();
      var inner = document.getElementById('inner');
      expect(collector.findEnclosingPostCard(inner)).toBeNull();
    } finally {
      window.Element.prototype.closest = originalClosest;
    }
  });
});
