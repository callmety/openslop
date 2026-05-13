const fs = require('fs');
const path = require('path');
const {
  RELEASE_EVIDENCE_CAPTURE_TEMPLATE_MAP,
  RELEASE_EVIDENCE_DIAGNOSTIC_TEMPLATE_MAP,
  getSmokeDiagnosticsConfig,
  captureOptionalDiagnostics,
  resolveCaptureFileName,
  resolveDiagnosticFileName,
} = require('./e2e/harness');

const ROOT = path.join(__dirname, '..');

function readJson(relPath) {
  return JSON.parse(fs.readFileSync(path.join(ROOT, relPath), 'utf8'));
}

describe('e2e harness contracts', () => {
  test('seedSettings defaults stay aligned with DEFAULT_SETTINGS storage format/version', () => {
    const constantsText = fs.readFileSync(path.join(ROOT, 'shared', 'constants.js'), 'utf8');
    const harnessText = fs.readFileSync(path.join(ROOT, 'tests', 'e2e', 'harness.js'), 'utf8');

    const formatMatch = constantsText.match(/SETTINGS_STORAGE_FORMAT:\s*(\d+)/);
    const versionMatch = constantsText.match(/DEFAULT_SETTINGS:[\s\S]*?version:\s*(\d+)/);
    expect(formatMatch).toBeTruthy();
    expect(versionMatch).toBeTruthy();

    const expectedFormat = formatMatch[1];
    const expectedVersion = versionMatch[1];

    expect(harnessText).toContain('_storageFormat: ' + expectedFormat);
    expect(harnessText).toContain('version: ' + expectedVersion);
  });

  test('harness fixture-path routes remain LinkedIn-only for deterministic scope', () => {
    const harnessText = fs.readFileSync(path.join(ROOT, 'tests', 'e2e', 'harness.js'), 'utf8');
    expect(harnessText).toContain('https://www.linkedin.com');
    expect(harnessText).not.toContain('http://localhost');
    expect(harnessText).not.toContain('https://example.com');
  });

  test('manifest host scopes remain LinkedIn-only across browser variants', () => {
    const chromeManifest = readJson('manifest.json');
    const firefoxManifest = readJson('manifest.firefox.json');

    expect(chromeManifest.host_permissions || []).toEqual(['https://www.linkedin.com/*']);
    expect((chromeManifest.content_scripts[0] || {}).matches || []).toEqual(['https://www.linkedin.com/*']);
    expect((firefoxManifest.content_scripts[0] || {}).matches || []).toEqual(['https://www.linkedin.com/*']);
  });

  test('release evidence screenshot templates remain checklist-aligned', () => {
    expect(RELEASE_EVIDENCE_CAPTURE_TEMPLATE_MAP).toEqual({
      'popup-a11y': 'popup-a11y.png',
      'feed-before': 'feed-before-after-before.png',
      'feed-after': 'feed-before-after-after.png',
    });
  });

  test('release evidence diagnostics templates remain checklist-aligned', () => {
    expect(RELEASE_EVIDENCE_DIAGNOSTIC_TEMPLATE_MAP).toEqual({
      'console-clean': 'console-clean.md',
      'network-summary': 'network-summary.md',
    });
  });

  test('capture filename resolver preserves template names and fallback suffix behavior', () => {
    expect(resolveCaptureFileName('feed-blacklist', { template: 'feed-before' }))
      .toBe('feed-before-after-before.png');
    expect(resolveCaptureFileName('popup-shell', { template: 'popup-a11y' }))
      .toBe('popup-a11y.png');
    expect(resolveCaptureFileName('sidebar-news-games', { suffix: 'both-hidden' }))
      .toBe('sidebar-news-games-both-hidden.png');
  });

  test('diagnostic filename resolver preserves template names and fallback suffix behavior', () => {
    expect(resolveDiagnosticFileName('release-evidence', { template: 'console-clean' }))
      .toBe('console-clean.md');
    expect(resolveDiagnosticFileName('release-evidence', { template: 'network-summary' }))
      .toBe('network-summary.md');
    expect(resolveDiagnosticFileName('popup-shell', { suffix: 'warnings' }))
      .toBe('popup-shell-warnings.md');
  });

  test('diagnostics capture config is disabled by default', () => {
    var cfg = getSmokeDiagnosticsConfig();
    expect(cfg.enabled).toBe(false);
    expect(cfg.runLabel).toBeTruthy();
    expect(cfg.scopeLabel).toBeTruthy();
  });

  test('network diagnostics can include outbound requests even when responses are absent', async () => {
    var originalEnv = process.env.HU_E2E_CAPTURE_DIAGNOSTICS;
    process.env.HU_E2E_CAPTURE_DIAGNOSTICS = '1';

    var writes = [];
    var originalWriteFile = fs.promises.writeFile;
    var originalMkdir = fs.promises.mkdir;

    fs.promises.writeFile = async function (filePath, content) {
      writes.push({ filePath: filePath, content: String(content || '') });
    };
    fs.promises.mkdir = async function () {};

    try {
      var page = {
        on: function () {},
        __huE2eDiagnostics: {
          consoleMessages: [],
          requests: [
            { method: 'POST', url: 'https://telemetry.example.com/collect' },
          ],
          responses: [],
        },
      };

      await captureOptionalDiagnostics(page, 'release-evidence', {
        captureConsole: false,
        captureNetwork: true,
        networkTemplate: 'network-summary',
      });

      var networkWrite = writes.find(function (entry) {
        return entry.filePath.indexOf('network-summary.md') !== -1;
      });
      expect(networkWrite).toBeTruthy();
      expect(networkWrite.content).toContain('https://telemetry.example.com/collect');
      expect(networkWrite.content).toContain('- Total requests: 1');
    } finally {
      if (typeof originalEnv === 'undefined') delete process.env.HU_E2E_CAPTURE_DIAGNOSTICS;
      else process.env.HU_E2E_CAPTURE_DIAGNOSTICS = originalEnv;
      fs.promises.writeFile = originalWriteFile;
      fs.promises.mkdir = originalMkdir;
    }
  });
});
