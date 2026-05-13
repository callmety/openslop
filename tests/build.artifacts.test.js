const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const DIST = path.join(ROOT, 'dist');

function listZipEntries(zipPath) {
  const output = execSync(`unzip -Z1 "${zipPath}"`, {
    cwd: ROOT,
    stdio: ['ignore', 'pipe', 'inherit'],
  }).toString('utf8');
  return output
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);
}

describe('build artifact packaging contract', () => {
  beforeAll(() => {
    execSync('npm run build', {
      cwd: ROOT,
      stdio: 'inherit',
    });
  });

  test('chrome zip contains only runtime roots with manifest.json', () => {
    const zipPath = path.join(DIST, 'openslop-chrome.zip');
    expect(fs.existsSync(zipPath)).toBe(true);

    const entries = listZipEntries(zipPath);
    expect(entries).toContain('manifest.json');
    expect(entries).toContain('background.js');
    expect(entries).toContain('shared/chrome-api.js');
    expect(entries.some((entry) => entry.indexOf('shared/') === 0)).toBe(true);
    expect(entries.some((entry) => entry.indexOf('content/') === 0)).toBe(true);
    expect(entries.some((entry) => entry.indexOf('popup/') === 0)).toBe(true);
    expect(entries.some((entry) => entry.indexOf('icons/') === 0)).toBe(true);

    expect(entries).not.toContain('manifest.firefox.json');
    expect(entries).not.toContain('background.firefox.js');
    expect(entries.some((entry) => entry.indexOf('tests/') === 0)).toBe(false);
    expect(entries.some((entry) => entry.indexOf('docs/') === 0)).toBe(false);
    expect(entries.some((entry) => entry.indexOf('artifacts/') === 0)).toBe(false);
    expect(entries.some((entry) => entry.indexOf('.DS_Store') !== -1)).toBe(false);
  });

  test('firefox zip ships renamed manifest.json and excludes source-only files', () => {
    const zipPath = path.join(DIST, 'openslop-firefox.zip');
    expect(fs.existsSync(zipPath)).toBe(true);

    const entries = listZipEntries(zipPath);
    expect(entries).toContain('manifest.json');
    expect(entries).not.toContain('manifest.firefox.json');
    expect(entries).toContain('background.firefox.js');
    expect(entries).toContain('shared/chrome-api.js');
    expect(entries.some((entry) => entry.indexOf('shared/') === 0)).toBe(true);
    expect(entries.some((entry) => entry.indexOf('content/') === 0)).toBe(true);
    expect(entries.some((entry) => entry.indexOf('popup/') === 0)).toBe(true);
    expect(entries.some((entry) => entry.indexOf('icons/') === 0)).toBe(true);

    expect(entries).not.toContain('background.js');
    expect(entries.some((entry) => entry.indexOf('tests/') === 0)).toBe(false);
    expect(entries.some((entry) => entry.indexOf('docs/') === 0)).toBe(false);
    expect(entries.some((entry) => entry.indexOf('artifacts/') === 0)).toBe(false);
    expect(entries.some((entry) => entry.indexOf('.DS_Store') !== -1)).toBe(false);
  });
});
