const fs   = require('fs');
const path = require('path');
const vm   = require('vm');

function loadPlainScript(relPath) {
  const absPath = path.join(__dirname, '..', relPath);
  const code    = fs.readFileSync(absPath, 'utf8');
  // Run in the global context so top-level `var` declarations become properties
  // of `global`, making them accessible across all test files in this worker.
  vm.runInContext(code, vm.createContext(global), { filename: absPath });
}

function loadContentScriptRuntimeModules() {
  loadPlainScript('content/modules/contracts.js');
  loadPlainScript('content/modules/text-extractors.js');
  loadPlainScript('content/modules/card-meta.js');
  loadPlainScript('content/modules/card-resolver.js');
  loadPlainScript('content/modules/post-evaluator.js');
  loadPlainScript('content/modules/scan-candidates.js');
  loadPlainScript('content/modules/late-rescan-scheduler.js');
}

module.exports = { loadPlainScript, loadContentScriptRuntimeModules };
