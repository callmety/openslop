#!/usr/bin/env node
//
// Pre-commit / CI guard:
//   1. No legacy product-name references. The project was renamed once
//      from "HushLink" to "OpenSlop"; any stray HushLink token in source,
//      docs, or file/dir names indicates an incomplete rebrand.
//   2. No slurs from the historical NSFW preset catalog (which was removed
//      from this repo to keep the source publishable). Stems are kept here
//      as base64 so this script's own source contains none of them
//      literally — a `grep` of this file will find no offensive strings.
//
// To audit or extend the denylist, decode the base64 strings; to add a new
// stem, base64-encode the normalized word and append it.

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const SKIP_DIRS = new Set(['.git', 'node_modules', 'dist', 'coverage', 'artifacts']);
const TEXT_EXTENSIONS = new Set([
  '.js', '.mjs', '.cjs', '.json', '.md', '.html', '.css', '.txt', '.yml', '.yaml', '.xml',
]);

const LEGACY_NAME_RE = /hush[\s._-]*link/i;

// Historical NSFW catalog stems, kept base64-encoded for the reason above.
const DENYLIST_STEMS_B64 = [
  'bmlnZ2Vy', 'bmlnZ2E=', 'ZmFnZ290', 'a2lrZQ==',
  'Y3VudA==', 'd2V0YmFjaw==', 'cmFnaGVhZA==', 'Z29vaw==',
  'YmVhbmVy', 'aGVlYg==', 'cG9yY2ggbW9ua2V5', 'anVuZ2xlIGJ1bm55',
  'Y2FtZWwgam9ja2V5', 'dG93ZWxoZWFk', 'Y29ja3N1Y2tlcg==',
];
const DENYLIST_STEMS = DENYLIST_STEMS_B64.map(b => Buffer.from(b, 'base64').toString('utf8'));
const DENYLIST_RE = new RegExp(
  '\\b(?:' + DENYLIST_STEMS.map(escapeRegex).join('|') + ')\\b',
  'i',
);

const SELF_PATH = __filename;
const findings = [];

function escapeRegex(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function recordFinding(type, relPath, detail) {
  findings.push({ type, relPath, detail });
}

function scanPath(absPath) {
  const relPath = path.relative(ROOT, absPath) || '.';

  if (LEGACY_NAME_RE.test(relPath)) {
    recordFinding('path', relPath, 'legacy brand token in file or directory name');
  }

  const stat = fs.statSync(absPath);

  if (stat.isDirectory()) {
    if (SKIP_DIRS.has(path.basename(absPath))) return;
    for (const entry of fs.readdirSync(absPath)) {
      scanPath(path.join(absPath, entry));
    }
    return;
  }

  if (!TEXT_EXTENSIONS.has(path.extname(absPath).toLowerCase())) return;
  if (absPath === SELF_PATH) return; // skip self — see header comment

  const lines = fs.readFileSync(absPath, 'utf8').split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    if (LEGACY_NAME_RE.test(lines[i])) {
      recordFinding('legacy-brand', relPath, 'line ' + (i + 1));
    }
    if (DENYLIST_RE.test(lines[i])) {
      recordFinding('denylist', relPath, 'line ' + (i + 1));
    }
  }
}

scanPath(ROOT);

if (findings.length) {
  console.error('Branding/denylist audit failed (expected zero findings):');
  for (const f of findings) {
    console.error('- [' + f.type + '] ' + f.relPath + ' (' + f.detail + ')');
  }
  process.exit(1);
}

console.log('Branding/denylist audit passed.');
