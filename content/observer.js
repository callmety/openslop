// OpenSlop — MutationObserver
// ─────────────────────────────────────────────────────────────────────────────
// Wraps a MutationObserver with debouncing, batching, and SPA navigation
// detection so that the host's high-frequency DOM mutations don't thrash the
// scanner on every scroll event or feed update.
//
// The flush callback receives:
//   { fullScan: boolean, roots: Element[] }
//
//   fullScan = true  → too many dirty roots, or URL changed → scan document
//   fullScan = false → scan only the dirty subtrees in `roots`
// ─────────────────────────────────────────────────────────────────────────────

/* global HU */
/* exported createObserver */

/**
 * @param {function({ fullScan: boolean, roots: Element[] }): void} onFlush
 * @returns {{ start: function(): void, disconnect: function(): void }}
 */
function createObserver(onFlush) {
  var dirtyRoots    = new Set(); // queued dirty subtree roots (Set for O(1) dedup)
  var debounceTimer = null;
  var maxTimer      = null;
  var lastUrl       = location.href;

  // ── Dirty Root Accumulation ──────────────────────────────────────────────

  /**
   * Add an element to the dirty set (O(1) dedup via Set).
   * Only connected nodes are queued.
   */
  function addDirtyRoot(node) {
    var el = (node.nodeType === Node.TEXT_NODE) ? node.parentElement : node;
    if (!el || !el.isConnected) return;
    dirtyRoots.add(el);
  }

  // ── Flush ────────────────────────────────────────────────────────────────

  function flush() {
    clearTimeout(debounceTimer);
    clearTimeout(maxTimer);
    debounceTimer = null;
    maxTimer      = null;

    // SPA navigation detection — the host changes location.href without reload
    var currentUrl = location.href;
    if (currentUrl !== lastUrl) {
      lastUrl = currentUrl;
      dirtyRoots = new Set();
      onFlush({ fullScan: true, roots: [] });
      return;
    }

    var roots = Array.from(dirtyRoots);
    dirtyRoots = new Set();

    onFlush({
      fullScan: roots.length > HU.SCAN.DIRTY_ROOTS_FULL_SCAN_THRESHOLD,
      roots:    roots,
    });
  }

  // ── Scheduling ───────────────────────────────────────────────────────────

  /**
   * Restart the debounce window, and arm the hard max-flush timer if not set.
   */
  function schedule() {
    clearTimeout(debounceTimer);
    debounceTimer = setTimeout(flush, HU.SCAN.DEBOUNCE_MS);

    if (!maxTimer) {
      maxTimer = setTimeout(flush, HU.SCAN.MAX_FLUSH_MS);
    }
  }

  // ── Observer ─────────────────────────────────────────────────────────────

  var observer = new MutationObserver(function (mutations) {
    for (var i = 0; i < mutations.length; i++) {
      var m = mutations[i];
      addDirtyRoot(m.target);
      for (var j = 0; j < m.addedNodes.length; j++) {
        addDirtyRoot(m.addedNodes[j]);
      }
    }
    schedule();
  });

  return {
    start: function () {
      observer.observe(document.body, {
        childList:       true,
        subtree:         true,
        characterData:   true,
        // Watch the attributes that affect post-card identification + text
        // extraction so cards arriving as a shell first, with aria-label /
        // title / alt / data-testid added later, still trigger a rescan.
        // Filtering to this narrow set keeps noise low — the host churns many
        // other attrs (class, style, data-*) that don't affect our logic.
        attributes:      true,
        attributeFilter: ['aria-label', 'title', 'alt', 'data-testid'],
      });
    },
    disconnect: function () {
      observer.disconnect();
      clearTimeout(debounceTimer);
      clearTimeout(maxTimer);
    },
  };
}
