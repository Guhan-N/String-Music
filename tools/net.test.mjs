/**
 * Offline-banner / connectivity tests — run with: node tools/net.test.mjs
 *                                            (fallback path: --fallback)
 *
 * Reproduces the reported bug: after going offline the "Offline — playing your
 * downloaded songs" banner came back was stuck on screen even once the
 * network returned (songs kept working, because native playback never asks
 * JS). Cause: the banner was repainted ONLY by the `online` window event, and
 * Android's WebView is frozen in the background — exactly when connectivity
 * usually changes — so that event was missed and nothing ever re-ran.
 *
 * Shims a minimal DOM + navigator/fetch, loads the REAL web/js/net.js and the
 * REAL setupOfflineBanner() from web/js/recommendations.js, and walks the
 * offline → online transition without touching the device.
 */

const FALLBACK = process.argv.includes('--fallback');

// ---------- shims ----------
const store = new Map();
global.localStorage = {
  getItem: (k) => (store.has(k) ? store.get(k) : null),
  setItem: (k, v) => store.set(k, String(v)),
  removeItem: (k) => store.delete(k),
  clear: () => store.clear()
};

const listeners = {}; // window/document events
function addEventListener(type, fn) {
  (listeners[type] = listeners[type] || []).push(fn);
}
function fire(type) {
  (listeners[type] || []).forEach((fn) => {
    try { fn({ type }); } catch (e) { console.error('listener threw:', e.message); }
  });
}

const banner = { style: { display: 'none' }, dataset: {} };
global.window = global;
global.addEventListener = addEventListener;
global.document = {
  readyState: 'complete',
  hidden: false,
  addEventListener,
  getElementById: (id) => (id === 'offlineBanner' ? banner : null),
  querySelectorAll: () => [],
  querySelector: () => null,
  createElement: () => ({
    style: {}, dataset: {}, innerHTML: '', textContent: '',
    classList: { add() {}, remove() {}, toggle() {} },
    appendChild() {}, setAttribute() {}, addEventListener() {}, remove() {},
    querySelector: () => null, querySelectorAll: () => []
  }),
  body: { appendChild() {}, classList: { add() {}, remove() {} } }
};

// Node 21+ exposes a read-only `navigator`; define our own instead of assigning.
const nav = { onLine: false, connection: { type: 'none' }, userAgent: 'node-test' };
Object.defineProperty(globalThis, 'navigator', {
  value: nav, writable: true, configurable: true
});

// ---------- fake network ----------
let netUp = false;     // does a request actually reach the network?
let fetchCalls = 0;
global.fetch = (url) => {
  fetchCalls++;
  if (!netUp) return Promise.reject(new TypeError('Failed to fetch'));
  return Promise.resolve({
    ok: true, status: 200, type: 'opaque', url: String(url),
    json: () => Promise.resolve({}),
    text: () => Promise.resolve(''),
    blob: () => Promise.resolve({ size: 2048 }),
    headers: new Map()
  });
};

let passed = 0, failed = 0;
function ok(cond, name) {
  if (cond) { passed++; console.log('  \u2713 ' + name); }
  else { failed++; console.error('  \u2717 FAIL: ' + name); }
}
function section(name) { console.log('\n== ' + name + ' =='); }
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

// ---------- load the shipped code ----------
section('0. setup');
if (!FALLBACK) {
  await import('../web/js/net.js');
  ok(typeof global.window.SimpMusicNet === 'object', 'net.js registers window.SimpMusicNet');
} else {
  ok(global.window.SimpMusicNet === undefined, 'net.js intentionally NOT loaded (stale-cache path)');
}
await import('../web/js/recommendations.js');
ok(banner.style.display === 'flex',
   'starts offline (onLine=false + no network) → banner visible');

// ---------- the reported bug ----------
section('1. network returns, onLine stays false, `online` event is MISSED');
await wait(150);
const legacyWouldStillShow = nav.onLine === false; // what the old render() read
netUp = true;               // internet is back — the songs work again
// intentionally: nav.onLine stays false, and we never fire the `online` event
await wait(6000);
ok(legacyWouldStillShow,
   'old logic (`navigator.onLine === false`) is stuck true — the reported bug');
ok(banner.style.display === 'none',
   'banner clears itself once the network is really back');
if (!FALLBACK) {
  ok(global.window.SimpMusicNet.isOnline() === true,
     'SimpMusicNet verdict is online (verified by a real request)');
}

// ---------- a spurious offline event must self-heal ----------
section('2. spurious `offline` event while online → brief banner, then self-heal');
fire('offline');
// Read synchronously: the `offline` event is trusted for an instant paint (it
// is the one signal Android rarely invents), so the banner is up before the
// confirming probe comes back.
ok(banner.style.display === 'flex', 'offline event paints the banner immediately');
await wait(300);
if (FALLBACK) {
  console.log('  - (degraded path: clears on the 5s re-check instead of instantly)');
} else {
  ok(banner.style.display === 'none', 'spurious event self-heals after the probe succeeds');
}
await wait(6000);
ok(banner.style.display === 'none', 'and it does clear by itself');

// ---------- genuinely offline must not flicker ----------
section('3. genuinely offline stays offline (no false clearing)');
netUp = false;
nav.onLine = false;
fire('offline');
await wait(50);
ok(banner.style.display === 'flex', 'banner shows while offline');
await wait(6200);
ok(banner.style.display === 'flex', 'banner stays (probes fail — no flicker)');

// ---------- healthy WebView fast path ----------
section('4. healthy WebView: `online` event clears it at once');
netUp = true;
nav.onLine = true;
fire('online');
await wait(120);
ok(banner.style.display === 'none', 'banner hidden right after the online event');

// ---------- player.js offline routing ----------
section('5. player.js isOfflineNow() prefers verified state over a stale flag');
{
  const { readFileSync } = await import('node:fs');
  const src = readFileSync(new URL('../web/js/player.js', import.meta.url), 'utf8');
  const m = src.match(/function isOfflineNow\(\)\s*\{[\s\S]*?\n\}/);
  ok(!!m, 'isOfflineNow() found in player.js');
  const make = new Function('window', 'navigator', 'return ' + m[0]);
  const staleFlag = { onLine: false, connection: { type: 'none' } };
  const fn = make({ SimpMusicNet: { isOffline: () => false } }, staleFlag);
  ok(fn() === false, 'stale onLine=false is overruled once net.js verified online');
  const fn2 = make({ SimpMusicNet: { isOffline: () => true } }, { onLine: true });
  ok(fn2() === true, 'verified offline wins over onLine=true');
  const fn3 = make({}, staleFlag);
  ok(fn3() === true, 'no net.js → falls back to the raw signals');
  const fn4 = make({}, { onLine: true, connection: {} });
  ok(fn4() === false, 'no net.js, online → not offline');
}

// ---------- the other three call sites are all migrated ----------
section('6. no direct navigator.onLine offline-branch left in player.js');
{
  const { readFileSync } = await import('node:fs');
  const src = readFileSync(new URL('../web/js/player.js', import.meta.url), 'utf8');
  const uses = (src.match(/isOfflineNow\(\)/g) || []).length;
  ok(uses >= 4, 'isOfflineNow() used at all 3 call sites + definition (got ' + uses + ')');
  ok(!/const offlineNow = \(navigator\.connection/.test(src),
     'no call site still reads navigator.onLine directly');
}

console.log('\n================================');
console.log('PASSED: ' + passed + '  FAILED: ' + failed +
  (FALLBACK ? '   [stale-cache fallback path]' : ''));
process.exit(failed ? 1 : 0);
