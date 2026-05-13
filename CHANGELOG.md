# Changelog

All notable user-visible changes to OpenSlop are recorded here. Format
follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/); the
project follows [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Changed
- **AI-filter toggle relabeled.** The popup AI-filter toggle is now
  labeled "Hide AI Posts" (was "Hide AI") so it parallels the slop
  slider's "Slop Sensitivity" card and reads more concretely on first
  glance. Aria-label updated to match. The slop slider keeps its
  "Slop Sensitivity" title, and the on-screen sensitivity badge
  ("Off / Light / Medium / Strict / 🔥 Scorched Earth") and per-level
  forecast drawer are untouched.
- **`docs/popup-screenshot.png` regenerated** to show the current
  "Hide AI Posts" label, captured from a viewport with no personal
  profile thumbnail visible. Donut counters reflect a longer session
  (22 hidden — AI Post 17 / AI Slop 5). README alt text updated to
  match the new counts.
- **README install section rewritten as a 60-second TL;DR.** Now
  includes the previously-implicit "step 0: get the folder" (Download
  ZIP or git clone), two side-by-side tables for browser-specific
  steps, and an explicit Firefox-temporary-add-on caveat noting that
  unsigned add-ons don't persist across restarts on stable Firefox.
- **Fresh-install defaults raised to "filter on, filter hard."**
  `HU.DEFAULT_SETTINGS.slopSensitivityLevel` 0 → 4 (Scorched Earth)
  and `HU.DEFAULT_SETTINGS.aiFilterEnabled` false → true, so a
  brand-new install does its job from the first page load instead
  of sitting inert until the user opens the popup. `normalizeSettings`
  now distinguishes "field missing" (apply DEFAULT_SETTINGS) from
  "field present" (run through the existing normalizer), so existing
  users keep whatever level/toggle they had — no silent upgrade-time
  bump. Six regression tests added in `tests/storage.test.js` covering
  fresh-install defaults, explicit-0 preservation, explicit-false
  preservation, and non-boolean coercion.
- **README / ARCHITECTURE / CLAUDE / CONTRIBUTING reconciled against
  current code.** Test counts updated (16 jest files / 205 cases — was
  18 / ~555); `verify:release` step count updated (10 — was 9 —
  `check:no-network` was missing from the lists); LOCs refreshed for
  `popup.html`, `popup.js`, `popup.css`, `content-script.js`, and
  `constants.js`; the dropped "UI-filter toggles" mention in
  `constants.js`'s row removed (the html-level toggle registry was
  ripped on 2026-05-12); cleanup-history figure refreshed from
  ~27.5k → ~16k LOC to ~27.5k → ~8.3k LOC to reflect the subsequent
  ~6.9k sweep.
- **`content/content-script.js` section header banner** rewritten to
  list only the twelve sections still present in the body (§1, §4,
  §7, §8, §15, §16, §17 [tombstone], §18, §19, §22, §23, §24, §26).
  The previous banner enumerated ten sections that were ripped during
  the 2026-05-12 sweeps (§2 muted authors, §3 session author limiting,
  §6 activity noise, §9–§14 of the 42-detector engine, §21 specialised
  evaluators). Body section banners remain authoritative.

### Removed
- **Dead category metadata.** The post-evaluator only emits four
  kinds — `'ai-filter'`, `'ai-slop'`, `'post'`, `'serious-mode'` —
  plus an `'unknown'` fallback when a hide decision lacks a kind.
  Every other entry in the donut/legend label, icon-path, and color
  tables was leftover from the ripped 42-detector engine and could
  never appear in the live tally. Trimmed:
    - `content/content-script.js` `KIND_LABELS`: 57 entries → 5.
    - `popup/popup.js` `REVIEW_KIND_LABELS`: 50 entries → 5.
    - `popup/popup.js` `DONUT_KIND_ICON_PATH`: 53 entries → 4
      (deduped the two AI-robot SVG paths into a shared constant).
    - `popup/popup.js` `NON_HUSH_TALLY_KINDS` + `isHushTallyKind`:
      removed (only filtered `degree-filter`, which the engine no
      longer emits). Inlined the remaining `tally[k] > 0` check.
    - `popup/popup.js` `toDonutTitleCase`: dropped the `OTW` / `PYMK` /
      `INMAIL` casing branches (those kinds no longer exist).
    - `shared/constants.js` `ACTIVITY_KIND_COLORS`: 53 entries → 4,
      plus the 25-line eero-palette preamble. `statsColor()` already
      falls back to slate `#94A3B8`, so future kinds render correctly
      without an explicit color.
  Net ~340 LOC removed; verify:release green.
- **`canonicalizeEntityKey` and its tests.** The function lived in
  `shared/storage.js` to derive a stable per-author key for the
  per-author post-cap feature; that feature was ripped in 2026-05-12
  along with the rest of the muting/snooze/allowlist surfaces, but
  the canonicalizer survived as dead code with no production callers
  — only the storage test exercised it. Removed the function, its
  60-line section comment, its `/* exported */` directive entry, and
  the 58-line `describe('canonicalizeEntityKey()')` block in
  `tests/storage.test.js`. Restores CLAUDE.md's "every symbol in
  `/* exported */` has at least one external consumer" invariant.
- **Donut empty state** no longer renders the "No data yet / Browse your
  feed…" prose placeholder. Instead it shows the gray ring plus two
  dimmed legend tiles (AI Post + AI Slop) with count `0`, so the popup
  reads as a calibrated, ready-to-fill dashboard before the first hide
  event lands instead of an awkward half-rendered state. `.donut-empty*`
  CSS removed; replaced by a single `.donut-legend__item--zero` modifier.
- **Extension icon** is now the public-domain
  ["No AI art" symbol](https://commons.wikimedia.org/wiki/File:No_AI_art.svg)
  from Wikimedia Commons (red circle-and-slash over "AI"), replacing the
  previous PNGs. SVG source committed alongside the four manifest-required
  rasterizations; see `icons/CREDITS.md` for regeneration.

### Removed
- **Out-of-scope detector infrastructure** that survived the 2026-05-12 popup
  rip but kept running. The 42-detector engine had its popup disclosure deleted
  earlier; this pass deletes the underlying machinery so the codebase actually
  matches the documented "post-card-only" product surface (AI filter + slop
  slider + hidden-item mode):
    - `content/content-script.js`: deleted §17 (UI Filter Application) entirely
      — ~5,150 LOC including all messaging-shell tagging
      (`data-hu-messaging-shell` / `-ad-rail` / `-layout` / `-main`),
      jobs main-module tagging (`data-hu-jobs-main-module`), sidebar/profile
      module tagging (`data-hu-sidebar-module`, `data-hu-profile-module`),
      premium-banner/sidebar-ads/MyNetwork-ads/whole-feed/auto-expand-more
      handlers, the WVMP/global-nav/share-box/left-profile/news-chrome
      refresh markers, and every `refresh*Markers` helper. Replaced with a
      one-line `applyUiFilters()` no-op so §24 + §26 callers still resolve.
    - `content/content-script.js` §22 `scanRoot`: dropped every `if
      (uiFilters.X) refresh*Markers(...)` branch — the scanner now does only
      what the popup advertises (resolve post cards, evaluate them).
    - `content/content-script.js` §24 + §26: dropped `feedFilters` /
      `uiFilters` debug telemetry counters and the `refreshLeftRailModuleMarkers`
      / `enqueueMixedNewsChromeRefresh` / `enqueueJobsMarkerRefresh` boot
      timers.
    - `content/content-script.js`: dropped the never-read
      `sessionStartedAt` chrome.storage write, `countTrueFlags` helper,
      `debugJobsLog` / `debugJobsReject` jobs-only debug helpers.
    - `content/content.css`: 1,890 → 149 lines. Kept only `[data-hu-hidden]`,
      `[data-hu-dimmed]`, `[data-hu-audit]`, the feed-card wrapper-chain
      `:has()` collapse, and the `.hu-reason-strip*` styling. Dropped every
      sidebar/messaging/jobs/profile/premium/ads/global-nav rule.
    - `shared/storage.js`: trimmed `normalizeUiFilters` from ~50 keys to the
      4 popup-driven keys (`auditMode`, `dimMode`, `showHiddenReasons`,
      `showFeedCounter`). Deleted `LINKED_PREMIUM_UI_POLICY_KEYS`,
      `LINKED_ADS_UI_POLICY_KEYS`, `isLinkedPremiumUiPolicyKey`,
      `getLinkedPremiumPolicyState`, `setLinkedPremiumPolicyState`,
      `setLinkedUiPolicyValue`, `reconcileSettingsPolicy`,
      `enforceUiPolicy`, plus their wrapper calls in `getSettings` /
      `saveSettings`.
    - `shared/constants.js`: dropped `HU_UI_FILTER_GROUPS`,
      `deriveUiFilterState`, the `UI_FILTER_GROUPS` / `deriveUiFilterState`
      exports on `HU`, and emptied `HU.UI_ATTRS` (every entry was an
      html-level toggle for removed surfaces). Trimmed `DEFAULT_SETTINGS.uiFilters`
      from ~50 keys to 4 to match the new normalizer.
    - `content/observer.js`: dropped `data-promoted-id` from the observer's
      `attributeFilter` (no consumer remains).
    - `eslint.config.mjs`: removed the `setSessionStartedAt` global (function
      never existed; only a typeof-guarded fallback referenced it).
    - `tests/`: deleted `content.ui-filters.test.js` (4,438 lines of
      coverage for the ripped messaging/jobs/sidebar/profile surfaces) and
      `constants.ui-derive.test.js` (covered the removed
      `deriveUiFilterState`). Trimmed `storage.test.js` from 933 → ~480
      lines (dropped `normalizeUiFilters` exhaustive flag coverage,
      `reconcileSettingsPolicy` / `setLinkedUiPolicyValue` describe block,
      stale `HU_FEED_TOGGLE_REGISTRY` markers, `showOnlyDegrees` /
      `skip1stConnections` markers, and the `promoted` tally fixture).
      Updated `popup.boot.test.js` and `popup.accessibility.test.js`
      fixtures to drop the removed `hu_settings_filters` sync key + every
      `feedFilters` / `uiFilters` schema reference. Updated
      `observer.test.js` to assert the new 4-attr filter.
- Net: ~6,900 LOC removed across production + tests; the engine now does
  only what the popup advertises and nothing more.

### Added
- **`scripts/check-no-network.js` + CI gate** — mechanically enforces the
  `PRIVACY.md` no-network promise by failing the build on any
  `fetch(`, `XMLHttpRequest`, `new WebSocket`, `sendBeacon`, or
  `EventSource(` reference in shipped code. Wired into
  `verify:release` and the GitHub Actions `verify` job.
- **README popup screenshot** at `docs/popup-screenshot.png` so readers
  see the product surface before installing.
- **`CONTRIBUTING.md` "Renaming your fork" + "Troubleshooting" sections** —
  8-step rebrand checklist (package.json / manifests / build script
  zip names / branding audit regex / icons / README badges) plus the
  `data-hu-slop-trigger` debug recipe.

### Changed
- **`eslint.config.mjs` global declarations purged.** Removed 19 dead
  globals (`HU_FEED_TOGGLE_REGISTRY`, `canonicalizeMutedAuthorKey`,
  `getMutedAuthorMeta`/`getMutedCompanyMeta`/`saveMutedAuthorMeta`/
  `saveMutedCompanyMeta`, `getOwnProfileRecord`/`saveOwnProfileRecord`,
  `getQuickLinksState`/`saveQuickLinksState`, `isRegexTerm`/
  `parseRegexLiteral`, `getUiState`/`saveUiState`,
  `getSessionHistory`/`appendSessionSnapshot`,
  `HU_RECOMMENDED_TERM_IDS`/`getRecommendedPresetState`, plus unused
  background-process globals `OffscreenCanvas`/`createImageBitmap`/
  `btoa`/`Uint8Array`/`ArrayBuffer`/`Image`/`fetch`) — all of them
  pointed at symbols deleted in the 2026-05-12 sweeps. Dropping
  `fetch` from the globals list also doubles as a privacy gate: any
  accidental network call now fails `no-undef` lint.
- **`ARCHITECTURE.md`** broken link to a non-existent
  `.github/ISSUE_TEMPLATE/site_adapter_proposal.yml` replaced with an
  in-repo pointer to the relevant `CONTRIBUTING.md` section.
- **README** reconciled "three small cards and a session chart" / four-
  item list mismatch and added a zero-runtime-deps + no-published-
  releases note to the Project status section.

### Removed
- **Advanced Filters disclosure + 42-detector site-specific feed-filter engine** —
  the popup-side `#advancedFiltersMount` disclosure (`popup.js` §27),
  `HU_FEED_TOGGLE_REGISTRY` and the entire `feedFilters` settings field
  (including dormant numerics: `hideOlderThanDays`, `maxPostsPerAuthor`,
  `hideJobsOverApplicants`, `minPostWords`, `doomscrollTimerMins`,
  `batchFeedLimit`, `showOnlyDegrees`/`showOnlyDegreesMode`, legacy
  `aiSlopThreshold`), and every detector branch that consulted them.
  Affects:
    - `popup/`: dropped `#advancedFiltersMount`, §27 of `popup.js`
      (`buildAdvancedFiltersCard`, `ADVANCED_FILTER_GROUPS`, related
      helpers), ~145 lines of `.advanced-filters*` CSS, and
      `tests/popup.advanced-filters.test.js`.
    - `shared/constants.js`: removed `HU_FEED_TOGGLE_REGISTRY`,
      `HU_ACTIVITY_NOISE_FILTER_KEYS`, the `feedFilters` IIFE in
      `DEFAULT_SETTINGS`, and the `SETTINGS_FILTERS_KEY` sync bucket.
      Storage layout shrinks from four sync keys to three
      (`hu_settings`, `hu_settings_blacklist`,
      `hu_settings_preset_state`); `uiFilters` now lives in the core
      `hu_settings` payload.
    - `shared/storage.js`: removed `normalizeFeedFilters`,
      `normalizeShowOnlyDegrees`, `normalizeNonNegativeInt`, the
      `feedFilters` mirroring in `reconcileSettingsPolicy` /
      `setLinkedPremiumPolicyState` / `getLinkedPremiumPolicyState`,
      and the legacy `feedFilters.aiSlopThreshold` handling in
      `migrateSliderAuthority`.
    - `content/content-script.js`: dropped §3 (session author limiting),
      §6 (activity-noise patterns), §9 (promoted/suggested detectors),
      §10 (actor & entity metadata), §11 (own-profile fetch), §12
      (quick filter detectors), §13 (feature detectors), §14
      (mute-target context), §21 (specialised evaluators —
      comments/jobs/messaging/notifications/search-feedback/search-noise),
      `LINKEDIN_POST_DETECTORS_PRIMARY/SECONDARY`, `runFlagDetectors`,
      doomscroll timer, batch-feed banner, auto-expand "see more",
      auto-sort feed preference, and ~50 `feedFilters.*` reads in the
      root scanner. The shell shed roughly 1,800 LOC.
    - `content/modules/`: deleted `promoted-suggested.js`,
      `activity-noise.js`, `feature-detectors.js` entirely. Pared
      `scan-candidates.js` down to post-card collection only.
      Rewrote `post-evaluator.js` as a 60-line minimal evaluator
      (serious-mode → AI filter → blacklist → slop slider).
    - `manifest.json` + `manifest.firefox.json`: dropped the three
      deleted module entries; load list shrinks from 16 → 13 files.
    - `tests/`: deleted `content.detectors.test.js`,
      `content.feature-detectors.test.js`, the 257-line auto-expand
      block in `content.ui-filters.test.js`, the H3 registry contract
      block in `storage.test.js`, every `normalizeFeedFilters` /
      `showOnlyDegrees` / `batchFeedLimit` / numeric-threshold
      describe block, the obsolete e2e fixtures
      (`autosort.smoke.html`, `jobs.smoke.html`,
      `messaging.smoke.html`, `messaging-shell.smoke.html`,
      `notifications-premium.smoke.html`, `search-feedback.smoke.html`,
      `search-noise.smoke.html`, `sidebar-chrome.smoke.html`) and 14
      of the 16 Playwright smoke cases. Jest count: ~800 → ~555.
  The product surface is now post-card-only: AI filter + slop sensitivity
  slider + hidden-item mode + session donut. Anyone wanting site-
  specific filters will design both the UX and the storage schema
  together; this is a feature removal, not a "wire up dormant
  behavior" gap.

- **Author/company muting, snooze, trust, and the allowlist** — all
  list-management features that had never been exposed in the popup.
  This was the final engine-ahead-of-UI surface; rather than build
  out the UX (list rows, add-by-handle input, snooze duration picker)
  the feature itself was cut so the codebase matches the shipped
  product surface. Affects:
    - `shared/storage.js`: removed `normalizeMutedAuthors`,
      `normalizeMutedCompanies`, `normalizeTrustedAuthors`,
      `normalizeTrustedCompanies`, `normalizeSnoozeList`,
      `normalizeAllowlist`, `normalizeMutedEntityMeta`,
      `sanitizeDisplayName`, `isLinkedInAuthorKey`,
      `isLinkedInCompanyKey`, `isLinkedInEntityKeyOfKind`,
      `normalizeEntityKeyList`, `canonicalizeLinkedInProfileHref`,
      `getMutedAuthorMeta`, `getMutedCompanyMeta`,
      `saveMutedAuthorMeta`, `saveMutedCompanyMeta`, and the
      `migrateMetaToLocal` legacy migration (~360 LOC).
    - `shared/constants.js`: removed seven entries from
      `HU_SYNC_KEY_LAYOUT` / `SETTINGS_SYNC_KEYS` and seven default
      fields from `DEFAULT_SETTINGS`. Storage layout shrinks from
      ten sync keys to four (`hu_settings`, `hu_settings_filters`,
      `hu_settings_blacklist`, `hu_settings_preset_state`).
    - `content/content-script.js`: removed §2 lookup tables for
      muted/trusted/snoozed authors and companies, the `allowMatcher`
      and `isAuthorMuted`/`isCompanyMuted`/`isAuthorSnoozed`/
      `isCompanySnoozed`/`isAuthorTrusted`/`isCompanyTrusted`
      helpers, the per-feature wiring in `applySettingsToRuntime`,
      the messaging muted-sender filter, the jobs muted-company
      filter, and the `hasActiveFeedFilters` / debug-log fields
      that referenced the removed state.
    - `content/modules/post-evaluator.js`: removed the early-exit
      blocks for muted/snoozed/trusted/allowlist (~30 LOC). The
      kept evaluator now starts from connection-degree filtering.
    - `tests/`: removed the precedence-ordering tests, all
      normalizer unit tests, and the `getMutedAuthorMeta`/
      `saveMutedAuthorMeta` round-trip tests. Jest count: 891 → ~800.
  Renamed `canonicalizeMutedAuthorKey` → `canonicalizeLinkedInEntityKey`
  to reflect what the function actually does (the only remaining
  consumer is `getSessionAuthorOrdinal`, which uses the canonical
  per-author key to enforce the per-session author cap).

### Changed
- **Donut center label is now static `hidden`.** The metric dropdown in
  the donut hub (Hidden / Shown / Noise %) is gone — `popup.html` drops
  `#donutMetricTrigger`/`#donutMetricMenu`, `popup.js` drops
  `DONUT_METRIC_LABELS` and every `donutMetric*` helper
  (sync/open/close/select + the docClick/Keydown/Focusin guards), and
  `popup.css` drops the `.donut-metric-*` + `.donut-center__metric-anchor`
  rules. `renderDonut` no longer reads `uiFilters.headerStatMetric` —
  it always shows the hidden total.
- **Donut vertical breathing room equalised.** `.temp-panel`
  `padding-bottom` was `14px`; now uses `var(--temp-tile-gap)` so the
  space below the donut matches the 6 px gap above it.
- **Slop slider "?" is now an in-popup overlay.** Clicking the help
  pip pins `document.body.offsetHeight` (so the extension keeps the
  same outer size), toggles `body.help-open`, and hides
  `#aiFilterMount`, `#hiddenModeMount`, `.donut-panel__inner`,
  `#liveCapsule`. CSS under `body.help-open` flex-stretches
  `.temp-panel → #slopSensitivityMount → .slop-slider-card →
  .slop-slider-card__body → .slop-debug-drawer` and gives the drawer
  `overflow-y: auto`, so the per-level descriptions scroll inside the
  pinned popup instead of growing it. `padding-bottom` flips back to
  `var(--temp-page-pad)` in this mode so the card sits with equal 12 px
  margins top and bottom.

- Bumped `jest` 29 → 30 and `jest-environment-jsdom` 29 → 30, which
  pulls in a jsdom that doesn't depend on the vulnerable
  `@tootallnate/once` / `http-proxy-agent` chain. `npm audit` is now
  clean (`found 0 vulnerabilities`). All 891 jest cases still pass
  unchanged on jest 30; no test code edits were required. (Test
  count rebaselined to ~800 in the same release after the list-feature
  rip above.)

### Fixed
- `npm run verify:release` now runs `audit:branding` as a gate step. CI
  was already running it, but the local "the gate" claim in
  [`CLAUDE.md`](./CLAUDE.md) and [`CONTRIBUTING.md`](./CONTRIBUTING.md)
  was a step short, so a contributor passing the local script could
  still fail CI on a branding regression.
- `scripts/audit-branding.js` `LEGACY_NAME_RE` now actually matches the
  prior product name token the rename was supposed to scrub (see the
  script's own header comment — the script skips itself so the literal
  reference there doesn't trip the guard). The previous pattern was
  looking for an unrelated token, so the legacy-name regression guard
  was effectively a no-op.
- Issue templates pointed at nonexistent `ROADMAP.md` and
  `docs/ARCHITECTURE.md`. Re-pointed to `CONTRIBUTING.md` (anti-goals)
  and `ARCHITECTURE.md` (real file).
- `content/content-script.js` section header listed `§5 Selection
  Capture` and `§25 Message Listener` that don't exist in the body;
  updated to match the body banners and noted the intentional gaps.
- Stat drift in `CLAUDE.md` / `ARCHITECTURE.md` / `README.md` (test
  file count, popup.css line count, total LOC, zip size) refreshed to
  match current reality.
- `PR template` now points contributors at `npm run verify:release`
  (the actual gate) instead of `npm test` + `npm run lint` alone.
- `CLAUDE.md` / `ARCHITECTURE.md` no longer list "trim
  `shared/storage.js` `/* exported */`" as an open cleanup item — every
  symbol in that directive has at least one external consumer; the
  cleanup was already done in an earlier sprint, the note was stale.

### Removed
- `openSectionLinksInNewTab` and `historyEnabled` settings fields.
  Neither had a live reader in production code; the latter was a
  vestige of the daily-history layer removed earlier this sprint.
  Plus the matching stale seedings in `tests/popup.*.test.js`,
  `tests/storage.test.js`, `tests/e2e/harness.js`, and the
  `e2e.harness.contract.test.js` assertion that pinned the
  `openSectionLinksInNewTab` literal.
- Profile-system settings fields that had no live reader:
  `quickSetupProfile`, `activeProfileId`, `activeProfileFingerprint`,
  and `profiles[]`. Their normalizer (`normalizeProfiles`), the
  `VALID_PROFILES` whitelist in `normalizeSettings()`, the matching
  entries in `DEFAULT_SETTINGS`, and the matching write fields in
  `saveSettings()` are gone. They came from a multi-profile quick-
  setup feature that was already removed; existing chrome.storage
  values simply get dropped on next normalize. ~30 LOC of storage
  code + ~100 LOC of tests removed.
- Dead `HU.*` metadata blocks in `shared/constants.js`:
  - `HU.MESSAGES` — five popup→content RPC names with no senders or
    handlers (the only handler, `HU_BINGO_SCAN`, was removed with the
    Bingo panel).
  - `HU.POPUP.TABS.MY_LIST` — tab ID for a multi-tab popup layout
    that no longer exists.
  - `HU.UI_FILTER_SECTIONS` — section metadata (label/icon/accent)
    for a Settings panel surface that no longer exists.
  - `HU.UI_FILTER_REGISTRY` — per-row UI metadata for the same
    nonexistent Settings panel. Unlike `HU_FEED_TOGGLE_REGISTRY` (which
    drives detector branches), this was pure UI labelling — zero
    runtime impact. The `tests/schema.contract.test.js` test that
    asserted registry/defaults alignment goes with it.
- 40+ unused CSS custom properties in `popup/popup.css` (both the
  dark `:root` block and the light-mode `@media` override):
  `--accent-hover`, every `--degree-accent-*` and `-subtle` variant,
  `--app-bg` / `--app-glass` / `--app-stroke*` (only
  `--app-highlight` is still consumed), `--border-subtle`,
  `--dot-amber` / `--dot-red` / `--dot-slate` (only `--dot-green`
  is live), `--radius-card` / `--radius-tile` / `--radius-dock`
  (only `--radius-pill` and the simple `--radius` / `-sm` / `-xs`
  scale are used), `--shadow-card` / `--shadow-dock`, `--text-1`,
  `--text`, every `--settings-*` design token (~27 tokens for the
  removed Settings panel), `--surface-trust` / `-snooze` / `-allow`
  / `-insights`, `--success` / `-subtle`, `--warning` / `-subtle`,
  `--info` / `-subtle`, `--danger-hover`, `--ease-spring`,
  `--font-mono`, `--dur-slow`.
- `getUiState` / `saveUiState` storage helpers + `HU.UI_STORAGE_KEY`
  + `HU.DEFAULT_UI_STATE`. A previous cleanup had removed every
  caller but left the implementation in `shared/storage.js`. No
  behavior change — the local-storage key was never being written.
- **Bingo panel** (~810 LOC across popup.js, popup.css, content-script.js).
  The panel was implemented end-to-end — popup grid + state persistence
  + active-tab message scan in the content script — but never wired
  into `popup/popup.html` (no `#bingoBtn` or `#bingoPanel` mount). Every
  handler short-circuited on a `null` element lookup; the
  `HU_BINGO_SCAN` message listener in `content-script.js` had no
  caller. With it: the `buildHistoryStyleItemCard` / `historyFormatTime`
  popup helpers, the `buildHistoryDedupeId` / `buildHistoryOpenUrl` /
  `buildHistorySnippet` content-side helpers (also bingo-only after
  the daily-history removal), the four unused popup chrome-api
  wrappers (`queryActiveTab`, `sendMessageToTab`, `localSet`,
  `localGet`), and most of `shared/chrome-api.js` (only
  `addStorageChangeListener` is still consumed by the live capsule).
- **`"tabs"` permission** from both `manifest.json` and
  `manifest.firefox.json`. Removing the bingo panel and the content-side
  message listener means no remaining use of `chrome.tabs.*` or
  popup→content message round-trips. `docs/PERMISSIONS.md` updated to
  match the smaller permission set.
- Dead popup.js handlers for DOM IDs that don't exist in `popup.html`:
  `#statusMsg` (showStatus toast — never reachable), `#powerBtnHome`
  (global on/off toggle — no UI surface), `#panelCategories` /
  `#panelUi` (panels the popup hasn't shipped since the multi-tab
  rewrite), and `#hmShown` / `#hmHidden` / `#hmRatio` (home-tab metric
  cells). With them: §4 (Status Messages), §5 (Power Toggle), and the
  `applyHomeMetrics` helper. The companion `.status`,
  `.temp-panel--disabled`, and `.temp-disabled-banner*` rules in
  `popup.css` go too. The live capsule and donut keep updating exactly
  as before; this just removes guarded handlers whose DOM targets were
  always `null`.

### Changed
- `low-signal-comments` and `inbox-cold-pitches` preset categories are
  now folded into slop sensitivity level 3 (Strict) instead of being
  managed via a never-written `presetState` carve-out. Net effect:
  users at level 3+ now actually get the CFBR / "great post!" /
  Calendly-funnel detections those categories already define.
- `migrateSliderAuthority` now drains `presetState` to `{}` on every
  legacy load (it used to preserve the manual carve-outs). All
  category enables go through the slider; legacy preset terms migrate
  to the user blacklist as before.

### Removed
- `HU_MANUAL_PRESET_CATEGORY_IDS` + `isManualPresetCategoryId` in
  `shared/presets.js`. Both categories the carve-out protected
  (`low-signal-comments`, `inbox-cold-pitches`) are now reachable
  through the slider.
- `HU_RECOMMENDED_TERM_IDS` + `getRecommendedPresetState` in
  `shared/presets.js`. Both were test-only after the "Recommended"
  quick-setup popup surface was removed.
- Historical NSFW preset catalog and the obfuscation-aware regex
  matcher that depended on it. The popup had no surface to enable
  them; the catalog was vestigial and contained slur strings that
  do not belong in a publishable repository.
- User-supplied regex literals in the custom blacklist
  (`buildUserRegex`, `analyzeRegexSafety`). No UI exposed this.
- `parseRegexLiteral` / `isRegexTerm` / `ALLOWED_REGEX_FLAGS` from
  `shared/normalize.js`; `canonicalizeBlacklistTerm` now simply
  returns `normalizeText(raw)` since the regex-literal canonical
  prefix had no live producer.
- Three no-op stubs in `popup.js` (`markQuickSetupCustom`,
  `updateBulkBtnState`, `renderHeaderStatRing`) and their five live
  call sites; also the dead `#headerStatRing` DOM lookup and the
  unreachable `if (headerStatRing) {…}` branch in the power toggle.
- `content/content-script.js` §20 mute-button injection (~405 lines):
  `injectMuteButtons`, `removeAllMuteButtons`, `makeMuteButton`,
  `showSnoozePickerOverlay`, `showMuteReasonOverlay`, the snooze
  picker overlay, the mute reason overlay, `persistMuteFromCard`,
  `persistSnoozeFromCard`, and `handleMuteClick`. No code path
  reached this section after the popup's muted-author surfaces were
  removed. Companion `.hu-mute-*`, `.hu-snooze-picker__*`, and
  `.hu-reason-overlay__*` rules in `content/content.css` (~210 lines)
  go with it.
- `clearDailyHistory` (storage.js) — no external caller. The
  internal history helpers it depended on stay because
  `appendHideHistoryBatch` still uses them.
- Three orphaned policy helpers in `shared/storage.js`:
  `isPolicyLockedUiFilterKey`, `isLinkedPremiumFeedPolicyKey`,
  `getLinkedPremiumPolicyFilterKeys`, plus their dedicated
  `LOCKED_UI_POLICY_KEYS` and `LINKED_PREMIUM_FEED_POLICY_KEYS`
  arrays — no callers anywhere.
- 5 helpers from `shared/chrome-api.js` (`sendMessageToActiveTab`,
  `clearSyncStorage`, `clearLocalStorage`, `clearStorageArea`,
  `createTab`, `updateTab`) — none had callers after the
  reset-all-settings + open-new-tab popup surfaces were removed.
- Three unreferenced SVG icons (`voice_selection.svg`,
  `voice_selection_off.svg`, `user-silhouette-svgrepo-com.svg`) —
  used by the deleted §20 mute injection and a removed profile
  overview. The build globbed `icons/*`, so all three were shipping
  inside both dist zips.
- Four Playwright e2e tests that drove popup UI surfaces which no
  longer exist (`#tabTemp`, `#termInput`, `#blockAdsMount`,
  `#powerBtnHome`, `#tabCategories`). They had been timing out at
  4.5 min each. Their content-script behavior is covered by other
  tests that seed `chrome.storage` directly. The boot smoke test
  was rewritten to assert on the live popup mounts.
- Dead test mocks for `saveMutedAuthorMeta`, `saveMutedCompanyMeta`,
  `getMutedAuthorMeta`, `getMutedCompanyMeta`, `saveSettings`, and
  `saveOwnProfileRecord` from `tests/content.detectors.test.js` +
  `tests/content.ui-filters.test.js` — the SUT (content-script.js)
  no longer references any of these.
- `removeFloatingOverlays` from `content/content-script.js` — its
  only query was for `.hu-snooze-picker, .hu-reason-overlay`, both
  of which were §20 classes.
- Own-profile + Quick-Links storage layer (`getOwnProfileRecord`,
  `saveOwnProfileRecord`, `getQuickLinksState`, `saveQuickLinksState`,
  `canonicalizeLinkedInProfilePath`) plus their `HU.OWN_PROFILE_KEY`
  and `HU.QUICK_LINKS` catalog in `shared/constants.js`. The popup
  surfaces those helpers powered (overview profile card, custom
  quick-links menu) were removed; the storage code had only test
  callers.
- Write-only review queue (`HU.REVIEW_QUEUE`, `getReviewQueue`,
  `appendReviewQueueEntry`, `clearReviewQueue`). The content script
  was appending to a chrome.storage.local ring buffer on every hide
  but nothing read from it. The one piece of metadata the tests
  cared about — `decision.slopTrigger` (which detector flagged the
  card) — is now exposed as a `data-hu-slop-trigger` DOM attribute
  on the card itself, which is both easier to inspect and free of
  storage I/O.
- Write-only author-counts flush (`HU.AUTHOR_COUNTS_KEY`,
  `getAuthorCounts`, `setAuthorCounts`, `normalizeAuthorCountsMap`).
  Same story: `sessionAuthorCounts` is still tracked in-memory and
  drives the per-author ordinal cap, but the debounced
  `setTimeout(flushAuthorCounts, 500)` writer had no consumer.
- Session-history write/read pair (`HU.SESSION_HISTORY_KEY`,
  `HU.SESSION_HISTORY_MAX`, `getSessionHistory`,
  `appendSessionSnapshot`). The content script's pagehide handler
  wrote a per-session breakdown to chrome.storage.local; the popup
  pulled it in `renderDonut`'s Promise.all but only consumed the
  sibling tally and feed-counter results.
- The entire daily-history layer (~14 helper functions across
  `shared/storage.js` + the `HU.HISTORY` constants block + the
  content-script writer chain: `pendingHistoryBatch`,
  `historyFlushTimer`, `historyEnabled` state,
  `measureHiddenAreaPx`, `queueHideHistoryEntry`,
  `flushHistoryBatch`, the visibilitychange + pagehide listeners,
  the `ensureHistoryMeta` boot/transition calls). The matching
  reader entry points — `getHistoryMeta`, `getHistoryMonth`,
  `getHistoryDay` — had only test callers. The bingo-only
  `buildHistorySnippet` keeps its 140-char snippet cap inlined.
- `getUiState` / `saveUiState` + `HU.UI_STORAGE_KEY` (popup never
  reads or writes them; tests + Playwright harness were the only
  consumers).
- `getSessionStartedAt` / `setSessionStartedAt` +
  `HU.SESSION_STARTED_AT_KEY` (test-only).
- `historyEnabled` field from `DEFAULT_SETTINGS`,
  `normalizeSettings`, and the split-sync `saveSettings` payload.

### Changed
- `scripts/audit-branding.js` now also fails on a base64-encoded
  denylist, so the removed slur stems cannot silently regress.
- `popup/popup.css` slimmed from 7,857 → 1,554 lines: 628 of 738
  selectors had no reference anywhere in `popup.html` or `popup.js`.
- `popup.js` section-header map at the top of the file rewritten to
  match the sections actually present (the previous map advertised
  long-removed surfaces like My List, muted authors, and history
  calendar).
- Bingo detail panel: `buildHistoryStyleItemCard` and
  `historyFormatTime` are now real implementations instead of
  empty-li / empty-string stubs, so the per-square hit list renders
  correctly for the first time since the upstream history
  drilldown was removed.
- `package-lock.json` updated via `npm audit fix` (non-breaking):
  resolves the high-severity `picomatch` advisories
  (GHSA-3v7f-55p6-f55p, GHSA-c2c7-rcm5-vvqj). The remaining four
  low-severity jsdom-tree items are now resolved by the jest 29 → 30
  bump documented in the `Changed` section above.

### Added
- `ARCHITECTURE.md` — file map, data flow, and an honest accounting
  of the engine-ahead-of-UI surfaces inherited from the upstream fork.
- `CONTRIBUTING.md` — scope, dev loop, and "how to add a preset term".
- `CODE_OF_CONDUCT.md`, `SECURITY.md`, `CHANGELOG.md`.
- `Branding / denylist audit` step in CI so the regression guard
  actually runs on every PR.

## [1.0.0] — 2026-05-13

First public release as OpenSlop. Single-screen popup: AI filter
toggle + 5-stop slop sensitivity slider + session donut chart.
