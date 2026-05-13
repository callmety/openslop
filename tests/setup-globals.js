// Load shared source files in dependency order so their globals are available
// in all test files. Executed before each test suite via jest.config.js setupFiles.
//
// Load order matters:
//   1. normalize.js  — normalizeText, escapeRegex, canonicalizeBlacklistTerm (no dependencies)
//   2. presets.js    — HU_PRESETS + helpers (depends on normalizeText)
//   3. matcher.js    — compileBlacklist (depends on normalizeText, escapeRegex, canonicalizeBlacklistTerm)

const { loadPlainScript } = require('./load-plain-script');

loadPlainScript('shared/normalize.js');
loadPlainScript('shared/presets.js');
loadPlainScript('content/matcher.js');
