const fs = require('fs');
const path = require('path');
const { chromium } = require('@playwright/test');

const EXTENSION_ROOT = path.resolve(__dirname, '..', '..');
const SCREENSHOT_ROOT = path.resolve(EXTENSION_ROOT, 'artifacts', 'qa');
const FIXTURE_GUARD_MARKER_ID = 'hu-e2e-fixture-root-marker';
const PAGE_DIAGNOSTICS_KEY = '__huE2eDiagnostics';
const RELEASE_EVIDENCE_CAPTURE_TEMPLATE_MAP = {
  'popup-a11y': 'popup-a11y.png',
  'feed-before': 'feed-before-after-before.png',
  'feed-after': 'feed-before-after-after.png',
};
const RELEASE_EVIDENCE_DIAGNOSTIC_TEMPLATE_MAP = {
  'console-clean': 'console-clean.md',
  'network-summary': 'network-summary.md',
};
const LINKEDIN_FIXTURE_HOST_HTML = [
  '<!doctype html>',
  '<html lang="en">',
  '<head>',
  '  <meta charset="UTF-8" />',
  '  <meta name="viewport" content="width=device-width, initial-scale=1.0" />',
  '  <title>OpenSlop LinkedIn Fixture Host</title>',
  '</head>',
  '<body>',
  '  <main id="hu-e2e-host-root"></main>',
  '</body>',
  '</html>',
].join('\n');

function sanitizePathToken(value) {
  return String(value || '')
    .replace(/[^a-zA-Z0-9._-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .toLowerCase();
}

function getSmokeScreenshotConfig() {
  var enabled = String(process.env.HU_E2E_CAPTURE || '').toLowerCase() === '1';
  var runLabel = sanitizePathToken(process.env.HU_E2E_CAPTURE_RUN || new Date().toISOString().slice(0, 10));
  var scopeLabel = sanitizePathToken(process.env.HU_E2E_CAPTURE_SCOPE || 'smoke');
  return {
    enabled: enabled,
    runLabel: runLabel || 'smoke',
    scopeLabel: scopeLabel || 'smoke',
  };
}

function getSmokeDiagnosticsConfig() {
  var enabled = String(process.env.HU_E2E_CAPTURE_DIAGNOSTICS || '').toLowerCase() === '1';
  var runLabel = sanitizePathToken(process.env.HU_E2E_CAPTURE_RUN || new Date().toISOString().slice(0, 10));
  var scopeLabel = sanitizePathToken(process.env.HU_E2E_CAPTURE_SCOPE || 'smoke');
  return {
    enabled: enabled,
    runLabel: runLabel || 'smoke',
    scopeLabel: scopeLabel || 'smoke',
  };
}

function normalizePngFileName(value) {
  var raw = String(value || '').trim();
  if (!raw) return '';
  var withoutExt = raw.replace(/\.png$/i, '');
  var sanitized = sanitizePathToken(withoutExt);
  if (!sanitized) return '';
  return sanitized + '.png';
}

function normalizeMarkdownFileName(value) {
  var raw = String(value || '').trim();
  if (!raw) return '';
  var withoutExt = raw.replace(/\.md$/i, '');
  var sanitized = sanitizePathToken(withoutExt);
  if (!sanitized) return '';
  return sanitized + '.md';
}

function resolveCaptureFileName(name, options) {
  var safeOptions = options && typeof options === 'object' ? options : {};
  var explicit = normalizePngFileName(safeOptions.fileName);
  if (explicit) return explicit;

  var templateKey = sanitizePathToken(safeOptions.template || '');
  if (templateKey && Object.prototype.hasOwnProperty.call(RELEASE_EVIDENCE_CAPTURE_TEMPLATE_MAP, templateKey)) {
    return RELEASE_EVIDENCE_CAPTURE_TEMPLATE_MAP[templateKey];
  }

  var safeName = sanitizePathToken(name || 'capture') || 'capture';
  var suffix = sanitizePathToken(safeOptions.suffix || '') || '';
  return suffix ? safeName + '-' + suffix + '.png' : safeName + '.png';
}

function resolveDiagnosticFileName(name, options) {
  var safeOptions = options && typeof options === 'object' ? options : {};
  var explicit = normalizeMarkdownFileName(safeOptions.fileName);
  if (explicit) return explicit;

  var templateKey = sanitizePathToken(safeOptions.template || '');
  if (templateKey && Object.prototype.hasOwnProperty.call(RELEASE_EVIDENCE_DIAGNOSTIC_TEMPLATE_MAP, templateKey)) {
    return RELEASE_EVIDENCE_DIAGNOSTIC_TEMPLATE_MAP[templateKey];
  }

  var safeName = sanitizePathToken(name || 'capture') || 'capture';
  var suffix = sanitizePathToken(safeOptions.suffix || '') || '';
  return suffix ? safeName + '-' + suffix + '.md' : safeName + '.md';
}

function ensurePageDiagnostics(page) {
  if (!page || typeof page.on !== 'function') return null;
  if (page[PAGE_DIAGNOSTICS_KEY]) return page[PAGE_DIAGNOSTICS_KEY];

  var diagnostics = {
    startedAt: new Date().toISOString(),
    consoleMessages: [],
    requests: [],
    responses: [],
  };

  page.on('console', function (msg) {
    diagnostics.consoleMessages.push({
      type: msg.type(),
      text: msg.text(),
      location: msg.location(),
      timestamp: new Date().toISOString(),
    });
  });

  page.on('request', function (request) {
    diagnostics.requests.push({
      url: request.url(),
      method: request.method(),
      resourceType: request.resourceType(),
      timestamp: new Date().toISOString(),
    });
  });

  page.on('response', function (response) {
    var req = response.request();
    diagnostics.responses.push({
      url: response.url(),
      ok: response.ok(),
      status: response.status(),
      method: req ? req.method() : '',
      resourceType: req ? req.resourceType() : '',
      timestamp: new Date().toISOString(),
    });
  });

  page[PAGE_DIAGNOSTICS_KEY] = diagnostics;
  return diagnostics;
}

function formatConsoleSummaryMarkdown(consoleMessages) {
  var messages = Array.isArray(consoleMessages) ? consoleMessages : [];
  var total = messages.length;
  var errorCount = 0;
  var warningCount = 0;
  var infoCount = 0;
  var debugCount = 0;
  var i;

  for (i = 0; i < messages.length; i++) {
    var type = String(messages[i].type || '').toLowerCase();
    if (type === 'error') errorCount += 1;
    else if (type === 'warning' || type === 'warn') warningCount += 1;
    else if (type === 'debug') debugCount += 1;
    else infoCount += 1;
  }

  var lines = [
    '# Console Summary',
    '',
    '- Total messages: ' + total,
    '- Errors: ' + errorCount,
    '- Warnings: ' + warningCount,
    '- Info/Log: ' + infoCount,
    '- Debug: ' + debugCount,
    '',
  ];

  if (total === 0) {
    lines.push('No console messages were captured during this smoke run.');
    return lines.join('\n') + '\n';
  }

  lines.push('## Messages');
  lines.push('');
  for (i = 0; i < messages.length; i++) {
    var entry = messages[i] || {};
    var location = entry.location && entry.location.url ? entry.location.url : '';
    var source = location ? ' (' + location + ')' : '';
    lines.push('- [' + String(entry.type || 'log').toLowerCase() + '] `' + String(entry.text || '').replace(/`/g, '\\`') + '`' + source);
  }

  return lines.join('\n') + '\n';
}

function isLinkedInOrExtensionUrl(url) {
  if (typeof url !== 'string' || !url) return true;
  if (url.indexOf('chrome-extension://') === 0) return true;
  if (url.indexOf('devtools://') === 0) return true;
  if (url.indexOf('data:') === 0) return true;
  return url.indexOf('https://www.linkedin.com/') === 0;
}

function formatNetworkSummaryMarkdown(networkRequests, networkResponses) {
  var requests = Array.isArray(networkRequests) ? networkRequests : [];
  var responses = Array.isArray(networkResponses) ? networkResponses : [];
  var totalRequests = requests.length;
  var totalResponses = responses.length;
  var successCount = 0;
  var nonSuccessCount = 0;
  var methods = {};
  var suspicious = [];
  var i;

  for (i = 0; i < requests.length; i++) {
    var reqEntry = requests[i] || {};
    var reqMethod = String(reqEntry.method || 'GET').toUpperCase();
    methods[reqMethod] = (methods[reqMethod] || 0) + 1;

    if (!isLinkedInOrExtensionUrl(reqEntry.url)) {
      suspicious.push({
        url: reqEntry.url,
        method: reqMethod,
      });
    }
  }

  for (i = 0; i < responses.length; i++) {
    var entry = responses[i] || {};
    var method = String(entry.method || 'GET').toUpperCase();
    if (!methods[method]) methods[method] = 0;

    if (entry.ok) successCount += 1;
    else nonSuccessCount += 1;
  }

  var lines = [
    '# Network Summary',
    '',
    '- Total requests: ' + totalRequests,
    '- Total responses: ' + totalResponses,
    '- Successful responses: ' + successCount,
    '- Non-success responses: ' + nonSuccessCount,
    '',
    '## Method Breakdown',
    '',
  ];

  var methodKeys = Object.keys(methods).sort();
  if (methodKeys.length === 0) {
    lines.push('- No network requests captured.');
  } else {
    for (i = 0; i < methodKeys.length; i++) {
      lines.push('- ' + methodKeys[i] + ': ' + methods[methodKeys[i]]);
    }
  }

  lines.push('');
  lines.push('## Non-LinkedIn/Extension Requests');
  lines.push('');
  if (suspicious.length === 0) {
    lines.push('- None detected.');
  } else {
    for (i = 0; i < suspicious.length; i++) {
      lines.push('- `' + String(suspicious[i].url || '').replace(/`/g, '\\`') + '` (method ' + String(suspicious[i].method || '').toUpperCase() + ')');
    }
  }

  return lines.join('\n') + '\n';
}

async function captureOptionalScreenshot(page, name, options) {
  if (!page || typeof page.screenshot !== 'function') return null;

  var cfg = getSmokeScreenshotConfig();
  if (!cfg.enabled) return null;

  var safeOptions = options && typeof options === 'object' ? options : {};
  var filename = resolveCaptureFileName(name, safeOptions);
  var relativeDir = path.join(cfg.runLabel, cfg.scopeLabel, 'e2e-smoke');
  var absoluteDir = path.join(SCREENSHOT_ROOT, relativeDir);
  await fs.promises.mkdir(absoluteDir, { recursive: true });

  var fullPath = path.join(absoluteDir, filename);
  await page.screenshot({
    path: fullPath,
    fullPage: !!safeOptions.fullPage,
  });

  return path.relative(EXTENSION_ROOT, fullPath);
}

async function captureOptionalDiagnostics(page, name, options) {
  if (!page) return null;

  var cfg = getSmokeDiagnosticsConfig();
  if (!cfg.enabled) return null;

  var diagnostics = ensurePageDiagnostics(page);
  var safeOptions = options && typeof options === 'object' ? options : {};
  var shouldCaptureConsole = safeOptions.captureConsole !== false;
  var shouldCaptureNetwork = safeOptions.captureNetwork !== false;

  if (!shouldCaptureConsole && !shouldCaptureNetwork) return null;

  var relativeDir = path.join(cfg.runLabel, cfg.scopeLabel, 'e2e-smoke');
  var absoluteDir = path.join(SCREENSHOT_ROOT, relativeDir);
  await fs.promises.mkdir(absoluteDir, { recursive: true });

  var out = {
    consolePath: null,
    networkPath: null,
  };

  if (shouldCaptureConsole) {
    var consoleFileName = resolveDiagnosticFileName(name || 'console', {
      fileName: safeOptions.consoleFileName,
      template: safeOptions.consoleTemplate,
      suffix: safeOptions.consoleSuffix,
    });
    var consoleFullPath = path.join(absoluteDir, consoleFileName);
    await fs.promises.writeFile(consoleFullPath, formatConsoleSummaryMarkdown(diagnostics.consoleMessages), 'utf8');
    out.consolePath = path.relative(EXTENSION_ROOT, consoleFullPath);
  }

  if (shouldCaptureNetwork) {
    var networkFileName = resolveDiagnosticFileName(name || 'network', {
      fileName: safeOptions.networkFileName,
      template: safeOptions.networkTemplate,
      suffix: safeOptions.networkSuffix,
    });
    var networkFullPath = path.join(absoluteDir, networkFileName);
    await fs.promises.writeFile(networkFullPath, formatNetworkSummaryMarkdown(diagnostics.requests, diagnostics.responses), 'utf8');
    out.networkPath = path.relative(EXTENSION_ROOT, networkFullPath);
  }

  return out;
}

function extensionArgs() {
  return [
    `--disable-extensions-except=${EXTENSION_ROOT}`,
    `--load-extension=${EXTENSION_ROOT}`,
  ];
}

async function launchExtensionContext(options) {
  const launchOptions = options && typeof options === 'object' ? options : {};
  const userDataDir = launchOptions.userDataDir || '';
  const chromiumOptions = Object.assign({}, launchOptions);
  delete chromiumOptions.userDataDir;

  const context = await chromium.launchPersistentContext(userDataDir, {
    headless: false,
    args: extensionArgs(),
    ...chromiumOptions,
  });

  let [serviceWorker] = context.serviceWorkers();
  if (!serviceWorker) {
    serviceWorker = await context.waitForEvent('serviceworker');
  }

  const workerUrl = serviceWorker.url();
  const extensionId = new URL(workerUrl).host;

  return {
    context,
    serviceWorker,
    extensionId,
    extensionRoot: EXTENSION_ROOT,
  };
}

async function openPopupPage(context, extensionId) {
  const popup = await context.newPage();
  ensurePageDiagnostics(popup);
  await popup.goto(`chrome-extension://${extensionId}/popup/popup.html`);
  return popup;
}

function extractBodyHtml(fixtureHtml) {
  if (typeof fixtureHtml !== 'string') return '';
  const match = fixtureHtml.match(/<body[^>]*>([\s\S]*)<\/body>/i);
  return match ? match[1] : fixtureHtml;
}

async function mountFixtureHtml(page, fixtureHtml, options) {
  const bodyHtml = extractBodyHtml(fixtureHtml);
  const safeOptions = options && typeof options === 'object' ? options : {};
  await page.evaluate(({ nextBodyHtml, fixturePathname, markerId }) => {
    var guardKey = '__HU_E2E_FIXTURE_GUARD__';
    var guard = window[guardKey];

    if (!guard) {
      guard = {
        markerId: markerId,
        bodyHtml: '',
        pathname: '',
        applying: false,
      };

      guard.apply = function () {
        if (guard.applying || !document.body) return;
        guard.applying = true;

        if (typeof guard.pathname === 'string' && guard.pathname) {
          window.history.replaceState({}, '', guard.pathname);
        }

        document.body.innerHTML =
          '<div id="' + guard.markerId + '" data-hu-e2e-fixture-root="1" hidden></div>' +
          guard.bodyHtml;

        window.dispatchEvent(new Event('load'));
        guard.applying = false;
      };

      guard.observer = new MutationObserver(function () {
        if (guard.applying) return;
        if (!document.getElementById(guard.markerId)) {
          guard.apply();
        }
      });
      guard.observer.observe(document.documentElement, { childList: true, subtree: true });
      window[guardKey] = guard;
    }

    guard.bodyHtml = nextBodyHtml;
    guard.pathname = (typeof fixturePathname === 'string' && fixturePathname) ? fixturePathname : '';
    guard.apply();
  }, {
    nextBodyHtml: bodyHtml,
    fixturePathname: safeOptions.forcePathname || '',
    markerId: FIXTURE_GUARD_MARKER_ID,
  });
}

async function seedDeterministicLinkedInHost(page) {
  await page.route('https://www.linkedin.com/**', async (route) => {
    var request = route.request();
    if (request.resourceType() === 'document') {
      await route.fulfill({
        status: 200,
        contentType: 'text/html; charset=utf-8',
        body: LINKEDIN_FIXTURE_HOST_HTML,
      });
      return;
    }

    await route.fulfill({ status: 204, body: '' });
  });
}

async function openLinkedInFixturePage(context, pathname, fixtureHtml, options) {
  const page = await context.newPage();
  ensurePageDiagnostics(page);
  const route = (typeof pathname === 'string' && pathname) ? pathname : '/feed/';
  const baseUrl = route.indexOf('http') === 0 ? route : `https://www.linkedin.com${route}`;
  const fixtureUrl = baseUrl.indexOf('?') === -1 ? `${baseUrl}?hu-e2e=1` : `${baseUrl}&hu-e2e=1`;
  await seedDeterministicLinkedInHost(page);
  await page.goto(fixtureUrl, { waitUntil: 'domcontentloaded' });
  await mountFixtureHtml(page, fixtureHtml, options);
  return page;
}

async function seedSettings(page, patch) {
  await page.evaluate((settingsPatch) => {
    const now = Date.now();

    const baseCore = {
      _storageFormat: 2,
      version: 14,
      enabled: true,
      slopSensitivityLevel: 0,
      aiFilterEnabled: false,
      seriousModeEnabled: false,
      updatedAt: now,
    };

    const defaultUiFilters = {
      hideSidebarModules: false,
      muteNotificationBadges: false,
      focusMode: false,
      hideWholeFeed: false,
      showFeedCounter: false,
      dimMode: false,
      showHiddenReasons: false,
      hideEngagementCounts: false,
      hideOtwRing: false,
      hideStatusBadges: false,
      hideViewerDetails: false,
      auditMode: false,
      wideMode: false,
      hideProfileMetrics: false,
      autoSortRecent: false,
      homeFeedSortMode: 'linkedin',
      hideBirthdayNudges: false,
      hidePremiumBanners: false,
      hideLinkedInNews: false,
      hideMyNetworkNoise: false,
      hideMyNetworkManage: false,
      hideMyNetworkAds: false,
      hideMyNetworkPending: false,
      hideMyNetworkZip: false,
      hideJobsProfileCard: false,
      hideJobsPrefsTracker: false,
      hideJobsTopPicks: false,
      hideJobsRecentSearches: false,
      hideJobsSkillMatch: false,
      hideJobsPremium: false,
      hideJobsCollections: false,
      hideJobsMoreJobs: false,
      hideNotificationBadge: false,
      hideFollowButtons: false,
      hideConnectButtons: false,
      hideCommentsSection: false,
      hideReactionBar: false,
      hideNotifJobAlerts: false,
      hideNotifReactions: false,
      hideNotifMentions: false,
      compactLayout: false,
      hideSidebarLinkedInNews: false,
      hideSidebarGames: false,
      hideSidebarSuggestedPeople: false,
      hideSidebarEvents: false,
      hideSidebarPremiumNags: false,
      hideSidebarAds: false,
      hideGlobalNav: false,
      hideShareBox: false,
      hideSidebarProfileCard: false,
      hideSidebarShortcuts: false,
      headerStatMetric: 'hidden',
      autoExpandMore: true,
    };

    const safePatch = settingsPatch && typeof settingsPatch === 'object' ? settingsPatch : {};
    const uiFilters = Object.assign({}, defaultUiFilters, safePatch.uiFilters || {});
    const core = Object.assign({}, baseCore, safePatch.core || {}, { uiFilters: uiFilters, updatedAt: now });

    const payload = {
      hu_settings: core,
      hu_settings_blacklist: Array.isArray(safePatch.blacklist) ? safePatch.blacklist : [],
      hu_settings_preset_state: safePatch.presetState && typeof safePatch.presetState === 'object' ? safePatch.presetState : {},
    };

    return new Promise((resolve) => {
      chrome.storage.sync.set(payload, () => resolve());
    });
  }, patch || {});
}

module.exports = {
  EXTENSION_ROOT,
  RELEASE_EVIDENCE_CAPTURE_TEMPLATE_MAP,
  RELEASE_EVIDENCE_DIAGNOSTIC_TEMPLATE_MAP,
  getSmokeScreenshotConfig,
  getSmokeDiagnosticsConfig,
  resolveCaptureFileName,
  resolveDiagnosticFileName,
  captureOptionalScreenshot,
  captureOptionalDiagnostics,
  launchExtensionContext,
  openPopupPage,
  openLinkedInFixturePage,
  mountFixtureHtml,
  seedSettings,
};
