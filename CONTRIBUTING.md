# Notes for forkers

**This project is unmaintained.** PRs, issues, and contact attempts
will not be triaged. The repo is left up as source code under the
[PolyForm Noncommercial 1.0.0](./LICENSE) license: you can fork,
modify, and redistribute it for any **noncommercial** purpose
(personal, hobby, study, nonprofit, education, research, government).
**Selling it — or any product or service that incorporates it — is
not permitted.** Read the LICENSE file in full before doing anything
beyond personal use. This file is a map for the technical side of
that fork.

The detection layers (presets, slop scorer) are site-agnostic. The
rest is one site adapter; adding adapters for other sites is the
main extension path.

## Development loop

```bash
# Setup (Node 20+)
npm install

# The full pre-PR check
npm run verify:release        # typecheck + lint + format-check +
                              # no-console + no-network + branding +
                              # jest + build + manifest validation +
                              # Playwright smoke

# Tighter inner loops
npm test                      # jest unit tests
npm run lint                  # eslint, --max-warnings=0
npm run test:e2e:smoke        # one Playwright spec, requires Chromium
npm run audit:branding        # legacy-name + denylist guard
```

### Loading the unpacked extension

**Chrome / Edge / Brave / Chromium**
1. `chrome://extensions`
2. Toggle **Developer mode**
3. **Load unpacked** → select this repo root

**Firefox**
1. `about:debugging#/runtime/this-firefox`
2. **Load Temporary Add-on** → select `manifest.firefox.json`

After a code change, hit the reload button on the extension card; the
content script reattaches on the next page load on the matched host
(full reload, not just SPA navigation).

## Read this before touching code

[`ARCHITECTURE.md`](./ARCHITECTURE.md) is the map. It points out which
layers are site-agnostic versus which belong to the current adapter.

## How to add a new preset term

1. Open [`shared/presets.js`](./shared/presets.js).
2. Find the category that best fits (or, if genuinely none fit, add a
   new category — categories drive the slider stops, so don't add one
   that isn't pulling its weight).
3. Add a new `{ id, text }` entry. **The `id` is a forever-stable
   identifier** — pick something descriptive and don't rename it later
   (users have it serialized in their settings). The format is
   `<cat-prefix>-<short-slug>`, e.g. `aih-from-one-insight-uncovered-by-ai`.
4. Add a test in [`tests/presets.test.js`](./tests/presets.test.js)
   asserting that the term is enabled at the expected slider level
   via `getSliderManagedTermIdsAtLevel(level)`.
5. Run `npm test` and `npm run audit:branding`.

> **Don't add slur terms or any of the historical NSFW catalog stems.**
> `npm run audit:branding` will fail the build and `scripts/audit-branding.js`
> documents why.

## How to fix DOM drift in an existing site adapter

1. Reproduce: load the extension, browse the surface that's broken,
   open DevTools, inspect the card that's no longer being recognized.
2. Find the relevant selector group in
   [`shared/constants.js`](./shared/constants.js). Most large sites
   heavily class-obfuscate their DOM, so most selectors there are
   `data-*`, `aria-label`, or structural.
3. Add (don't replace) the new selector; old layouts coexist with new
   ones for weeks during rollouts.
4. Cover with a fixture in `tests/e2e/fixtures/` if the change touches
   the smoke path; otherwise a unit test in
   `tests/content.detectors.test.js`.

## How to add a site adapter for a new platform

The seams are: card resolution (`content/modules/card-resolver.js`),
text extraction (`content/modules/text-extractors.js`), the selector
groups in `shared/constants.js`, and the manifest `matches` /
`host_permissions` entries. The popup, scorer, observer, storage, and
session stats don't need to change.

In your fork, expect to:

1. Add the new host to both `manifest.json` and
   `manifest.firefox.json` (same `matches` list in both).
2. Add (or replace) selector groups in `shared/constants.js`.
3. If the new site has a fundamentally different card shape, generalize
   `card-resolver.js` and `text-extractors.js` or branch by host.
4. Add fixture pages under `tests/e2e/fixtures/` so the Playwright
   smoke spec covers the new site.

## Test gates (kept in CI for the source as it stands)

`npm run verify:release` runs all of these and any fork that wants the
existing gates can keep them as-is:

- `typecheck` (no-op for this JS-only repo; kept as a fork-friendly seam)
- ESLint (`--max-warnings=0`)
- format check
- `check:no-console` (no `console.*` in shipped code)
- `check:no-network` (no `fetch`, `XMLHttpRequest`, `WebSocket`,
  `sendBeacon`, or `EventSource` in shipped code — see `PRIVACY.md`)
- `audit:branding` (legacy product-name + base64 denylist guard)
- Jest unit suite (205 cases across 16 files)
- Chrome + Firefox zip build
- Manifest validation
- Playwright extension smoke spec

## Renaming your fork

If you're publishing your fork under a different name, the surface to
update is small. After cloning:

1. **`package.json`** — `name`, `repository.url`, `homepage`.
2. **`manifest.json`** and **`manifest.firefox.json`** — `name`,
   `description`, and (if you're targeting different hosts)
   `host_permissions` + `content_scripts.matches`.
3. **`scripts/build-chrome-zip.js`** and **`build-firefox-zip.js`** —
   the `OUTPUT_ZIP` filename in each.
4. **`scripts/audit-branding.js`** — `LEGACY_NAME_RE` currently scrubs
   OpenSlop's prior project name. If you want it to also scrub
   "OpenSlop" itself, add `openslop` to the regex; otherwise leave it.
5. **`icons/`** — replace `icon16.png`, `icon32.png`, `icon48.png`,
   `icon128.png` with your own.
6. **`README.md`** — update the CI / license badge URLs to your fork's
   repo path, swap the screenshot at `docs/popup-screenshot.png`, and
   re-word any first-person references.
7. Optionally: rename string mentions of "OpenSlop" in `CLAUDE.md`,
   `ARCHITECTURE.md`, `PRIVACY.md`, and `popup/popup.html`'s `<title>`.
8. Run `npm run verify:release` to confirm everything still passes.

## Troubleshooting

**A card isn't being filtered.** The ground-truth signal is the
`data-hu-slop-trigger` attribute the content script writes onto every
classified card. Open DevTools, inspect the card, and check whether
the attribute is set:

- Attribute present (e.g. `data-hu-slop-trigger="ai-filter"` or
  `"heuristic-threshold-N"`) → detection worked, presentation may not
  have. Check your hidden-item mode (Audit / Minimize / Hide) and the
  CSS in `content/content.css`.
- Attribute absent → detection didn't fire. Walk up to
  `content/modules/post-evaluator.js` → `getPostDecision()` and trace
  why each branch returned an empty decision.

**Settings look stuck or stale.** Open the browser's extension storage
inspector (Chrome: DevTools → Application → Storage → Extension
Storage; Firefox: about:debugging → Inspect → Storage). The two keys
that matter live under `chrome.storage.sync` (settings) and
`chrome.storage.local` (session counters). Deleting them resets to
defaults on next page load.

**The popup donut shows zero after a fresh page load.** Session
counters are scoped to the browsing session; they reset on every
content-script boot. That's the design, not a bug.

## Code of conduct

`CODE_OF_CONDUCT.md` is in the repo for forks that want to keep it.
Since this project is unmaintained, it is not actively enforced
here — your fork's behavior is your call.
