# Bug report — connectivity / offline handling sweep

**Version:** 3.20.6 → 3.20.7 · **Date:** 2026-10-16 · **Scope:** `web/`, `mobile/www/`, Android asset bundle

* [§1 The stuck "offline" banner](#1-reported-bug--offline-banner-never-goes-away)
* [§5 Empty lock-screen progress bar after an automatic track change](#5-lock-screen-progress-bar-empty-after-an-automatic-track-change--fixed)

---

## 1. Reported bug — "offline" banner never goes away

> "When the user is offline it shows the offline warning, but after the internet is
> available it still shows the offline warning — the songs work properly."

**Status: fixed.** Confirmed reproduced and fixed in the shipped files by an automated test
(`tools/net.test.mjs`).

### Root cause

`setupOfflineBanner()` in `web/js/recommendations.js` painted the `#offlineBanner` **only**
when a window event fired:

```js
window.addEventListener('online', render);
window.addEventListener('offline', render);
render();
```

and `render()` read the raw signals:

```js
return (navigator.connection && navigator.connection.type === 'none')
  || navigator.onLine === false;
```

Nothing else ever re-ran that function. On Android the WebView is frozen while the app is in
the background — which is exactly when connectivity usually changes — so the `online` event
was delivered to a frozen renderer, the listener never ran, and the warning stayed on screen
for the rest of the session. Audio kept working because native ExoPlayer never asks JS.

Two further landmines sat in the same expression:

* `navigator.onLine` is a cached, coarse flag that the WebView can hold at `false` long after
  the network is back.
* `navigator.connection.type` is a **deprecated** API (Chrome's `navigator.connection` has no
  `type`, only `effectiveType`) — when it exists, a stale `'none'` pins the banner on its own.

### The fix

New shared helper **`web/js/net.js`** (`window.SimpMusicNet`) owns the verdict:

| Behaviour | Why |
| --- | --- |
| Signals only *arm* a check; a real `no-cors` request to two independent hosts decides | a stale flag or a missed event can no longer decide anything |
| Re-checks on `online` / `offline`, `visibilitychange`, `focus`, `pageshow`, Capacitor `resume` | covers the frozen-WebView case, and app resume |
| Re-checks every 5 s while offline, every 60 s while online | a wrong verdict self-heals within seconds |
| `isOnline()` is synchronous (never blocks), `verify()` is the authoritative async answer | hot paths (player routing) stay synchronous |
| Verdict default is **online** | playback always tries the live stream first |

Consumers updated:

* `recommendations.js` — banner subscribes to `SimpMusicNet.onChange`; the no-net.js
  fallback (stale cached bundle) still adds a 5 s probe of its own, so a missed event cannot
  pin the banner there either.
* `app.js` — the network-speed pill no longer greys out on `navigator.onLine === false`
  alone; it asks the verified state and confirms once before going fully grey, and re-measures
  when the app returns to the foreground.
* `player.js` — the three `offlineNow` branches (play error fallback, `playTrack`,
  `togglePlay`) now call one `isOfflineNow()` helper, so a stale flag can no longer send every
  tap down the "play the downloaded copy instead of the stream" path.

---

## 2. Same root cause, two more places (fixed)

| # | File | Symptom it would have caused |
| --- | --- | --- |
| 2.1 | `web/js/app.js` (`measureNetSpeed`, `initNetPill`) | Signal-strength pill stuck **fully grey** after reconnect (early `return 'offline'`), and never re-measured if the `online` event was missed |
| 2.2 | `web/js/player.js` (3 sites) | Taps routed to the downloaded copy / `playOfflineIfAvailable()` instead of streaming, because `navigator.onLine` still said `false` |

---

## 3. Other findings

### 3.1 Stale duplicate app files shipped inside the APK — **fixed (deleted)**

`mobile/www/` (the Capacitor `webDir`) and `mobile/android/app/src/main/assets/public/` both
contained **stray copies at their root** that did not exist in `web/`:

```
mobile/www/app.js            73 KB   (differs from js/app.js — an OLD build, Sep 26)
mobile/www/categories.js     12 KB
mobile/www/playlists.js      12 KB
mobile/www/style.css         22 KB
+ the same four in mobile/android/app/src/main/assets/public/
```

~120 KB of dead weight per copy inside the APK, and a **stale duplicate of the whole app**
one directory above the real one — a trap if any future loader ever resolved `app.js`
instead of `js/app.js`. Verified unreferenced (nothing in either `index.html` or either
`sw.js` points at them) and then deleted. The empty `cordova.js` / `cordova_plugins.js`
stubs in the Android assets were left in place — Capacitor's cordova bridge expects those
paths to exist.

### 3.2 `docs/` (GitHub Pages build) is not affected

`docs/` has no `offlineBanner` markup and no `navigator.onLine` usage, so no mirror of this
fix is needed there. Its JS is an intentionally older/divergent build.

### 3.3 Deprecated API usage

`navigator.connection.type` was load-bearing in the offline path despite being removed from
modern Chrome. It now appears only as a *hint* inside `SimpMusicNet`, never as the verdict.

---

## 4. Verification

### 4.1 Automated, against the real shipped files — `tools/net.test.mjs`

Loads the actual `web/js/net.js` and the actual `setupOfflineBanner()` from
`web/js/recommendations.js` behind a shimmed DOM/`navigator`/`fetch`, then walks the reported
sequence. Run with `node tools/net.test.mjs` (add `--fallback` for the stale-cache path).

```
node tools/net.test.mjs
  ✓ starts offline (onLine=false + no network) → banner visible
  ✓ old logic (`navigator.onLine === false`) is stuck true — the reported bug
  ✓ banner clears itself once the network is really back          ← the fix
  ✓ offline event paints the banner immediately
  ✓ spurious event self-heals after the probe succeeds
  ✓ genuinely offline: banner stays (no flicker)
  ✓ healthy WebView: `online` event clears it at once
  ✓ player.js isOfflineNow(): stale onLine=false overruled once verified online
  ✓ no call site still reads navigator.onLine directly
PASSED: 18  FAILED: 0

node tools/net.test.mjs --fallback        # net.js missing (stale cached bundle)
PASSED: 16  FAILED: 0

node tools/reco.test.mjs                  # existing suite, no regression
PASSED: 22  FAILED: 0
```

Test 1 is the bug itself: `navigator.onLine` is held at `false` and the `online` event is
**never fired** — the old expression stays stuck, while the new one clears the banner within
one re-check.

### 4.2 On-device (APK) — **skipped (not verified on hardware)**

The build was attempted three times and the Gradle daemon crashed each time with a JVM OOM
(`insufficient memory for the Java Runtime Environment to continue`,
`hs_err_pid*.log` — crash logs removed afterwards). The machine has 8 GB total with only
~650 MB free (browsers + Defender + other processes), and the daemon needs ~1.5 GB; lowering
it to `-Xmx1024m -XX:MaxMetaspaceSize=512m --no-parallel` got as far as
`:app:compileDebugJavaWithJavac` before dying as well. Nothing about the crash relates to
these code changes. Per the decision taken, the on-device airplane-mode walkthrough
(background the app → network returns → reopen → banner must be gone) was **skipped**, so
that path remains verified by simulation (§4.1) only.

### 4.3 Parity

`web/`, `mobile/www/` and `mobile/android/app/src/main/assets/public/` hold byte-identical
copies of every changed file (checked by md5). `??` new files: `web/js/net.js`,
`mobile/www/js/net.js`, `tools/net.test.mjs`.

---

## 5. Lock-screen progress bar empty after an automatic track change — **fixed**

> "The music player in the lock screen is not working properly: if a song finishes
> itself then another plays, but the next song's loader doesn't show in the lock-screen
> player, and the music still plays & even shows the next song name correctly, but not
> the song loading."

### What the system draws from

The lock-screen / quick-settings media card's scrubber, and the `00:07 / 04:12` time
labels beside it, are drawn from the **duration in the session metadata**
(`METADATA_KEY_DURATION`). Media3 fills that from the *player*, not the item metadata:
`PlayerWrapper.getDurationWithCommandCheck()` returns `Player.getDuration()` and
`ControllerLegacyCbForBroadcast.updateMetadataIfChanged()` writes it into the session
metadata; the framework's `MediaSessionRecord` then uses it as the progress range
(Android docs: *"If the duration isn't set the seek bar doesn't show progress"*).
Media3 1.3.1's `MediaMetadata` has **no duration field at all** (verified against the
AAR: no `setDurationMs`), so `Player.getDuration()` is the only lever.

### Root cause

On an automatic track change the session metadata is published the instant the next
media item becomes current — before the new stream has been opened — so
`getDuration()` is still `TIME_UNSET`. The title/artist are already in the metadata and
show correctly; the duration is missing, so the bar has no range and the time labels
vanish. Measured live on the device (`dumpsys media_session`, 0.4 s polling across a
real auto-advance, screen off):

```
playing (song ends)  state=PLAYING   position=267401   metadata: size=10   ← bar works
item transitions     state=BUFFERING active id=2→1    metadata: size=7    ← duration GONE
still opening        state=BUFFERING                  metadata: size=9
stream ready         state=PLAYING   position=0        metadata: size=10   ← recovers
```

For a track whose resolved stream never reports a length the recovery never happens and
the bar stays empty for that whole song — matching the report (`size=10` is the state
that renders the working `00:07 / 04:12` card, captured on the same device).

### Fix

The session player is already a `ForwardingPlayer` wrapper (`mediaPlayer()`, v3.13.1),
so it now answers with the duration the queue already knows whenever the player cannot:

```java
@Override
public long getDuration() {
    long d = super.getDuration();
    if (d != C.TIME_UNSET && d > 0) return d;
    Track cur = currentTrack();
    return cur != null && cur.durationSec > 0 ? cur.durationSec * 1000L : d;
}
```

Every queued track carries `durationSec` from the WebView, so the very first metadata
publish already has a usable range and the scrubber can never be empty mid-transition.
The wrapper is also what `MediaSession.setPlayer()` is handed, so the fix survives the
crossfade player swap (`finishCrossfade` re-binds the same wrapper).

### Verification

* **Observed the failure on the device** (table above) and confirmed the working case
  renders `00:07 / 04:12` — so the metadata-size change is really the scrubber leaving.
* **The changed Java compiles**: `javac` (JDK 17) compiled all 8 app sources + generated
  `BuildConfig` against the real `android.jar` (API 35 minus), media3 1.3.1 AARs,
  capacitor-android, NewPipeExtractor and okhttp/okio, exit 0. This is how the invalid
  `setDurationMs` call was caught (Media3 1.3.1 has no such API).
* **NOT verified on hardware**: the fix needs a rebuilt APK, and gradle cannot finish on
  this machine right now (JVM OOM — 8 GB total, ~390 MB free at the time of writing).
  The reasoning above is source- and device-observation-backed, not a runtime test of
  the patched build.

### Reproduce/verify in 1 minute (once the APK builds)

```bash
adb install -r mobile/android/app/build/outputs/apk/debug/app-debug.apk   # v3.20.7
# play a 2-song queue, then, with the SCREEN OFF, let song 1 end naturally
adb shell input keyevent 26      # screen off
# ...wait for the switch, then:
adb shell input keyevent 26      # wake → lock screen
adb shell screencap -p /sdcard/lock.png && adb pull /sdcard/lock.png .
# EXPECT: new title AND a filled bar with time labels (e.g. 00:03 / 04:12).
# Before the fix the bar was empty and the labels were missing for the first seconds
# of every auto-advanced track.
```

## 6. Some songs skip themselves until the app is restarted — **fixed**

> "i don't know why but sometime some songs i cannot able to play & it skip itself, but
> when i restart the app it plays the song perfectly"

### Root cause — an invalidator that never matched a key

`StreamResolver` caches resolved stream URLs in a `videoId → url` map. Entries are
stored under `videoId@quality` (playback) and `dl:videoId` (downloads), so a single
track can be cached at more than one quality. `invalidate(videoId)` — the only way the
app drops a dead URL — did `CACHE.remove(videoId)`. Nothing was ever stored under the
bare id, so **every call was a silent no-op**.

That broke both recovery paths at once:

1. `SelfHealingDataSource.open()` catches a 403/410/429, calls
   `StreamResolver.invalidate()` and retries the open once — but the retry re-resolved
   through the same still-cached URL, so it failed the same way.
2. `PlaybackKeepAliveService`'s fixer and its post-error retry did the same thing.

A YouTube stream URL that gets rejected for a reason its own `expire=` timestamp does
not predict (PO-token/client mismatch, rate limiting, a URL minted for a different
network) therefore stayed in the map for the rest of the process lifetime. Every later
attempt got the same dead URL, ExoPlayer errored, `recoverFromBrokenTrack()` dropped the
track and skipped to the next one. Kill and relaunch the app, the map is empty, a fresh
URL is minted — and the very same song plays. That is exactly the report.

### Fix

* `playbackKey(videoId)` is now the single place a playback cache key is built; the
  resolver, `invalidate()` and `isCached()` all go through it.
* `invalidate()` removes **every** entry for the id — all `videoId@quality` variants plus
  the `dl:` entry — together with its bookkeeping timestamps.
* Entries also carry their resolve time (`CACHE_AT`) and are treated as stale when the
  URL's own `expire=` is less than a minute away (or, for URLs without one, after 3 h),
  so a URL is re-minted *before* it can 403 mid-track.
* Eviction no longer assumes the bitrate map has a matching entry (that used to throw
  `NoSuchElementException` inside the resolve call and be reported as an unplayable
  track), and the quality setting's `saver` label survives normalization.

### Verification

* **Compiles**: `javac` (JDK 17) built all 8 app sources + generated `BuildConfig` against
  `android.jar`, media3 1.3.1, capacitor-android, NewPipeExtractor and okhttp/okio — exit 0.
* **Built the APK and installed it on the device** (v3.20.7, `assembleDebug`, 1m41s).
  Gradle needed a JDK 17 (the machine now only has JDK 24, which Gradle 8.2.1 refuses);
  a portable Temurin 17 supplied through `-Dorg.gradle.java.home` was enough — no system
  change. Logged playback on the new build: `Resolved … (quality=high, picked 160kbps
  webm)` → session `state=PLAYING(3)`, position advancing, no player errors.
* **NOT reproduced end-to-end**: forcing a *live* URL to be rejected mid-session needs a
  track to sit in the cache until YouTube invalidates it, which is not scriptable from
  adb. The fix is verified as “the invalidator now does what its callers always assumed”,
  not as a runtime replay of the report.

### Reproduce/verify by hand

Play a playlist for an hour or more without restarting (the window where a cached URL
outlives its validity), or toggle airplane mode mid-track to force resolution failures.
Before the fix the track was dropped and skipped for the rest of the session; now the
retry re-mints a URL and the same track keeps playing.

## 7. Files changed

| File | Change |
| --- | --- |
| `web/js/net.js` | **new** — `SimpMusicNet` verified-connectivity helper |
| `web/js/recommendations.js` | banner driven by `SimpMusicNet` + degraded-path probe |
| `web/js/app.js` | net pill uses the verified state; re-measures on resume |
| `web/js/player.js` | `isOfflineNow()` helper; 3 call sites migrated |
| `web/index.html` | loads `js/net.js`; asset cache-bust `?v=v3207_net` |
| `web/sw.js` | `net.js` precached; cache `simpmusic-v88` → `v89` |
| `mobile/www/…` | all six of the above mirrored |
| `mobile/android/app/src/main/assets/public/…` | all six mirrored |
| `tools/net.test.mjs` | **new** — regression test for this bug |
| `mobile/android/app/build.gradle` | `versionCode 96` / `versionName "3.20.7"` |
| `…/PlaybackKeepAliveService.java` | §5 — session `getDuration()` falls back to the queued track length |
| `…/StreamResolver.java` | §6 — one place builds cache keys; `invalidate()` really removes every variant; URL-age/expiry checks |
| `mobile/www/{app,categories,playlists}.js`, `mobile/www/style.css` | **deleted** — stale duplicates (§3.1) |
| `mobile/android/app/src/main/assets/public/{app,categories,playlists}.js`, `…/style.css` | **deleted** — same duplicates in the shipped bundle |

## 8. How to re-test on a device

1. `cd mobile/android && ./gradlew assembleDebug` (needs ≥1.5 GB free RAM)
   * Gradle 8.2.1 needs **JDK 17** — `gradle.properties` pins `C:/Program Files/Java/jdk-17`,
     which no longer exists on this machine (only JDK 24). A portable Temurin 17 works
     without touching the system: `./gradlew assembleDebug --no-daemon \
     -Dorg.gradle.java.home=<path-to-jdk-17>`.
2. `adb install -r app/build/outputs/apk/debug/app-debug.apk`
3. Open the app, then `adb shell cmd connectivity airplane-mode enable` → banner appears.
4. Press Home, `adb shell cmd connectivity airplane-mode disable`, wait ~10 s, reopen the app
   → the banner must be gone within a few seconds, with no app restart.
5. §6: play a long playlist without restarting; a track that fails to open must now be
   re-resolved (fresh URL) instead of being dropped and skipped.
