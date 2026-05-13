#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const DIST_DIR = path.join(ROOT, 'dist');
const OUTPUT_ZIP = path.join(DIST_DIR, 'openslop-chrome.zip');

const ZIP_INPUTS = [
  'manifest.json',
  'background.js',
  'shared/',
  'content/',
  'popup/',
  'icons/',
];

function run(command, args, options) {
  const result = spawnSync(command, args, Object.assign({ stdio: 'inherit' }, options));
  if (result.status !== 0) {
    process.exit(result.status || 1);
  }
}

fs.mkdirSync(DIST_DIR, { recursive: true });
if (fs.existsSync(OUTPUT_ZIP)) {
  fs.unlinkSync(OUTPUT_ZIP);
}

run('zip', ['-r', OUTPUT_ZIP].concat(ZIP_INPUTS).concat(['--exclude', '*.DS_Store']), {
  cwd: ROOT,
});
