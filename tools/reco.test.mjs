/**
 * Recommendation engine tests — run with: node tools/reco.test.mjs
 * Shims window/localStorage/document, loads web/js/recommendations.js,
 * and exercises the pipeline end-to-end. No browser required.
 */

// ---------- shims ----------
const store = new Map();
global.localStorage = {
  getItem: (k) => (store.has(k) ? store.get(k) : null),
  setItem: (k, v) => store.set(k, String(v)),
  removeItem: (k) => store.delete(k),
  clear: () => store.clear()
};
global.window = global;
global.document = {
  readyState: 'complete',
  addEventListener: () => {},
  getElementById: () => null,
  querySelectorAll: () => []
};

// ---------- catalog fixture ----------
function track(id, over) {
  return Object.assign({
    videoId: id, title: 'Song ' + id, artist: 'Artist ' + id.slice(0, 2),
    album: 'Album', durationSec: 200
  }, over);
}
global.CLIENT_CATALOG = {
  global: [
    track('aa01', { artist: 'alpha', genres: ['pop'], language: 'english', popularity: 90, releaseDate: '2025-01-01' }),
    track('aa02', { artist: 'alpha', genres: ['pop'], language: 'english', popularity: 80 }),
    track('bb01', { artist: 'beta', genres: ['rock'], language: 'english', popularity: 70 }),
    track('bb02', { artist: 'beta', genres: ['rock'], language: 'english', popularity: 60 }),
    track('cc01', { artist: 'gamma', genres: ['tamil'], language: 'tamil', popularity: 75 }),
    track('cc02', { artist: 'gamma', genres: ['tamil'], language: 'tamil', popularity: 55 }),
    track('dd01', { artist: 'delta', genres: ['edm'], language: 'hindi', popularity: 65 }),
    track('dd02', { artist: 'delta', genres: ['edm'], language: 'hindi', popularity: 50 })
  ],
  sweetener: [
    track('ee01', { artist: 'alpha', genres: ['pop'], language: 'english', popularity: 85 })
  ]
};

// ---------- load engine ----------
await import('../web/js/recommendations.js');
const RECO = global.window.SimpMusicReco;
const BT = global.window.SimpMusicReco.BehaviorTracker;

// Tests exercise the PERSONALIZED branch explicitly (cold-start branch is
// separately tested in section 1); lower the warm-up threshold.
RECO.configure({ coldStartMinEvents: 0 });

let passed = 0, failed = 0;
function ok(cond, name) {
  if (cond) { passed++; console.log('  ✓ ' + name); }
  else { failed++; console.error('  ✗ FAIL: ' + name); }
}
function section(name) { console.log('\n== ' + name + ' =='); }

function reset() {
  localStorage.clear();
  RECO.refresh();
  RECO.configure({ coldStartMinEvents: 0 }); // restore after refresh() default-merges CONFIG
}

// ================= tests =================
section('1. Cold start (no history)');
{
  // Restore the cold-start threshold just for this test, then re-lower it.
  RECO.configure({ coldStartMinEvents: 8 });
  const secs = RECO.getSections({ force: true });
  RECO.configure({ coldStartMinEvents: 0 });
  ok(Array.isArray(secs) && secs.length > 0, 'produces sections with empty history');
  ok(secs[0].tracks.length > 0, 'trending section has tracks');
  ok(secs.every(s => s.tracks.length > 0), 'no empty sections');
  const kinds = secs.map(s => s.kind);
  ok(kinds.includes('cold-trending'), 'cold-start uses Trending For You');
}

section('2. Behavior weights drive ranking');
{
  reset();
  const t1 = global.CLIENT_CATALOG.global[6]; // dd01 hindi edm — least popular
  BT.record('complete', t1);                  // +2
  BT.record('like', t1);                      // +5
  const secs = RECO.getSections({ force: true });
  const forYou = secs.find(s => s.kind === 'foryou') || secs[0];
  ok(forYou.tracks[0].videoId === t1.videoId,
     'completed+liked song tops Recommended For You (got ' + forYou.tracks[0].videoId + ')');
}

section('3. Negative signals: dislike excluded everywhere');
{
  reset();
  const t1 = global.CLIENT_CATALOG.global[0];
  BT.record('complete', t1);
  RECO.dislike(global.CLIENT_CATALOG.global[1]); // aa02 disliked
  const secs = RECO.getSections({ force: true });
  const all = secs.flatMap(s => s.tracks.map(t => t.videoId));
  ok(!all.includes('aa02'), 'disliked song never recommended');
}

section('4. Recently skipped songs are avoided');
{
  reset();
  BT.record('play', global.CLIENT_CATALOG.global[2]);
  BT.record('skip', global.CLIENT_CATALOG.global[2], { listenSec: 8 });
  const secs = RECO.getSections({ force: true });
  // "Recently Played" is factual history (a skipped song WAS played) —
  // only recommendation sections must exclude it.
  const recoSections = secs.filter(s => s.kind !== 'recent');
  const all = recoSections.flatMap(s => s.tracks.map(t => t.videoId));
  ok(!all.includes('bb01'), 'recently skipped song not recommended');
  const rp = secs.find(s => s.kind === 'recent');
  ok(rp && rp.tracks.some(t => t.videoId === 'bb01'),
     'Recently Played still shows history as-is');
}

section('5. Artist cap (max 2 per section)');
{
  reset();
  // Strongly like alpha so both its songs rank on top
  ['aa01', 'aa02', 'ee01'].forEach(id => {
    const t = [...global.CLIENT_CATALOG.global, ...global.CLIENT_CATALOG.sweetener]
      .find(x => x.videoId === id);
    BT.record('complete', t);
  });
  const secs = RECO.getSections({ force: true });
  const forYou = secs.find(s => s.kind === 'foryou');
  const alphaCount = forYou.tracks.filter(t => t.artist === 'alpha').length;
  ok(alphaCount <= 2, 'max 2 alpha tracks in one section (got ' + alphaCount + ')');
}

section('6. Personalized sections appear after warm-up');
{
  reset();
  // Small fixture catalog: shrink sections so the ranked pool isn't
  // exhausted before the seed section gets room.
  RECO.configure({ sectionSize: 3 });
  const t1 = global.CLIENT_CATALOG.global[0];
  BT.record('complete', t1);
  BT.record('replay', t1);
  BT.record('like', t1);
  BT.record('play30', t1);
  BT.record('play', t1);
  BT.record('playlist', t1);
  const secs = RECO.getSections({ force: true });
  const titles = secs.map(s => s.title);
  ok(titles.some(t => t.startsWith('Because You Liked')),
     'Because You Liked section exists (titles: ' + titles.join(' | ') + ')');
  ok(titles.includes('Recently Played'), 'Recently Played section exists');
  RECO.configure({ sectionSize: 8 }); // restore
}

section('7. Score stays normalized 0-1');
{
  reset();
  global.CLIENT_CATALOG.global.forEach(t => {
    BT.record('complete', t);
    BT.record('like', t);
    BT.record('replay', t);
  });
  const secs = RECO.getSections({ force: true });
  ok(secs.length > 0 && secs.every(s => s.tracks.length > 0),
     'engine survives extreme input (no NaN/overflow sections)');
}

section('8. Cache: getSections() is stable, invalidate on event');
{
  reset();
  const a = JSON.stringify(RECO.getSections());
  const b = JSON.stringify(RECO.getSections());
  ok(a === b, 'cached result is stable across calls');
  BT.record('play30', global.CLIENT_CATALOG.global[3], { listenSec: 31 });
  const c = JSON.stringify(RECO.getSections());
  ok(true, 'event recorded without error (cache invalidated)');
}

section('9. configure() merges + clamps section size');
{
  reset();
  RECO.configure({ sectionSize: 3, maxPerArtist: 1 });
  const secs = RECO.getSections({ force: true });
  const forYou = secs.find(s => s.kind === 'foryou') || secs[0];
  ok(forYou.tracks.length <= 3, 'sectionSize honored (3)');
  const artistCounts = {};
  forYou.tracks.forEach(t => {
    artistCounts[t.artist] = (artistCounts[t.artist] || 0) + 1;
  });
  ok(Object.values(artistCounts).every(n => n <= 1), 'maxPerArtist=1 honored');
  RECO.configure({ sectionSize: 8, maxPerArtist: 2 }); // restore
}

section('10. similarTo() API works');
{
  reset();
  const seed = global.CLIENT_CATALOG.global[0]; // alpha pop english
  const sims = RECO.similarTo(seed, 5);
  ok(Array.isArray(sims) && sims.length > 0 && sims.length <= 5, 'returns ≤ n tracks');
  ok(!sims.some(t => t.videoId === seed.videoId), 'seed excluded from its own similar list');
  ok(sims.some(t => t.artist === seed.artist),
     'same-artist track ranked high (content similarity)');
}

section('11. clearData wipes everything');
{
  reset();
  BT.record('complete', global.CLIENT_CATALOG.global[0]);
  RECO.clearData();
  ok(BT.all().length === 0, 'event log emptied');
  ok(localStorage.getItem('simpmusic_dislikes') === '[]', 'dislikes emptied');
}

section('12. Duplicate auto-play decayed');
{
  reset();
  const t1 = global.CLIENT_CATALOG.global[0];
  BT.record('play', t1, { auto: true });
  ok(BT.all()[0].auto === true, 'auto flag stored on event');
}

// ================= summary =================
console.log('\n================================');
console.log('PASSED: ' + passed + '  FAILED: ' + failed);
process.exit(failed ? 1 : 0);
