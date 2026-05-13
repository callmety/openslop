const { JSDOM } = require('jsdom');
const { loadPlainScript } = require('./load-plain-script');

describe('content/modules/card-resolver.js', () => {
  var dom;

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
    loadPlainScript('content/modules/card-resolver.js');
  });

  afterEach(() => {
    if (dom && dom.window) dom.window.close();
  });

  test('resolveFeedCard prefers nearest FeedType wrapper shell over inner listitem', () => {
    var wrap = document.createElement('div');
    wrap.innerHTML =
      '<div role="list" data-testid="mainFeed">' +
        '<div data-display-contents="true">' +
          '<div class="d399fa58 _18e3eda6 _6d862854">' +
            '<div class="_936a7c6b" componentkey="expanded5GaxFoQgEPiXops5CQEF9edjuh4iZAPPiQhjQeEPCp4FeedType_MAIN_FEED_RELEVANCE">' +
              '<div id="inner-card" role="listitem" componentkey="expanded5GaxFoQgEPiXops5CQEF9edjuh4iZAPPiQhjQeEPCp4FeedType_MAIN_FEED_RELEVANCE">' +
                '<span data-testid="expandable-text-box">Promoted sample</span>' +
              '</div>' +
            '</div>' +
          '</div>' +
        '</div>' +
      '</div>';
    document.body.appendChild(wrap);

    var inner = document.getElementById('inner-card');
    var resolved = window.__HUCS__.modules.cardResolver.resolveFeedCard(inner, {
      searchResultOuter: '[data-view-name="search-entity-result-universal-template"], li.artdeco-card',
      feedCardItem: 'div[role="listitem"]',
      feedCardList: 'div[role="list"][data-testid="mainFeed"]',
    });

    expect(resolved).not.toBe(inner);
    expect(resolved.getAttribute('componentkey')).toBe('expanded5GaxFoQgEPiXops5CQEF9edjuh4iZAPPiQhjQeEPCp4FeedType_MAIN_FEED_RELEVANCE');
    expect(resolved.querySelector('#inner-card')).not.toBeNull();
  });
});
