/**
 * SimpMusicNet (v3.20.7) — one source of truth for "are we actually online?".
 *
 * Why this exists:
 *  - `navigator.onLine` and the `online` / `offline` window events are NOT
 *    reliable in an Android WebView. The events are missed while the WebView
 *    is frozen in the background (exactly when connectivity usually changes),
 *    and the WebView can keep reporting a stale value. The offline banner used
 *    to be driven by a single one of those events, so it stayed on screen
 *    forever after the network came back — while native playback (which never
 *    asks JS) happily kept working.
 *  - So signals only *arm* a check here. A real, cheap network request decides
 *    the answer, and the state is re-verified on a timer and on every
 *    foreground/network-change signal, so a wrong verdict always self-heals.
 *
 * API (all safe to call before the first probe has answered):
 *   SimpMusicNet.isOnline()      → sync best guess (never blocks, never probes)
 *   SimpMusicNet.isOffline()     → !isOnline()
 *   SimpMusicNet.verify(force)   → Promise<boolean>, authoritative; concurrent
 *                                  callers share one in-flight probe
 *   SimpMusicNet.onChange(fn)    → subscribe to verdict changes, returns off()
 *   SimpMusicNet.start()         → begin watching (done automatically)
 */
(function () {
  'use strict';

  // Tiny, CORS-free reachability targets. `no-cors` responses are opaque but
  // resolve as soon as the request actually reaches the network, and reject
  // when there is none. Two independent hosts so a single blocked/filtered
  // domain can't be mistaken for a dead connection.
  var PROBE_URLS = [
    'https://i.ytimg.com/vi/dQw4w9WgXcQ/default.jpg',
    'https://www.gstatic.com/generate_204'
  ];
  var PROBE_TIMEOUT_MS = 6000;
  // While offline, re-check often so the warning clears within seconds of the
  // network returning; while online, only drift-correct occasionally.
  var RECHECK_OFFLINE_MS = 5000;
  var RECHECK_ONLINE_MS = 60000;
  var FRESH_MS = 3000; // a verdict younger than this is reused as-is

  var lastVerified = null;  // true | false | null (nothing verified yet)
  var lastVerifiedAt = 0;
  var inFlight = null;
  var listeners = [];
  var timer = null;

  function apiSaysOffline() {
    if (navigator.onLine === false) return true;
    try {
      var c = navigator.connection || navigator.mozConnection || navigator.webkitConnection;
      if (!c) return false;
      // `type` only exists in the legacy Network Information API, and Chrome's
      // `effectiveType` is a rough bucket — a hint, never trusted on its own.
      if (c.type === 'none' || c.effectiveType === 'none') return true;
    } catch (e) { /* ignore */ }
    return false;
  }

  /** Synchronous best guess. Real evidence wins; otherwise assume online. */
  function isOnline() {
    if (lastVerified !== null) return lastVerified;
    return !apiSaysOffline();
  }

  function probeOne(url) {
    if (typeof fetch !== 'function') return Promise.resolve(null); // can't tell
    var ctl = typeof AbortController === 'function' ? new AbortController() : null;
    var killer = ctl ? setTimeout(function () { ctl.abort(); }, PROBE_TIMEOUT_MS) : null;
    return fetch(url, {
      mode: 'no-cors',
      cache: 'no-store',
      credentials: 'omit',
      signal: ctl ? ctl.signal : undefined
    }).then(function () { return true; }, function () { return false; })
      .then(function (ok) {
        if (killer) clearTimeout(killer);
        return ok;
      });
  }

  /** TRUE if any probe reached the network, FALSE if every one failed. */
  function probe() {
    var stamp = Date.now();
    return Promise.all(PROBE_URLS.map(function (u) {
      return probeOne(u + (u.indexOf('?') < 0 ? '?' : '&') + 't=' + stamp);
    })).then(function (results) {
      if (results.indexOf(true) >= 0) return true;
      // All null → fetch unavailable → don't claim offline.
      return results.every(function (r) { return r === null; });
    });
  }

  function notify() {
    for (var i = 0; i < listeners.length; i++) {
      try { listeners[i](lastVerified); } catch (e) { /* isolate */ }
    }
  }

  function schedule() {
    if (timer) clearTimeout(timer);
    var wait = lastVerified === false ? RECHECK_OFFLINE_MS : RECHECK_ONLINE_MS;
    timer = setTimeout(function () {
      timer = null;
      // Not force: a cadence tick is happy with a verdict that is still fresh.
      verify(false);
    }, wait);
  }

  function setState(ok) {
    var changed = ok !== lastVerified;
    lastVerified = ok;
    lastVerifiedAt = Date.now();
    schedule();
    if (changed) notify();
  }

  /** Promise<boolean> — the authoritative answer. */
  function verify(force) {
    if (inFlight) return inFlight;
    if (!force && lastVerified !== null && (Date.now() - lastVerifiedAt) < FRESH_MS) {
      return Promise.resolve(lastVerified);
    }
    inFlight = probe().then(function (ok) {
      inFlight = null;
      setState(ok);
      return ok;
    }, function () {
      inFlight = null;
      setState(false);
      return false;
    });
    return inFlight;
  }

  function onChange(fn) {
    if (typeof fn === 'function') listeners.push(fn);
    return function off() {
      var i = listeners.indexOf(fn);
      if (i >= 0) listeners.splice(i, 1);
    };
  }

  /** The `offline` event is the one signal Android rarely invents — trust it
   *  for an instant paint, then confirm with a probe. */
  function markOffline() {
    if (lastVerified === false) return;
    lastVerified = false;
    lastVerifiedAt = Date.now();
    schedule();
    notify();
    verify(true);
  }

  function start() {
    window.addEventListener('online', function () { verify(true); });
    window.addEventListener('offline', markOffline);
    // Returning to the foreground is when a missed event hurts most: the
    // WebView was frozen while connectivity changed, so ask again now.
    document.addEventListener('visibilitychange', function () {
      if (!document.hidden) verify(true);
    });
    window.addEventListener('focus', function () { verify(true); });
    window.addEventListener('pageshow', function () { verify(true); });
    if (window.Capacitor && window.Capacitor.Plugins && window.Capacitor.Plugins.App) {
      try {
        window.Capacitor.Plugins.App.addListener('resume', function () { verify(true); });
      } catch (e) { /* plugin absent */ }
    }
    verify(true); // first verdict
  }

  window.SimpMusicNet = {
    isOnline: isOnline,
    isOffline: function () { return !isOnline(); },
    verify: verify,
    onChange: onChange,
    start: start,
    lastVerified: function () { return lastVerified; },
    lastVerifiedAt: function () { return lastVerifiedAt; }
  };

  start();
})();
