// OpenSlop — Manifest & build smoke tests
//
// Verifies that both manifests reference only files that actually exist on
// disk, and that the package.json build scripts still include expected roots.
// This catches file renames, manifest typos, and packaging drift without
// running the actual zip command.

const fs   = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');

function readJson(relPath) {
  return JSON.parse(fs.readFileSync(path.join(ROOT, relPath), 'utf8'));
}

function fileExists(relPath) {
  return fs.existsSync(path.join(ROOT, relPath));
}

function collectManifestRefs(manifest) {
  var refs = [];

  // Background SW (MV3) or scripts (MV2)
  if (manifest.background) {
    if (manifest.background.service_worker) refs.push(manifest.background.service_worker);
    (manifest.background.scripts || []).forEach(function (f) { refs.push(f); });
  }

  // Action popup + icons (MV3 uses action; MV2 uses browser_action)
  var action = manifest.action || manifest.browser_action;
  if (action) {
    if (action.default_popup) refs.push(action.default_popup);
    if (action.default_icon) {
      Object.keys(action.default_icon).forEach(function (size) {
        refs.push(action.default_icon[size]);
      });
    }
  }

  // Top-level icons
  if (manifest.icons) {
    Object.keys(manifest.icons).forEach(function (size) {
      refs.push(manifest.icons[size]);
    });
  }

  // Content scripts
  (manifest.content_scripts || []).forEach(function (cs) {
    (cs.js  || []).forEach(function (f) { refs.push(f); });
    (cs.css || []).forEach(function (f) { refs.push(f); });
  });

  // Deduplicate
  var seen = {};
  return refs.filter(function (f) {
    if (seen[f]) return false;
    seen[f] = true;
    return true;
  });
}

function getContentScriptJs(manifest) {
  return ((manifest.content_scripts || [])[0] || {}).js || [];
}

function expectedContentModuleOrder() {
  return [
    'content/modules/contracts.js',
    'content/modules/text-extractors.js',
    'content/modules/card-meta.js',
    'content/modules/card-resolver.js',
    'content/modules/post-evaluator.js',
    'content/modules/scan-candidates.js',
    'content/modules/late-rescan-scheduler.js',
  ];
}

// ── Chrome manifest ───────────────────────────────────────────────────────────

describe('manifest.json (Chrome MV3)', () => {
  var manifest;
  beforeAll(function () { manifest = readJson('manifest.json'); });

  test('parses as valid JSON', () => {
    expect(manifest).toBeTruthy();
  });

  test('is MV3', () => {
    expect(manifest.manifest_version).toBe(3);
  });

  test('permissions stay minimal and scoped', () => {
    expect(manifest.permissions || []).toEqual(['storage']);
    expect(manifest.host_permissions || []).toEqual(['https://www.linkedin.com/*']);
    expect((manifest.content_scripts && manifest.content_scripts[0] && manifest.content_scripts[0].matches) || [])
      .toEqual(['https://www.linkedin.com/*']);
  });

  test('does not add risky permission-surface manifest fields', () => {
    expect(Object.prototype.hasOwnProperty.call(manifest, 'optional_permissions')).toBe(false);
    expect(Object.prototype.hasOwnProperty.call(manifest, 'externally_connectable')).toBe(false);
    expect(Object.prototype.hasOwnProperty.call(manifest, 'web_accessible_resources')).toBe(false);
    expect(Object.prototype.hasOwnProperty.call(manifest, 'content_security_policy')).toBe(false);
  });

  test('all referenced files exist on disk', () => {
    collectManifestRefs(manifest).forEach(function (ref) {
      expect({ ref: ref, exists: fileExists(ref) }).toEqual({ ref: ref, exists: true });
    });
  });
});

// ── Firefox manifest ──────────────────────────────────────────────────────────

describe('manifest.firefox.json (Firefox MV2)', () => {
  var manifest;
  beforeAll(function () { manifest = readJson('manifest.firefox.json'); });

  test('parses as valid JSON', () => {
    expect(manifest).toBeTruthy();
  });

  test('is MV2', () => {
    expect(manifest.manifest_version).toBe(2);
  });

  test('permissions stay minimal and scoped', () => {
    expect(manifest.permissions || []).toEqual([
      'storage',
      'https://www.linkedin.com/*',
    ]);
    expect((manifest.content_scripts && manifest.content_scripts[0] && manifest.content_scripts[0].matches) || [])
      .toEqual(['https://www.linkedin.com/*']);
  });

  test('does not add risky permission-surface manifest fields', () => {
    expect(Object.prototype.hasOwnProperty.call(manifest, 'optional_permissions')).toBe(false);
    expect(Object.prototype.hasOwnProperty.call(manifest, 'externally_connectable')).toBe(false);
    expect(Object.prototype.hasOwnProperty.call(manifest, 'web_accessible_resources')).toBe(false);
    expect(Object.prototype.hasOwnProperty.call(manifest, 'content_security_policy')).toBe(false);
  });

  test('all referenced files exist on disk', () => {
    collectManifestRefs(manifest).forEach(function (ref) {
      expect({ ref: ref, exists: fileExists(ref) }).toEqual({ ref: ref, exists: true });
    });
  });
});

describe('content-script module load order parity', () => {
  var chromeManifest;
  var firefoxManifest;

  beforeAll(function () {
    chromeManifest = readJson('manifest.json');
    firefoxManifest = readJson('manifest.firefox.json');
  });

  test('chrome and firefox manifest content script js arrays stay in lockstep', () => {
    expect(getContentScriptJs(chromeManifest)).toEqual(getContentScriptJs(firefoxManifest));
  });

  test('pure modules load before content-script runtime shell', () => {
    var js = getContentScriptJs(chromeManifest);
    var shellIndex = js.indexOf('content/content-script.js');
    expect(shellIndex).toBeGreaterThan(-1);
    expectedContentModuleOrder().forEach(function (modulePath) {
      var idx = js.indexOf(modulePath);
      expect(idx).toBeGreaterThan(-1);
      expect(idx).toBeLessThan(shellIndex);
    });
  });

  test('chrome and firefox keep release metadata in parity', () => {
    expect(chromeManifest.name).toBe(firefoxManifest.name);
    expect(chromeManifest.version).toBe(firefoxManifest.version);
    expect(chromeManifest.description).toBe(firefoxManifest.description);
    expect((chromeManifest.action || {}).default_popup).toBe((firefoxManifest.browser_action || {}).default_popup);
    expect(chromeManifest.icons).toEqual(firefoxManifest.icons);
    expect(((chromeManifest.content_scripts || [])[0] || {}).css || [])
      .toEqual((((firefoxManifest.content_scripts || [])[0] || {}).css || []));
  });
});

// ── Build script integrity ────────────────────────────────────────────────────

describe('package.json build scripts', () => {
  var scripts;
  beforeAll(function () { scripts = readJson('package.json').scripts; });

  test('build:chrome packages expected roots', () => {
    var cmd = scripts['build:chrome'];
    expect(cmd).toContain('scripts/build-chrome-zip.js');
  });

  test('build:firefox packages expected roots', () => {
    var cmd = scripts['build:firefox'];
    expect(cmd).toContain('scripts/build-firefox-zip.js');
    expect(cmd).not.toContain('manifest.firefox.json background.firefox.js');
  });

  test('build script runs both chrome and firefox builds', () => {
    var cmd = scripts['build'];
    expect(cmd).toContain('build:chrome');
    expect(cmd).toContain('build:firefox');
  });
});

// ── Playwright harness guardrails ────────────────────────────────────────────

describe('playwright harness guardrails', () => {
  var configText;
  var harnessText;
  var chromeManifest;
  var firefoxManifest;

  beforeAll(function () {
    configText = fs.readFileSync(path.join(ROOT, 'playwright.config.js'), 'utf8');
    harnessText = fs.readFileSync(path.join(ROOT, 'tests/e2e/harness.js'), 'utf8');
    chromeManifest = readJson('manifest.json');
    firefoxManifest = readJson('manifest.firefox.json');
  });

  test('keeps deterministic extension-safe config defaults', () => {
    expect(configText).toContain('workers: 1');
    expect(configText).toContain("fullyParallel: false");
    expect(configText).toContain("trace: 'retain-on-failure'");
  });

  test('loads extension from repo root and does not override manifest scope', () => {
    expect(harnessText).toContain('--disable-extensions-except=');
    expect(harnessText).toContain('--load-extension=');
    expect(harnessText).not.toContain('--host-rules');
    expect(harnessText).not.toContain('--disable-web-security');
    expect(harnessText).not.toContain('--disable-features=IsolateOrigins');
  });

  test('manifest host/content-script scope remains LinkedIn-only for harnessed runs', () => {
    expect(chromeManifest.host_permissions || []).toEqual(['https://www.linkedin.com/*']);
    expect((chromeManifest.content_scripts && chromeManifest.content_scripts[0] && chromeManifest.content_scripts[0].matches) || [])
      .toEqual(['https://www.linkedin.com/*']);

    expect((firefoxManifest.content_scripts && firefoxManifest.content_scripts[0] && firefoxManifest.content_scripts[0].matches) || [])
      .toEqual(['https://www.linkedin.com/*']);
  });
});
