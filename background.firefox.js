// OpenSlop — Background Script (Firefox / MV2)
// ─────────────────────────────────────────────────────────────────────────────
// The extension no longer caches any images in the background script.
// Avatar photos for muted entities and the logged-in user's profile are not
// stored — the popup uses emoji placeholders for muted entities and the
// app wordmark for the header. The only remaining responsibility is to
// stay alive as a minimal background script so Firefox does not flag the
// extension as broken.
//
// All chrome.* calls are valid in Firefox ≥ 109 which added the chrome.*
// alias on top of the native browser.* Promise API.
// ─────────────────────────────────────────────────────────────────────────────

'use strict';

var POPUP_SESSION_KEY = (typeof HU === 'object' && HU && HU.POPUP_SESSION_ID_KEY) ? HU.POPUP_SESSION_ID_KEY : 'hu_popup_session_id';

function buildPopupSessionId() {
  return String(Date.now()) + '-' + Math.random().toString(36).slice(2, 10);
}

function writePopupSessionId(sessionId) {
  if (!chrome.storage || !chrome.storage.local || typeof chrome.storage.local.set !== 'function') return;
  var payload = {};
  payload[POPUP_SESSION_KEY] = sessionId;
  chrome.storage.local.set(payload);
}

function refreshPopupSessionId() {
  writePopupSessionId(buildPopupSessionId());
}

function ensurePopupSessionId() {
  if (!chrome.storage || !chrome.storage.local || typeof chrome.storage.local.get !== 'function') return;
  chrome.storage.local.get(POPUP_SESSION_KEY, function (result) {
    var existing = result && typeof result[POPUP_SESSION_KEY] === 'string' ? result[POPUP_SESSION_KEY] : '';
    if (!existing) refreshPopupSessionId();
  });
}

ensurePopupSessionId();

if (chrome.runtime && chrome.runtime.onStartup && typeof chrome.runtime.onStartup.addListener === 'function') {
  chrome.runtime.onStartup.addListener(refreshPopupSessionId);
}

if (chrome.runtime && chrome.runtime.onInstalled && typeof chrome.runtime.onInstalled.addListener === 'function') {
  chrome.runtime.onInstalled.addListener(refreshPopupSessionId);
}

// No-op listener: keeps the background script registered and allows the popup
// to open without "Could not establish connection" errors on first install.
chrome.runtime.onMessage.addListener(function (message) {
  if (!message) return;
  // All image-caching messages have been removed. Any legacy message types
  // sent by a cached content script are silently ignored here.
});
