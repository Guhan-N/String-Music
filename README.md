# 🎵 String Music

An ad-free music streaming ecosystem inspired by **SimpMusic** and **Apple Music** that runs across **Web, Android, and Extension** with **Zero Connection Settings Required**:
- 🌐 **Live Web Application (GitHub Pages)**: [https://guhan-n.github.io/String-Music/](https://guhan-n.github.io/String-Music/)
- 📱 **Mobile Responsive View**: Dedicated mobile home view automatically tailored for phone screens.
- 🎧 **iPod Classic Player**: Tap the playing song profile picture / album art to launch the iPod Click Wheel player modal!
- 📲 **Android Mobile APK**: Standalone installable `.apk` ([`SimpMusic.apk`](./SimpMusic.apk)) with background playback.
- 🧩 **Browser Extension**: Manifest V3 extension with mini-player popup & background audio.

Stream directly with **real-time synchronized lyrics** powered by the open [LRCLIB](https://lrclib.net) API, requiring **ZERO subscriptions, API keys, or backend IP configurations**.

---

## 📁 Project Architecture & File Structure

```
music-ecosystem/
├── backend/
│   ├── server.js              # Express server serving API + Web SPA
│   ├── scraper.js             # YouTube WEB_REMIX parser & LRCLIB client
│   └── package.json           # Dependencies: express, cors
├── web/
│   ├── index.html             # Apple Music Glassmorphic SPA
│   ├── css/
│   │   └── style.css          # Glassmorphic dark palette, vinyl animations, karaoke styling
│   └── js/
│       ├── player.js          # Playback engine (YT IFrame, Queue, MediaSession API)
│       ├── lyrics.js          # LRCLIB synchronized lyrics & auto-scrolling engine
│       └── app.js             # UI Controller, search debounce, playlists, shortcuts
├── extension/
│   ├── manifest.json          # Chrome Manifest V3 configuration
│   ├── popup.html             # 400x560px compact mini-player popup
│   ├── popup.css              # Compact glassmorphic styles
│   ├── popup.js               # Mini-player controller
│   ├── background.js          # Service worker managing offscreen document
│   ├── offscreen.html         # Offscreen audio host for background playback
│   ├── offscreen.js           # Background playback engine & Chrome media session
│   └── icons/                 # 16px, 48px, 128px PNG icons
├── mobile/
│   ├── capacitor.config.json  # Capacitor Android configuration
│   ├── package.json
│   ├── www/                   # Packaged web frontend assets
│   ├── android/               # Native Android project with Gradle wrapper
│   └── SimpMusic.apk          # Pre-compiled, installable Android APK (3.7MB)
├── SimpMusic.apk              # Standalone installable Android APK
└── package.json               # Root helper scripts
```

---

## 🚀 Quick Setup & Usage Instructions

### 1. Run the Web Application Locally
1. Open terminal in `music-ecosystem/backend`:
   ```bash
   cd music-ecosystem/backend
   npm install
   node server.js
   ```
2. Open your browser and navigate to:
   ```
   http://localhost:3000
   ```
3. **Features in Web App**:
   - **Search**: Instant search with YouTube Music autocomplete suggestions.
   - **Browse**: Curated charts for Global Top 50, Chill Lo-Fi, Pop, Hip-Hop, Rock, and Indie.
   - **Karaoke Lyrics**: Click the lyrics button (or press `L`) to open the fullscreen glassmorphic karaoke view with rotating vinyl album cover and auto-scrolling lyrics. Click any lyric line to seek playback!
   - **Queue**: Dynamic queue drawer with reordering and auto-recommendations.
   - **Keyboard Shortcuts**:
     - `Space`: Play / Pause
     - `←` / `→`: Seek -5s / +5s
     - `L`: Toggle Fullscreen Lyrics
     - `Q`: Toggle Up Next Queue
     - `M`: Mute / Unmute

---

### 2. Load the Browser Extension (Chrome / Edge / Brave)
1. Open your browser and navigate to the Extensions page:
   - **Chrome**: `chrome://extensions/`
   - **Edge**: `edge://extensions/`
   - **Brave**: `brave://extensions/`
2. Enable **Developer mode** (toggle in the top-right corner).
3. Click **Load unpacked** (top-left button).
4. Select the `music-ecosystem/extension` folder:
   ```
   g:\String MUSIC\music-ecosystem\extension
   ```
5. Pin the **SimpMusic** extension icon to your toolbar.
6. Click the extension icon to open the 400x560px mini-player.
7. **Background Audio**: Start playing any song and close the popup or switch tabs—audio continues seamlessly in the background via the Manifest V3 Offscreen Audio Worker!

---

### 3. Install & Build the Android Mobile App (`.apk`)

#### Option A: Direct Install (Pre-compiled APK)
The standalone Android `.apk` has been compiled and is ready for immediate installation:
- **File location**: `music-ecosystem/SimpMusic.apk` or `music-ecosystem/mobile/SimpMusic.apk` (Size: ~3.7 MB).
- **Install on Device via ADB**:
  ```bash
  adb install "music-ecosystem/SimpMusic.apk"
  ```
- Or copy `SimpMusic.apk` to your phone's storage and tap to install (enable "Install unknown apps" in Settings).

#### Option B: Rebuild via Gradle (CLI / Android Studio)
To re-compile the APK from source:
1. Open PowerShell in `music-ecosystem/mobile/android`:
   ```powershell
   cd music-ecosystem/mobile/android
   $env:JAVA_HOME = "C:\Program Files\Java\jdk-17"
   $env:ANDROID_HOME = "C:\Users\yassh\AppData\Local\Android\Sdk"
   .\gradlew.bat assembleDebug
   ```
2. The newly generated APK will be at:
   ```
   music-ecosystem/mobile/android/app/build/outputs/apk/debug/app-debug.apk
   ```

---

## 🛠️ API Reference (Shared Backend)

| Endpoint | Method | Description | Parameters |
|---|---|---|---|
| `/api/search` | `GET` | Searches YouTube Music (WEB_REMIX client) | `q`: query string |
| `/api/suggestions` | `GET` | Autocomplete search suggestions | `q`: query string |
| `/api/trending` | `GET` | Curated charts by genre | `genre`: `global`, `chill`, `pop`, `hiphop`, `rock`, `indie` |
| `/api/lyrics` | `GET` | Synchronized LRC lyrics from LRCLIB | `title`, `artist`, `duration` |
| `/api/health` | `GET` | API health status & uptime | None |

---

## 🎨 Design System
- **Colors**:
  - Background: `#0a0a12`, `#12111d`
  - Neon Violet Accent: `#a855f7`
  - Neon Rose Accent: `#ec4899`
  - Frosted Borders: `rgba(255, 255, 255, 0.08)`
- **Glassmorphism**: `backdrop-filter: blur(24px)`
- **Typography**: Plus Jakarta Sans
