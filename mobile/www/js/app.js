/**
 * SimpMusic Main Web Application Controller
 * Handles UI interactions, search, recommendations, playlists, and keyboard shortcuts
 */

/**
 * Mobile-layout decision (v3.11.3).
 * Width alone is wrong: in landscape a phone can exceed 900 CSS px and
 * would flip to the desktop layout. Any touch/coarse-pointer device gets
 * the mobile layout at every size; real desktops keep the width rule.
 */
function isTouchLayout() {
  try {
    return (window.matchMedia('(pointer: coarse)').matches ||
            'ontouchstart' in window) &&
           !window.matchMedia('(pointer: fine)').matches;
  } catch (e) { return false; }
}
function isMobileLayout() {
  return window.matchMedia('(max-width: 900px)').matches || isTouchLayout();
}

document.addEventListener('DOMContentLoaded', () => {
  // Initialize Core Engines
  const player = new MusicPlayer();
  const lyrics = new LyricsController(player);
  // Expose globally so categories.js / playlists.js can trigger playback
  window.player = player;

  // State Management
  let currentTracks = [];
  // True while the tracklist shows a playlist opened from the Library —
  // the only context where the ⋮ "add to playlist" sheet is offered.
  let playlistDetailMode = false;
  let likedSongs = JSON.parse(localStorage.getItem('simpmusic_likes') || '[]');
  let activeGenre = 'global';

  // DOM Elements
  const searchInput = document.getElementById('searchInput');
  const searchClearBtn = document.getElementById('searchClearBtn');
  const suggestionsBox = document.getElementById('searchSuggestions');
  const tracksGrid = document.getElementById('tracksGrid');
  const sectionTitle = document.getElementById('sectionTitle');
  const heroBanner = document.getElementById('heroBanner');
  const heroBackdrop = document.getElementById('heroBackdrop');
  const heroTitle = document.getElementById('heroTitle');
  const heroSubtitle = document.getElementById('heroSubtitle');
  const heroPlayBtn = document.getElementById('heroPlayBtn');
  const genreChips = document.querySelectorAll('.genre-chip');

  // Reference UI Elements: Numbered Tracklist & Hero
  const numberedTracklist = document.getElementById('numberedTracklist');
  const heroCoverImg = document.getElementById('heroCoverImg');
  const heroCategory = document.getElementById('heroCategory');
  const heroArtist = document.getElementById('heroArtist');
  const heroLikeBtn = document.getElementById('heroLikeBtn');
  const heroDownloadBtn = document.getElementById('heroDownloadBtn');

  // Mobile Home View Elements
  const desktopTracklistView = document.getElementById('desktopTracklistView');
  const mobileHomeView = document.getElementById('mobileHomeView');
  const mobileHeroThumb = document.getElementById('mobileHeroThumb');
  const mobileHeroTitle = document.getElementById('mobileHeroTitle');
  const mobileMiniDock = document.getElementById('mobileMiniDock');
  const mobileMiniThumb = document.getElementById('mobileMiniThumb');
  const mobileMiniTitle = document.getElementById('mobileMiniTitle');
  const mobileMiniArtist = document.getElementById('mobileMiniArtist');
  const mobileMiniLikeBtn = document.getElementById('mobileMiniLikeBtn');
  const mobileMiniPlayBtn = document.getElementById('mobileMiniPlayBtn');

  // iPod Player Elements
  const ipodPlayerModal = document.getElementById('ipodPlayerModal');
  const ipodBackBtn = document.getElementById('ipodBackBtn');
  const ipodAlbumTag = document.getElementById('ipodAlbumTag');
  const ipodCoverImg = document.getElementById('ipodCoverImg');
  const ipodTitle = document.getElementById('ipodTitle');
  const ipodArtist = document.getElementById('ipodArtist');
  const ipodCurrentTime = document.getElementById('ipodCurrentTime');
  const ipodRemainingTime = document.getElementById('ipodRemainingTime');
  const ipodProgressRail = document.getElementById('ipodProgressRail');
  const ipodProgressFill = document.getElementById('ipodProgressFill');
  const ipodProgressThumb = document.getElementById('ipodProgressThumb');

  // iPod Wheel Buttons
  const ipodClickWheel = document.getElementById('ipodClickWheel');
  const wheelShuffleBtn = document.getElementById('wheelShuffleBtn');
  const wheelPrevBtn = document.getElementById('wheelPrevBtn');
  const wheelNextBtn = document.getElementById('wheelNextBtn');
  const wheelPlayBtn = document.getElementById('wheelPlayBtn');
  const wheelCenterBtn = document.getElementById('wheelCenterBtn');


  // Player Dock Elements
  const dockThumb = document.getElementById('dockThumb');
  const dockTitle = document.getElementById('dockTitle');
  const dockArtist = document.getElementById('dockArtist');
  const dockLikeBtn = document.getElementById('dockLikeBtn');
  const playPauseBtn = document.getElementById('playPauseBtn');
  const prevBtn = document.getElementById('prevBtn');
  const nextBtn = document.getElementById('nextBtn');
  const shuffleBtn = document.getElementById('shuffleBtn');
  const repeatBtn = document.getElementById('repeatBtn');
  const progressRail = document.getElementById('progressRail');
  const progressFill = document.getElementById('progressFill');
  const progressThumb = document.getElementById('progressThumb');
  const currentTimeLabel = document.getElementById('currentTimeLabel');
  const totalDurationLabel = document.getElementById('totalDurationLabel');
  const volumeSlider = document.getElementById('volumeSlider');
  const volumeBtn = document.getElementById('volumeBtn');
  const lyricsToggleBtn = document.getElementById('lyricsToggleBtn');
  const queueToggleBtn = document.getElementById('queueToggleBtn');

  // Lyrics Overlay Elements
  const lyricsOverlay = document.getElementById('lyricsOverlay');
  const closeLyricsBtn = document.getElementById('closeLyricsBtn');
  const vinylDisc = document.getElementById('vinylDisc');
  const vinylCover = document.getElementById('vinylCover');
  const vinylTitle = document.getElementById('vinylTitle');
  const vinylArtist = document.getElementById('vinylArtist');

  // Queue Drawer Elements
  const queueDrawer = document.getElementById('queueDrawer');
  const closeQueueBtn = document.getElementById('closeQueueBtn');
  const queueList = document.getElementById('queueList');
  const clearQueueBtn = document.getElementById('clearQueueBtn');

  // Zero-Configuration Detection: Works with local backend or 100% standalone
  let isCloudMode = false;
  window.API_BASE = (window.location.protocol === 'http:' || window.location.protocol === 'https:') ? '' : '';
  let API_BASE = window.API_BASE;

  // Native search via NewPipe (Android APK). Returns track[] or null.
  // Inside the APK the WebView is served from Capacitor's internal localhost,
  // so the Express backend is unreachable — search must run on-device.
  async function nativeSearch(query, timeoutMs = 10000, type = 'songs') {
    try {
      const cap = window.Capacitor;
      if (!cap || !cap.isPluginAvailable || !cap.isPluginAvailable('PlaybackKeeper')) return null;
      const res = await Promise.race([
        cap.Plugins.PlaybackKeeper.search({ query, type }),
        new Promise((_, rej) => setTimeout(() => rej(new Error('native search timeout')), timeoutMs))
      ]);
      if (res && res.results) {
        const parsed = JSON.parse(res.results);
        if (Array.isArray(parsed) && parsed.length > 0) return parsed;
      }
    } catch (e) {
      console.warn('nativeSearch failed:', (e && e.message) || e);
    }
    return null;
  }

  // Auto-detect if same-origin backend is active without blocking UI
  async function probeBackend() {
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 1200);
      const res = await fetch(`${API_BASE ? API_BASE : ''}/api/health`, { signal: controller.signal });
      clearTimeout(timeoutId);
      if (res.ok) {
        isCloudMode = false;
        return;
      }
    } catch (e) {}
    // If no backend endpoint responds (e.g. GitHub Pages or offline), operate standalone
    isCloudMode = true;
  }
  probeBackend();

  // Format seconds to mm:ss
  function formatTime(seconds) {
    if (isNaN(seconds) || seconds < 0) return '0:00';
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${mins}:${secs < 10 ? '0' : ''}${secs}`;
  }

  // v3.12.3: startup placeholder = the LAST song the user listened to
  // (from history), not a hardcoded track. Falls back to a neutral idle
  // state when there is no history at all.
  function lastListenedTrack() {
    try {
      const rec = JSON.parse(localStorage.getItem('simpmusic_recent_songs') || '[]');
      if (Array.isArray(rec) && rec.length && rec[0] && rec[0].videoId) return rec[0];
    } catch (e) {}
    return null;
  }
  const idleStartupTrack = {
    videoId: '',
    title: 'No song playing',
    artist: 'Play something to begin',
    album: 'STRING MUSIC',
    duration: '0:00',
    durationSec: 0,
    thumbnail: 'icons/sweetener_cover.png'
  };

  // Update Hero & Cards with track metadata
  function updateMediaSessionMetadataSafe(track) {
    try {
      if (!track || !('mediaSession' in navigator)) return;
      navigator.mediaSession.metadata = new MediaMetadata({
        title: track.title || '',
        artist: track.artist || '',
        album: track.album || 'String Music',
        artwork: track.thumbnail ? [{ src: track.thumbnail, sizes: '512x512', type: 'image/jpeg' }] : []
      });
    } catch (e) {}
  }

  function updateHeroDetails(track) {
    const t = track || lastListenedTrack() || idleStartupTrack;
    if (heroCoverImg) heroCoverImg.src = t.thumbnail || 'icons/sweetener_cover.png';
    if (heroTitle) heroTitle.textContent = t.title || 'No song playing';
    if (heroArtist) heroArtist.textContent = t.artist || 'Play something to begin';
    if (heroCategory) heroCategory.textContent = t.album || 'STRING MUSIC';

    // Update Mobile Screen 2 elements
    if (mobileHeroThumb) mobileHeroThumb.src = t.thumbnail || 'icons/sweetener_cover.png';
    if (mobileHeroTitle) mobileHeroTitle.textContent = t.title || 'No song playing';
    if (mobileMiniThumb) mobileMiniThumb.src = t.thumbnail || 'icons/sweetener_cover.png';
    if (mobileMiniTitle) mobileMiniTitle.textContent = t.title || 'No song playing';
    if (mobileMiniArtist) {
      mobileMiniArtist.textContent = t.artist || 'Play something to begin';
      if (t.artist) mobileMiniArtist.setAttribute('data-artist-open', t.artist);
      else mobileMiniArtist.removeAttribute('data-artist-open');
    }

    // Update iPod Screen 1 elements
    if (ipodCoverImg) ipodCoverImg.src = t.thumbnail || 'icons/sweetener_cover.png';
    if (ipodTitle) ipodTitle.textContent = t.title || 'No song playing';
    if (ipodArtist) ipodArtist.textContent = t.artist || 'Play something to begin';
    if (ipodAlbumTag) ipodAlbumTag.textContent = (t.album || 'SIMPMUSIC').toUpperCase();
  }

  function updateActivePlayingRow(videoId) {
    document.querySelectorAll('.track-row').forEach(row => {
      if (row.dataset.videoId === videoId) {
        row.classList.add('active-playing');
      } else {
        row.classList.remove('active-playing');
      }
    });
  }

  // Resilient Load Trending (Guaranteed zero-failure, defaults to sweetener playlist)
  async function loadTrending(genre = 'sweetener') {
    activeGenre = genre;
    if (sectionTitle) sectionTitle.textContent = `Trending • ${genre.toUpperCase()}`;

    let tracks = null;

    // 1. Try backend server if not purely in cloud mode
    if (!isCloudMode && genre !== 'sweetener') {
      try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 2000);
        const endpoint = API_BASE ? `${API_BASE}/api/trending?genre=${genre}` : `/api/trending?genre=${genre}`;
        const res = await fetch(endpoint, { signal: controller.signal });
        clearTimeout(timeoutId);
        if (res.ok) {
          tracks = await res.json();
        }
      } catch (err) {
        console.warn('Backend fetch failed, falling back to client catalog:', err);
      }
    }

    // 2. Seamless Standalone Cloud Catalog Fallback
    if (!tracks || tracks.length === 0) {
      if (typeof window.getClientTrending === 'function') {
        tracks = window.getClientTrending(genre);
      }
    }

    if (!tracks || tracks.length === 0) {
      tracks = window.getClientTrending('sweetener');
    }

    currentTracks = tracks;
    renderTracks(tracks);
  }

  // Render Numbered Tracklist matching top monitor in reference image
  function renderTracks(tracks, isSearch = false) {
    playlistDetailMode = false; // home/search/trending rows never offer the playlist sheet
    const addSongsBtn = document.getElementById('addSongsHeroBtn');
    if (addSongsBtn) addSongsBtn.style.display = 'none';
    if (!numberedTracklist) return;
    numberedTracklist.innerHTML = '';
    if (!tracks || tracks.length === 0) {
      numberedTracklist.innerHTML = `<p style="text-align: center; color: var(--text-muted); padding: 40px;">No songs found.</p>`;
      return;
    }

    // If searching, row 1 is the top match. Otherwise row 4 is active by default in the mockup if no track playing yet
    const currentPlayingId = player.currentTrack ? player.currentTrack.videoId : (isSearch ? tracks[0].videoId : (tracks[3] ? tracks[3].videoId : tracks[0].videoId));

    const fragment = document.createDocumentFragment();
    tracks.forEach((track, idx) => {
      const isCurrent = currentPlayingId === track.videoId;
      const row = document.createElement('div');
      row.className = `track-row ${isCurrent ? 'active-playing' : ''}`;
      row.dataset.videoId = track.videoId;

      row.innerHTML = `
        <div class="track-row-num">${idx + 1}</div>
        <div class="track-row-details">
          <div class="track-row-title" title="${track.title}">${track.title}</div>
          <div class="track-row-artist" title="${track.artist}" data-artist-open="${escapeHtml(track.artist || '')}">${track.artist}</div>
        </div>
        <button class="track-row-menu" title="Options">⋮</button>
      `;

      row.addEventListener('click', (e) => {
        if (e.target.classList.contains('track-row-menu')) {
          e.stopPropagation();
          // Universal 3-dot song menu: add to playlist / play next / download
          if (window.SimpMusicPlaylists && window.SimpMusicPlaylists.songMenu) {
            window.SimpMusicPlaylists.songMenu(track);
          } else {
            showToast(`Options: ${track.title}`);
          }
          return;
        }
        player.playTrack(track, tracks);
        updateActivePlayingRow(track.videoId);
      });

      fragment.appendChild(row);
    });

    numberedTracklist.appendChild(fragment);

    // Setup Hero Banner: use the playing track, or the top track while
    // searching, or the last-listened song (idleStartupTrack for new users).
    // v3.13: defaultLovelyTrack was referenced here but never defined — any
    // idle renderTracks() call threw a ReferenceError and killed the hero.
    const featured = player.currentTrack || (isSearch ? tracks[0] : (lastListenedTrack() || idleStartupTrack));
    updateHeroDetails(featured);

    if (heroLikeBtn) {
      heroLikeBtn.onclick = () => {
        toggleLike(player.currentTrack || featured);
        showToast(`Added to Liked Songs`);
      };
    }
    // v3.20.2-store: the Play Store bundle has no download feature — the
    // native plugin is never registered, so hide every download entry point.
    window.STORE_BUILD = window.STORE_BUILD || false;
    if (heroDownloadBtn && window.STORE_BUILD) {
      heroDownloadBtn.style.display = 'none';
    }
    if (heroDownloadBtn && !window.STORE_BUILD) {
      heroDownloadBtn.onclick = () => {
        // v3.18.5: inside a playlist detail, download the WHOLE playlist
        // (with the size-preview confirm); elsewhere, just the featured song.
        if (playlistDetailMode && currentTracks && currentTracks.length) {
          confirmPlaylistDownload(currentTracks, heroTitle ? heroTitle.textContent : 'Playlist').then(ok => {
            if (ok) downloadPlaylistTracks(currentTracks, null);
          });
          return;
        }
        startDownload(player.currentTrack || featured);
      };
    }
  }

  // Like Song Toggle
  function toggleLike(track) {
    if (!track) return;
    const idx = likedSongs.findIndex(s => s.videoId === track.videoId);
    if (idx >= 0) {
      likedSongs.splice(idx, 1);
    } else {
      likedSongs.unshift(track);
    }
    localStorage.setItem('simpmusic_likes', JSON.stringify(likedSongs));
    updateDockLikeState();
  }

  function updateDockLikeState() {
    const cur = player.currentTrack;
    if (!cur) return;
    const isLiked = likedSongs.some(s => s.videoId === cur.videoId);
    dockLikeBtn.classList.toggle('liked', isLiked);
    dockLikeBtn.querySelector('svg').setAttribute('fill', isLiked ? 'currentColor' : 'none');
  }

  // Search Debounce & Autocomplete
  let searchDebounceTimer = null;
  searchInput.addEventListener('input', (e) => {
    const query = e.target.value;
    searchClearBtn.classList.toggle('active', query.length > 0);

    clearTimeout(searchDebounceTimer);
    if (!query.trim()) {
      suggestionsBox.classList.remove('active');
      return;
    }

    searchDebounceTimer = setTimeout(async () => {
      // Fetch suggestions
      try {
        const endpoint = API_BASE ? `${API_BASE}/api/suggestions?q=${encodeURIComponent(query)}` : `/api/suggestions?q=${encodeURIComponent(query)}`;
        const res = await fetch(endpoint);
        if (res.ok) {
          const sugs = await res.json();
          if (sugs && sugs.length > 0) {
            renderSuggestions(sugs);
            return;
          }
        }
      } catch (err) {}
      if (typeof window.getClientSuggestions === 'function') {
        renderSuggestions(window.getClientSuggestions(query));
      }
    }, 200);
  });

  function renderSuggestions(sugs) {
    if (!sugs || sugs.length === 0) {
      suggestionsBox.classList.remove('active');
      return;
    }
    suggestionsBox.innerHTML = '';
    sugs.slice(0, 6).forEach(sug => {
      const item = document.createElement('div');
      item.className = 'suggestion-item';
      item.innerHTML = `
        <span class="suggestion-icon">🔍</span>
        <span>${sug}</span>
      `;
      item.addEventListener('click', () => {
        searchInput.value = sug;
        suggestionsBox.classList.remove('active');
        executeSearch(sug);
      });
      suggestionsBox.appendChild(item);
    });
    suggestionsBox.classList.add('active');
  }

  let isSearchActive = false;

  // Execute Search with Zero-Failure Backend & Client Fallback
  async function executeSearch(query) {
    if (!query || !query.trim()) return;
    const cleanQ = query.trim();

    if (suggestionsBox) suggestionsBox.classList.remove('active');

    // Desktop mode: surface results in the main tracklist. Mobile uses the
    // dedicated search view, so no view toggling is needed there.
    if (isMobileLayout() === false) {
      if (desktopTracklistView) desktopTracklistView.style.display = 'block';
      if (settingsView) settingsView.style.display = 'none';
    }
    isSearchActive = true;

    // Show immediate search loading in hero banner and tracklist
    if (heroCategory) heroCategory.textContent = 'SEARCH';
    if (heroTitle) heroTitle.textContent = `"${cleanQ}"`;
    if (heroArtist) heroArtist.textContent = 'Searching Trending Music...';
    if (numberedTracklist) {
      numberedTracklist.innerHTML = `
        <div style="text-align: center; padding: 60px 20px; color: var(--text-muted);">
          <div style="font-size: 2rem; margin-bottom: 12px; display: inline-block;">🔍</div>
          <p style="font-size: 1rem; color: #ffffff; margin-bottom: 6px;">Searching for "${cleanQ}"...</p>
          <span style="font-size: 0.8rem; color: var(--text-muted);">Scanning global catalog & live streams</span>
        </div>
      `;
    }

    let results = null;

    // 1. Native search (Android APK): NewPipe extraction on-device.
    results = await nativeSearch(cleanQ);

    // 2. Backend server search (web / PWA served by Express)
    if (!results && !isCloudMode) {
      try {
        const searchEndpoint = API_BASE ? `${API_BASE}/api/search?q=${encodeURIComponent(cleanQ)}` : `/api/search?q=${encodeURIComponent(cleanQ)}`;
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 6000);
        const res = await fetch(searchEndpoint, { signal: controller.signal });
        clearTimeout(timeoutId);
        if (res.ok) {
          results = await res.json();
        }
      } catch (err) {
        console.warn('Backend search request failed or timed out:', err);
      }
    }

    // 2. Standalone zero-failure fallback if backend returned empty or was unreachable
    if (!results || results.length === 0) {
      if (typeof window.clientSearch === 'function') {
        results = window.clientSearch(cleanQ);
      }
    }

    currentTracks = results || [];

    if (currentTracks.length > 0) {
      if (heroCategory) heroCategory.textContent = 'SEARCH RESULTS';
      if (heroTitle) heroTitle.textContent = `"${cleanQ}"`;
      if (heroArtist) heroArtist.textContent = `${currentTracks.length} songs found on YouTube Music`;
      if (heroCoverImg && currentTracks[0].thumbnail) {
        heroCoverImg.src = currentTracks[0].thumbnail;
      }
      renderTracks(currentTracks, true);
      showToast(`Found ${currentTracks.length} songs for "${cleanQ}"`);
    } else {
      if (heroCategory) heroCategory.textContent = 'NO RESULTS';
      if (heroTitle) heroTitle.textContent = `"${cleanQ}"`;
      if (heroArtist) heroArtist.textContent = 'No matching songs found';
      if (numberedTracklist) {
        numberedTracklist.innerHTML = `
          <div style="text-align: center; padding: 60px 20px; color: var(--text-muted);">
            <div style="font-size: 2rem; margin-bottom: 10px;">🎵</div>
            <p style="font-size: 1rem; color: #ffffff; margin-bottom: 6px;">No songs found for "${cleanQ}"</p>
            <span style="font-size: 0.8rem; color: var(--text-muted);">Try searching another artist, track title, or lyrics snippet.</span>
          </div>
        `;
      }
    }
  }



  searchInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      suggestionsBox.classList.remove('active');
      executeSearch(searchInput.value);
    }
  });

  searchClearBtn.addEventListener('click', () => {
    searchInput.value = '';
    searchClearBtn.classList.remove('active');
    if (suggestionsBox) suggestionsBox.classList.remove('active');
    isSearchActive = false;
    if (desktopTracklistView) desktopTracklistView.style.display = '';
    if (mobileHomeView) mobileHomeView.style.display = '';
    loadTrending(activeGenre);
  });

  // Hide suggestions when clicking outside
  document.addEventListener('click', (e) => {
    if (!searchInput.contains(e.target) && !suggestionsBox.contains(e.target)) {
      suggestionsBox.classList.remove('active');
    }
  });

  // Genre Filter Tabs
  genreChips.forEach(chip => {
    chip.addEventListener('click', () => {
      genreChips.forEach(c => c.classList.remove('active'));
      chip.classList.add('active');
      loadTrending(chip.dataset.genre);
    });
  });

  // Sidebar Navigation & View Routing
  const browseView = document.getElementById('browseView');
  const settingsView = document.getElementById('settingsView');
  const desktopPlaylistsView = document.getElementById('desktopPlaylistsView');

  document.querySelectorAll('.nav-item').forEach(item => {
    item.addEventListener('click', () => {
      document.querySelectorAll('.nav-item').forEach(i => i.classList.remove('active'));
      item.classList.add('active');
      const view = item.dataset.view;

      if (view === 'settings') {
        if (browseView) browseView.style.display = 'none';
        if (settingsView) settingsView.style.display = 'flex';
        if (desktopPlaylistsView) desktopPlaylistsView.style.display = 'none';
        updateDeviceProfileUI();
      } else {
        if (browseView) browseView.style.display = 'block';
        if (settingsView) settingsView.style.display = 'none';
        if (desktopPlaylistsView) desktopPlaylistsView.style.display = 'none';

        if (view === 'home' || view === 'explore') {
          if (desktopTracklistView) desktopTracklistView.style.display = '';
          if (mobileHomeView) mobileHomeView.style.display = '';
          loadTrending(activeGenre);
        } else if (view === 'playlists') {
          if (desktopTracklistView) desktopTracklistView.style.display = 'none';
          if (mobileHomeView) mobileHomeView.style.display = 'none';
          if (desktopPlaylistsView) desktopPlaylistsView.style.display = 'block';
          if (window.SimpMusicPlaylists) window.SimpMusicPlaylists.renderDesktop();
        } else if (view === 'queue') {
          if (queueDrawer) queueDrawer.classList.add('open');
        }
      }
    });
  });

  // --- Device Account Memory & Import / Export Engine ---
  let deviceId = localStorage.getItem('simpmusic_device_id');
  if (!deviceId) {
    deviceId = 'SIMP-' + Math.random().toString(36).substring(2, 6).toUpperCase();
    localStorage.setItem('simpmusic_device_id', deviceId);
  }

  let deviceName = localStorage.getItem('simpmusic_device_name');
  if (!deviceName) {
    const isMobile = /Android|iPhone|iPad|iPod/i.test(navigator.userAgent);
    deviceName = isMobile ? `Mobile Device (${deviceId})` : `Desktop (${deviceId})`;
    localStorage.setItem('simpmusic_device_name', deviceName);
  }

  function updateDeviceProfileUI() {
    const idBadge = document.getElementById('deviceIdBadge');
    const nameEl = document.getElementById('deviceProfileName');
    const platEl = document.getElementById('devicePlatformText');
    const likesEl = document.getElementById('statsLikesCount');
    const playEl = document.getElementById('statsPlaylistsCount');
    const queueEl = document.getElementById('statsQueueCount');

    const mobileStatLikes = document.getElementById('mobileStatLikes');
    const mobileStatRecents = document.getElementById('mobileStatRecents');
    const mobileStatPlaylists = document.getElementById('mobileStatPlaylists');

    if (idBadge) idBadge.textContent = deviceId;
    if (nameEl) nameEl.textContent = deviceName;
    if (platEl) platEl.textContent = navigator.userAgent.includes('Android') ? 'Android Device Account' : 'Web / Desktop Account';
    if (likesEl) likesEl.textContent = likedSongs.length;
    if (playEl) {
      const pl = JSON.parse(localStorage.getItem('simpmusic_playlists') || '[]');
      playEl.textContent = pl.length;
    }
    if (queueEl) queueEl.textContent = player.queue ? player.queue.length : 0;

    if (mobileStatLikes) mobileStatLikes.textContent = likedSongs.length;
    if (mobileStatRecents) mobileStatRecents.textContent = (typeof recentSongs !== 'undefined' ? recentSongs.length : 0);
    if (mobileStatPlaylists) mobileStatPlaylists.textContent = JSON.parse(localStorage.getItem('simpmusic_playlists') || '[]').length;
  }

  // Export Account Memory
  function exportAccountData() {
    const playlists = JSON.parse(localStorage.getItem('simpmusic_playlists') || '[]');
    return {
      version: '1.0',
      exportedAt: new Date().toISOString(),
      sourceDevice: {
        id: deviceId,
        name: deviceName
      },
      likes: likedSongs,
      playlists: playlists,
      settings: {
        apiHost: localStorage.getItem('simpmusic_api_host') || '',
        cloudMode: localStorage.getItem('simpmusic_cloud_mode') === 'true'
      }
    };
  }

  // Download Backup JSON file (v3.11: full payload via SimpMusicBackup)
  const exportFileBtn = document.getElementById('exportFileBtn');
  if (exportFileBtn) {
    exportFileBtn.addEventListener('click', () => {
      if (window.SimpMusicBackup) { window.SimpMusicBackup.export(); return; }
      const data = exportAccountData();
      const jsonStr = JSON.stringify(data, null, 2);
      const blob = new Blob([jsonStr], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      const dateStr = new Date().toISOString().split('T')[0];
      a.href = url;
      a.download = `simpmusic-account-${dateStr}.json`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      showToast('Account memory downloaded as .json file!');
    });
  }

  // Copy Shareable Sync Code
  const copySyncCodeBtn = document.getElementById('copySyncCodeBtn');
  if (copySyncCodeBtn) {
    copySyncCodeBtn.addEventListener('click', () => {
      const data = exportAccountData();
      try {
        const jsonStr = JSON.stringify(data);
        const code = btoa(unescape(encodeURIComponent(jsonStr)));
        navigator.clipboard.writeText(code).then(() => {
          showToast('Sync Code copied! Paste it on your other device.');
        }).catch(() => {
          prompt('Copy your Sync Code below:', code);
        });
      } catch (err) {
        showToast('Error generating Sync Code.');
      }
    });
  }

  // Choose file button
  const importFileInput = document.getElementById('importFileInput');
  const chooseFileBtn = document.getElementById('chooseFileBtn');
  const selectedFileName = document.getElementById('selectedFileName');
  let selectedImportData = null;

  if (chooseFileBtn && importFileInput) {
    chooseFileBtn.addEventListener('click', () => importFileInput.click());
    importFileInput.addEventListener('change', (e) => {
      const file = e.target.files[0];
      if (file) {
        selectedFileName.textContent = file.name;
        const reader = new FileReader();
        reader.onload = (evt) => {
          try {
            selectedImportData = JSON.parse(evt.target.result);
            showToast(`Loaded backup with ${selectedImportData.likes?.length || 0} songs`);
          } catch (err) {
            alert('Invalid backup JSON file.');
            selectedImportData = null;
          }
        };
        reader.readAsText(file);
      }
    });
  }

  // Apply Import & Synchronize
  const applyImportBtn = document.getElementById('applyImportBtn');
  const syncCodeTextarea = document.getElementById('syncCodeTextarea');

  if (applyImportBtn) {
    applyImportBtn.addEventListener('click', () => {
      let dataToImport = selectedImportData;
      const syncCode = syncCodeTextarea ? syncCodeTextarea.value.trim() : '';

      if (!dataToImport && syncCode) {
        try {
          const decodedStr = decodeURIComponent(escape(atob(syncCode)));
          dataToImport = JSON.parse(decodedStr);
        } catch (e) {
          try {
            dataToImport = JSON.parse(syncCode);
          } catch (e2) {
            alert('Invalid Sync Code or JSON format. Please verify the code.');
            return;
          }
        }
      }

      if (!dataToImport) {
        alert('No valid account data to import. Please select a backup file or paste a Sync Code.');
        return;
      }

      // v3.11 full backup format → restore through the backup engine.
      if (dataToImport.app === 'string-music') {
        if (!window.SimpMusicBackup) { alert('Backup engine not loaded'); return; }
        const mode2 = document.querySelector('input[name="importMode"]:checked')?.value || 'merge';
        try {
          const counts = window.SimpMusicBackup.restore(dataToImport, mode2 === 'replace' ? 'replace' : 'merge');
          showToast(`Restored ${counts.likes || 0} likes, ${counts.playlists || 0} playlists — reloading…`);
          setTimeout(() => window.location.reload(), 1200);
        } catch (e) {
          alert('Restore failed: ' + (e && e.message || 'error'));
        }
        return;
      }

      if (!Array.isArray(dataToImport.likes)) {
        alert('No valid account data to import. Please select a backup file or paste a Sync Code.');
        return;
      }

      const mode = document.querySelector('input[name="importMode"]:checked')?.value || 'merge';
      let finalLikes = [];

      if (mode === 'merge') {
        const existingMap = new Map();
        likedSongs.forEach(s => existingMap.set(s.videoId, s));
        dataToImport.likes.forEach(s => {
          if (!existingMap.has(s.videoId)) {
            existingMap.set(s.videoId, s);
          }
        });
        finalLikes = Array.from(existingMap.values());
      } else {
        finalLikes = [...dataToImport.likes];
      }

      likedSongs = finalLikes;
      localStorage.setItem('simpmusic_likes', JSON.stringify(likedSongs));

      if (dataToImport.playlists && Array.isArray(dataToImport.playlists)) {
        localStorage.setItem('simpmusic_playlists', JSON.stringify(dataToImport.playlists));
      }

      updateDeviceProfileUI();
      showToast(`Account sync complete! (${finalLikes.length} total liked songs)`);
      if (syncCodeTextarea) syncCodeTextarea.value = '';
      if (selectedFileName) selectedFileName.textContent = 'No file chosen';
      selectedImportData = null;
    });
  }

  // Danger Zone: Reset Account Data
  const resetAccountBtn = document.getElementById('resetAccountBtn');
  if (resetAccountBtn) {
    resetAccountBtn.addEventListener('click', () => {
      if (confirm('Are you sure you want to wipe this device\'s account data? This will clear all liked songs on this device.')) {
        likedSongs = [];
        localStorage.removeItem('simpmusic_likes');
        localStorage.removeItem('simpmusic_playlists');
        deviceId = 'SIMP-' + Math.random().toString(36).substring(2, 6).toUpperCase();
        localStorage.setItem('simpmusic_device_id', deviceId);
        updateDeviceProfileUI();
        showToast('Device memory wiped. New clean account generated.');
      }
    });
  }

  // Player Events Integration
  player.on('play', (track) => {
    playPauseBtn.innerHTML = `
      <svg width="22" height="22" viewBox="0 0 24 24" fill="currentColor">
        <rect x="6" y="4" width="4" height="16"></rect>
        <rect x="14" y="4" width="4" height="16"></rect>
      </svg>
    `;
    dockThumb.classList.add('spin');
    vinylDisc.classList.remove('paused');

    if (mobileMiniPlayBtn) {
      mobileMiniPlayBtn.innerHTML = `<svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="4" width="4" height="16"/><rect x="14" y="4" width="4" height="16"/></svg>`;
    }
    if (wheelPlayBtn) {
      wheelPlayBtn.innerHTML = `<svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="4" width="4" height="16"/><rect x="14" y="4" width="4" height="16"/></svg>`;
    }

    if (track) {
      dockThumb.src = track.thumbnail;
      dockTitle.textContent = track.title;
      dockArtist.textContent = track.artist;
      vinylCover.src = track.thumbnail;
      vinylTitle.textContent = track.title;
      vinylArtist.textContent = track.artist;

      if (mobileMiniThumb) mobileMiniThumb.src = track.thumbnail;
      if (mobileMiniTitle) mobileMiniTitle.textContent = track.title;
      if (mobileMiniArtist) {
        mobileMiniArtist.textContent = track.artist;
        if (track.artist) mobileMiniArtist.setAttribute('data-artist-open', track.artist);
        else mobileMiniArtist.removeAttribute('data-artist-open');
      }

      updateHeroDetails(track);
      updateActivePlayingRow(track.videoId);
      updateDockLikeState();
      lyrics.loadLyrics(track);
      if (typeof recordRecentSong === 'function') {
        recordRecentSong(track);
      }
      if (mobileMiniDock) mobileMiniDock.style.display = 'flex';
    }
  });

  player.on('pause', () => {
    playPauseBtn.innerHTML = `
      <svg width="22" height="22" viewBox="0 0 24 24" fill="currentColor">
        <path d="M8 5v14l11-7z"/>
      </svg>
    `;
    if (mobileMiniPlayBtn) {
      mobileMiniPlayBtn.innerHTML = `<svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z"/></svg>`;
    }
    if (wheelPlayBtn) {
      wheelPlayBtn.innerHTML = `<svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z"/></svg>`;
    }
    dockThumb.classList.remove('spin');
    vinylDisc.classList.add('paused');
  });

  // --- Native playback (Android/ExoPlayer) ---
  // Transport controls (lock screen, notification, headset) are handled
  // directly by the native MediaSession/ExoPlayer — no JS roundtrip. The
  // WebView only mirrors state via "playbackkeeper-*" events, which
  // player.js listens for and re-emits as normal player events below.

  player.on('timeupdate', ({ currentTime, duration }) => {
    // While the user is dragging a scrubber, the bar shows the drag
    // position — incoming progress must not snap it back (v3.7 fix).
    if (isSeeking || ipodSeeking) return;
    currentTimeLabel.textContent = formatTime(currentTime);
    totalDurationLabel.textContent = formatTime(duration);

    if (duration > 0) {
      const pct = (currentTime / duration) * 100;
      progressFill.style.width = `${pct}%`;
      progressThumb.style.left = `${pct}%`;

      if (ipodCurrentTime) ipodCurrentTime.textContent = formatTime(currentTime);
      if (ipodRemainingTime) {
        const remaining = Math.max(0, duration - currentTime);
        ipodRemainingTime.textContent = `-${formatTime(remaining)}`;
      }
      if (ipodProgressFill) ipodProgressFill.style.width = `${pct}%`;
      if (ipodProgressThumb) ipodProgressThumb.style.left = `${pct}%`;
    }
  });

  player.on('queueupdate', ({ queue, currentIndex }) => {
    renderQueue(queue, currentIndex);
  });

  // Queue Drawer Rendering
  function renderQueue(queue, currentIndex) {
    queueList.innerHTML = '';
    if (!queue || queue.length === 0) {
      queueList.innerHTML = `<p style="text-align: center; color: var(--text-muted); padding: 30px;">Queue is empty.</p>`;
      return;
    }

    queue.forEach((track, index) => {
      const item = document.createElement('div');
      item.className = `queue-item ${index === currentIndex ? 'active' : ''}`;
      item.innerHTML = `
        <img class="queue-thumb" src="${track.thumbnail}" alt="" />
        <div class="queue-details">
          <div class="queue-track-title">${track.title}</div>
          <div class="queue-track-artist" data-artist-open="${escapeHtml(track.artist || '')}">${track.artist}</div>
        </div>
        <button class="queue-remove-btn" title="Remove">✕</button>
      `;

      item.addEventListener('click', (e) => {
        if (!e.target.classList.contains('queue-remove-btn')) {
          player.playTrack(track);
        }
      });

      item.querySelector('.queue-remove-btn').addEventListener('click', (e) => {
        e.stopPropagation();
        player.removeFromQueue(index);
      });

      queueList.appendChild(item);
    });
  }

  // Scrubber seeking — v3.7: FREE DRAGGING via pointer events. The bar
  // follows the finger live (both dock + iPod rails), progress updates are
  // suppressed while dragging, and ONE seek fires on release. Touch + mouse.
  let isSeeking = false;
  let ipodSeeking = false;

  function railPos(e, rail) {
    const rect = rail.getBoundingClientRect();
    return Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
  }
  function paintDockBar(pos, target) {
    progressFill.style.width = `${pos * 100}%`;
    progressThumb.style.left = `${pos * 100}%`;
    currentTimeLabel.textContent = formatTime(target);
  }

  progressRail.addEventListener('pointerdown', (e) => {
    if (!player.duration || player.duration <= 0) return;
    isSeeking = true;
    paintDockBar(railPos(e, progressRail), railPos(e, progressRail) * player.duration);
    e.preventDefault();
  });
  window.addEventListener('pointermove', (e) => {
    if (!isSeeking) return;
    paintDockBar(railPos(e, progressRail), railPos(e, progressRail) * player.duration);
  });
  window.addEventListener('pointerup', (e) => {
    if (!isSeeking) return;
    isSeeking = false;
    player.seekTo(railPos(e, progressRail) * player.duration);
  });
  progressRail.addEventListener('click', (e) => {
    if (player.duration > 0) player.seekTo(railPos(e, progressRail) * player.duration);
  });

  // Dock Buttons
  playPauseBtn.addEventListener('click', () => player.togglePlay());
  prevBtn.addEventListener('click', () => player.previous());
  nextBtn.addEventListener('click', () => player.next());
  dockLikeBtn.addEventListener('click', () => toggleLike(player.currentTrack));

  shuffleBtn.addEventListener('click', () => {
    const isShuffle = player.toggleShuffle();
    shuffleBtn.classList.toggle('active', isShuffle);
    showToast(isShuffle ? 'Shuffle turned ON' : 'Shuffle turned OFF');
  });

  repeatBtn.addEventListener('click', () => {
    const mode = player.toggleRepeat();
    repeatBtn.classList.toggle('active', mode !== 'off');
    repeatBtn.title = `Repeat: ${mode.toUpperCase()}`;
    showToast(`Repeat: ${mode.toUpperCase()}`);
  });

  // Volume
  volumeSlider.addEventListener('input', (e) => {
    player.setVolume(e.target.value);
  });

  let prevVol = 80;
  volumeBtn.addEventListener('click', () => {
    if (player.volume > 0) {
      prevVol = player.volume;
      player.setVolume(0);
      volumeSlider.value = 0;
    } else {
      player.setVolume(prevVol);
      volumeSlider.value = prevVol;
    }
  });

  // Lyrics Overlay Toggle
  lyricsToggleBtn.addEventListener('click', () => {
    lyricsOverlay.classList.toggle('active');
  });
  closeLyricsBtn.addEventListener('click', () => {
    lyricsOverlay.classList.remove('active');
  });

  // Queue Drawer Toggle
  queueToggleBtn.addEventListener('click', () => {
    queueDrawer.classList.toggle('open');
  });
  closeQueueBtn.addEventListener('click', () => {
    queueDrawer.classList.remove('open');
  });
  clearQueueBtn.addEventListener('click', () => {
    player.clearQueue();
  });

  // Toast Notification
  // Toast Notification — v3.6: instant entry animation (feels snappier),
  // stacked (not overlapping), capped at 3 so the screen never clutters.
  function showToast(msg) {
    document.querySelectorAll('.app-toast').forEach(t => { t.dataset.expiring = '1'; });
    const toast = document.createElement('div');
    toast.className = 'app-toast';
    toast.style.cssText = `
      position: fixed;
      bottom: calc(110px + ${document.querySelectorAll('.app-toast').length * 46}px);
      left: 50%;
      transform: translateX(-50%) translateY(8px) scale(0.96);
      background: rgba(28, 27, 44, 0.95);
      backdrop-filter: blur(16px);
      border: 1px solid var(--border-glass);
      color: white;
      padding: 10px 24px;
      border-radius: var(--radius-full);
      font-size: 0.875rem;
      font-weight: 600;
      z-index: 9999;
      box-shadow: var(--shadow-glass);
      opacity: 0;
      transition: opacity 0.15s ease, transform 0.15s cubic-bezier(0.2, 0.9, 0.3, 1.2);
      max-width: 82vw;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
      pointer-events: none;
    `;
    toast.textContent = msg;
    document.body.appendChild(toast);
    requestAnimationFrame(() => {
      toast.style.opacity = '1';
      toast.style.transform = 'translateX(-50%) translateY(0) scale(1)';
    });
    setTimeout(() => {
      toast.style.opacity = '0';
      toast.style.transform = 'translateX(-50%) translateY(6px) scale(0.97)';
      setTimeout(() => toast.remove(), 180);
    }, 2200);
  }

  // Keyboard Shortcuts
  document.addEventListener('keydown', (e) => {
    if (['INPUT', 'TEXTAREA'].includes(document.activeElement.tagName)) return;

    if (e.code === 'Space') {
      e.preventDefault();
      player.togglePlay();
    } else if (e.code === 'ArrowLeft') {
      e.preventDefault();
      player.seekTo(Math.max(0, player.currentTime - 5));
    } else if (e.code === 'ArrowRight') {
      e.preventDefault();
      player.seekTo(Math.min(player.duration, player.currentTime + 5));
    } else if (e.key === 'l' || e.key === 'L') {
      lyricsOverlay.classList.toggle('active');
    } else if (e.key === 'q' || e.key === 'Q') {
      queueDrawer.classList.toggle('open');
    } else if (e.key === 'm' || e.key === 'M') {
      volumeBtn.click();
    }
  });

  // ===================================================================
  // iPod Classic Click Wheel Player: Only appears when clicking on playing song profile pic
  // ===================================================================
  function openIpodPlayer() {
    if (!ipodPlayerModal) return;
    ipodPlayerModal.classList.add('open');
    ipodPlayerModal.style.display = 'flex';
    syncIpodWithPlayer();
  }

  // Bring the iPod screen in line with the REAL player state (metadata,
  // progress bar, times). Without this the modal shows stale numbers from
  // whatever rendered last.
  function syncIpodWithPlayer() {
    const cur = player.currentTrack;
    if (!cur) {
      // v3.13: nothing playing YET — show the last-listened song (the same
      // one the hero/mini dock already paint at startup) instead of the
      // misleading idle screen. True idle only for a brand-new user.
      const last = lastListenedTrack();
      if (last) {
        updateHeroDetails(last);
      } else {
        if (ipodTitle) ipodTitle.textContent = 'No song playing';
        if (ipodArtist) ipodArtist.textContent = 'Play something to begin';
        if (ipodAlbumTag) ipodAlbumTag.textContent = 'SIMPMUSIC';
        if (ipodCoverImg) ipodCoverImg.src = 'icons/sweetener_cover.png';
      }
      if (ipodCurrentTime) ipodCurrentTime.textContent = '0:00';
      if (ipodRemainingTime) ipodRemainingTime.textContent = '-0:00';
      if (ipodProgressFill) ipodProgressFill.style.width = '0%';
      if (ipodProgressThumb) ipodProgressThumb.style.left = '0%';
    } else {
      updateHeroDetails(cur);
      const dur = player.duration || cur.durationSec || 0;
      const pos = player.currentTime || 0;
      if (dur > 0) {
        const pct = Math.min(100, (pos / dur) * 100);
        if (ipodCurrentTime) ipodCurrentTime.textContent = formatTime(pos);
        if (ipodRemainingTime) ipodRemainingTime.textContent = `-${formatTime(Math.max(0, dur - pos))}`;
        if (ipodProgressFill) ipodProgressFill.style.width = `${pct}%`;
        if (ipodProgressThumb) ipodProgressThumb.style.left = `${pct}%`;
      }
    }
  }

  function closeIpodPlayer() {
    if (!ipodPlayerModal) return;
    ipodPlayerModal.classList.remove('open');
    ipodPlayerModal.style.display = 'none';
  }

  // --- iPod lyrics: tap the album art to toggle scrolling lyrics over it ---
  const ipodLyricsOverlay = document.getElementById('ipodLyricsOverlay');
  let ipodLyrics = null;
  function ensureIpodLyrics() {
    if (ipodLyrics) return ipodLyrics;
    if (typeof LyricsController === 'function') {
      ipodLyrics = new LyricsController(player);
      ipodLyrics.container = document.getElementById('ipodLyricsStream');
    }
    return ipodLyrics;
  }
  function refreshIpodLyrics() {
    const ctl = ensureIpodLyrics();
    if (ctl && player.currentTrack) ctl.loadLyrics(player.currentTrack);
  }
  if (ipodCoverImg && ipodLyricsOverlay) {
    ipodCoverImg.addEventListener('click', (e) => {
      e.stopPropagation();
      const opening = ipodLyricsOverlay.style.display === 'none';
      ipodLyricsOverlay.style.display = opening ? 'flex' : 'none';
      if (opening) refreshIpodLyrics();
    });
  }
  player.on('play', () => {
    if (ipodLyricsOverlay && ipodLyricsOverlay.style.display !== 'none') refreshIpodLyrics();
  });

  // ---------------- Downloads (native: Music/SimpMusic via MediaStore) ---
  function startDownload(track) {
    if (!track || !track.videoId) return;
    const native = window.Capacitor && window.Capacitor.isPluginAvailable && window.Capacitor.isPluginAvailable('SimpMusicDownload');
    if (!native) {
      showToast('Downloads need the Android app');
      return;
    }
    startDownload._busy = startDownload._busy || {};
    if (startDownload._busy[track.videoId]) {
      showToast(`Already downloading "${track.title}"`);
      return;
    }
    startDownload._busy[track.videoId] = true;
    // v3.5.3: remember filename → videoId so the offline row can play the
    // song later (MediaStore wipes the COMPOSER field on rescan).
    try {
      const map = JSON.parse(localStorage.getItem('simpmusic_dl_ids') || '{}');
      map[`${track.artist || 'Unknown'} - ${track.title || 'String Music'}`] = track.videoId;
      localStorage.setItem('simpmusic_dl_ids', JSON.stringify(map));
    } catch (e) {}
    // v3.5.2: register BEFORE the call so the offline section immediately
    // shows a 0% progress card ("loading" state).
    startDownload._active = startDownload._active || {};
    startDownload._active[track.videoId] = {
      title: track.title || 'String Music',
      artist: track.artist || '',
      percent: 0,
      startedAt: Date.now()
    };
    renderLibraryDownloads();
    try {
      const cap = window.Capacitor.Plugins.SimpMusicDownload;
      if (cap.addListener && !startDownload._listeners) {
        startDownload._listeners = true;
        // Throttled progress toasts — the user sees the download moving.
        let lastToastAt = 0, lastShownPct = -1;
        cap.addListener('progress', (p) => {
          if (!p || p.percent == null) return;
          const now = Date.now();
          if (p.percent >= 100) {
            delete startDownload._active[p.videoId];
            delete startDownload._busy[p.videoId];
            showToast('✓ Saved to Music/SimpMusic');
            renderLibraryDownloads();
          } else {
            if (startDownload._active[p.videoId]) {
              startDownload._active[p.videoId].percent = p.percent;
            }
            renderLibraryDownloads();
            // v3.19.2: feed the playlist-download HUD
            if (window.__plDlProgress && p.videoId === window.__plDlProgress.currentId) {
              updatePlaylistDlProgress(p.percent, null);
            }
            if (now - lastToastAt > 5000 && p.percent - lastShownPct >= 25) {
              lastToastAt = now; lastShownPct = p.percent;
              showToast(`Downloading… ${p.percent}%`);
            }
          }
        });
        cap.addListener('error', (e) => {
          const id = e && e.videoId;
          if (id) {
            delete startDownload._active[id];
            delete startDownload._busy[id];
            renderLibraryDownloads();
          }
          showToast(`Download failed: ${(e && e.message) || 'error'}`);
        });
      }
      showToast(`Downloading "${track.title}"… (stay online)`);
      // Prefer the selected audio quality so downloads match playback bitrate.
      const pref = (window.player && player.audioQuality) || 'standard';
      cap.audio({
        videoId: track.videoId,
        title: track.title || 'String Music',
        artist: track.artist || 'Unknown Artist',
        preferHighBitrate: pref === 'high'
      }).then((r) => {
        delete startDownload._busy[track.videoId];
        delete startDownload._active[track.videoId];
        if (r && r.existing) {
          showToast(`Already downloaded: "${track.title}"`);
        } else {
          showToast('✓ Saved to Music/SimpMusic');
        }
        renderLibraryDownloads();
      }).catch((e) => {
        delete startDownload._busy[track.videoId];
        delete startDownload._active[track.videoId];
        console.warn('Download failed:', e);
        showToast(`Download failed: ${(e && e.message) || 'try again'}`);
        renderLibraryDownloads();
      });
    } catch (e) {
      delete startDownload._busy[track.videoId];
      delete startDownload._active[track.videoId];
      showToast('Download failed');
    }
  }
  window.SimpMusicDownloads = { download: startDownload, refresh: renderLibraryDownloads };

  // ---------------- v3.18.5: Playlist download with size preview ----------------
  // Estimate storage from durations × the selected audio quality bitrate and
  // ALWAYS ask before downloading a whole playlist.

  const DL_BITRATE_KBPS = { low: 64, standard: 128, high: 256 };

  function estimatePlaylistSize(tracks) {
    const quality = (window.player && player.audioQuality)
      || localStorage.getItem('simpmusic_audio_quality') || 'standard';
    const kbps = DL_BITRATE_KBPS[quality] || 128;
    let savedIds = new Set();
    try {
      const map = JSON.parse(localStorage.getItem('simpmusic_dl_ids') || '{}');
      savedIds = new Set(Object.values(map));
    } catch (e) {}
    const seen = new Set();
    let bytes = 0, songs = 0, alreadySaved = 0;
    (tracks || []).forEach(t => {
      if (!t || !t.videoId || seen.has(t.videoId)) return;
      seen.add(t.videoId);
      songs++;
      if (savedIds.has(t.videoId)) alreadySaved++;
      let sec = Number(t.durationSec) || 0;
      if (!sec && t.duration) {
        const m = /^(\d+):(\d{1,2})$/.exec(String(t.duration));
        if (m) sec = (+m[1]) * 60 + (+m[2]);
      }
      if (!sec) sec = 210; // sensible default ≈ 3:30
      bytes += sec * kbps * 1000 / 8;
    });
    let sizeText;
    if (bytes >= 1024 * 1024 * 1024) sizeText = (bytes / (1024 * 1024 * 1024)).toFixed(1) + ' GB';
    else if (bytes >= 1024 * 1024) sizeText = Math.max(1, Math.round(bytes / (1024 * 1024))) + ' MB';
    else sizeText = Math.max(1, Math.round(bytes / 1024)) + ' KB';
    return { songs, bytes, sizeText, alreadySaved, kbps, quality };
  }

  function confirmPlaylistDownload(tracks, sourceName) {
    return new Promise((resolve) => {
      if (document.getElementById('plDlConfirmOverlay')) { resolve(false); return; }
      const est = estimatePlaylistSize(tracks);
      if (!est.songs) { resolve(false); return; }
      const wrap = document.createElement('div');
      wrap.innerHTML = '<div class="cat-overlay pl-overlay" id="plDlConfirmOverlay">'
        + '<div class="pl-dialog">'
        + '<div class="pl-dialog-title">Download playlist</div>'
        + '<div style="color:#d4d4d8; font-size:0.85rem; margin-bottom:8px;">“' + escapeHtml(sourceName || 'Playlist') + '” — ' + est.songs + ' song' + (est.songs === 1 ? '' : 's') + '</div>'
        + '<div style="font-size:1.6rem; font-weight:800; color:#fff; margin-bottom:2px;">≈ ' + est.sizeText + '</div>'
        + '<div style="color:#71717a; font-size:0.72rem; line-height:1.5; margin-bottom:14px;">of storage needed · estimated at '
        + escapeHtml(est.quality) + ' quality (' + est.kbps + ' kbps)'
        + (est.alreadySaved ? '<br>' + est.alreadySaved + ' song' + (est.alreadySaved === 1 ? '' : 's') + ' already saved — they will be skipped' : '')
        + '</div>'
        + '<div class="pl-dialog-actions">'
        + '<button class="pl-btn pl-btn-ghost" id="plDlCancelBtn">Cancel</button>'
        + '<button class="pl-btn pl-btn-primary" id="plDlGoBtn">⬇ Download</button>'
        + '</div></div></div>';
      document.body.appendChild(wrap.firstChild);
      const overlay = document.getElementById('plDlConfirmOverlay');
      requestAnimationFrame(() => overlay.classList.add('active'));
      const close = (ok) => {
        overlay.classList.remove('active');
        setTimeout(() => overlay.remove(), 200);
        resolve(ok);
      };
      document.getElementById('plDlCancelBtn').addEventListener('click', () => close(false));
      overlay.addEventListener('click', (e) => { if (e.target === overlay) close(false); });
      document.getElementById('plDlGoBtn').addEventListener('click', () => close(true));
    });
  }

  // v3.19.2: floating playlist-download progress HUD — big bar, current
  // song, song counter, live percent, and a Cancel button that aborts
  // cleanly between songs (the native plugin has no mid-file cancel).
  function showPlaylistDlProgress(info) {
    let hud = document.getElementById('plDlProgressHud');
    if (!hud) {
      hud = document.createElement('div');
      hud.id = 'plDlProgressHud';
      hud.className = 'pl-dl-hud';
      hud.innerHTML = '<div class="pl-dl-hud-top">'
        + '<div class="pl-dl-hud-info">'
        + '<div class="pl-dl-hud-title">Downloading playlist…</div>'
        + '<div class="pl-dl-hud-song">Preparing…</div>'
        + '</div>'
        + '<button class="pl-dl-hud-cancel" id="plDlCancelHudBtn">Cancel</button>'
        + '</div>'
        + '<div class="pl-dl-hud-bar"><div class="pl-dl-hud-fill" id="plDlHudFill"></div></div>'
        + '<div class="pl-dl-hud-meta"><span id="plDlHudCount"></span><span id="plDlHudPct">0%</span></div>'
        + '</div>';
      document.body.appendChild(hud);
      requestAnimationFrame(() => hud.classList.add('show'));
      document.getElementById('plDlCancelHudBtn').addEventListener('click', () => {
        if (window.__plDlProgress) window.__plDlProgress.cancelled = true;
        const btn = document.getElementById('plDlCancelHudBtn');
        if (btn) { btn.disabled = true; btn.textContent = 'Cancelling…'; }
      });
    } else {
      hud.style.display = 'flex';
      requestAnimationFrame(() => hud.classList.add('show'));
      const btn = document.getElementById('plDlCancelHudBtn');
      if (btn) { btn.disabled = false; btn.textContent = 'Cancel'; }
    }
    const songEl = hud.querySelector('.pl-dl-hud-song');
    if (songEl && info) songEl.textContent = info.title;
    const countEl = document.getElementById('plDlHudCount');
    if (countEl && info) countEl.textContent = `Song ${info.songIndex} of ${info.total}`;
    const fill = document.getElementById('plDlHudFill');
    const pct = document.getElementById('plDlHudPct');
    if (fill) fill.style.width = '0%';
    if (pct) pct.textContent = '0%';
  }

  function updatePlaylistDlProgress(percent, songIndex) {
    const hud = document.getElementById('plDlProgressHud');
    if (!hud) return;
    const fill = document.getElementById('plDlHudFill');
    const pct = document.getElementById('plDlHudPct');
    const count = document.getElementById('plDlHudCount');
    if (percent != null && fill && pct) {
      fill.style.width = Math.max(4, Math.round(percent)) + '%';
      pct.textContent = Math.round(percent) + '%';
    }
    if (songIndex != null && count && window.__plDlProgress) {
      count.textContent = `Song ${songIndex} of ${window.__plDlProgress.total}`;
    }
  }

  function hidePlaylistDlProgress() {
    const hud = document.getElementById('plDlProgressHud');
    if (!hud) return;
    hud.classList.remove('show');
    setTimeout(() => { if (hud.parentNode) hud.parentNode.removeChild(hud); }, 300);
  }

  function downloadPlaylistTracks(tracks, btn) {
    const cap = window.Capacitor && window.Capacitor.Plugins && window.Capacitor.Plugins.SimpMusicDownload;
    if (!cap) {
      showToast('Downloads need the Android app');
      return;
    }
    const seen = new Set();
    const queue = (tracks || []).filter(t => t && t.videoId && !seen.has(t.videoId) && seen.add(t.videoId));
    if (!queue.length) { showToast('Nothing to download'); return; }
    // Remember filename → videoId so the offline rows stay playable
    // (same map the single-song download writes).
    try {
      const map = JSON.parse(localStorage.getItem('simpmusic_dl_ids') || '{}');
      queue.forEach(t => { map[`${t.artist || 'Unknown'} - ${t.title || 'String Music'}`] = t.videoId; });
      localStorage.setItem('simpmusic_dl_ids', JSON.stringify(map));
    } catch (e) {}
    const pref = (window.player && player.audioQuality) || 'standard';
    const total = queue.length;
    let done = 0, failed = 0, existed = 0, currentIdx = 0;
    if (btn) { btn.disabled = true; btn.textContent = `⬇ 0/${total}…`; }

    // v3.19.2: per-song runner — resolves 'done' | 'existing' | 'failed'
    function downloadOne(t) {
      return new Promise((resolve) => {
        window.__plDlProgress.currentId = t.videoId;
        cap.audio({
          videoId: t.videoId,
          title: t.title || 'String Music',
          artist: t.artist || 'Unknown Artist',
          preferHighBitrate: pref === 'high'
        }).then(r => resolve(r && r.existing ? 'existing' : 'done'))
          .catch(() => resolve('failed'));
      });
    }

    window.__plDlProgress = { cancelled: false, currentId: null, total };
    showToast(`Downloading ${total} song${total === 1 ? '' : 's'}… (stay online)`);

    (async () => {
      try {
        while (currentIdx < queue.length) {
          const st = window.__plDlProgress;
          if (!st || st.cancelled) break;
          const t = queue[currentIdx];
          showPlaylistDlProgress({ title: t.title || 'String Music', songIndex: currentIdx + 1, total });
          const res = await downloadOne(t);
          if (res === 'done') done++;
          else if (res === 'existing') existed++;
          else failed++;
          currentIdx++;
          updatePlaylistDlProgress(null, currentIdx);
          if (btn) btn.textContent = `⬇ ${currentIdx}/${total}…`;
        }
      } finally {
        // v3.19.3: ALWAYS hide the HUD + restore the button, even if the
        // state object vanished mid-run (prevents a stuck progress card).
        const cancelled = !!(window.__plDlProgress && window.__plDlProgress.cancelled);
        window.__plDlProgress = null;
        hidePlaylistDlProgress();
        if (btn) { btn.disabled = false; btn.textContent = '⬇ Download'; }
        renderLibraryDownloads();
        if (cancelled) {
          showToast(`Download cancelled — ${done} song${done === 1 ? '' : 's'} saved`);
        } else if (failed === total && total > 0) {
          showToast('Download failed — check your connection');
        } else {
          const parts = [];
          if (done) parts.push(`${done} saved`);
          if (existed) parts.push(`${existed} already saved`);
          if (failed) parts.push(`${failed} failed`);
          showToast('✓ ' + (parts.join(', ') || 'Playlist saved'));
        }
      }
    })();
  }

  window.SimpMusicDownloads.downloadPlaylist = downloadPlaylistTracks;
  window.SimpMusicDownloads.confirmPlaylist = confirmPlaylistDownload;
  window.SimpMusicDownloads.estimate = estimatePlaylistSize;

  // ---------------- Library: Downloads section ----------------
  // v3.5.2: shows (a) live progress cards for active downloads and (b) the
  // finished files, which PLAY IN-APP on tap (videoId stashed in MediaStore).
  let _downloadsCache = [];
  /** filename / "artist - title" → videoId, saved at download time. */
  function dlIdMap() {
    try { return JSON.parse(localStorage.getItem('simpmusic_dl_ids') || '{}'); }
    catch (e) { return {}; }
  }
  function renderLibraryDownloads() {
    const wrap = document.getElementById('mobileDownloadsWrap');
    const grid = document.getElementById('mobileDownloadsList');
    if (!wrap || !grid) return;
    const native = window.Capacitor && window.Capacitor.isPluginAvailable && window.Capacitor.isPluginAvailable('SimpMusicDownload');
    if (!native) { wrap.style.display = 'none'; return; }
    const active = startDownload._active || {};
    const activeIds = Object.keys(active);

    function buildProgressCard(id, d) {
      const div = document.createElement('div');
      div.className = 'mobile-v2-release-item dl-progress-item';
      div.innerHTML = '<div class="mobile-v2-release-thumb dl-thumb dl-spin">⬇</div>'
        + '<div class="mobile-v2-release-info">'
        + '<div class="mobile-v2-release-title dl-title"></div>'
        + '<div class="mobile-v2-release-artist dl-artist"></div>'
        + '<div class="dl-bar"><div class="dl-bar-fill" style="width:' + Math.max(4, d.percent) + '%"></div></div>'
        + '</div>'
        + '<div class="dl-pct">' + d.percent + '%</div>';
      div.querySelector('.dl-title').textContent = d.title;
      div.querySelector('.dl-artist').textContent = 'Downloading…';
      return div;
    }

    function buildFileRow(f) {
      const div = document.createElement('div');
      div.className = 'mobile-v2-release-item dl-file album-item dl-file-item';
      const sizeMb = f.size ? (f.size / 1048576).toFixed(1) + ' MB' : '';
      div.innerHTML = '<div class="mobile-v2-release-thumb dl-thumb dl-play-badge"></div>'
        + '<div class="mobile-v2-release-info">'
        + '<div class="mobile-v2-release-title dl-title"></div>'
        + '<div class="mobile-v2-release-artist dl-artist"></div>'
        + (sizeMb ? '<div class="dl-size">' + sizeMb + '</div>' : '')
        + '</div>'
        + '<button class="dl-remove-btn" title="Delete from device">✕</button>';
      div.querySelector('.dl-title').textContent = f.title || f.relativePath || 'Download';
      div.querySelector('.dl-artist').textContent = f.artist || '';

      // v3.19.13: show the song's real cover art instead of a plain ▶ tile.
      // Every download made since v3.5.2 has its videoId in simpmusic_dl_ids
      // (keyed by filename or "artist - title"), so the YouTube thumbnail is
      // one lookup away; the ▶ badge stays as a small corner overlay. Rows
      // without any resolvable id keep the plain tile.
      const dlVid = f.videoId || dlIdMap()[f.fileName || ''] || dlIdMap()[`${f.artist || 'Unknown'} - ${f.title || ''}`] || '';
      if (dlVid) {
        const thumbEl = div.querySelector('.dl-thumb');
        const img = new Image();
        img.className = 'dl-art';
        img.alt = '';
        img.loading = 'lazy';
        img.decoding = 'async';
        img.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;object-fit:cover;border-radius:inherit;background:#27272a;';
        img.onerror = () => { img.remove(); }; // network hiccup → keep the ▶ tile
        img.src = 'https://i.ytimg.com/vi/' + dlVid + '/hqdefault.jpg';
        thumbEl.appendChild(img);
        thumbEl.style.position = 'relative';
        const playTag = document.createElement('span');
        playTag.className = 'dl-play-tag';
        playTag.textContent = '▶';
        playTag.style.cssText = 'position:absolute;right:4px;bottom:3px;font-size:0.62rem;line-height:1;background:rgba(0,0,0,0.55);color:#fff;border-radius:4px;padding:2px 4px;';
        thumbEl.appendChild(playTag);
      }

      // Tap row (or ▶ badge) → play in-app. videoId resolution order:
      // stored id → filename/id map → title match → native search (legacy).
      async function playIt() {
        let track = null;
        // Every local source of track objects (catalog, history, likes, playlists).
        function localPool() {
          let pool = [];
          try {
            if (window.getClientTrending) {
              pool = pool.concat(window.getClientTrending('global') || [], window.getClientTrending('sweetener') || []);
            }
            pool = pool.concat(JSON.parse(localStorage.getItem('simpmusic_recent_songs') || '[]'));
            pool = pool.concat(JSON.parse(localStorage.getItem('simpmusic_likes') || '[]'));
            JSON.parse(localStorage.getItem('simpmusic_playlists') || '[]').forEach(pl => { pool = pool.concat(pl.tracks || []); });
          } catch (e) {}
          const seen = new Set();
          return pool.filter(t => t && t.videoId && !seen.has(t.videoId) && seen.add(t.videoId));
        }
        const vid = f.videoId || dlIdMap()[f.fileName || ''] || dlIdMap()[`${f.artist || 'Unknown'} - ${f.title || ''}`] || '';
        if (vid) {
          track = localPool().find(t => t.videoId === vid) || {
            videoId: vid,
            title: f.title || 'Offline song',
            artist: f.artist || '',
            thumbnail: vid ? ('https://i.ytimg.com/vi/' + vid + '/hqdefault.jpg') : ''
          };
        } else {
          // Legacy download (pre-v3.5.2): match by "artist - title", then title.
          const label = ((f.artist || '') + ' - ' + (f.title || '')).toLowerCase();
          const pool = localPool();
          track = pool.find(t => (t.artist + ' - ' + t.title).toLowerCase() === label)
            || pool.find(t => (t.title || '').toLowerCase() === (f.title || '').toLowerCase());
          if (!track) {
            // Last resort: resolve via native YouTube search (the MediaStore
            // artist field is often "<unknown>", so search by title only),
            // then remember the resolved id for next time.
            const results = (await nativeSearch(f.title || '')) || [];
            const normTitle = (f.title || '').toLowerCase();
            track = results.find(x => (x.title || '').toLowerCase() === normTitle) || results[0] || null;
            if (track && track.videoId) {
              try {
                const m = dlIdMap();
                m[f.fileName || `${f.artist || 'Unknown'} - ${f.title || ''}`] = track.videoId;
                localStorage.setItem('simpmusic_dl_ids', JSON.stringify(m));
              } catch (e) {}
            }
          }
        }
        if (track && window.player && window.player.playTrack) {
          window.player.playTrack(track, [track]);
          const dock = document.getElementById('mobileMiniDock');
          if (dock) dock.style.display = 'flex';
          if (window.showToast) window.showToast('Playing offline: ' + (track.title || ''));
        } else if (window.showToast) {
          window.showToast('Found in Music/SimpMusic — open with any music player');
        }
      }
      div.addEventListener('click', (e) => {
        if (e.target.closest('.dl-remove-btn')) return;
        playIt();
      });

      // ✕ → delete the file from MediaStore.
      div.querySelector('.dl-remove-btn').addEventListener('click', (e) => {
        e.stopPropagation();
        if (!f._id) return;
        try {
          window.Capacitor.Plugins.SimpMusicDownload.remove({ id: f._id }).then(() => {
            if (window.showToast) window.showToast('Deleted');
            renderLibraryDownloads();
          }).catch(() => {});
        } catch (err) {}
      });
      return div;
    }

    try {
      window.Capacitor.Plugins.SimpMusicDownload.list().then((res) => {
        const files = (res && res.files) || [];
        _downloadsCache = files;
        grid.innerHTML = '';
        if (!files.length && !activeIds.length) { wrap.style.display = 'none'; return; }
        wrap.style.display = '';
        // Active downloads first (loading state), then finished files.
        activeIds.forEach((id) => grid.appendChild(buildProgressCard(id, active[id])));
        files.forEach((f) => grid.appendChild(buildFileRow(f)));
      }).catch(() => {
        if (activeIds.length) {
          wrap.style.display = '';
          grid.innerHTML = '';
          activeIds.forEach((id) => grid.appendChild(buildProgressCard(id, active[id])));
        } else {
          wrap.style.display = 'none';
        }
      });
    } catch (e) { wrap.style.display = 'none'; }
  }
  // Refresh the section whenever the Library tab is opened.
  const _origSwitchView = switchMobileView;
  switchMobileView = function (viewName) {
    _origSwitchView(viewName);
    if (viewName === 'library') renderLibraryDownloads();
  };

  // iPod Back Button closes player
  if (ipodBackBtn) {
    ipodBackBtn.addEventListener('click', closeIpodPlayer);
  }

  // iPod ⋮ Menu (v3.8) — opens the same song sheet used everywhere else
  // (Add to playlist / Play next / Download / Not for me) for the
  // currently playing track.
  const ipodMenuBtn = document.getElementById('ipodMenuBtn');
  if (ipodMenuBtn) {
    ipodMenuBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      playClickHaptic();
      const t = player.currentTrack;
      if (!t) {
        showToast('No song playing');
        return;
      }
      if (window.SimpMusicPlaylists && window.SimpMusicPlaylists.songMenu) {
        window.SimpMusicPlaylists.songMenu(t);
      } else {
        showToast('Options: ' + t.title);
      }
    });
  }

  // Clicking backdrop outside iPod frame closes player
  if (ipodPlayerModal) {
    ipodPlayerModal.addEventListener('click', (e) => {
      if (e.target === ipodPlayerModal) closeIpodPlayer();
    });
  }

  // 1. Desktop Playing Song Profile Picture click triggers iPod Player
  if (dockThumb) {
    dockThumb.style.cursor = 'pointer';
    dockThumb.title = 'Open iPod Player';
    dockThumb.addEventListener('click', openIpodPlayer);
  }
  const dockThumbWrapper = document.querySelector('.dock-thumb-wrapper');
  if (dockThumbWrapper) {
    dockThumbWrapper.style.cursor = 'pointer';
    dockThumbWrapper.title = 'Open iPod Player';
    dockThumbWrapper.addEventListener('click', openIpodPlayer);
  }

  // 2. Mobile Floating Mini Dock Playing Song Profile Picture triggers iPod Player
  if (mobileMiniThumb) {
    mobileMiniThumb.style.cursor = 'pointer';
    mobileMiniThumb.title = 'Open iPod Player';
    mobileMiniThumb.addEventListener('click', openIpodPlayer);
  }
  const miniDockThumbWrap = document.querySelector('.mini-dock-thumb-wrap');
  if (miniDockThumbWrap) {
    miniDockThumbWrap.style.cursor = 'pointer';
    miniDockThumbWrap.title = 'Open iPod Player';
    miniDockThumbWrap.addEventListener('click', openIpodPlayer);
  }
  if (mobileMiniDock) {
    mobileMiniDock.addEventListener('click', (e) => {
      if (e.target.closest('.mini-dock-btn')) return;
      openIpodPlayer();
    });
  }

  // 3. Featured Card and Hero Artwork triggers iPod Player
  const mobileHeroCard = document.getElementById('mobileHeroCard');
  if (mobileHeroCard) {
    mobileHeroCard.addEventListener('click', openIpodPlayer);
  }
  if (heroCoverImg) {
    heroCoverImg.style.cursor = 'pointer';
    heroCoverImg.title = 'Open iPod Player';
    heroCoverImg.addEventListener('click', openIpodPlayer);
  }
  const albumHeroArtWrapper = document.querySelector('.album-hero-art-wrapper');
  if (albumHeroArtWrapper) {
    albumHeroArtWrapper.style.cursor = 'pointer';
    albumHeroArtWrapper.title = 'Open iPod Player';
    albumHeroArtWrapper.addEventListener('click', openIpodPlayer);
  }

  if (mobileMiniPlayBtn) {
    mobileMiniPlayBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      player.togglePlay();
    });
  }

  if (mobileMiniLikeBtn) {
    mobileMiniLikeBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      toggleLike(player.currentTrack);
      const isLiked = player.currentTrack && likedSongs.some(s => s.videoId === player.currentTrack.videoId);
      mobileMiniLikeBtn.querySelector('svg').setAttribute('fill', isLiked ? 'currentColor' : 'none');
    });
  }

  // ===================================================================
  // Helper: Escape HTML
  // ===================================================================
  function escapeHtml(str) {
    if (!str) return '';
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }

  // ===================================================================
  // 1. Mobile Recent Songs Engine (Replaces Top Picks)
  // ===================================================================
  let recentSongs = JSON.parse(localStorage.getItem('simpmusic_recent_songs') || '[]');

  // Recents show ONLY what the user actually played — no filler songs.
  // The whole section is hidden until the user plays their first song.

  window.recordRecentSong = function(track) {
    if (!track || !track.videoId) return;
    recentSongs = recentSongs.filter(s => s.videoId !== track.videoId);
    recentSongs.unshift({
      videoId: track.videoId,
      title: track.title,
      artist: track.artist,
      album: track.album || track.title,
      duration: track.duration || '3:20',
      durationSec: track.durationSec || 200,
      thumbnail: track.thumbnail || 'images/mobile/card_landscape.png',
      timestamp: Date.now()
    });
    if (recentSongs.length > 30) recentSongs.pop();
    localStorage.setItem('simpmusic_recent_songs', JSON.stringify(recentSongs));
    renderMobileRecentSongs();
    updateDeviceProfileUI();
  };

  function renderMobileRecentSongs() {
    const row1 = document.getElementById('mobileRecentRow1');
    const row2 = document.getElementById('mobileRecentRow2');
    if (!row1 || !row2) return;

    // Real history only: hide the section entirely when nothing played yet
    const section = document.getElementById('mobileRecentSection');
    if (!recentSongs || recentSongs.length === 0) {
      if (section) section.style.display = 'none';
      row1.innerHTML = '';
      row2.innerHTML = '';
      return;
    }
    if (section) section.style.display = '';
    const listToRender = recentSongs;

    row1.innerHTML = '';
    row2.innerHTML = '';

    const mid = Math.ceil(listToRender.length / 2);
    const row1Items = listToRender.slice(0, mid);
    const row2Items = listToRender.slice(mid);

    function createRecentCard(track) {
      const card = document.createElement('div');
      card.className = 'mobile-v2-pick-card';
      card.dataset.video = track.videoId;
      card.dataset.title = track.title;
      card.dataset.artist = track.artist;
      card.innerHTML = `
        <div class="mobile-v2-pick-thumb-wrap">
          <img loading="lazy" decoding="async" class="mobile-v2-pick-img" src="${track.thumbnail}" alt="${escapeHtml(track.title)}" onerror="this.src='https://images.unsplash.com/photo-1511671782779-c97d3d27a1d4?w=200&auto=format&fit=crop&q=80'" />
          <div class="mobile-v2-pick-play-icon">
            <svg width="22" height="22" viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z"/></svg>
          </div>
        </div>
        <div class="mobile-v2-pick-name" title="${escapeHtml(track.title)}">${escapeHtml(track.title)}</div>
        <div class="mobile-v2-pick-sub" title="${escapeHtml(track.artist)}" data-artist-open="${escapeHtml(track.artist || '')}">${escapeHtml(track.artist)}</div>
        <button class="song-menu-btn recent-menu-btn" title="More" data-video="${escapeHtml(track.videoId)}" data-title="${escapeHtml(track.title)}" data-artist="${escapeHtml(track.artist)}" data-thumb="${escapeHtml(track.thumbnail || '')}" data-duration="${escapeHtml(track.duration || '')}" data-durationsec="${track.durationSec || 0}">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><circle cx="12" cy="5" r="2"/><circle cx="12" cy="12" r="2"/><circle cx="12" cy="19" r="2"/></svg>
        </button>
      `;
      card.addEventListener('click', (e) => {
        if (e.target.closest('.song-menu-btn')) return; // menu button handles itself
        player.playTrack(track, listToRender);
        if (mobileMiniDock) mobileMiniDock.style.display = 'flex';
        showToast(`Playing ${track.title}`);
      });
      return card;
    }

    row1Items.forEach(t => row1.appendChild(createRecentCard(t)));
    row2Items.forEach(t => row2.appendChild(createRecentCard(t)));
  }

  // =====================================================================
  // v3.15: CURRENT TRENDING — home-page section showing the most-played
  // songs right now for the user's languages (picker picks + inferred
  // taste, reusing the v3.14 language machinery), with a global fallback.
  // =====================================================================
  const _trendCache = { at: 0, tracks: null };
  const TREND_CACHE_TTL = 5 * 60 * 1000;
  // v3.20.8: guards against a slow boot-time load (no languages picked yet)
  // landing after the language-aware reload and overwriting its results.
  let _trendGen = 0;

  async function loadCurrentTrending() {
    const gen = ++_trendGen;
    const sec = document.getElementById('mobileTrendingSection');
    const r1 = document.getElementById('mobileTrendingRow1');
    const r2 = document.getElementById('mobileTrendingRow2');
    const langsEl = document.getElementById('mobileTrendingLangs');
    if (!sec || !r1 || !r2) return;

    // Which languages? picked first, then inferred from listening history.
    const { picked, listenCounts } = inferLanguageTaste();
    let langs = picked.slice(0, 2);
    if (!langs.length) {
      langs = Object.entries(listenCounts).sort((a, b) => b[1] - a[1]).slice(0, 2).map(e => e[0]);
    }
    const label = (langs.length ? langs : ['global']).join(' • ').toUpperCase();
    if (langsEl) langsEl.textContent = label;

    // Fresh cache → render immediately
    const now = Date.now();
    if (_trendCache.tracks && now - _trendCache.at < TREND_CACHE_TTL) {
      renderTrendingCards(_trendCache.tracks);
      return;
    }
    if (!_trendCache.tracks) {
      // First paint: skeleton cards so the section doesn't jump
      r1.innerHTML = '';
      r2.innerHTML = '';
    }

    // v3.16.1: STRICT language filter — only the user's languages appear
    // here. The global-trending backfill was removed: when languages are
    // known, fewer cards beat wrong-language cards. (No title-based language
    // re-filtering: Latin-script Tamil titles would misclassify — the search
    // query itself constrains the language.)
    const per = await Promise.all(langs.map(l => cachedLangSearch(l, 12).catch(() => [])));
    if (gen !== _trendGen) return; // a newer load (language change) owns the section now
    let tracks = [];
    const seen = new Set();
    const maxLen = Math.max(0, ...per.map(a => a.length));
    for (let i = 0; i < maxLen; i++) {
      per.forEach(arr => {
        const t = arr[i];
        if (t && t.videoId && !seen.has(t.videoId)) { seen.add(t.videoId); tracks.push(t); }
      });
    }
    if (!langs.length) {
      // No picker & no history: only then fall back to the global mix.
      for (const t of buildDiscoverMix(20)) {
        if (tracks.length >= 12) break;
        if (t && t.videoId && !seen.has(t.videoId)) { seen.add(t.videoId); tracks.push(t); }
      }
    }
    tracks = tracks.slice(0, 12);
    _trendCache.at = now;
    _trendCache.tracks = tracks;

    if (!tracks.length) {
      sec.style.display = 'none';
      return;
    }
    sec.style.display = '';
    renderTrendingCards(tracks);
  }

  /**
   * v3.20.8: a language pick has to reach Home immediately.
   *
   * This section used to render whatever it found when the page booted and then
   * keep that for TREND_CACHE_TTL. On a fresh install the picker is still open
   * at boot, so it found "no languages yet" and filled the row with the global
   * (English) mix — and choosing Tamil or Hindi afterwards did not re-render it,
   * so the English songs stayed up for the rest of the session. Dropping both
   * caches here makes the next load re-search in the languages just picked.
   */
  function refreshForLanguageChange() {
    _trendCache.at = 0;
    _trendCache.tracks = null;
    Object.keys(_langDiscoverCache).forEach(k => { delete _langDiscoverCache[k]; });
    loadCurrentTrending();
    loadChartPlaylists();
  }
  window.addEventListener('simp:languages-changed', refreshForLanguageChange);

  function renderTrendingCards(tracks) {
    const r1 = document.getElementById('mobileTrendingRow1');
    const r2 = document.getElementById('mobileTrendingRow2');
    if (!r1 || !r2) return;
    r1.innerHTML = '';
    r2.innerHTML = '';
    const mid = Math.ceil(tracks.length / 2);
    tracks.slice(0, mid).forEach(t => r1.appendChild(trendingCard(t, tracks)));
    tracks.slice(mid).forEach(t => r2.appendChild(trendingCard(t, tracks)));
  }

  // =====================================================================
  // v3.18: TRENDING PLAYLISTS (YouTube Charts) — replaces New Releases.
  // v3.20.4: the cards are built from the LIVE weekly chart ids read off
  // YouTube Music's charts page (getChartIndex). The ids baked into the
  // constants below are ONLY a fallback for when that fetch is unavailable —
  // YouTube rotates chart playlists weekly, so a hardcoded id is stale the
  // moment it ships (and the old India/Telugu/Hindi ids pointed at the wrong
  // charts entirely). Cards: Global + India always, then one per preferred
  // language.
  // =====================================================================
  const CHART_PLAYLISTS = [
    { key: 'global', name: 'Top 100 Music Videos Global', sub: 'Trending Charts', listId: 'PL4fGSI1pDJn6puJdseH2Rt9sMvt9E2M4i' },
    { key: 'india', name: 'Top 100 Music Videos India', sub: 'Trending Charts', listId: 'PL4fGSI1pDJn6O1LS0XSdF3RyO0Rq_LDeI' }
  ];
  // v3.20.4: this map now only lists WHICH languages get a chart card (one
  // card per preferred language, after Global + India; with nothing picked,
  // inferred listening taste decides. English needs no card — Global covers
  // it). The list ids are no longer a source: they are dead/rotated, so a
  // language without a live weekly chart gets a live-search card instead.
  const LANG_CHARTS = {
    tamil: 'PLdPQQOxV3l0_11bBrgSX5CCb0YtcBGhhA',
    hindi: 'PL3oW2tjiIxvTaC6caIGR55W3ssqGvb_LR',
    telugu: 'PLaZ8DgRHYD_qT3k1B5PZCOgzs8-SR0fxR',
    malayalam: 'PLdmw3NKXtkFc8RLjvDXBeMhUyOTnMluSU',
    kannada: 'PLdmw3NKXtkFe4Lz_UeD7zX1GNhxiC08fD',
    marathi: 'PLdmw3NKXtkFcNBBM6JVpWu0FjNohyiAMN',
    punjabi: 'PLdmw3NKXtkFcO4jCuUtOz0xXAc1TnYAKf'
  };
  const _chartCardCache = {};
  // v3.20.4: card CONTENTS expire so a session left open for hours still picks
  // up a new chart; the id index itself rotates weekly, so 6h is plenty.
  const CHART_CARD_TTL = 30 * 60 * 1000;
  const CHART_INDEX_TTL = 6 * 60 * 60 * 1000;
  const CHART_INDEX_KEY = 'simpmusic_chart_index';
  const _chartIndexCache = { at: 0, charts: null };

  function chartCardMeta(chart) {
    return new Promise(resolve => {
      // Key on the card's key+listId: the India fallback for english users
      // reuses India's listId, and a bare listId key would collide.
      const cacheKey = chart.key + ':' + chart.listId;
      const cached = _chartCardCache[cacheKey];
      if (cached && Date.now() - cached.at < CHART_CARD_TTL) { resolve(cached.meta); return; }
      const finish = (meta) => {
        // A failed refresh keeps the last good card instead of blanking it.
        if (!meta && cached) { resolve(cached.meta); return; }
        _chartCardCache[cacheKey] = { at: Date.now(), meta };
        resolve(meta);
      };
      // v3.20.4: languages YouTube publishes no weekly chart for get a live
      // language-search card instead of a baked-in playlist id (those are
      // dead — the Malayalam/Kannada/Marathi lists no longer resolve at all).
      if (chart.searchLang) {
        cachedLangSearch(chart.searchLang, 50).then(tracks => {
          const list = (tracks || []).filter(t => t && t.videoId);
          if (!list.length) { finish(null); return; }
          finish({
            name: chart.name,
            sub: chart.sub,
            thumb: (list[0] && list[0].thumbnail) || '',
            count: list.length,
            tracks: list,
            listId: chart.listId
          });
        }).catch(() => finish(null));
        return;
      }
      const cap = window.Capacitor && window.Capacitor.Plugins && window.Capacitor.Plugins.PlaybackKeeper;
      if (!cap || !cap.resolvePlaylist) { finish(null); return; }
      cap.resolvePlaylist({ url: 'https://www.youtube.com/playlist?list=' + chart.listId })
        .then(res => {
          const data = JSON.parse(res.playlist);
          const first = data.tracks && data.tracks[0];
          finish({
            name: chart.name,
            sub: chart.sub,
            thumb: (first && first.thumbnail) || chart.thumb || '',
            count: data.count || (data.tracks ? data.tracks.length : 0),
            tracks: data.tracks || [],
            listId: chart.listId
          });
        })
        .catch(() => finish(null));
    });
  }

  /**
   * v3.20.4: the current week's chart playlists, straight from YouTube Music
   * (native InnerTube call). Cached in memory + localStorage for 6h so the
   * charts row is not refetched on every Home visit, but still rolls over to
   * the new weekly ids on its own. Resolves null when unavailable (web/PWA,
   * offline) — callers then fall back to the baked-in constants.
   */
  async function getChartIndex() {
    const now = Date.now();
    if (_chartIndexCache.charts && now - _chartIndexCache.at < CHART_INDEX_TTL) {
      return _chartIndexCache.charts;
    }
    if (!_chartIndexCache.charts) {
      try {
        const stored = JSON.parse(localStorage.getItem(CHART_INDEX_KEY) || 'null');
        if (stored && Array.isArray(stored.charts) && stored.charts.length) {
          _chartIndexCache.charts = stored.charts;
          _chartIndexCache.at = stored.at || 0;
          if (now - _chartIndexCache.at < CHART_INDEX_TTL) return _chartIndexCache.charts;
        }
      } catch (e) { /* corrupt cache: refetch below */ }
    }
    const cap = window.Capacitor && window.Capacitor.Plugins && window.Capacitor.Plugins.PlaybackKeeper;
    if (!cap || typeof cap.charts !== 'function') return _chartIndexCache.charts || null;
    try {
      const res = await cap.charts();
      const charts = (JSON.parse((res && res.charts) || '[]') || [])
        .filter(c => c && c.listId && c.title)
        .filter(c => /top|trend|chart|weekly/i.test(c.title));
      if (!charts.length) return _chartIndexCache.charts || null;
      _chartIndexCache.charts = charts;
      _chartIndexCache.at = Date.now();
      try { localStorage.setItem(CHART_INDEX_KEY, JSON.stringify(_chartIndexCache)); } catch (e) {}
      return charts;
    } catch (e) {
      // Offline / endpoint changed: keep serving whatever we already have.
      return _chartIndexCache.charts || null;
    }
  }

  /** Best chart row for a request: 'global', 'india' or a language name. */
  function pickChartRow(index, lang) {
    if (!index || !index.length) return null;
    let filter;
    if (lang === 'global') filter = /(international|global)/i;
    else if (lang === 'india') filter = /india/i;
    else {
      const name = String(lang || '').toLowerCase().replace(/[^a-z]/g, '');
      if (!name) return null;
      filter = new RegExp('(^|[^a-z])' + name + '([^a-z]|$)', 'i');
    }
    const matches = index.filter(c => filter.test(c.title || ''));
    if (!matches.length) return null;
    // Prefer the weekly Top-100 style chart over one-off/daily lists.
    const score = (c) => {
      const t = String(c.title || '').toLowerCase();
      let s = 0;
      if (/weekly/.test(t)) s += 4;
      if (/100/.test(t)) s += 3;
      if (/top/.test(t)) s += 1;
      if (/music videos|songs/.test(t)) s += 1;
      if (/daily/.test(t)) s -= 2;
      return s;
    };
    matches.sort((a, b) => score(b) - score(a));
    return matches[0];
  }

  async function loadChartPlaylists() {
    const sec = document.getElementById('mobileChartPlaylistsSection');
    const r1 = document.getElementById('mobileChartRow1');
    const r2 = document.getElementById('mobileChartRow2');
    if (!sec || !r1 || !r2) return;

    // v3.18.9: Global + India always, then a "Top Weekly Videos <LANG>" card
    // for EVERY preferred language (Settings picker first; inferred taste
    // only when nothing is picked). Hard cap 8 cards total to keep the row
    // sensible.
    const { picked, listenCounts } = inferLanguageTaste();
    let langs = (picked && picked.length ? picked.slice() : []);
    if (!langs.length) {
      langs = Object.entries(listenCounts || {})
        .sort((a, b) => b[1] - a[1]).map(e => e[0]).slice(0, 2);
    }
    const wanted = [
      { key: 'global', lang: 'global', fallback: CHART_PLAYLISTS[0] },
      { key: 'india', lang: 'india', fallback: CHART_PLAYLISTS[1] }
    ];
    (langs || []).forEach(rawLang => {
      const lang = String(rawLang || '').toLowerCase().trim();
      if (!lang || !LANG_CHARTS[lang]) return; // english: Global covers it
      if (wanted.length >= 8) return;
      if (wanted.some(w => w.lang === lang)) return; // already requested
      wanted.push({ key: 'lang_' + lang, lang });
    });

    // Live weekly ids first. A language with no official weekly chart gets a
    // live-search card (contents roll over with the search rotation) — the
    // baked-in constants are only the last resort for Global/India offline.
    const index = await getChartIndex();
    const charts = [];
    wanted.forEach(w => {
      const live = pickChartRow(index, w.lang);
      if (live) {
        if (charts.some(c => c.listId === live.listId)) return; // already shown
        charts.push({
          key: w.key,
          name: live.title,
          sub: 'Trending Charts · updated weekly',
          listId: live.listId,
          thumb: live.thumb
        });
        return;
      }
      if (!w.fallback) {
        charts.push({
          key: w.key, searchLang: w.lang,
          listId: 'search:' + w.lang,
          name: w.lang.toUpperCase() + ' Top Hits',
          sub: 'Fresh picks · refreshed every hour'
        });
        return;
      }
      charts.push({
        key: w.key, name: w.fallback.name, sub: w.fallback.sub,
        listId: w.fallback.listId
      });
    });

    const metas = await Promise.all(charts.map(c => chartCardMeta(c)));
    const pairs = charts.map((def, i) => ({ def, meta: metas[i] })).filter(p => p.meta);
    if (!pairs.length) { sec.style.display = 'none'; return; }
    sec.style.display = '';
    renderChartCards(pairs);
  }

  function renderChartCards(pairs) {
    const r1 = document.getElementById('mobileChartRow1');
    const r2 = document.getElementById('mobileChartRow2');
    if (!r1 || !r2) return;
    r1.innerHTML = '';
    r2.innerHTML = '';
    pairs.forEach(({ def, meta }, idx) => {
      const card = document.createElement('div');
      card.className = 'mobile-v2-pick-card';
      card.innerHTML = `
        <div class="mobile-v2-pick-thumb-wrap">
          <img loading="lazy" decoding="async" class="mobile-v2-pick-img" src="${escapeHtml(meta.thumb || '')}" onerror="this.src='https://images.unsplash.com/photo-1511671782779-c97d3d27a1d4?w=200&auto=format&fit=crop&q=80'" />
          <div class="mobile-v2-pick-play-icon">
            <svg width="22" height="22" viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z"/></svg>
          </div>
        </div>
        <div class="mobile-v2-pick-name" title="${escapeHtml(meta.name)}">${escapeHtml(meta.name)}</div>
        <div class="mobile-v2-pick-sub" title="${escapeHtml(meta.sub)}">${escapeHtml(meta.sub)}${meta.count ? ' · ' + meta.count + ' songs' : ''}</div>
      `;
      // v3.18.3: bind the meta AND the chart def on the element. If the user
      // taps before the background fetch finished, fetch on demand instead
      // of dead-ending with a toast.
      card._chartMeta = meta;
      card._chartDef = def;
      card.addEventListener('click', () => {
        const open = (m) => openPlaylistPreview({ name: m.name, creator: m.sub, count: m.count, tracks: m.tracks });
        const m = card._chartMeta;
        if (m && m.tracks && m.tracks.length) { open(m); return; }
        showToast('Loading chart…');
        chartCardMeta(card._chartDef).then(fresh => {
          if (fresh && fresh.tracks && fresh.tracks.length) open(fresh);
          else showToast('Could not load that chart');
        });
      });
      if (idx < 2) r1.appendChild(card); else r2.appendChild(card);
    });
  }

  function trendingCard(track, list) {
    const card = document.createElement('div');
    card.className = 'mobile-v2-pick-card';
    card.innerHTML = `
      <div class="mobile-v2-pick-thumb-wrap">
        <img loading="lazy" decoding="async" class="mobile-v2-pick-img" src="${track.thumbnail}" alt="${escapeHtml(track.title)}" onerror="this.src='https://images.unsplash.com/photo-1511671782779-c97d3d27a1d4?w=200&auto=format&fit=crop&q=80'" />
        <div class="mobile-v2-pick-play-icon">
          <svg width="22" height="22" viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z"/></svg>
        </div>
      </div>
      <div class="mobile-v2-pick-name" title="${escapeHtml(track.title)}">${escapeHtml(track.title)}</div>
      <div class="mobile-v2-pick-sub" title="${escapeHtml(track.artist)}">${escapeHtml(track.artist)}</div>
      <button class="song-menu-btn recent-menu-btn" title="More" data-video="${escapeHtml(track.videoId)}" data-title="${escapeHtml(track.title)}" data-artist="${escapeHtml(track.artist)}" data-thumb="${escapeHtml(track.thumbnail || '')}" data-duration="${escapeHtml(track.duration || '')}" data-durationsec="${track.durationSec || 0}">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><circle cx="12" cy="5" r="2"/><circle cx="12" cy="12" r="2"/><circle cx="12" cy="19" r="2"/></svg>
      </button>
    `;
    card.addEventListener('click', (e) => {
      if (e.target.closest('.song-menu-btn')) return;
      player.playTrack(track, list);
      if (mobileMiniDock) mobileMiniDock.style.display = 'flex';
      showToast(`Playing ${track.title}`);
    });
    return card;
  }

  const mobileClearRecentsBtn = document.getElementById('mobileClearRecentsBtn');
  const mobileClearRecentsSettingsBtn = document.getElementById('mobileClearRecentsSettingsBtn');

  function clearRecentSongs() {
    recentSongs = [];
    localStorage.removeItem('simpmusic_recent_songs');
    renderMobileRecentSongs();
    updateDeviceProfileUI();
    showToast('Recent songs history cleared');
  }

  if (mobileClearRecentsBtn) mobileClearRecentsBtn.addEventListener('click', clearRecentSongs);
  if (mobileClearRecentsSettingsBtn) mobileClearRecentsSettingsBtn.addEventListener('click', clearRecentSongs);

  // New releases cards click handler
  document.querySelectorAll('#mobileNewReleasesList .mobile-v2-release-item').forEach(item => {
    item.addEventListener('click', (e) => {
      const vid = item.dataset.video || '2bJKg73Q_S4';
      const title = item.dataset.title || 'Song';
      const artist = item.dataset.artist || 'Artist';
      const img = item.querySelector('img')?.src || 'images/mobile/thumb_new_releases.png';
      const trackObj = { videoId: vid, title, artist, album: 'New Releases', duration: '3:20', durationSec: 200, thumbnail: img };
      player.playTrack(trackObj, [trackObj]);
      if (mobileMiniDock) mobileMiniDock.style.display = 'flex';
      showToast(`Playing ${title}`);
    });
  });

  // ===================================================================
  // 2. Mobile View Routing & Navigation
  // ===================================================================
  const mobileSearchView = document.getElementById('mobileSearchView');
  const mobileSettingsView = document.getElementById('mobileSettingsView');
  const mobileLibraryView = document.getElementById('mobileLibraryView');
  const navHomeBtn = document.getElementById('mobileNavHomeBtn');
  const navSearchBtn = document.getElementById('mobileNavSearchBtn');
  const navPlaylistBtn = document.getElementById('mobileNavPlaylistBtn');
  const navProfileBtn = document.getElementById('mobileNavProfileBtn');
  const mobileSearchTrigger = document.getElementById('mobileSearchTrigger');
  const mobileSearchBackBtn = document.getElementById('mobileSearchBackBtn');
  const mobileSettingsBackBtn = document.getElementById('mobileSettingsBackBtn');
  const mobileHeaderSettingsBtn = document.getElementById('mobileHeaderSettingsBtn');

  // =====================================================================
  // v3.15.2: SMART ANDROID BACK BUTTON
  // The native side (MainActivity.installSmartBack) asks
  // window.SimpMusicBack.handle() before leaving the app. This walks the
  // UI stack top-down: open overlays (iPod view, queue sheet, song sheet,
  // dialogs) first, then the visited-view stack (Library → Settings →
  // Home), matching the user's actual navigation path.
  // =====================================================================
  const backViewStack = ['home'];

  function topOverlayCloser() {
    // Order matters: highest z-index / innermost first.
    if (typeof window.SimpMusicQueue !== 'undefined' && window.SimpMusicQueue &&
        document.querySelector('.queue-sheet-wrap.open')) {
      return () => window.SimpMusicQueue.close();
    }
    if (document.getElementById('plSheet')) {
      return () => { const s = document.getElementById('plSheet'); if (s) s.remove(); };
    }
    if (document.getElementById('plOverlay')) {
      return () => { const o = document.getElementById('plOverlay'); if (o) o.remove(); };
    }
    if (document.getElementById('plAddSongsOverlay') && document.getElementById('plAddSongsOverlay').style.display !== 'none') {
      return () => {
        const o = document.getElementById('plAddSongsOverlay');
        if (o) o.style.display = 'none';
        if (typeof closeAddSongs === 'function') closeAddSongs();
      };
    }
    if (document.getElementById('catOverlay')) {
      return () => { const o = document.getElementById('catOverlay'); if (o) o.remove(); };
    }
    if (lyricsOverlay && lyricsOverlay.classList.contains('active')) {
      return () => lyricsOverlay.classList.remove('active');
    }
    if (ipodPlayerModal && ipodPlayerModal.classList.contains('open')) {
      return closeIpodPlayer;
    }
    return null;
  }

  function smartHandleBack() {
    // 1. Close the topmost overlay
    const closer = topOverlayCloser();
    if (closer) { closer(); return true; }
    // 2. Step back through visited views (Library → Settings → Home …)
    if (isMobileLayout() && backViewStack.length > 1) {
      backViewStack.pop();
      smartHandleBack._stepping = true; // don't re-record this as navigation
      try {
        switchMobileView(backViewStack[backViewStack.length - 1] || 'home');
      } finally {
        smartHandleBack._stepping = false;
      }
      return true;
    }
    // 3. Nothing left to close — let Android background the app
    return false;
  }
  window.SimpMusicBack = { handle: smartHandleBack, stack: backViewStack };

  function switchMobileView(viewName) {
    // v3.15.2: track the user's navigation path for the Android BACK button
    // (Library → Settings → Home). Only record real user-driven transitions.
    if (typeof smartHandleBack === 'function' && !smartHandleBack._stepping) {
      const top = backViewStack[backViewStack.length - 1];
      if (viewName !== top) {
        // Avoid dupes when re-tapping the current tab
        const existing = backViewStack.indexOf(viewName);
        if (existing >= 0) backViewStack.splice(existing, 1); // revisit: move to top
        backViewStack.push(viewName);
        if (backViewStack.length > 6) backViewStack.shift(); // safety cap
      }
    }
    // Hide all main mobile subviews
    if (mobileHomeView) mobileHomeView.style.display = 'none';
    if (mobileSearchView) mobileSearchView.style.display = 'none';
    if (mobileSettingsView) mobileSettingsView.style.display = 'none';
    if (mobileLibraryView) mobileLibraryView.style.display = 'none';
    if (desktopTracklistView) desktopTracklistView.style.display = 'none';
    if (settingsView) settingsView.style.display = 'none';

    document.querySelectorAll('.mobile-v2-nav-item').forEach(b => b.classList.remove('active'));

    if (viewName === 'home') {
      if (mobileHomeView) mobileHomeView.style.display = 'block';
      navHomeBtn?.classList.add('active');
      loadCurrentTrending(); // v3.15: refresh trending on Home open
      loadChartPlaylists(); // v3.18.1: re-pick the language chart on Home open
      updateNetPill(true); // v3.19.4: refresh the speed indicator
    } else if (viewName === 'search') {
      if (mobileSearchView) mobileSearchView.style.display = 'block';
      navSearchBtn?.classList.add('active');
      renderMobileSearchHistory();
      // Prefill the browse list so the view is never empty. v3.13: rotate a
      // fresh "Discover Music" mix on every open instead of one static list.
      // v3.14: an instant pool renders first, then the language-aware
      // refinement (picker languages + inferred taste) replaces it once the
      // per-language searches return.
      if (mobileSearchResultsList && (mobileSearchResultsList.children.length === 0 || mobileSearchPrefillActive)) {
        renderMobileSearchResults(buildDiscoverMix(), null);
        buildDiscoverMixRefined(12).then(refined => {
          // Only apply if the user hasn't typed a real search meanwhile.
          if (mobileSearchPrefillActive && refined.length && mobileSearchResultsList) {
            renderMobileSearchResults(refined, null);
          }
        }).catch(() => {});
      }
      setTimeout(() => mobileSearchInput?.focus(), 150);
    } else if (viewName === 'library') {
      // Library tab shows playlists only (create / play / add songs)
      if (mobileLibraryView) mobileLibraryView.style.display = 'block';
      if (window.SimpMusicPlaylists) window.SimpMusicPlaylists.renderMobile();
      navPlaylistBtn?.classList.add('active');
    } else if (viewName === 'settings') {
      if (mobileSettingsView) mobileSettingsView.style.display = 'block';
      navProfileBtn?.classList.add('active');
      updateDeviceProfileUI();
    }
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  if (navHomeBtn) navHomeBtn.addEventListener('click', () => switchMobileView('home'));
  if (navSearchBtn) navSearchBtn.addEventListener('click', () => switchMobileView('search'));
  if (navPlaylistBtn) navPlaylistBtn.addEventListener('click', () => switchMobileView('library'));
  if (navProfileBtn) navProfileBtn.addEventListener('click', () => switchMobileView('settings'));

  if (mobileSearchTrigger) mobileSearchTrigger.addEventListener('click', () => switchMobileView('search'));
  if (mobileSearchBackBtn) mobileSearchBackBtn.addEventListener('click', () => switchMobileView('home'));
  if (mobileHeaderSettingsBtn) mobileHeaderSettingsBtn.addEventListener('click', () => switchMobileView('settings'));
  if (mobileSettingsBackBtn) mobileSettingsBackBtn.addEventListener('click', () => switchMobileView('home'));

  // ===================================================================
  // Playlist detail view + play-track fallback (events from playlists.js)
  // ===================================================================
  window.addEventListener('simpmusic:open-playlist', (e) => {
    const pl = e.detail;
    if (!pl || !Array.isArray(pl.tracks)) return;
    const isMobile = isMobileLayout();
    if (isMobile) {
      // v3.18.5: phones open the mobile playlist overlay (the desktop
      // tracklist hero rendered clipped/off-screen on narrow screens).
      // Library stays visible behind the overlay — closing returns there.
      openPlaylistPreview({
        name: pl.name || 'Playlist',
        creator: pl.virtual ? 'Your likes' : 'You',
        count: pl.tracks.length,
        tracks: pl.tracks,
        inLibrary: true,
        virtual: !!pl.virtual,
        id: pl.id
      });
      return;
    } else {
      if (browseView) browseView.style.display = 'none';
      if (desktopPlaylistsView) desktopPlaylistsView.style.display = 'none';
      if (settingsView) settingsView.style.display = 'none';
    }
    if (desktopTracklistView) desktopTracklistView.style.display = 'block';
    currentTracks = pl.tracks;
    renderTracks(pl.tracks, true);
    // Set hero labels AFTER renderTracks, which overwrites them with the playing track
    if (sectionTitle) sectionTitle.textContent = 'Playlists';
    if (heroCategory) heroCategory.textContent = 'PLAYLIST';
    if (heroTitle) heroTitle.textContent = pl.name || 'Playlist';
    if (heroArtist) heroArtist.textContent = `${pl.tracks.length} song${pl.tracks.length === 1 ? '' : 's'}`;
    playlistDetailMode = true; // enable the ⋮ add-to-playlist sheet for these rows
    const addSongsHero = document.getElementById('addSongsHeroBtn');
    if (addSongsHero) addSongsHero.style.display = '';
    window.scrollTo({ top: 0, behavior: 'smooth' });
  });

  window.addEventListener('simpmusic:play-track', (e) => {
    // Fallback path (only fires when window.player was unavailable)
    const track = e.detail;
    if (track && typeof player.playTrack === 'function') {
      player.playTrack(track, e.tracks || [track]);
      const dock = document.getElementById('mobileMiniDock');
      if (dock) dock.style.display = 'flex';
    }
  });

  // ===================================================================
  // 3. Mobile Search Controller
  // ===================================================================
  const mobileSearchInput = document.getElementById('mobileSearchInput');
  const mobileSearchClearBtn = document.getElementById('mobileSearchClearBtn');
  const mobileSearchSuggestions = document.getElementById('mobileSearchSuggestions');
  const mobileSearchChipsWrap = document.getElementById('mobileSearchChipsWrap');
  const mobileClearHistoryBtn = document.getElementById('mobileClearHistoryBtn');
  const mobileSearchResultsList = document.getElementById('mobileSearchResultsList');
  const mobileSearchResultsStatus = document.getElementById('mobileSearchResultsStatus');
  const mobileSearchGenres = document.getElementById('mobileSearchGenres');

  let mobileSearchHistory = JSON.parse(localStorage.getItem('simpmusic_search_history') || '["Billie Eilish", "The Weeknd", "Dua Lipa", "Chill Beats", "Pop Hits"]');

  // v3.19.12: redesigned Recent Searches chips — clean monochrome SVG
  // icons (stroke style matching the rest of the app) instead of the loud
  // 🔍 emoji, plus a per-chip ✕ to delete a single term (previously the
  // only way to remove anything was wiping the whole history).
  const RECENT_CLOCK_SVG = '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M12 7.5V12l3 2"/></svg>';
  const CHIP_REMOVE_SVG = '<svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18"/></svg>';

  function renderMobileSearchHistory() {
    if (!mobileSearchChipsWrap) return;
    mobileSearchChipsWrap.innerHTML = '';
    if (mobileSearchHistory.length === 0) {
      const emptySpan = document.createElement('span');
      emptySpan.style.cssText = 'color:#71717a; font-size:0.78rem;';
      emptySpan.textContent = 'No recent searches';
      mobileSearchChipsWrap.appendChild(emptySpan);
      return;
    }
    mobileSearchHistory.slice(0, 8).forEach(term => {
      const chip = document.createElement('div');
      chip.className = 'mobile-search-chip';
      chip.setAttribute('role', 'button');
      chip.innerHTML = `<span class="chip-ico">${RECENT_CLOCK_SVG}</span>`
        + `<span class="chip-term">${escapeHtml(term)}</span>`
        + `<button class="chip-remove" title="Remove" aria-label="Remove ${escapeHtml(term)}">${CHIP_REMOVE_SVG}</button>`;
      chip.addEventListener('click', (e) => {
        if (e.target.closest('.chip-remove')) return; // remove button handles itself
        if (mobileSearchInput) mobileSearchInput.value = term;
        performMobileSearch(term);
      });
      chip.querySelector('.chip-remove').addEventListener('click', (e) => {
        e.stopPropagation();
        mobileSearchHistory = mobileSearchHistory.filter(t => t.toLowerCase() !== term.toLowerCase());
        localStorage.setItem('simpmusic_search_history', JSON.stringify(mobileSearchHistory));
        renderMobileSearchHistory();
        showToast(`Removed "${term}"`);
      });
      mobileSearchChipsWrap.appendChild(chip);
    });
  }

  function addSearchHistory(term) {
    if (!term || !term.trim()) return;
    const clean = term.trim();
    mobileSearchHistory = mobileSearchHistory.filter(t => t.toLowerCase() !== clean.toLowerCase());
    mobileSearchHistory.unshift(clean);
    if (mobileSearchHistory.length > 15) mobileSearchHistory.pop();
    localStorage.setItem('simpmusic_search_history', JSON.stringify(mobileSearchHistory));
    renderMobileSearchHistory();
  }

  if (mobileClearHistoryBtn) {
    if (!mobileClearHistoryBtn.dataset.icoDone) {
      mobileClearHistoryBtn.dataset.icoDone = '1';
      mobileClearHistoryBtn.innerHTML = '<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 6h18"/><path d="M8 6V4h8v2"/><path d="M6 6l1 14h10l1-14"/><path d="M10 11v6M14 11v6"/></svg>Clear';
    }
    mobileClearHistoryBtn.addEventListener('click', () => {
      mobileSearchHistory = [];
      localStorage.removeItem('simpmusic_search_history');
      renderMobileSearchHistory();
      showToast('Search history cleared');
    });
  }

  // v3.17: search-type pills (Songs / Playlists / Artists). Switching tabs
  // re-runs the active query with the new type, or restores the Discover
  // prefill (Songs) / hint (Playlists, Artists) when the field is empty.
  if (mobileSearchGenres) {
    mobileSearchGenres.querySelectorAll('.mobile-genre-pill').forEach(pill => {
      pill.addEventListener('click', () => {
        mobileSearchGenres.querySelectorAll('.mobile-genre-pill').forEach(p => p.classList.remove('active'));
        pill.classList.add('active');
        mobileSearchType = pill.dataset.genre;
        const q = mobileSearchInput ? mobileSearchInput.value.trim() : '';
        if (q) {
          performMobileSearch(q);
        } else if (mobileSearchType === 'songs') {
          showDiscoverPrefill();
        } else {
          renderMobileTypedResults([], mobileSearchType, null);
        }
      });
    });
  }

  // Mobile search input handling
  let mobileSearchTimeout = null;
  if (mobileSearchInput) {
    mobileSearchInput.addEventListener('input', (e) => {
      const q = e.target.value;
      if (mobileSearchClearBtn) {
        mobileSearchClearBtn.classList.toggle('active', q.length > 0);
      }
      clearTimeout(mobileSearchTimeout);
      if (!q.trim()) {
        if (mobileSearchSuggestions) mobileSearchSuggestions.classList.remove('active');
        return;
      }
      mobileSearchTimeout = setTimeout(() => {
        fetchMobileSuggestions(q.trim());
      }, 250);
    });

    mobileSearchInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        const q = mobileSearchInput.value.trim();
        if (q) {
          if (mobileSearchSuggestions) mobileSearchSuggestions.classList.remove('active');
          performMobileSearch(q);
        }
      }
    });
  }

  if (mobileSearchClearBtn) {
    mobileSearchClearBtn.addEventListener('click', () => {
      if (mobileSearchInput) {
        mobileSearchInput.value = '';
        mobileSearchInput.focus();
      }
      mobileSearchClearBtn.classList.remove('active');
      if (mobileSearchSuggestions) mobileSearchSuggestions.classList.remove('active');
    });
  }

  async function fetchMobileSuggestions(query) {
    if (!mobileSearchSuggestions) return;
    try {
      let suggestions = [];
      if (!isCloudMode) {
        const endpoint = API_BASE ? `${API_BASE}/api/suggestions?q=${encodeURIComponent(query)}` : `/api/suggestions?q=${encodeURIComponent(query)}`;
        const res = await fetch(endpoint);
        if (res.ok) suggestions = await res.json();
      }
      if (!suggestions || suggestions.length === 0) {
        // Fallback search local catalog
        const allSongs = [...(window.getClientTrending('global') || []), ...(window.getClientTrending('sweetener') || [])];
        const matches = allSongs.filter(s => s.title.toLowerCase().includes(query.toLowerCase()) || s.artist.toLowerCase().includes(query.toLowerCase()));
        suggestions = matches.map(s => s.title).slice(0, 6);
      }

      if (suggestions && suggestions.length > 0) {
        mobileSearchSuggestions.innerHTML = '';
        suggestions.slice(0, 5).forEach(s => {
          const item = document.createElement('div');
          item.className = 'mobile-suggestion-item';
          item.innerHTML = `<span>🔍</span><span>${escapeHtml(s)}</span>`;
          item.addEventListener('click', () => {
            if (mobileSearchInput) mobileSearchInput.value = s;
            mobileSearchSuggestions.classList.remove('active');
            performMobileSearch(s);
          });
          mobileSearchSuggestions.appendChild(item);
        });
        mobileSearchSuggestions.classList.add('active');
      } else {
        mobileSearchSuggestions.classList.remove('active');
      }
    } catch (e) {
      mobileSearchSuggestions.classList.remove('active');
    }
  }

  // v3.17: restore the Discover prefill on the Songs tab
  function showDiscoverPrefill() {
    if (mobileSearchResultsList) {
      renderMobileSearchResults(buildDiscoverMix(), null);
      buildDiscoverMixRefined(12).then(refined => {
        if (mobileSearchPrefillActive && refined.length && mobileSearchResultsList) {
          renderMobileSearchResults(refined, null);
        }
      }).catch(() => {});
    }
  }

  async function performMobileSearch(query) {
    if (!query || !query.trim()) return;
    const gen = ++mobileSearchGen;
    const searchType = mobileSearchType; // capture at CALL time
    const cleanQ = query.trim();
    addSearchHistory(cleanQ);
    if (mobileSearchSuggestions) mobileSearchSuggestions.classList.remove('active');
    const typeLabel = searchType === 'playlists' ? 'playlists'
      : searchType === 'artists' ? 'artists' : 'songs';
    if (mobileSearchResultsStatus) mobileSearchResultsStatus.textContent = `SEARCHING ${typeLabel.toUpperCase()} FOR "${cleanQ}"...`;
    if (mobileSearchResultsList) {
      mobileSearchResultsList.innerHTML = `
        <div style="text-align:center; padding:30px; color:#71717a;">
          <div style="font-size:1.5rem; margin-bottom:8px;">🔍</div>
          <div>Finding ${typeLabel} for "${escapeHtml(cleanQ)}"...</div>
        </div>
      `;
    }

    try {
      let results = [];
      // 1. Native typed search (Android APK): NewPipe extraction on-device.
      results = (await nativeSearch(cleanQ, 10000, searchType)) || [];
      if (gen !== mobileSearchGen) return; // superseded by a newer search
      // 2. Backend server search (web / PWA)
      if ((!results || results.length === 0) && !isCloudMode) {
        const searchEndpoint = API_BASE ? `${API_BASE}/api/search?q=${encodeURIComponent(cleanQ)}` : `/api/search?q=${encodeURIComponent(cleanQ)}`;
        const res = await fetch(searchEndpoint);
        if (res.ok) {
          results = await res.json();
        }
      }
      if (gen !== mobileSearchGen) return; // superseded while fetching
      if (searchType === 'songs' && (!results || results.length === 0)) {
        // Standalone local client catalog search (songs tab only)
        const allLocal = [...(window.getClientTrending('global') || []), ...(window.getClientTrending('sweetener') || [])];
        results = allLocal.filter(t => 
          t.title.toLowerCase().includes(cleanQ.toLowerCase()) ||
          t.artist.toLowerCase().includes(cleanQ.toLowerCase()) ||
          (t.album && t.album.toLowerCase().includes(cleanQ.toLowerCase()))
        );
      }

      renderMobileTypedResults(results || [], searchType, cleanQ);
    } catch (err) {
      console.error('Mobile search error:', err);
      if (gen === mobileSearchGen) renderMobileTypedResults([], searchType, cleanQ);
    }
  }

  /**
   * v3.17: render search results by type — songs use the classic row,
   * playlists offer one-tap import, artists show channel cards.
   */
  function renderMobileTypedResults(items, type, query) {
    if (type === 'playlists') { renderPlaylistResults(items, query); return; }
    if (type === 'artists') { renderArtistResults(items, query); return; }
    renderMobileSearchResults(items, query);
  }

  function renderPlaylistResults(items, query) {
    if (!mobileSearchResultsList) return;
    mobileSearchPrefillActive = false;
    if (mobileSearchResultsStatus) {
      mobileSearchResultsStatus.textContent = query
        ? `PLAYLISTS FOR "${query}" (${items.length})`
        : 'PLAYLISTS';
    }
    if (!items.length) {
      mobileSearchResultsList.innerHTML = `<div style="text-align:center; padding:30px; color:#71717a;"><div style="font-size:1.8rem; margin-bottom:8px;">😕</div><div style="color:#fff; font-weight:600;">No playlists found${query ? ` for "${escapeHtml(query)}"` : ''}</div></div>`;
      return;
    }
    mobileSearchResultsList.innerHTML = '';
    items.forEach(pl => {
      const item = document.createElement('div');
      item.className = 'mobile-search-item';
      item.innerHTML = `
        <img class="mobile-search-thumb" style="border-radius:12px;" src="${escapeHtml(pl.thumbnail || '')}" onerror="this.src='https://images.unsplash.com/photo-1511671782779-c97d3d27a1d4?w=200&auto=format&fit=crop&q=80'" />
        <div class="mobile-search-info">
          <div class="mobile-search-item-title">${escapeHtml(pl.name)}</div>
          <div class="mobile-search-item-meta">📋 ${escapeHtml(pl.creator || 'Trending')} · Playlist</div>
        </div>
        <button class="mobile-search-play-btn" title="Import" style="background:rgba(168,85,247,0.3); font-size:0.68rem; padding:6px 10px; border-radius:999px;">Import</button>
      `;
      item.addEventListener('click', async (e) => {
        e.stopPropagation();
        const btn = item.querySelector('.mobile-search-play-btn');
        btn.textContent = '…';
        try {
          const cap = window.Capacitor && window.Capacitor.Plugins.PlaybackKeeper;
          const res = await cap.resolvePlaylist({ url: 'https://www.youtube.com/playlist?list=' + pl.playlistId });
          const data = JSON.parse(res.playlist);
          btn.textContent = 'Import';
          // v3.17.2: open a PREVIEW first — import is a separate button inside.
          openPlaylistPreview(data);
        } catch (err) {
          btn.textContent = 'Import';
          showToast('Could not open that playlist');
        }
      });
      mobileSearchResultsList.appendChild(item);
    });
  }

  /**
   * v3.17.2: playlist preview sheet — browse & play tracks WITHOUT importing.
   * "Add to Library" is an explicit button inside, so the user only keeps
   * playlists they actually like.
   */
  function openPlaylistPreview(data) {
    // v3.18.5: re-opening (e.g. after adding a song) REFRESHES the preview
    const existingOverlay = document.getElementById('plPreviewOverlay');
    if (existingOverlay) existingOverlay.remove();
    const tracks = data.tracks || [];
    const inLibrary = !!data.inLibrary;      // opened from Library (saved playlist)
    const isVirtual = !!data.virtual;        // pinned Liked Songs
    const count = data.count != null ? data.count : tracks.length;
    const canDownload = !!(window.Capacitor && window.Capacitor.Plugins && window.Capacitor.Plugins.SimpMusicDownload);
    const wrap = document.createElement('div');
    wrap.innerHTML = '<div class="cat-overlay pl-overlay" id="plPreviewOverlay">'
      + '<div class="pl-dialog" style="width:min(94vw, 460px);">'
      + '<div class="pl-dialog-title" style="margin-bottom:2px;">' + escapeHtml(data.name) + '</div>'
      + '<div style="color:#71717a; font-size:0.75rem; margin-bottom:12px;">by ' + escapeHtml(data.creator || 'Trending') + ' · ' + count + ' song' + (count === 1 ? '' : 's') + '</div>'
      + '<div style="display:flex; gap:8px; margin-bottom:12px; flex-wrap:wrap;">'
      + '<button class="pl-btn pl-btn-primary" id="plPreviewPlay" style="flex:1 1 40%;">▶ Play all</button>'
      + (!inLibrary ? '<button class="pl-btn pl-btn-ghost" id="plPreviewAdd" style="flex:1 1 40%;">➕ Add to Library</button>' : '')
      + (inLibrary && !isVirtual ? '<button class="pl-btn pl-btn-ghost" id="plPreviewAddSongs" style="flex:1 1 40%;">➕ Add Songs</button>' : '')
      + (canDownload && tracks.length ? '<button class="pl-btn pl-btn-ghost" id="plPreviewDl" style="flex:1 1 40%;">⬇ Download</button>' : '')
      + '</div>'
      + '<div id="plPreviewList" style="max-height:52vh; overflow-y:auto; border-top:1px solid rgba(255,255,255,0.08);"></div>'
      + '<div class="pl-dialog-actions"><button class="pl-btn pl-btn-ghost" id="plPreviewClose">Close</button></div>'
      + '</div></div>';
    document.body.appendChild(wrap.firstChild);
    const overlay = document.getElementById('plPreviewOverlay');
    const list = document.getElementById('plPreviewList');
    requestAnimationFrame(() => overlay.classList.add('active'));

    if (!tracks.length) {
      list.innerHTML = '<div style="color:#71717a; padding:26px 8px; text-align:center; font-size:0.8rem;">'
        + (isVirtual ? 'No liked songs yet — tap ♥ on any song you enjoy.' : 'No songs yet — use ➕ Add Songs to fill this playlist.')
        + '</div>';
    }

    // v3.18.5: playlist download — show required storage BEFORE downloading
    const dlBtn = document.getElementById('plPreviewDl');
    if (dlBtn) dlBtn.addEventListener('click', async () => {
      dlBtn.disabled = true;
      let ok = false;
      try { ok = await confirmPlaylistDownload(tracks, data.name); } catch (e) { ok = false; }
      dlBtn.disabled = false;
      if (ok) downloadPlaylistTracks(tracks, dlBtn);
    });

    // v3.18.5: add songs from inside the playlist (mobile)
    const addSongsBtn = document.getElementById('plPreviewAddSongs');
    if (addSongsBtn) addSongsBtn.addEventListener('click', () => {
      const api = window.SimpMusicPlaylists;
      if (api && api.openAddSongs && data.id) api.openAddSongs(data.id);
      else if (window.showToast) showToast('Open the playlist from Library to add songs');
    });

    tracks.forEach((t, idx) => {
      const row = document.createElement('div');
      row.className = 'mobile-search-item';
      row.style.padding = '8px 4px';
      row.innerHTML = `
        <span style="color:#565968; font-size:0.75rem; width:20px; text-align:center; flex:none;">${idx + 1}</span>
        <img class="mobile-search-thumb" style="width:42px; height:42px; border-radius:8px;" src="${escapeHtml(t.thumbnail || '')}" onerror="this.style.visibility='hidden'" />
        <div class="mobile-search-info">
          <div class="mobile-search-item-title" style="font-size:0.85rem;">${escapeHtml(t.title)}</div>
          <div class="mobile-search-item-meta">${escapeHtml(t.artist || '')}${t.duration ? ' · ' + escapeHtml(t.duration) : ''}</div>
        </div>`;
      row.addEventListener('click', () => {
        player.playTrack(t, tracks);
        if (mobileMiniDock) mobileMiniDock.style.display = 'flex';
        showToast(`Playing ${t.title}`);
      });
      list.appendChild(row);
    });

    const close = () => {
      overlay.classList.remove('active');
      setTimeout(() => overlay.remove(), 200);
    };
    document.getElementById('plPreviewClose').addEventListener('click', close);
    overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); });

    document.getElementById('plPreviewPlay').addEventListener('click', () => {
      if (!tracks.length) return;
      player.playTrack(tracks[0], tracks);
      if (mobileMiniDock) mobileMiniDock.style.display = 'flex';
      showToast(`Playing "${data.name}"`);
    });

    document.getElementById('plPreviewAdd').addEventListener('click', function () {
      const api = window.SimpMusicPlaylists;
      if (!api) return;
      const existing = api.all().find(p => !p.virtual && p.name === data.name);
      const saved = existing || api.create(data.name);
      if (!existing) {
        tracks.forEach(t => api.addTrack(saved.id, t));
      }
      api.renderMobile();
      api.renderDesktop();
      this.textContent = existing ? '✓ Already in Library' : '✓ Added';
      this.disabled = true;
      showToast(existing ? `"${data.name}" is already in your Library` : `"${data.name}" saved to Library (${tracks.length} songs)`);
    });
  }

  function renderArtistResults(items, query) {
    if (!mobileSearchResultsList) return;
    mobileSearchPrefillActive = false;
    if (mobileSearchResultsStatus) {
      mobileSearchResultsStatus.textContent = query
        ? `ARTISTS FOR "${query}" (${items.length})`
        : 'ARTISTS';
    }
    if (!items.length) {
      mobileSearchResultsList.innerHTML = `<div style="text-align:center; padding:30px; color:#71717a;"><div style="font-size:1.8rem; margin-bottom:8px;">🎤</div><div style="color:#fff; font-weight:600;">No artists found${query ? ` for "${escapeHtml(query)}"` : ''}</div></div>`;
      return;
    }

    // v3.21.1: the web backend has no artist-filtered search, so on the PWA
    // this list arrives as SONGS — derive the unique artists from it rather
    // than rendering rows with an undefined name.
    const artists = [];
    const seenNames = {};
    const addArtist = (name, subs, thumbnail) => {
      const clean = String(name || '').trim();
      if (!clean || clean.length > 60 || seenNames[clean.toLowerCase()]) return;
      seenNames[clean.toLowerCase()] = true;
      artists.push({
        name: clean,
        subs: subs || 0,
        thumbnail: thumbnail || ''
      });
    };
    items.forEach(it => {
      if (!it) return;
      // Real artist rows (native search) carry `name` directly.
      if (it.name) { addArtist(it.name, it.subs, it.thumbnail); return; }
      // Web fallback returns SONGS: a song's `artist` is a credit list
      // ("Anirudh Ravichander & Arunraja Kamaraj"), so split it into
      // individual names — otherwise searching an artist shows everyone
      // EXCEPT them.
      const thumb = it.thumbnail || (it.videoId
        ? 'https://i.ytimg.com/vi/' + it.videoId + '/hqdefault.jpg' : '');
      String(it.artist || '').split(/\s*(?:,|&|feat\.?|ft\.?|x|\||•)\s*/i)
        .forEach(n => addArtist(n, 0, thumb));
    });
    // Put the names that match what was typed first.
    if (query) {
      const q = query.toLowerCase();
      artists.sort((a, b) => {
        const am = a.name.toLowerCase().includes(q) ? 0 : 1;
        const bm = b.name.toLowerCase().includes(q) ? 0 : 1;
        return am - bm;
      });
    }
    artists.forEach(a => {
      const item = document.createElement('div');
      item.className = 'mobile-search-item';
      const subs = a.subs > 0 ? (a.subs >= 1e6 ? (a.subs / 1e6).toFixed(1) + 'M' : a.subs >= 1e3 ? Math.round(a.subs / 1e3) + 'K' : String(a.subs)) + ' subscribers' : 'Artist';
      item.innerHTML = `
        <img class="mobile-search-thumb" style="border-radius:50%; object-fit:cover;" src="${escapeHtml(a.thumbnail || '')}" onerror="this.style.visibility='hidden'" />
        <div class="mobile-search-info">
          <div class="mobile-search-item-title">${escapeHtml(a.name)}</div>
          <div class="mobile-search-item-meta">🎤 ${escapeHtml(subs)}</div>
        </div>
        <button class="mobile-search-play-btn" title="Play songs" style="background:rgba(168,85,247,0.3); font-size:0.68rem; padding:6px 10px; border-radius:999px;">Play</button>
      `;
      // v3.21.1: tapping the artist opens their page (top songs + albums) —
      // the same sheet you get by tapping an artist name anywhere else.
      item.addEventListener('click', () => {
        if (window.SimpMusicArtist) {
          window.SimpMusicArtist.open(a.name);
        } else {
          showToast('Artist pages are unavailable in this build');
        }
      });
      // The Play button keeps the old one-tap behaviour: queue the songs.
      item.querySelector('.mobile-search-play-btn').addEventListener('click', async (e) => {
        e.stopPropagation();
        showToast(`Playing songs by ${a.name}…`);
        const results = (await nativeSearch(a.name + ' songs', 10000, 'songs')) || [];
        if (results.length && results[0].videoId) {
          player.playTrack(results[0], results);
          if (mobileMiniDock) mobileMiniDock.style.display = 'flex';
        } else {
          showToast('No songs found for this artist');
        }
      });
      mobileSearchResultsList.appendChild(item);
    });
  }
  // =====================================================================
  // v3.14: language-aware "Discover Music" prefill for the Search tab.
  //
  // 1. Languages picked in the language picker dominate the mix (user with
  //    only Tamil selected gets only Tamil songs).
  // 2. Taste inference: languages the user actually LISTENS to (detected
  //    from history) but didn't pick earn a proportional slice — choose
  //    Tamil, listen to English, and Discover starts mixing both.
  // 3. Reco picks + trending fill the rest, shuffled fresh on every open.
  // =====================================================================

  const LANG_TOKENS = {
    tamil: ['tamil', 'kollywood'],
    hindi: ['hindi', 'bollywood'],
    telugu: ['telugu', 'tollywood'],
    malayalam: ['malayalam', 'mollywood'],
    kannada: ['kannada', 'sandalwood'],
    marathi: ['marathi'],
    punjabi: ['punjabi', 'punjwood']
  };

  // Indic Unicode ranges — script detection is far more reliable than
  // keywords for regional songs (v3.14.1).
  const LANG_SCRIPTS = [
    ['tamil', /[\u0B80-\u0BFF]/],
    ['hindi', /[\u0900-\u097F]/],
    ['telugu', /[\u0C00-\u0C7F]/],
    ['malayalam', /[\u0D00-\u0D7F]/],
    ['kannada', /[\u0C80-\u0CFF]/],
    ['punjabi', /[\u0A00-\u0A7F]/]
  ];

  function detectLanguage(track) {
    if (!track) return null;
    const hay = ((track.title || '') + ' ' + (track.artist || '') + ' ' + (track.album || '')).toLowerCase();
    // 1. Indic script in the metadata → that language, near-certain.
    for (const [lang, re] of LANG_SCRIPTS) {
      if (re.test(hay)) return lang;
    }
    // 2. Language keywords ("(Tamil)", "Tollywood", …).
    for (const [lang, tokens] of Object.entries(LANG_TOKENS)) {
      for (const tok of tokens) {
        const re = new RegExp('(^|[^a-z])' + tok + '([^a-z]|$)');
        if (re.test(hay)) return lang;
      }
    }
    // 3. Latin script with no Indian-language marker → English by far the
       // most likely (The Weeknd, Ed Sheeran, … never say "english" in the
       // title — v3.14.1 fixes their detection).
    if (/[a-z]/.test(hay)) return 'english';
    return null;
  }

  /**
   * Infer which languages the user actually listens to. Returns a weight
   * map: picked languages get weight 4, extra listened-but-unpicked
   * languages get weight 2 × (listen count share) — so a Tamil-only picker
   * user who has never played an English song sees pure Tamil, while one
   * who keeps playing English tracks gets an English slice too.
   */
  function inferLanguageTaste() {
    const picked = (window.SimpMusicCategories && window.SimpMusicCategories.get) ? (window.SimpMusicCategories.get() || []) : [];
    const listenCounts = {};
    try {
      const rec = JSON.parse(localStorage.getItem('simpmusic_recent_songs') || '[]');
      (Array.isArray(rec) ? rec : []).forEach(t => {
        const lang = detectLanguage(t);
        if (lang) listenCounts[lang] = (listenCounts[lang] || 0) + 1;
      });
    } catch (e) {}
    const weights = {};
    picked.slice(0, 4).forEach(l => { weights[l] = (weights[l] || 0) + 4; });
    // v3.14.1: each listened-but-unpicked language earns weight proportional
    // to how much of the listening it covers, up to 3 (just under a picked
    // language's 4) — Tamil picker + heavy English listening ⇒ roughly 60/40.
    let maxExtra = 0;
    Object.entries(listenCounts).forEach(([lang, count]) => {
      if (!picked.includes(lang)) maxExtra = Math.max(maxExtra, count);
    });
    if (maxExtra > 0) {
      Object.entries(listenCounts).forEach(([lang, count]) => {
        if (!picked.includes(lang)) {
          weights[lang] = (weights[lang] || 0) + 3 * (count / maxExtra);
        }
      });
    }
    return { picked, weights, listenCounts };
  }

  // Session cache so re-opening Search doesn't re-run native searches
  const _langDiscoverCache = {};
  const LANG_CACHE_TTL = 5 * 60 * 1000;

  function cachedLangSearch(lang, limit) {
    return new Promise(resolve => {
      const now = Date.now();
      const c = _langDiscoverCache[lang];
      if (c && now - c.at < LANG_CACHE_TTL && c.tracks.length) {
        resolve(c.tracks.slice(0, limit));
        return;
      }
      const cats = window.SimpMusicCategories;
      if (!cats || typeof cats.searchLanguage !== 'function') { resolve([]); return; }
      cats.searchLanguage(lang, limit + 6).then(tracks => {
        _langDiscoverCache[lang] = { at: now, tracks: tracks || [] };
        resolve((tracks || []).slice(0, limit));
      }).catch(() => resolve([]));
    });
  }

  /**
   * Async refined mix: quota per language from taste weights, tracks pulled
   * live via per-language search; remainder + failures fall back to the
   * reco/trending pool. Resolves with up to `size` tracks.
   */
  async function buildDiscoverMixRefined(size) {
    const { picked, weights } = inferLanguageTaste();
    const base = buildDiscoverMix(size); // instant pool (reco + trending)
    const out = [];
    const seen = new Set(base.slice(0, size).map(t => t.videoId));
    const baseQueue = base.slice(size); // extras for backfill

    const totalW = Object.values(weights).reduce((a, b) => a + b, 0);
    if (totalW > 0) {
      const entries = Object.entries(weights).sort((a, b) => b[1] - a[1]).slice(0, 4);
      const jobs = entries.map(([lang, w]) => {
        const quota = Math.max(1, Math.round(size * (w / totalW)));
        return cachedLangSearch(lang, quota).then(tracks => {
          (tracks || []).forEach(t => {
            if (t && t.videoId && !seen.has(t.videoId) && out.length < size) {
              seen.add(t.videoId);
              out.push(t);
            }
          });
        });
      });
      await Promise.all(jobs);
    }
    // Backfill from the instant pool if language fetches fell short (offline,
    // picker skipped, etc.) — the prefill is never empty.
    for (const t of baseQueue) {
      if (out.length >= size) break;
      if (t && t.videoId && !seen.has(t.videoId)) { seen.add(t.videoId); out.push(t); }
    }
    shuffleInPlace(out);
    return out.slice(0, size);
  }

  function shuffleInPlace(arr) {
    for (let i = arr.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [arr[i], arr[j]] = [arr[j], arr[i]];
    }
  }

  // v3.13: instant "Discover Music" mix for the Search tab prefill. Personal
  // recommendation picks first (history sections excluded — that's not
  // discovery), topped up with client-catalog trending. Rendered immediately;
  // the language-aware refinement (buildDiscoverMixRefined) replaces it a
  // moment later when the per-language searches return.
  function buildDiscoverMix(limit) {
    const size = limit || 12;
    const seen = new Set();
    const pool = [];
    try {
      const reco = window.SimpMusicReco;
      if (reco && typeof reco.getSections === 'function') {
        for (const s of (reco.getSections() || [])) {
          if (s.kind === 'recent') continue;
          for (const t of (s.tracks || [])) {
            if (t && t.videoId && !seen.has(t.videoId)) { seen.add(t.videoId); pool.push(t); }
          }
        }
      }
    } catch (e) { /* reco engine unavailable — trending below still fills */ }
    for (const t of (window.getClientTrending('global') || [])) {
      if (pool.length >= size + 8) break;
      if (t && t.videoId && !seen.has(t.videoId)) { seen.add(t.videoId); pool.push(t); }
    }
    shuffleInPlace(pool);
    return pool.slice(0, size + 8);
  }

  // v3.13: true while the Search tab is showing the discovery prefill (not
  // real search results) so re-opening the tab can rotate the mix.
  let mobileSearchPrefillActive = false;
  // v3.17: active search-type tab — 'songs' | 'playlists' | 'artists'
  let mobileSearchType = 'songs';
  // v3.17.1: bumped on every new search; stale (superseded) resolves are
  // dropped so a slow earlier search can never overwrite a newer one with
  // wrong-type results.
  let mobileSearchGen = 0;

  function renderMobileSearchResults(tracks, query) {
    if (!mobileSearchResultsList) return;
    mobileSearchPrefillActive = !query;
    mobileSearchResultsList.innerHTML = '';
    if (!tracks || tracks.length === 0) {
      if (mobileSearchResultsStatus) mobileSearchResultsStatus.textContent = 'NO RESULTS FOUND';
      mobileSearchResultsList.innerHTML = `
        <div style="text-align:center; padding:30px; color:#71717a;">
          <div style="font-size:1.8rem; margin-bottom:8px;">😕</div>
          <div style="color:#ffffff; font-weight:600; margin-bottom:4px;">No tracks found for "${escapeHtml(query)}"</div>
          <div style="font-size:0.8rem;">Try searching for artist name, song title, or genre.</div>
        </div>
      `;
      return;
    }

    if (mobileSearchResultsStatus) {
      mobileSearchResultsStatus.textContent = query
        ? `RESULTS FOR "${query}" (${tracks.length})`
        : `DISCOVER MUSIC (${tracks.length})`;
    }

    tracks.forEach(track => {
      const item = document.createElement('div');
      item.className = 'mobile-search-item';
      item.innerHTML = `
        <img class="mobile-search-thumb" src="${track.thumbnail}" alt="${escapeHtml(track.title)}" onerror="this.src='https://images.unsplash.com/photo-1511671782779-c97d3d27a1d4?w=200&auto=format&fit=crop&q=80'" />
        <div class="mobile-search-info">
          <div class="mobile-search-item-title">${escapeHtml(track.title)}</div>
          <div class="mobile-search-item-meta">${escapeHtml(track.artist)} • ${track.duration || '3:20'}</div>
        </div>
        <button class="mobile-search-play-btn" title="Play">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z"/></svg>
        </button>
        <button class="song-menu-btn" title="More" data-video="${escapeHtml(track.videoId)}" data-title="${escapeHtml(track.title)}" data-artist="${escapeHtml(track.artist)}" data-thumb="${escapeHtml(track.thumbnail || '')}" data-duration="${escapeHtml(track.duration || '')}" data-durationsec="${track.durationSec || 0}">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><circle cx="12" cy="5" r="2"/><circle cx="12" cy="12" r="2"/><circle cx="12" cy="19" r="2"/></svg>
        </button>
      `;
      item.addEventListener('click', (e) => {
        if (e.target.closest('.song-menu-btn')) return; // menu button handles itself
        player.playTrack(track, tracks);
        if (mobileMiniDock) mobileMiniDock.style.display = 'flex';
        showToast(`Playing ${track.title}`);
      });
      mobileSearchResultsList.appendChild(item);
    });
  }

  // ===================================================================
  // 4. Mobile Settings Controller
  // ===================================================================
  const mobileQualitySelector = document.getElementById('mobileQualitySelector');
  const mobileAutoplayToggle = document.getElementById('mobileAutoplayToggle');
  const mobileAutoLyricsToggle = document.getElementById('mobileAutoLyricsToggle');
  const mobileAmoledToggle = document.getElementById('mobileAmoledToggle');
  const mobileGlowToggle = document.getElementById('mobileGlowToggle');
  const mobileExportBtn = document.getElementById('mobileExportBtn');
  const mobileCopySyncBtn = document.getElementById('mobileCopySyncBtn');
  const mobileImportTriggerBtn = document.getElementById('mobileImportTriggerBtn');
  const mobileImportFileInput = document.getElementById('mobileImportFileInput');
  const mobileResetAllBtn = document.getElementById('mobileResetAllBtn');

  // Audio Quality Setting
  // v3.20.6: normalize before matching the buttons — a legacy stored "low"
  // value used to match no button at all, so the card showed nothing selected.
  const savedQuality = (typeof normalizeAudioQuality === 'function')
    ? normalizeAudioQuality(localStorage.getItem('simpmusic_audio_quality'))
    : (localStorage.getItem('simpmusic_audio_quality') || 'standard');
  if (mobileQualitySelector) {
    mobileQualitySelector.querySelectorAll('.mobile-quality-btn').forEach(btn => {
      if (btn.dataset.quality === savedQuality) btn.classList.add('active');
      else btn.classList.remove('active');

      btn.addEventListener('click', () => {
        mobileQualitySelector.querySelectorAll('.mobile-quality-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        // v3.12.2: route through the player so the native resolver switches
        // band immediately (old streams already playing keep their bitrate).
        if (window.player && window.player.setAudioQuality) {
          window.player.setAudioQuality(btn.dataset.quality);
        } else {
          localStorage.setItem('simpmusic_audio_quality', btn.dataset.quality);
        }
        showToast(`Audio quality set to ${btn.querySelector('.quality-label').textContent}`);
      });
    });
  }

  // AMOLED Black Mode Setting
  const isAmoled = localStorage.getItem('simpmusic_amoled') === 'true';
  if (isAmoled) document.body.classList.add('amoled-mode');
  if (mobileAmoledToggle) {
    mobileAmoledToggle.checked = isAmoled;
    mobileAmoledToggle.addEventListener('change', () => {
      document.body.classList.toggle('amoled-mode', mobileAmoledToggle.checked);
      localStorage.setItem('simpmusic_amoled', mobileAmoledToggle.checked);
      showToast(mobileAmoledToggle.checked ? 'AMOLED Pitch Black enabled' : 'AMOLED mode disabled');
    });
  }

  // Autoplay setting
  if (mobileAutoplayToggle) {
    mobileAutoplayToggle.checked = localStorage.getItem('simpmusic_autoplay') !== 'false';
    mobileAutoplayToggle.addEventListener('change', () => {
      localStorage.setItem('simpmusic_autoplay', mobileAutoplayToggle.checked);
      showToast(mobileAutoplayToggle.checked ? 'Autoplay enabled' : 'Autoplay disabled');
    });
  }

  // Auto lyrics setting
  if (mobileAutoLyricsToggle) {
    mobileAutoLyricsToggle.checked = localStorage.getItem('simpmusic_autolyrics') !== 'false';
    mobileAutoLyricsToggle.addEventListener('change', () => {
      localStorage.setItem('simpmusic_autolyrics', mobileAutoLyricsToggle.checked);
      showToast(mobileAutoLyricsToggle.checked ? 'Synchronized lyrics enabled' : 'Synchronized lyrics off');
    });
  }

  // Dynamic glow setting
  if (mobileGlowToggle) {
    mobileGlowToggle.checked = localStorage.getItem('simpmusic_glow') !== 'false';
    const glow1 = document.querySelector('.ambient-glow-1');
    const glow2 = document.querySelector('.ambient-glow-2');
    if (localStorage.getItem('simpmusic_glow') === 'false') {
      if (glow1) glow1.style.display = 'none';
      if (glow2) glow2.style.display = 'none';
    }
    mobileGlowToggle.addEventListener('change', () => {
      localStorage.setItem('simpmusic_glow', mobileGlowToggle.checked);
      if (glow1) glow1.style.display = mobileGlowToggle.checked ? 'block' : 'none';
      if (glow2) glow2.style.display = mobileGlowToggle.checked ? 'block' : 'none';
      showToast(mobileGlowToggle.checked ? 'Ambient glows enabled' : 'Ambient glows off (battery saver)');
    });
  }

  // Export / Copy Sync / Import on mobile (v3.11: full backup via SimpMusicBackup)
  if (mobileExportBtn) {
    mobileExportBtn.addEventListener('click', () => {
      if (window.SimpMusicBackup) window.SimpMusicBackup.export();
      else {
        const exportFileBtn = document.getElementById('exportFileBtn');
        if (exportFileBtn) exportFileBtn.click();
        else showToast('Exporting account backup...');
      }
    });
  }
  if (mobileCopySyncBtn) {
    mobileCopySyncBtn.addEventListener('click', () => {
      const copySyncCodeBtn = document.getElementById('copySyncCodeBtn');
      if (copySyncCodeBtn) copySyncCodeBtn.click();
      else showToast('Sync code copied!');
    });
  }
  if (mobileImportTriggerBtn && mobileImportFileInput) {
    mobileImportTriggerBtn.addEventListener('click', () => {
      if (window.SimpMusicBackup) { window.SimpMusicBackup.importViaPicker(); return; }
      mobileImportFileInput.click();
    });
    mobileImportFileInput.addEventListener('change', (e) => {
      const importFileInput = document.getElementById('importFileInput');
      if (importFileInput && e.target.files.length > 0) {
        importFileInput.files = e.target.files;
        const applyImportBtn = document.getElementById('applyImportBtn');
        if (applyImportBtn) applyImportBtn.click();
      }
    });
  }
  // New restore button (mobile Backup card, v3.11)
  const mobileBackupExportBtn = document.getElementById('mobileBackupExportBtn');
  const mobileBackupImportBtn = document.getElementById('mobileBackupImportBtn');
  if (mobileBackupExportBtn) {
    mobileBackupExportBtn.addEventListener('click', () => {
      if (window.SimpMusicBackup) window.SimpMusicBackup.export();
      else showToast('Backup engine not loaded');
    });
  }
  if (mobileBackupImportBtn) {
    mobileBackupImportBtn.addEventListener('click', () => {
      if (window.SimpMusicBackup) window.SimpMusicBackup.importViaPicker();
      else showToast('Backup engine not loaded');
    });
  }

  // v3.12: Crossfade chips
  const crossfadeSelector = document.getElementById('crossfadeSelector');
  if (crossfadeSelector) {
    const currentCf = (window.player && window.player.crossfadeSec) ||
      parseInt(localStorage.getItem('simpmusic_crossfade') || '0', 10) || 0;
    crossfadeSelector.querySelectorAll('.mobile-quality-btn').forEach(btn => {
      if (parseInt(btn.dataset.cf, 10) === currentCf) btn.classList.add('active');
      btn.addEventListener('click', () => {
        crossfadeSelector.querySelectorAll('.mobile-quality-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        const sec = window.player ? window.player.setCrossfade(btn.dataset.cf)
                                  : parseInt(btn.dataset.cf, 10);
        showToast(sec > 0 ? `Crossfade set to ${sec}s` : 'Crossfade off');
      });
    });
  }

  // v3.16: Sleep timer chips
  const sleepTimerSelector = document.getElementById('sleepTimerSelector');
  if (sleepTimerSelector) {
    let sleepMode = 'off';
    try {
      sleepMode = (JSON.parse(localStorage.getItem('simpmusic_sleep') || '{}').mode) || 'off';
    } catch (e) {}
    const statusEl = document.getElementById('sleepTimerStatus');
    const markChips = () => {
      sleepTimerSelector.querySelectorAll('.mobile-quality-btn').forEach(b => {
        b.classList.toggle('active', b.dataset.sleep === sleepMode);
      });
      if (statusEl) {
        statusEl.textContent = sleepMode === 'off'
          ? ''
          : (sleepMode === 'eot' ? '⏳ Will pause at the end of the current song' : `⏳ Will pause in about ${sleepMode} minutes (fades out at the end)`);
      }
    };
    sleepTimerSelector.querySelectorAll('.mobile-quality-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        sleepMode = btn.dataset.sleep;
        if (sleepMode === 'off') {
          window.player.setSleepTimer({});
          showToast('Sleep timer off');
        } else if (sleepMode === 'eot') {
          window.player.setSleepTimer({ endOfTrack: true });
          showToast('Pausing at the end of this song 😴');
        } else {
          window.player.setSleepTimer({ minutes: parseInt(sleepMode, 10) });
          showToast(`Music stops in ${sleepMode} minutes 😴`);
        }
        markChips();
      });
    });
    markChips();
    // Live status: clear the chips when the timer fires
    player.on('sleepdone', () => {
      sleepMode = 'off';
      try { localStorage.removeItem('simpmusic_sleep'); } catch (e) {}
      markChips();
      showToast('😴 Sleep timer — music paused. Good night!');
    });

    // v3.16.1: custom minutes input (1–720)
    const customInput = document.getElementById('sleepCustomMinutes');
    const customBtn = document.getElementById('sleepCustomSetBtn');
    if (customInput && customBtn) {
      const applyCustom = () => {
        const mins = parseInt(customInput.value, 10);
        if (!mins || mins < 1 || mins > 720) {
          showToast('Enter minutes between 1 and 720');
          return;
        }
        sleepMode = String(mins);
        window.player.setSleepTimer({ minutes: mins });
        markChips();
        showToast(`Music stops in ${mins} minute${mins > 1 ? 's' : ''} 😴`);
        customInput.blur();
      };
      customBtn.addEventListener('click', applyCustom);
      customInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') applyCustom(); });
    }
  }

  // v3.12: Queue sheet openers (mini dock + iPod "Up Next")
  const mobileMiniQueueBtn = document.getElementById('mobileMiniQueueBtn');
  const ipodQueueBtn = document.getElementById('ipodQueueBtn'); // v3.12.4: pill removed from iPod; kept for mini-dock compatibility
  if (mobileMiniQueueBtn) {
    mobileMiniQueueBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      if (window.SimpMusicQueue) window.SimpMusicQueue.toggle();
    });
  }

  // Wipe All Data
  if (mobileResetAllBtn) {
    mobileResetAllBtn.addEventListener('click', () => {
      if (confirm('Are you sure you want to wipe all local data (likes, recent songs, cached playlists) on this device?')) {
        localStorage.clear();
        showToast('All local data wiped. Reloading...');
        setTimeout(() => window.location.reload(), 800);
      }
    });
  }

  // ===================================================================
  // iPod Classic Click Wheel Engine
  // ===================================================================
  function playClickHaptic() {
    try {
      const AudioContext = window.AudioContext || window.webkitAudioContext;
      if (!AudioContext) return;
      const ctx = new AudioContext();
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'triangle';
      osc.frequency.setValueAtTime(800, ctx.currentTime);
      gain.gain.setValueAtTime(0.05, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.04);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start();
      osc.stop(ctx.currentTime + 0.04);
    } catch (e) {}
  }

  if (wheelShuffleBtn) {
    // v3.15.1: iPod-style mode cycle on the wheel's top button:
    //   normal → Shuffle ON → Repeat this song (one) → normal
    // The icon swaps between the shuffle and repeat glyphs and the dock's
    // shuffle/repeat buttons stay in sync with the same player state.
    const wheelShuffleIcon = wheelShuffleBtn.innerHTML;
    const wheelRepeatIcon = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><polyline points="17 1 21 5 17 9"/><path d="M3 11V9a4 4 0 0 1 4-4h14"/><polyline points="7 23 3 19 7 15"/><path d="M21 13v2a4 4 0 0 1-4 4H3"/></svg>';

    function syncModeButtons() {
      const sh = !!player.shuffle;
      const rp = player.repeatMode === 'one';
      wheelShuffleBtn.classList.toggle('active', sh || rp);
      wheelShuffleBtn.innerHTML = rp ? wheelRepeatIcon : wheelShuffleIcon;
      wheelShuffleBtn.title = sh ? 'Mode: Shuffle' : (rp ? 'Mode: Repeat song' : 'Mode: Normal');
      if (shuffleBtn) shuffleBtn.classList.toggle('active', sh);
      if (repeatBtn) {
        repeatBtn.classList.toggle('active', player.repeatMode !== 'off');
        repeatBtn.title = `Repeat: ${String(player.repeatMode).toUpperCase()}`;
      }
    }

    function setRepeatMode(mode) {
      // toggleRepeat cycles off→all→one→off; step until the wanted mode.
      const modes = ['off', 'all', 'one'];
      let guard = 3;
      while (player.repeatMode !== mode && guard-- > 0) player.toggleRepeat();
      return modes.indexOf(mode) >= 0;
    }

    wheelShuffleBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      playClickHaptic();
      if (player.shuffle) {
        // Shuffle ON → Repeat this song
        player.toggleShuffle(); // shuffle OFF first (they are exclusive here)
        setRepeatMode('one');
        showToast('Repeat: this song 🔁');
      } else if (player.repeatMode === 'one') {
        // Repeat song → back to normal
        setRepeatMode('off');
        showToast('Normal playback');
      } else {
        // Normal → Shuffle ON
        player.toggleShuffle();
        showToast('Shuffle ON 🔀');
      }
      syncModeButtons();
    });

    // Keep the wheel in step when shuffle/repeat change elsewhere (dock buttons)
    player.on('shuffletoggle', syncModeButtons);
    player.on('repeatmodechange', syncModeButtons);
    syncModeButtons();
  }

  if (wheelPrevBtn) {
    wheelPrevBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      playClickHaptic();
      player.previous();
    });
  }

  if (wheelNextBtn) {
    wheelNextBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      playClickHaptic();
      player.next();
    });
  }

  if (wheelPlayBtn) {
    wheelPlayBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      playClickHaptic();
      player.togglePlay();
    });
  }

  if (wheelCenterBtn) {
    wheelCenterBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      playClickHaptic();
      player.togglePlay();
    });
  }

  // iPod Timeline Scrubber — v3.7: same free-drag behavior as the dock bar.
  if (ipodProgressRail) {
    ipodProgressRail.addEventListener('pointerdown', (e) => {
      if (!player.duration || player.duration <= 0) return;
      ipodSeeking = true;
      const pos = railPos(e, ipodProgressRail);
      ipodProgressFill.style.width = `${pos * 100}%`;
      ipodProgressThumb.style.left = `${pos * 100}%`;
      if (ipodCurrentTime) ipodCurrentTime.textContent = formatTime(pos * player.duration);
      e.preventDefault();
    });
    window.addEventListener('pointermove', (e) => {
      if (!ipodSeeking) return;
      const pos = railPos(e, ipodProgressRail);
      ipodProgressFill.style.width = `${pos * 100}%`;
      ipodProgressThumb.style.left = `${pos * 100}%`;
      if (ipodCurrentTime) ipodCurrentTime.textContent = formatTime(pos * player.duration);
    });
    window.addEventListener('pointerup', (e) => {
      if (!ipodSeeking) return;
      ipodSeeking = false;
      if (player.duration > 0) player.seekTo(railPos(e, ipodProgressRail) * player.duration);
    });
    ipodProgressRail.addEventListener('click', (e) => {
      if (player.duration > 0) player.seekTo(railPos(e, ipodProgressRail) * player.duration);
    });
  }

  // Rotary Wheel Dragging Interaction — v3.8: gestures that START on a
  // wheel button belong to the button (tap), never to the ring scrub.
  // Previously a button press also armed the ring listener: micro-movement
  // of the finger produced rapid seek ticks + click sounds, so one tap felt
  // like every button fired at once. Now the ring only arms after the finger
  // moves ≥14px, proving it's a scrub and not a tap.
  let isDraggingWheel = false;
  let wheelStart = null;
  let lastAngle = 0;

  function calculateWheelAngle(e) {
    if (!ipodClickWheel) return 0;
    const rect = ipodClickWheel.getBoundingClientRect();
    const cx = rect.left + rect.width / 2;
    const cy = rect.top + rect.height / 2;
    const clientX = e.touches ? e.touches[0].clientX : e.clientX;
    const clientY = e.touches ? e.touches[0].clientY : e.clientY;
    return Math.atan2(clientY - cy, clientX - cx) * (180 / Math.PI);
  }

  if (ipodClickWheel) {
    ipodClickWheel.addEventListener('pointerdown', (e) => {
      // Buttons handle themselves — never arm the ring scrub from them.
      if (e.target.closest('.wheel-btn') || e.target.closest('.wheel-center-btn')) return;
      wheelStart = { x: e.clientX, y: e.clientY, maxDist: 0 };
      isDraggingWheel = false; // not yet — wait for real movement
      lastAngle = calculateWheelAngle(e);
    }, true);

    window.addEventListener('pointermove', (e) => {
      if (wheelStart === null) return;
      const dx = e.clientX - wheelStart.x;
      const dy = e.clientY - wheelStart.y;
      wheelStart.maxDist = Math.max(wheelStart.maxDist, Math.hypot(dx, dy));
      if (!isDraggingWheel && wheelStart.maxDist < 14) return; // still a tap
      isDraggingWheel = true;
      const angle = calculateWheelAngle(e);
      let diff = angle - lastAngle;
      if (diff > 180) diff -= 360;
      if (diff < -180) diff += 360;

      if (Math.abs(diff) >= 12) {
        playClickHaptic();
        const delta = diff > 0 ? 4 : -4;
        player.seekTo(Math.max(0, Math.min(player.duration, player.currentTime + delta)));
        lastAngle = angle;
      }
    });

    window.addEventListener('pointerup', () => {
      isDraggingWheel = false;
      wheelStart = null;
    });

    // Buttons CLAIM the gesture at capture time so window-level pointermove
    // during a button press can never trigger ring-scrub seeking.
    document.querySelectorAll('.wheel-btn, .wheel-center-btn').forEach(btn => {
      btn.addEventListener('pointerdown', (e) => {
        e.stopPropagation();
        wheelStart = null;      // ring scrub definitely not armed
        isDraggingWheel = false;
      }, true);
    });
  }

  // =====================================================================
  // v3.19.4: NETWORK SPEED PILL (Home header) — replaces the old static
  // AD-FREE pill. Measures real throughput and lights the dot + 1–3 arcs:
  //   all grey     → offline   (dot AND arcs grey — fully grey pill)
  //   + inner arc  → low       (dot + 1 arc purple)
  //   + middle arc → medium    (dot + 2 arcs purple)
  //   + outer arc  → high      (dot + 3 arcs purple — fully purple)
  //=====================================================================
  const NET_PILL_TIERS = [
    { min: 5e6, arcs: 3 },   // high — fully purple
    { min: 1.5e6, arcs: 2 }, // medium
    { min: 0, arcs: 1 }      // low — anything online lights dot + arc1
  ];
  let _netPillTimer = null;

  function netPillSetLevel(level) {
    // level 0 = offline → EVERYTHING grey (arcs + dot). 1–3 = low/medium/high
    // → the dot plus that many arcs (inner → outer) turn purple; the rest dim.
    const parts = [
      document.getElementById('netDot'),
      document.getElementById('netArc1'),
      document.getElementById('netArc2'),
      document.getElementById('netArc3')
    ];
    parts.forEach((el, i) => {
      // level 0 → nothing lit (fully grey); level N → dot + N arcs lit.
      if (el) el.classList.toggle('net-on', level > 0 && i < level + 1);
    });
  }
  window.netPillSetLevel = netPillSetLevel;

  // v3.19.5: REAL throughput probe. The old version trusted navigator.
  //connection, but Android WebView reports "4g" for nearly every connection
  // (and keeps reporting it offline), so the pill was stuck on full. It also
  // tried fetch()+blob() on a no-cors response, whose body is unreadable —
  // that measured latency, not bandwidth.
  // v3.19.6: i.ytimg.com serves images with CORS enabled (verified on-device),
  // so we fetch with REAL byte counts: one warm-up request (absorbs DNS + TCP
  // + TLS), then THREE parallel ~64 KB fetches. Parallel transfers beat TCP
  // slow-start, so the wall-clock aggregate tracks the actual line rate
  // instead of hovering at the round-trip boundary (why 1/2/3 arcs flickered
  // with the single 55 KB probe).
  // ~260 KB per check, every 2 minutes — negligible on Wi-Fi.
  const NET_PROBE_URL = 'https://i.ytimg.com/vi/dQw4w9WgXcQ/maxresdefault.jpg'; // ≈ 64 KB

  function fetchBytes(url) {
    const ctl = new AbortController();
    const killer = setTimeout(() => ctl.abort(), 10000);
    return fetch(url, { cache: 'no-store', signal: ctl.signal })
      .then(r => {
        if (!r.ok) throw new Error('HTTP ' + r.status);
        return r.blob().then(b => b.size);
      })
      .finally(() => clearTimeout(killer));
  }

  function probeOnce(url, bytes) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      const t0 = performance.now();
      const done = (ok) => {
        const ms = performance.now() - t0;
        if (ok && ms > 0) resolve(bytes / (ms / 1000));
        else reject(new Error('probe failed'));
      };
      img.onload = () => done(true);
      img.onerror = () => done(false);
      img.src = url;
      setTimeout(() => done(false), 8000); // hard timeout
    });
  }

  async function measureNetSpeed() {
    // v3.20.7: the pill used to grey out purely on `navigator.onLine === false`.
    // In the Android WebView that flag (and the `online` event) can stay wrong
    // long after the network is back, which pinned the pill fully grey. The
    // verdict now comes from SimpMusicNet, which probes for real; we only
    // confirm once more before greying out, so a stale flag can't stick.
    const net = window.SimpMusicNet;
    if (net && typeof net.isOffline === 'function' && net.isOffline()) {
      const ok = typeof net.verify === 'function' ? await net.verify(true) : false;
      if (!ok) return 'offline';
    } else if (!net && navigator.onLine === false) {
      return 'offline';
    }
    // 1) Warm up the connection (one throwaway ~64 KB load).
    try { await fetchBytes(NET_PROBE_URL + '?warm=' + Date.now()); } catch (e) {}
    // 2) Three parallel downloads — real bytes ÷ wall time. One retry if the
    //    whole batch fails (ytimg occasionally rate-limits burst requests).
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const tag = Date.now() + '-' + attempt;
        const t0 = performance.now();
        const sizes = await Promise.allSettled([
          fetchBytes(NET_PROBE_URL + '?p=' + tag + '-0'),
          fetchBytes(NET_PROBE_URL + '?p=' + tag + '-1'),
          fetchBytes(NET_PROBE_URL + '?p=' + tag + '-2')
        ]);
        const bytes = sizes.reduce((s, r) => s + (r.status === 'fulfilled' ? r.value : 0), 0);
        const ms = performance.now() - t0;
        if (bytes > 10000 && ms > 0) {
          window.__lastNetMeasure = { src: 'parallel', bps: bytes * 8 / (ms / 1000), bytes, ms: Math.round(ms) };
          return bytes * 8 / (ms / 1000);
        }
      } catch (e) { /* fall through */ }
    }
    // 3) CORS fetch unavailable → tiny Image probes (rough, RTT-bound).
    const legacy = [];
    for (let i = 0; i < 3; i++) {
      const file = i < 2 ? 'sddefault.jpg' : 'hqdefault.jpg';
      try {
        legacy.push(await probeOnce('https://i.ytimg.com/vi/dQw4w9WgXcQ/' + file + '?x=' + Date.now() + '-' + i, (i < 2 ? 55 : 24) * 1000 * 8));
      } catch (e) { /* keep going */ }
    }
    if (legacy.length) {
      window.__lastNetMeasure = { src: 'legacy', bps: Math.max.apply(null, legacy) };
      return Math.max.apply(null, legacy);
    }
    // 4) All probes failed → Network Information API as last resort. Android
    //    WebView reports "4g"/10 Mbps even on unusable networks, so a guess is
    //    never allowed to claim medium/high: unknown-but-online shows "low".
    try {
      const conn = navigator.connection || navigator.mozConnection || navigator.webkitConnection;
      if (conn && (conn.effectiveType === '2g' || conn.effectiveType === 'slow-2g')) {
        window.__lastNetMeasure = { src: 'api', bps: 8e4 };
        return 8e4; // very slow per API
      }
    } catch (e) {}
    window.__lastNetMeasure = { src: 'unknown', bps: 6e5 };
    return 6e5; // unknown but online → "low" (never trust API guesses)
  }

  async function updateNetPill(force) {
    if (!document.getElementById('mobileNetPill')) return;
    if (_netPillTimer) return;
    _netPillTimer = setTimeout(() => { _netPillTimer = null; }, 10000); // throttle 10s
    const bps = await measureNetSpeed();
    if (bps === 'offline') { netPillSetLevel(0); return; }
    const tier = NET_PILL_TIERS.find(t => bps >= t.min);
    netPillSetLevel(tier ? tier.arcs : 1);
  }
  window.updateNetPill = updateNetPill;

  // Re-measure on network changes + every 2 min, and paint once at startup.
  (function initNetPill() {
    if (!document.getElementById('mobileNetPill')) return;
    try {
      const conn = navigator.connection || navigator.mozConnection || navigator.webkitConnection;
      if (conn && conn.addEventListener) {
        conn.addEventListener('change', () => updateNetPill(true));
      }
      window.addEventListener('online', () => updateNetPill(true));
      window.addEventListener('offline', () => netPillSetLevel(0));
      // v3.20.7: re-measure when the app comes back to the foreground — the
      // WebView can miss the `online` event entirely while it is frozen, which
      // left the pill grey until the next 2-minute tick.
      document.addEventListener('visibilitychange', () => {
        if (!document.hidden) updateNetPill(true);
      });
      window.addEventListener('focus', () => updateNetPill(true));
      setInterval(() => updateNetPill(true), 120000);
    }
    catch (e) {}
    updateNetPill(true);
  })();

  // Initial Mobile Ecosystem Initialization
  renderMobileRecentSongs();
  renderMobileSearchHistory();
  updateDeviceProfileUI();
  loadCurrentTrending(); // v3.15: home-page Current Trending section
  loadChartPlaylists(); // v3.18: home-page Trending Playlists (charts)

  // v3.12.3: restore the LAST LISTENED song into the player UI on launch
  // (metadata only — nothing auto-plays). This replaces the hardcoded
  // "lovely (with Khalid)" placeholder.
  const lastTrack = lastListenedTrack();
  if (lastTrack) {
    updateHeroDetails(lastTrack);
    updateMediaSessionMetadataSafe(lastTrack);
    // Also fill the dock + vinyl labels (they default to "Select a track…")
    const dockTitle = document.getElementById('dockTitle');
    const dockArtist = document.getElementById('dockArtist');
    if (dockTitle) dockTitle.textContent = lastTrack.title;
    if (dockArtist) dockArtist.textContent = lastTrack.artist;
    const vinylTitle = document.getElementById('vinylTitle');
    const vinylArtist = document.getElementById('vinylArtist');
    if (vinylTitle) vinylTitle.textContent = lastTrack.title;
    if (vinylArtist) vinylArtist.textContent = lastTrack.artist;
  } else {
    updateHeroDetails(idleStartupTrack);
  }

  // --- Responsive mode management (mobile routing <-> desktop CSS) ---
  // Touch devices (phones/tablets) use the mobile layout at ANY width —
  // landscape included — so every phone renders identically.
  const MOBILE_BP = {
    matches: isMobileLayout(),
    addEventListener: function (fn) {
      const wq = window.matchMedia('(max-width: 900px)');
      const pq = window.matchMedia('(pointer: coarse)');
      const handler = () => { this.matches = isMobileLayout(); fn(); };
      wq.addEventListener('change', handler);
      pq.addEventListener && pq.addEventListener('change', handler);
      window.addEventListener('resize', handler);
    }
  };

  function applyResponsiveMode() {
    if (MOBILE_BP.matches) {
      switchMobileView('home');
    } else {
      // Desktop mode: clear every mobile-routing inline style so the CSS
      // responsive rules take over again (prevents leaked display:none)
      ['mobileHomeView', 'mobileSearchView', 'mobileSettingsView', 'mobileLibraryView', 'desktopTracklistView', 'desktopPlaylistsView'].forEach(id => {
        const el = document.getElementById(id);
        if (el) el.style.display = '';
      });
      if (settingsView) settingsView.style.display = '';
    }
  }

  applyResponsiveMode();

  // Re-evaluate when crossing the breakpoint (rotation, window resize)
  if (typeof MOBILE_BP.addEventListener === 'function') {
    MOBILE_BP.addEventListener('change', applyResponsiveMode);
  } else if (typeof MOBILE_BP.addListener === 'function') {
    MOBILE_BP.addListener(applyResponsiveMode); // older Safari
  }

  // Initial Load with automatic network probing (Loads sweetener playlist by default)
  if (typeof probeBackend === 'function') {
    probeBackend().then(() => {
      loadTrending('sweetener');
    }).catch(() => {
      loadTrending('sweetener');
    });
  } else {
    loadTrending('sweetener');
  }

});
