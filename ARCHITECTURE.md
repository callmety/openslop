# Architecture

A high-level map of how OpenSlop is wired, what each file owns, and where
the seams are. The engine is split site-agnostic vs. site-specific so
that adding adapters for other sites is the main extension path.

## TL;DR

```
┌─────────────────┐  chrome.storage.sync  ┌──────────────────────┐
│  popup/popup.*  │ ─────settings──────▶  │  content/            │
│  (toolbar UI)   │ ◀────session stats──  │  content-script.js   │
└─────────────────┘                       │  + observer + matcher│
                                          └──────────┬───────────┘
                                                     │
                                              observes DOM
                                                     │
                                          ┌──────────▼───────────┐
                                          │  site adapter        │
                                          │  (one ships today)   │
                                          └──────────────────────┘
```

Three independent processes that only talk through `chrome.storage`:

1. **Popup** (`popup/`) — toolbar UI. Reads/writes settings, renders the
   live session donut from stats the content script writes back.
2. **Content script** (`content/`) — runs on the matched host. Observes
   DOM mutations, scores posts, hides matches.
3. **Background** (`background.js`, `background.firefox.js`) — tiny
   service worker / event page. Currently a no-op skeleton, kept because
   MV3 requires a registered background entry.

No network calls. No message-passing between popup and content script
beyond `chrome.storage.onChanged` notifications.

## File map

### `popup/` — the toolbar UI

| File | Lines | Role |
| --- | --- | --- |
| `popup.html` | ~55 | Three mount points (AI filter, slop slider, hidden-mode) + donut SVG + live capsule. That's it. |
| `popup.js` | ~1,010 | All popup behavior in a single IIFE. Section markers (`§1` … `§26d`) split it into named regions. |
| `popup.css` | ~1,215 | Styles for the three controls + donut. |

### `content/` — the feed filter engine

| File | Role |
| --- | --- |
| `content-script.js` | The engine. ~2.3K lines, single IIFE, with non-contiguous section markers (`§1`, `§4`, `§7`, `§8`, `§15`, `§16`, `§18`, `§19`, `§22`, `§23`, `§24`, `§26`) — gaps are tombstones from earlier feature rips. Owns all DOM logic, scoring, hide/reveal. |
| `observer.js` | Wraps `MutationObserver` with debouncing + SPA-navigation detection. Hands batched dirty roots to the scanner. |
| `matcher.js` | Compiles a list of blacklist terms into a single `{ matches, firstMatch }` object. Hashtag-aware, Unicode-aware, Scunthorpe-safe. |
| `modules/contracts.js` | Tiny shim that initializes `window.__HUCS__.modules = {}` so module files can register into one shared namespace (MV3 has no `import`). |
| `modules/text-extractors.js` | Pull readable text out of post-card DOM (site-specific). |
| `modules/card-meta.js` | Extract card meta text and reactor-header text. |
| `modules/card-resolver.js` | Walk up from any mutation target to its enclosing post card. |
| `modules/scan-candidates.js` | Enumerate post-card scan targets in a dirty root. |
| `modules/post-evaluator.js` | The "should we hide this?" decision per card (AI filter + slop slider + serious-mode). Site-agnostic. |
| `modules/late-rescan-scheduler.js` | Re-checks cards whose first scan was inconclusive (text loaded after first paint). |

### `shared/` — code loaded by both popup and content script

| File | Role |
| --- | --- |
| `constants.js` | Site-adapter DOM selectors, scan thresholds, donut palette/labels, debounce/timer constants. ~1.1K lines — most of the volume is enumerated selectors because the current adapter's DOM drifts frequently. A new adapter would add (or replace) the selector groups here. |
| `presets.js` | The preset catalog: every term the slop slider can suppress, organised into named categories with stable IDs. Site-agnostic. Drives the 0–4 slider via `getSliderManagedTermIdsAtLevel(level)`. |
| `storage.js` | Wraps `chrome.storage.sync` and `chrome.storage.local`. Owns the settings schema, migrations, normalization, and session/tally writes. |
| `normalize.js` | `normalizeText`, `escapeRegex`, `canonicalizeBlacklistTerm`, and helpers for parsing/identifying user-supplied regex literals. |
| `chrome-api.js` | Promise-flavored wrappers around the callback-style `chrome.*` APIs. |

### `scripts/` — build & verification

| File | Role |
| --- | --- |
| `build-chrome-zip.js` | Produces `dist/openslop-chrome.zip` (MV3). |
| `build-firefox-zip.js` | Produces `dist/openslop-firefox.zip` (MV2). |
| `audit-branding.js` | CI guard: fails the build if any historical product-name token *or* any item from the (base64-encoded) denylist appears in source. |
| `check-no-console.js` | CI guard: no `console.*` calls in shipped code. |
| `preflight.sh` | Pre-push sanity check. |

### `tests/` — Jest + Playwright

16 Jest files (205 cases), one Playwright smoke spec (2 cases).
Loaded into a synthetic global scope by `tests/setup-globals.js`, since
the shipping code uses script-tag globals (no modules).

## Data flow

1. User flips a toggle / drags the slider in the popup.
2. `popup.js` writes the new settings to `chrome.storage.sync` via
   `saveSettings()`.
3. Every active matched-host tab's content script wakes on
   `chrome.storage.onChanged` (see §24 of `content-script.js`),
   re-derives the active blacklist via `getEffectiveBlacklist()`, and
   re-compiles the matcher.
4. The next observer flush re-evaluates every visible card with the new
   rule set; cards transition between hidden and shown.
5. The content script writes session-tally counters to `chrome.storage`;
   the popup's donut polls and re-renders every second.

## Manifest packaging

`manifest.json` (MV3 / Chrome) and `manifest.firefox.json` (MV2 / Firefox)
both list the **same** 13-file content-script load order. Order matters:
`shared/*` first (they declare globals), then `content/matcher.js` and
`content/observer.js`, then `content/modules/*` (they register into
`__HUCS__.modules`), then `content-script.js` last (it consumes everything).

If you add a new content-script file, you must add it to **both
manifests**, in the same position. The `validate:extension` script catches
divergence.

## Engine-ahead-of-UI surfaces

**The queue is empty.** The content script honors exactly what the
popup exposes:

- AI filter — fires on post text + actor description.
- Slop sensitivity slider — drives a managed blacklist + heuristic
  scorer over post body text.
- Hidden-item mode — audit / minimize / hide presentation modes.

The product surface is intentionally post-card-only. A previous sweep
removed a 42-detector site-specific feed-filter engine
(promoted/suggested/recruiter/premium/notifications/jobs/messaging-style
detectors) along with its popup disclosure; the detectors and storage
paths went with it. Bringing site-specific filters back, or adding new
ones for a different site, means designing the UX and the storage
schema together — it isn't a "wire up dormant behavior" task.

The prior cleanup history (mute-button injection, daily-history storage,
review queue, own-profile + quick-links, NSFW preset catalog,
user-supplied regex literals, author/company muting + snooze + trust +
allowlist, the 42-detector Advanced Filters disclosure) remains visible
in `git log` for context.

## Where to start reading

- **Adding a new preset term** → `shared/presets.js`, then add a test
  in `tests/presets.test.js`. The slider mapping is in the same file
  (`getSliderManagedTermIdsAtLevel`). Site-agnostic.
- **Debugging a false positive / negative** → start at
  `content/modules/post-evaluator.js`, then walk up to whichever
  detector flagged the card (see `content-script.js` §19 `evaluatePost`).
- **Site-specific DOM drift** → `shared/constants.js`. The current
  adapter's selectors live there; most breakage is the site
  renaming or restructuring nodes.
- **Adding a site adapter for another platform** → see
  [`CONTRIBUTING.md`](./CONTRIBUTING.md#how-to-add-a-site-adapter-for-a-new-platform).
  The seams (card resolution, text extraction, host scope in the
  manifests, selector groups in `shared/constants.js`) are where new
  adapters slot in.
