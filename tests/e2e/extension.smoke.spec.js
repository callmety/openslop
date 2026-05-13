const fs = require('fs');
const path = require('path');
const { test, expect } = require('@playwright/test');
const {
  launchExtensionContext,
  openPopupPage,
  openLinkedInFixturePage,
  mountFixtureHtml,
  captureOptionalScreenshot,
  captureOptionalDiagnostics,
  seedSettings,
} = require('./harness');

function readFixture(name) {
  return fs.readFileSync(path.join(__dirname, 'fixtures', name), 'utf8');
}

const FEED_FIXTURE_HTML = readFixture('feed-smoke.html');

async function captureReleaseChecklistEvidence(page, template, options) {
  var safeOptions = options && typeof options === 'object' ? options : {};
  await captureOptionalScreenshot(page, template, Object.assign({}, safeOptions, { template: template }));
}

async function captureReleaseChecklistDiagnostics(page) {
  await captureOptionalDiagnostics(page, 'release-evidence', {
    captureConsole: true,
    captureNetwork: true,
    consoleTemplate: 'console-clean',
    networkTemplate: 'network-summary',
  });
}

async function remountFixtureBody(page, fixtureHtml, fixturePathname) {
  await mountFixtureHtml(page, fixtureHtml, {
    forcePathname: fixturePathname || '',
  });
}

async function ensureFixtureNode(page, selector, fixtureHtml, fixturePathname) {
  var initialCount = await page.locator(selector).count();
  if (initialCount > 0) return;
  await remountFixtureBody(page, fixtureHtml, fixturePathname);
  await expect(page.locator(selector)).toHaveCount(1);
}

test.describe('OpenSlop extension E2E smoke', () => {
  test('loads extension service worker and popup shell', async () => {
    const { context, extensionId, serviceWorker } = await launchExtensionContext();
    try {
      const popup = await openPopupPage(context, extensionId);

      // The popup is one screen with three mounted control cards plus a
      // session donut + live capsule. Each card is rendered into its mount
      // point by popup.js on boot.
      await expect(popup.locator('body')).toBeVisible();
      await expect(popup.locator('#panelTemp')).toBeVisible();
      await expect(popup.locator('#aiFilterMount > *')).toHaveCount(1);
      await expect(popup.locator('#slopSensitivityMount > *')).toHaveCount(1);
      await expect(popup.locator('#hiddenModeMount > *')).toHaveCount(1);
      await expect(popup.locator('#donutSvg')).toBeVisible();

      await captureOptionalScreenshot(popup, 'popup-shell', { suffix: 'overview' });
      await captureReleaseChecklistEvidence(popup, 'popup-a11y');
      await captureReleaseChecklistDiagnostics(popup);

      const workerUrl = serviceWorker.url();
      expect(workerUrl).toContain(`chrome-extension://${extensionId}`);

      await popup.close();
    } finally {
      await context.close();
    }
  });

  test('hides deterministic feed fixture card after blacklist seed', async () => {
    test.slow();
    const { context, extensionId } = await launchExtensionContext();
    try {
      const popup = await openPopupPage(context, extensionId);

      await seedSettings(popup, {
        blacklist: ['promoted noise sample'],
      });

      const feedPage = await openLinkedInFixturePage(context, '/feed/', FEED_FIXTURE_HTML);
      await ensureFixtureNode(feedPage, '#card-1', FEED_FIXTURE_HTML, '/feed/');

      await expect(feedPage.locator('#card-1')).toHaveAttribute('data-hu-hidden', '1');
      await expect(feedPage.locator('#card-1')).toHaveAttribute('data-hu-kind', 'post');
      await expect(feedPage.locator('#card-2')).not.toHaveAttribute('data-hu-hidden', /./);
      await captureOptionalScreenshot(feedPage, 'feed-blacklist', { suffix: 'after-hide', fullPage: true });

      await feedPage.close();
      await popup.close();
    } finally {
      await context.close();
    }
  });
});
