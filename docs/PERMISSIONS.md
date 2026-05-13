# OpenSlop — Permissions Rationale

## Manifest summary

- `permissions`: `storage`
- `host_permissions` (Chrome MV3): the host of the shipping site
  adapter (see `manifest.json` `host_permissions` and
  `content_scripts.matches` for the exact pattern)
- Host scope (Firefox MV2): same pattern, declared in
  `manifest.firefox.json`

No other origins are requested. Adding a site adapter for another
platform would add that platform's host pattern alongside the
existing one (and Chrome / AMO would surface that to the user at
install time).

## `"storage"`

**Why it's needed:** OpenSlop persists user settings and runtime counters.

**What's stored:**
- `chrome.storage.sync` — settings bundle (slop sensitivity level, AI-filter toggle)
- `chrome.storage.local` — session feed counters and per-category tallies (used
  by the donut chart)

**Threat model:** Data stays local to the browser's extension storage (plus
Chrome Sync replication for sync keys). OpenSlop sends no analytics or
telemetry. No image, avatar, or media caching is persisted.

## Host scope

OpenSlop runs only on the site declared in `content_scripts.matches`. Host
permission scope mirrors the same origin. No other origins are required for
normal operation.

## Permissions intentionally NOT requested

| Permission | Why it's absent |
|---|---|
| `activeTab`     | Popup-message architecture covers all current flows |
| `scripting`     | No runtime script injection |
| `webRequest`    | No request interception |
| `cookies`       | No cookie access |
| `history`       | No history access |
| `identity`      | No OAuth/identity integration |
| `notifications` | No native notification surface |
