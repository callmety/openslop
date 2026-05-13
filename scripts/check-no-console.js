#!/usr/bin/env node

const { execSync } = require('child_process');

const cmd = [
  "grep -RIn",
  "--exclude-dir=node_modules",
  "--exclude-dir=.git",
  "--exclude-dir=dist",
  "--exclude-dir=artifacts",
  "--include='*.js'",
  "'console\\.'",
  'shared content popup background.js background.firefox.js tests',
  '|| true',
].join(' ');

const out = execSync(cmd, {
  stdio: ['ignore', 'pipe', 'pipe'],
  encoding: 'utf8',
}).trim();

if (out) {
  process.stderr.write(out + '\n');
  process.exit(1);
}

process.stdout.write('no console statements found\n');
