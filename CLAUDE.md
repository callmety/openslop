# OpenSlop — Claude session brief

**This project is unmaintained.** The original author is no longer
accepting bug reports, PRs, or other contact. This file is auto-loaded
by Claude Code in any fork that picks up the source; it's a fast
cold-start brief on how the code is laid out. Read
[`ARCHITECTURE.md`](./ARCHITECTURE.md) before touching code; read
[`CONTRIBUTING.md`](./CONTRIBUTING.md) for the dev loop.

## What this is

A Manifest V3 (Chrome) + Manifest V2 (Firefox) open-source extension
that hides AI-slop posts from a feed. The current build ships one site
adapter — the host matched by the manifests' `content_scripts.matches`
— but the engine (presets, scorer, observer, popup, storage) is
site-agnostic, and adding more adapters is the explicit extension path.

The popup is intentionally one screen: AI-filter toggle + 5-stop slop
sensitivity slider + hidden-item mode card + session donut + live
capsule. **That is the entire product surface.** If a popup-side
feature isn't in `popup/popup.html`, it does not exist.

No network calls of any kind. The privacy contract enforced in
[`PRIVACY.md`](./PRIVACY.md) is load-bearing — do not introduce `fetch`,
`XMLHttpRequest`, beacons, or telemetry. (`npm run check:no-console`
also keeps `console.*` out of shipped code.)

## Where things live

- `popup/` — toolbar UI, a single IIFE in `popup.js`. Section banners
  (`§1`, `§2`, `§8`, `§16`, `§19`, `§25b`, `§26b`, `§26c`, `§26d`)
  split it. Numbering is intentionally non-contiguous — gaps mark removed
  surfaces.
- `content/` — runs on every page of the matched host(s).
  `content-script.js` is one large IIFE (sections `§1`…`§26`).
  `observer.js`, `matcher.js`, and six modules under
  `content/modules/` are loaded as separate files because MV3
  plain-script loading has no module scope sharing.
- `shared/` — code loaded by both popup and content script:
  `constants.js`, `presets.js`, `storage.js`, `normalize.js`,
  `chrome-api.js`.
- `scripts/` — build + verification. `audit-branding.js` is a CI gate.
- `tests/` — Jest (`*.test.js`, 16 files / 205 cases) + one Playwright
  spec at `tests/e2e/extension.smoke.spec.js` (2 cases, ~4s).

## Hard rules

1. **No slurs in source.** The repo was forked from a larger extension
   that had an NSFW preset catalog; that catalog was removed and git
   history was rewritten to scrub it. `scripts/audit-branding.js`
   carries a base64-encoded denylist that fails the build on regression.
   This script's own source contains no slur strings literally; if you
   modify it, keep that property.
2. **`npm run verify:release` is the gate.** All ten steps must pass
   before pushing: typecheck, lint:ci, format:check, check:no-console,
   check:no-network, audit:branding, test:extension (jest),
   build:extension, validate:extension, test:e2e:extension (Playwright).
   CI runs the same chain.
3. **Tests assert on `data-hu-slop-trigger`** for slop-detector
   classification, not on a review-queue mock. That review queue was
   removed; the trigger reason now lives on the card itself as a DOM
   attribute. Don't bring the queue back without a real reader.
4. **Manifest stays in lockstep.** `manifest.json` (MV3) and
   `manifest.firefox.json` (MV2) must list the content-script files in
   the same order. `validate:extension` catches divergence.

## Current cleanup state

The repo just finished a long cleanup sprint. Source dropped from
~27.5k → ~7.9k LOC across `shared/`, `content/`, and `popup/`.
`popup.css` 7,857 → ~1,200. The 42-detector site-specific
feed-filter engine (promoted/suggested/recruiter/premium/
notifications/etc.) was ripped on 2026-05-12 along with its popup
disclosure — see Advanced Filters removal note below.

`dist/openslop-chrome.zip` is built fresh by `verify:release`.

## What's left

**Nothing in the engine-ahead-of-UI queue.** The product surface is
exactly the four popup cards: AI filter, slop sensitivity slider,
hidden-item mode, and the session donut/live capsule. No detector
runs without a popup control behind it.

Recent removals (chronological):

- **2026-05-12 (later)** — Advanced Filters disclosure + 42-detector
  engine ripped (`HU_FEED_TOGGLE_REGISTRY`, `feedFilters` schema,
  `content/modules/promoted-suggested.js`, `activity-noise.js`,
  `feature-detectors.js`, §10/§12/§13/§14/§21 of `content-script.js`).
  Wholesale ~1,800 LOC delete. The product is now post-card-only
  (AI filter + slop slider + hidden-item mode); jobs/messaging/
  notifications/comments-row evaluators went with it. A future
  contributor wanting to add site-specific filters (for any site)
  will design the UX and storage schema together.
- **2026-05-12 (earlier)** — Author/company muting + snooze + trust +
  allowlist surfaces removed entirely.

The pure-cleanup queue is empty — every symbol in
`shared/storage.js`'s `/* exported */` directive has at least one
external consumer.

If you're not sure what to work on: there isn't a prescribed "next
thing." The product surface is the intended one. Pick what the user
asks for; otherwise watch for site-adapter DOM drift in
`shared/constants.js`. Adding adapters for new sites is the project's
top-priority extension path — see `CONTRIBUTING.md`.

## Workflow tips

- **One concern per commit.** The diffs are easier to review and the
  CHANGELOG already follows that pattern.
- **Run the gate locally before pushing.** `npm run verify:release`.
  Playwright needs Chromium; `npm run test:e2e:install` (one-time).
- **Keep CHANGELOG `[Unreleased]` in sync.** Every cleanup commit
  bumps it. The previous sessions are a good template.
- **Don't bypass hooks** (`--no-verify`) or sign-off flags. If a hook
  fails, fix the underlying issue.

## Resuming an autonomous cleanup session

The cleanup queue is empty. If you find something else worth pruning:

1. Map the surface area — usually a grep for the function name across
   `content/`, `shared/`, `popup/`, `tests/`.
2. **Distinguish dead code from missing UI.** A function with no
   non-test callers can still be live behavior if its caller is the
   test harness driving real detector code. Read the assertions, not
   just the references.
3. One coherent commit per logical layer. Run `verify:release` after
   each, push when green.
4. Update `ARCHITECTURE.md` and `CHANGELOG.md` `[Unreleased]` to match.

The pre-cleanup backup branch has been deleted; `git log` on `main`
is now the canonical history. The slur scrub used `git filter-branch`
in two passes (quoted-form + word-boundary); if anything new shows up
that should be scrubbed historically, the same approach works.
