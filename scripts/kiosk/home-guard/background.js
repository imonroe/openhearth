// OpenHearth Home Guard — background service worker (FR-A3 / NFR-5).
//
// content.js intercepts the reserved Home/Back key on a launched service page and
// asks this worker to bring the kiosk home. Navigating from here with
// chrome.tabs.update moves the WHOLE TAB back to OpenHearth regardless of which
// frame the key was pressed in — including a service's cross-origin <iframe>,
// where the content script cannot reach window.top to navigate it directly (a
// real-world failure on players that host the video in a foreign-origin frame,
// e.g. Sling). This is the robust half of the cross-service Home/Back guarantee.
//
// Security: chrome.runtime.onMessage only receives messages from this extension's
// own content scripts/pages — a service page's own JavaScript cannot reach it
// (that would be onMessageExternal, which we don't use). So a launched service
// can't forge a "return home" message. We still re-validate the URL is http(s).
//
// chrome.tabs.update navigation needs no extra permission, and sender.tab.id is
// available without the "tabs" permission (only sensitive fields like url/title
// are gated), so the manifest stays permission-free.
const RETURN_MESSAGE = 'openhearth-home-guard:return';

chrome.runtime.onMessage.addListener((message, sender) => {
  if (!message || message.type !== RETURN_MESSAGE) return;

  const tabId = sender && sender.tab ? sender.tab.id : undefined;
  const url = typeof message.homeUrl === 'string' ? message.homeUrl : undefined;
  if (typeof tabId !== 'number' || !url) return;

  // Defense-in-depth: never navigate the tab to a non-http(s) URL even if a
  // malformed homeUrl somehow reaches here.
  try {
    const protocol = new URL(url).protocol;
    if (protocol !== 'http:' && protocol !== 'https:') return;
  } catch {
    return;
  }

  chrome.tabs.update(tabId, { url });
});
