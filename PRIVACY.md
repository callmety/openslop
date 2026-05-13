# OpenSlop Privacy

OpenSlop runs entirely in your browser. There is no backend.

## What's stored locally

- **Settings** (`chrome.storage.sync`): your slop sensitivity level and AI-filter toggle.
- **Session counters** (`chrome.storage.local`): how many posts have been hidden vs.
  shown this browsing session — used to draw the donut chart in the popup.

That's all. Both surfaces are inspectable via your browser's extension storage
inspector.

## What's NOT collected

- No analytics, telemetry, crash reports, or usage tracking.
- No account, login, or API key.
- No data is sent to any server controlled by the OpenSlop project.

## Network activity

**OpenSlop makes no network requests.** No `fetch`, no `XMLHttpRequest`, no
WebSockets, no beacons. This is enforced two ways:

- `npm run check:no-network` greps shipped code for `fetch(`, `XMLHttpRequest`,
  `new WebSocket`, `sendBeacon`, and `EventSource(`. It runs in CI on every
  push and in `verify:release` locally.
- `eslint.config.mjs` deliberately omits `fetch` from the global declarations,
  so any accidental call also fails `no-undef` lint.

You can also reproduce the grep yourself:

```bash
grep -rE "fetch\(|XMLHttpRequest|new WebSocket|sendBeacon|EventSource\(" \
  content/ popup/ shared/ background.js background.firefox.js
```

The only outbound traffic from the extension is `chrome.storage.sync`
replication — which Chrome handles directly, only contains your slider /
toggle preferences, and never touches the OpenSlop project.

## Uninstalling

Removing the extension wipes all locally stored settings. Sync-replicated
preferences will also clear from connected browsers on next sync.

## Permission rationale

See [docs/PERMISSIONS.md](./docs/PERMISSIONS.md) for the per-permission breakdown.
