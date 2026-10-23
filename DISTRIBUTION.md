# String Music — two-app distribution

Two products, one codebase, one flag.

| | **String Music Simple** | **String Music Elite** |
|---|---|---|
| Package | `com.stringmusic.simple` | `com.stringmusic.elite` |
| Distribution | Google Play Store | GitHub Releases (this repository) |
| Audio | files already on the device (MediaStore) | YouTube streaming + local |
| Network permission | **none** | `INTERNET` |
| Streaming code in binary | **none** (no NewPipe, no OkHttp) | yes |
| Version | 1.0.0 | 3.22.0 |

## Repository layout

Both products live in this one repository, [Guhan-N/String-Music](https://github.com/Guhan-N/String-Music):

- `web/` — the shared app; the Elite APK packages it as-is.
- `web/simple/` — the Play edition shell (local library only).
- `mobile/android/app/src/elite` — streaming Java, manifest and assets.
- `mobile/android/app/src/simple` — MediaStore library + local playback.
- `Releases` — only `string-music-elite-*.apk`; the Simple build is uploaded to
  Play, never attached to a release.

Package names are permanent. Play treats a package name as the app's identity, so
`com.stringmusic.simple` can never become the streaming app and
`com.stringmusic.elite` can never be uploaded to Play. That separation is what
keeps the store listing stable while Elite ships independently.

## The flag

[`web/js/build-config.js`](web/js/build-config.js) holds the only switch:

```js
const ELITE_BUILD = true;
```

- `true` → Elite: the full app in `web/`.
- `false` → Simple: the local-only shell in `web/simple/`.

`tools/build-apps.mjs` rewrites that line while it stages each edition, and the
staged copy also controls which assets are packaged:

```
simple :  index.html + simple.css + simple.js + js/build-config.js (false)
elite  :  the whole web/ tree + js/build-config.js (true)
```

## Building

```bash
node tools/build-apps.mjs simple     # → dist/string-music-simple-<version>-debug.apk
node tools/build-apps.mjs elite      # → dist/string-music-elite-<version>-debug.apk
node tools/build-apps.mjs both --release   # release variants
```

`JAVA_HOME` must point at a JDK 17 (`tools/build-apps.mjs` falls back to
`.tools/jdk17` when present). Gradle 8.2.1 refuses to start on JDK 21+.

Install the Play build on a connected phone:

```bash
adb install -r dist/string-music-simple-1.0.0-debug.apk
```

## What Simple contains

- `LocalLibraryPlugin` — reads `MediaStore.Audio` (MP3, FLAC, AAC, OGG, WAV …)
  and returns title/artist/album/duration/content-URI. Album art is decoded
  natively and handed to JS as a `data:` URL.
- `LocalPlaybackService` — a plain media3 `MediaSessionService` over
  `content://` URIs: background playback, lock-screen and notification controls.
- `web/simple/*` — Songs / Liked / Settings, seek bar, likes in `localStorage`,
  and a base64 sync code export.

Nothing in the Simple binary can open a socket: the manifest has no network
permission, `eliteImplementation` keeps NewPipe and OkHttp out of the build, and
the only `Intent` it ever fires is `ACTION_VIEW` for the browser hand-off.

## What Elite adds

The full WebView app (`web/`), the NewPipe-backed stream resolver, the
keep-alive playback service, downloads and backup, plus a one-time first-launch
screen that imports a sync code produced by Simple (`elite-onboarding.js`).
Imported likes are resolved to a streamable track by title/artist the first time
they are played.

## The Elite link in Simple (policy-safe by construction)

Settings ends with a quiet card:

> ✨ String Music Elite — YouTube streaming, lyrics, crossfade & more
> **[ Learn More ]**

It never says Update / Download / Install, never appears as a popup, and exists
only inside Settings. Tapping it opens an in-app terms screen; only the second
button — **I Understand, Take Me to Elite** — calls
`window.open(url, '_system')` (with a native `ACTION_VIEW` fallback).

Simple does not download, install, fetch, verify or version-check anything. After
the browser opens, the app is out of the loop and every subsequent action is the
user's own, outside Play's jurisdiction.

## Publishing a new Elite version

1. Bump `versionCode` / `versionName` in the `elite` block of
   [`mobile/android/app/build.gradle`](mobile/android/app/build.gradle).
2. Build a signed release APK:
   `node tools/build-apps.mjs elite --release`
3. GitHub → **Releases → Draft a new release** → tag `v3.22.0` → upload
   `dist/string-music-elite-3.22.0.apk` → **Publish**.

The releases page at
`https://github.com/Guhan-N/String-Music/releases/latest` is the download
page, changelog and version history in one. No server, no update endpoint.

### Release description template

```markdown
## What's new
- <feature>
- <fix>

## Install
1. Download `string-music-elite-<version>.apk` below.
2. Open the downloaded file.
3. If Android asks, allow "Install unknown apps" for your browser or Files app.
4. Tap Install.

Coming from String Music Simple? Open Simple → Settings → Export Sync Code,
then paste that code into Elite's first-launch screen.

**This app is not on Google Play. Install voluntarily at your own discretion.**
```

## Publishing an update to Simple (Play)

1. Bump `versionCode` / `versionName` in the `simple` block of
   [`mobile/android/app/build.gradle`](mobile/android/app/build.gradle).
2. `node tools/build-apps.mjs simple --release`
3. Upload the AAB/APK to the Play Console.

Simple's reviewed behaviour is fixed: local playback only, the Elite card
unchanged. Building it never touches Elite's code path, and `ELITE_BUILD` is
staged as `false` for that artifact.

## Play Console notes

- App access: no login, no accounts.
- Data safety: no data collected, no data shared — the app has no network
  permission and stores likes only in local storage.
- Permissions: audio media read (for the library) + notifications (media
  controls). No `INTERNET`, no `ACCESS_NETWORK_STATE`, no location, no ads ID.
- The Settings card describes a product hosted elsewhere and does not install
  anything; keep it as-is, do not turn it into a promotional banner.
