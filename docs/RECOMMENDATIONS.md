# SimpMusic Recommendation System (v3.5)

Content-based, rule-weighted recommendation engine. Fully client-side
(works offline in the APK), modular, and ready to swap in ML/collaborative
filtering later.

## Architecture

```
RecommendationEngine (window.SimpMusicReco)
├── BehaviorTracker        — event log (localStorage: simpmusic_rec_events)
├── UserProfileBuilder     — weighted prefs (simpmusic_rec_prefs)
├── CandidateGenerator     — catalog + recents + likes + playlists (deduped)
├── SimilarityCalculator   — genre/artist/language/mood/history 0–1 scores
├── RankingEngine          — weighted normalized score
├── DiversityFilter        — no repeats, skip avoidance, artist caps
└── RecommendationCache    — 15-min TTL, invalidated on new behavior
```

Each stage is a self-contained object; replacing one with an ML model means
re-implementing its interface only (e.g. `RankingEngine.score()` could call a
TF.js model, `similarTo()` could use collaborative-filtering embeddings).

## Data model (localStorage)

| Key | Shape | Notes |
|---|---|---|
| `simpmusic_rec_events` | `[{t, id, ts, dur, auto, src}]` | Behavior log, capped at 400 events. Types: `play`, `play30`, `complete`, `replay`, `skip`, `like`, `playlist`, `dislike` |
| `simpmusic_rec_prefs` | `{songs, topGenres, topArtists, topLanguages, topMoods, avgTempo, replayed, recent, liked, disliked, interactions}` | Cached profile; rebuilt only when event count changes (incremental) |
| `simpmusic_rec_recs` | `{at, sections}` | Cached output sections; 15-min TTL, invalidated on every recorded event |
| `simpmusic_dislikes` | `[{videoId, title, artist}]` | Explicit "Not for me" songs — never recommended |

All keys are DB-shaped (flat JSON documents) so a backend can mirror them
verbatim for server-side profiles.

## Behavior weights

| Event | Weight | Notes |
|---|---|---|
| complete (≥90% listened) | +2 | |
| played >30s | +1 | once per play |
| replay | +3 | auto-advance replays decay ×0.5 |
| like | +5 | reuses existing `simpmusic_likes` |
| add to playlist | +4 | reuses existing playlists |
| quick skip (<35% + ≥5s) | −4 | |
| dislike ("Not for me") | −6 | also hard-excluded from recos |

Additional signals: **recency half-life 10 days** (recent listening dominates),
**auto-play decay ×0.5** (unattended auto-advance counts half).

## Song profiles

`songProfile()` normalizes each track: artist, album, genres[], language,
moods[], bpm, popularity (0–100), releaseDate, audioFeatures. **Any missing
field is simply absent** — its similarity part falls back to a neutral 0.5
instead of erroring. The static client catalog may carry genres/language/
moods/popularity; recents/likes/playlists may not; both work.

## Score

```
score = genre×0.25 + artist×0.20 + language×0.15 + mood×0.15
      + history×0.15 + popularity×0.05 + freshness×0.05
```

Every part is normalized to 0–1 (`clamp01`). `history` = best Jaccard overlap
of the candidate's feature set (`a:artist`, `g:genre`, `m:mood`, `l:language`)
against positively-weighted songs from the last 30 days. `freshness` decays
over 2 years from `releaseDate`.

## Diversity

- never recommend disliked songs, or songs skipped in the last 24h (a
  play/complete *after* the skip un-blocks the song)
- max 2 tracks per artist per section (`maxPerArtist`)
- no duplicates within or across sections
- **discovery mix** (`diversity`): 70% personalized / 20% similar / 10%
  exploration — the "Discover New Music" section is drawn from the ranking
  tail (songs *outside* the user's usual favorites)

## Cold start

With fewer than `coldStartMinEvents` (8) interactions the engine serves:
- **Trending For You** — popular-first, filtered to the languages chosen in
  onboarding (`simpmusic_categories`), artist-capped, dislikes excluded
- **Discover New Music**
- **Best of [genre]** — one section per known genre

Personalized sections replace cold-start ones automatically once the user
crosses the threshold — no manual step.

## Recommendation sections

`Recommended For You` · `Based On Your Listening` · `Because You Liked
[Song]` · `More From [Artist]` · `Discover New Music` · `Recently Played` ·
`Similar Songs` — max 7 sections (`maxSections`), 8 tracks each
(`sectionSize`). Empty sections are dropped.

## UI integration

- **Mobile Home**: `#mobileRecoSection` (between Recent Songs and New
  Releases) renders all sections as horizontally scrollable rows of
  `.reco-card`s, each with the existing 3-dot song menu. Section hides
  itself when empty.
- **Desktop**: `#desktopRecoRows` above the tracklist, same sections in a
  2-column grid (hidden <900px).
- **"Not for me"**: added to the universal song menu (`playlists.js`) →
  `SimpMusicReco.dislike(track)` → song excluded from all recommendations.
- Styling: `css/recommendations.css` (cards reuse the app's purple accent).

## Public API (`window.SimpMusicReco`)

```js
.getSections()             // cached sections (cheap, call on every Home open)
.refresh()                 // force recompute
.similarTo(track, n)       // ranked similar songs for a seed track
.configure({ ... })        // merge config overrides (composes, not resets)
.dislike(track)            // "Not for me"
.clearData()               // wipe events + prefs + recs + dislikes
.on('updated', fn)         // re-render hook (fired after each generate)
.render()                  // re-render UI from cache
.BehaviorTracker.record(type, track, { listenSec, auto, source })
```

### Config keys (all overridable via `configure()`)

`maxSections:7` · `sectionSize:8` · `weights{...}` · `autoPlayDecay:0.5` ·
`scoreWeights{...}` · `recencyHalfLifeDays:10` · `maxPerArtist:2` ·
`historyWeightDays:30` · `cacheTtlMs:900000` · `coldStartMinEvents:8` ·
`diversity{personalized:.7, similar:.2, discovery:.1}`

## Performance

- profile cached (`_eventCount` dirty check → rebuild only on new events)
- sections cached (15-min TTL) and invalidated on behavior events, **not**
  on every app open
- catalog index memoized 60s
- skip-list cache keyed by log signature
- generation is O(candidates × history) with small constants — the whole
  pipeline over the ~50-track local catalog runs in a few ms

## Player integration (no player.js changes)

A 1s telemetry loop derives events from existing player state:
`play` on track change, `play30` past 30s, `complete` at ≥90% duration,
`skip` when abandoning <35% after ≥5s, `replay` on `ended`. Likes and
playlist adds come from 2s/3s diffs of the existing `simpmusic_likes` /
`simpmusic_playlists` storage. All hooks are try/catch-wrapped — tracking
can never break playback.

## Running & testing

```bash
# Unit tests (node, no browser needed)
node music-ecosystem/tools/reco.test.mjs        # 22 assertions

# Ship to device
cd music-ecosystem
cp web/{index.html,sw.js,manifest.json} mobile/www/
cp web/css/{style.css,categories.css,recommendations.css} mobile/www/css/
cp web/js/*.js mobile/www/js/                   # incl. recommendations.js
cd mobile && npx cap copy android
cd android && ./gradlew assembleDebug
adb install -r app/build/outputs/apk/debug/app-debug.apk
```

### Manual verification on device

1. Cold start: Home shows "Trending For You" + "Discover New Music"
2. Play ≥2 songs fully (or tap around) → sections switch to "Recommended
   For You" / "Based On Your Listening" / "Recently Played"
3. Like a song → "Because You Liked [Song]" appears
4. Menu → "Not for me" on a song → it disappears from every section
5. Skip a song quickly → it stops being recommended (unless replayed)
