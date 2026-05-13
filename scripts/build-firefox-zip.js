#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const DIST_DIR = path.join(ROOT, 'dist');
const OUTPUT_ZIP = path.join(DIST_DIR, 'openslop-firefox.zip');
const STAGING_ROOT = path.join(ROOT, 'artifacts', 'build-staging', 'firefox');

const COPY_PATHS = [
  'background.firefox.js',
  'shared',
  'content',
  'popup',
  'icons',
];

function run(command, args, options) {
  const result = spawnSync(command, args, Object.assign({ stdio: 'inherit' }, options));
  if (result.status !== 0) {
    process.exit(result.status || 1);
  }
}

function copyRecursive(src, dst) {
  const stat = fs.statSync(src);
  if (stat.isDirectory()) {
    fs.mkdirSync(dst, { recursive: true });
    const entries = fs.readdirSync(src);
    for (let i = 0; i < entries.length; i++) {
      copyRecursive(path.join(src, entries[i]), path.join(dst, entries[i]));
    }
    return;
  }
  fs.mkdirSync(path.dirname(dst), { recursive: true });
  fs.copyFileSync(src, dst);
}

fs.mkdirSync(DIST_DIR, { recursive: true });
if (fs.existsSync(OUTPUT_ZIP)) {
  fs.unlinkSync(OUTPUT_ZIP);
}

if (fs.existsSync(STAGING_ROOT)) {
  fs.rmSync(STAGING_ROOT, { recursive: true, force: true });
}
fs.mkdirSync(STAGING_ROOT, { recursive: true });

// Firefox requires manifest.json inside the packaged archive.
copyRecursive(path.join(ROOT, 'manifest.firefox.json'), path.join(STAGING_ROOT, 'manifest.json'));

for (let i = 0; i < COPY_PATHS.length; i++) {
  const rel = COPY_PATHS[i];
  copyRecursive(path.join(ROOT, rel), path.join(STAGING_ROOT, rel));
}

run('zip', ['-r', OUTPUT_ZIP, 'manifest.json', 'background.firefox.js', 'shared/', 'content/', 'popup/', 'icons/', '--exclude', '*.DS_Store'], {
  cwd: STAGING_ROOT,
});
