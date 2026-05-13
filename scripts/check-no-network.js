#!/usr/bin/env node

// Privacy contract gate: shipped code must make no network calls.
// Mirrors the grep documented in PRIVACY.md so the promise is mechanically
// enforced, not aspirational. Scans only shipped sources — `tests/` may stub
// these for negative-path coverage.

const { execSync } = require('child_process');

const PATTERN = 'fetch\\(|XMLHttpRequest|new WebSocket|sendBeacon|EventSource\\(';

const cmd = [
  "grep -RIEn",
  "--exclude-dir=node_modules",
  "--exclude-dir=.git",
  "--exclude-dir=dist",
  "--exclude-dir=artifacts",
  "--include='*.js'",
  `'${PATTERN}'`,
  'shared content popup background.js background.firefox.js',
  '|| true',
].join(' ');

const out = execSync(cmd, {
  stdio: ['ignore', 'pipe', 'pipe'],
  encoding: 'utf8',
}).trim();

if (out) {
  process.stderr.write(
    'check-no-network: forbidden network APIs found in shipped code:\n' +
      out +
      '\nThe privacy contract (PRIVACY.md) forbids any network calls.\n',
  );
  process.exit(1);
}

process.stdout.write('no network calls found in shipped code\n');
