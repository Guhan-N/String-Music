/**
 * SimpMusic Main Web Application Controller
 * Handles UI interactions, search, recommendations, playlists, and keyboard shortcuts
 */

document.addEventListener('DOMContentLoaded', () => {
  // Initialize Core Engines
  const player = new MusicPlayer();
  const lyrics = new LyricsController(player);

  // State Management
  let currentTracks = [];
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

  const defaultLovelyTrack = {
    videoId: 'V1Pl8CzNzCw',
    title: 'lovely (with Khalid)',
    artist: 'Billie Eilish',
    album: 'Sweetener',
    duration: '3:20',
    durationSec: 200,
    thumbnail: 'icons/sweetener_cover.png'
  };

  // Update Hero & Cards with track metadata
  function updateHeroDetails(track) {
    const t = track || defaultLovelyTrack;
    if (heroCoverImg) heroCoverImg.src = t.thumbnail || 'icons/sweetener_cover.png';
    if (heroTitle) heroTitle.textContent = t.title || 'lovely (with Khalid)';
    if (heroArtist) heroArtist.textContent = t.artist || 'Billie Eilish';
    if (heroCategory) heroCategory.textContent = t.album || 'Sweetener';

    // Update Mobile Screen 2 elements
    if (mobileHeroThumb) mobileHeroThumb.src = t.thumbnail || 'icons/sweetener_cover.png';
    if (mobileHeroTitle) mobileHeroTitle.textContent = t.title || 'lovely (with Khalid)';
    if (mobileMiniThumb) mobileMiniThumb.src = t.thumbnail || 'icons/sweetener_cover.png';
    if (mobileMiniTitle) mobileMiniTitle.textContent = t.title || 'lovely (with Khalid)';
    if (mobileMiniArtist) mobileMiniArtist.textContent = t.artist || 'Billie Eilish';

    // Update iPod Screen 1 elements
    if (ipodCoverImg) ipodCoverImg.src = t.thumbnail || 'icons/sweetener_cover.png';
    if (ipodTitle) ipodTitle.textContent = t.title || 'lovely (with Khalid)';
    if (ipodArtist) ipodArtist.textContent = t.artist || 'Billie Eilish';
    if (ipodAlbumTag) ipodAlbumTag.textContent = (t.album || 'SWEETENER').toUpperCase();
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
          <div class="track-row-artist" title="${track.artist}">${track.artist}</div>
        </div>
        <button class="track-row-menu" title="Options">⋮</button>
      `;

      row.addEventListener('click', (e) => {
        if (e.target.classList.contains('track-row-menu')) {
          e.stopPropagation();
          showToast(`Options: ${track.title}`);
          return;
        }
        player.playTrack(track, tracks);
        updateActivePlayingRow(track.videoId);
      });

      fragment.appendChild(row);
    });

    numberedTracklist.appendChild(fragment);

    // Setup Hero Banner: Use currently playing track, or top track if searching, or default lovely (with Khalid)
    const featured = player.currentTrack || (isSearch ? tracks[0] : defaultLovelyTrack);
    updateHeroDetails(featured);

    if (heroLikeBtn) {
      heroLikeBtn.onclick = () => {
        toggleLike(player.currentTrack || featured);
        showToast(`Added to Liked Songs`);
      };
    }
    if (heroDownloadBtn) {
      heroDownloadBtn.onclick = () => {
        showToast(`Saved "${(player.currentTrack || featured).title}" offline`);
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

    // If on mobile screen, toggle tracklist view so search results are prominent
    if (window.innerWidth <= 900) {
      if (desktopTracklistView) desktopTracklistView.style.display = 'block';
      if (mobileHomeView) mobileHomeView.style.display = 'none';
    }
    isSearchActive = true;

    // Show immediate search loading in hero banner and tracklist
    if (heroCategory) heroCategory.textContent = 'SEARCH';
    if (heroTitle) heroTitle.textContent = `"${cleanQ}"`;
    if (heroArtist) heroArtist.textContent = 'Searching YouTube Music...';
    if (numberedTracklist) {
      numberedTracklist.innerHTML = `
        <div style="text-align: center; padding: 60px 20px; color: var(--text-muted);">
          <div style="font-size: 2rem; margin-bottom: 12px; display: inline-block;">🔍</div>
          <p style="font-size: 1rem; color: #ffffff; margin-bottom: 6px;">Searching YouTube Music for "${cleanQ}"...</p>
          <span style="font-size: 0.8rem; color: var(--text-muted);">Scanning global catalog & live streams</span>
        </div>
      `;
    }

    let results = null;

    // 1. Try backend server search
    if (!isCloudMode) {
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

  document.querySelectorAll('.nav-item').forEach(item => {
    item.addEventListener('click', () => {
      document.querySelectorAll('.nav-item').forEach(i => i.classList.remove('active'));
      item.classList.add('active');
      const view = item.dataset.view;

      if (view === 'settings') {
        if (browseView) browseView.style.display = 'none';
        if (settingsView) settingsView.style.display = 'flex';
        updateDeviceProfileUI();
      } else {
        if (browseView) browseView.style.display = 'block';
        if (settingsView) settingsView.style.display = 'none';

        if (view === 'home' || view === 'explore') {
          if (desktopTracklistView) desktopTracklistView.style.display = '';
          if (mobileHomeView) mobileHomeView.style.display = '';
          loadTrending(activeGenre);
        } else if (view === 'liked') {
          if (desktopTracklistView) desktopTracklistView.style.display = '';
          if (mobileHomeView) mobileHomeView.style.display = '';
          if (sectionTitle) sectionTitle.textContent = 'Liked Songs';
          if (heroCategory) heroCategory.textContent = 'LIBRARY';
          if (heroTitle) heroTitle.textContent = 'Liked Songs';
          if (heroArtist) heroArtist.textContent = `${likedSongs.length} favorite tracks`;
          currentTracks = likedSongs;
          renderTracks(likedSongs, true);
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

    if (idBadge) idBadge.textContent = deviceId;
    if (nameEl) nameEl.textContent = deviceName;
    if (platEl) platEl.textContent = navigator.userAgent.includes('Android') ? 'Android Device Account' : 'Web / Desktop Account';
    if (likesEl) likesEl.textContent = likedSongs.length;
    if (playEl) {
      const pl = JSON.parse(localStorage.getItem('simpmusic_playlists') || '[]');
      playEl.textContent = pl.length;
    }
    if (queueEl) queueEl.textContent = player.queue ? player.queue.length : 0;
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

  // Download Backup JSON file
  const exportFileBtn = document.getElementById('exportFileBtn');
  if (exportFileBtn) {
    exportFileBtn.addEventListener('click', () => {
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

      if (!dataToImport || !Array.isArray(dataToImport.likes)) {
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

      updateHeroDetails(track);
      updateActivePlayingRow(track.videoId);
      updateDockLikeState();
      lyrics.loadLyrics(track);
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

  player.on('timeupdate', ({ currentTime, duration }) => {
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
          <div class="queue-track-artist">${track.artist}</div>
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

  // Scrubber seeking
  let isSeeking = false;
  progressRail.addEventListener('click', (e) => {
    const rect = progressRail.getBoundingClientRect();
    const pos = (e.clientX - rect.left) / rect.width;
    const targetSec = pos * player.duration;
    player.seekTo(targetSec);
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
  function showToast(msg) {
    const toast = document.createElement('div');
    toast.style.cssText = `
      position: fixed;
      bottom: 110px;
      left: 50%;
      transform: translateX(-50%);
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
      transition: opacity 0.3s ease;
    `;
    toast.textContent = msg;
    document.body.appendChild(toast);
    setTimeout(() => {
      toast.style.opacity = '0';
      setTimeout(() => toast.remove(), 300);
    }, 2000);
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
    const cur = player.currentTrack || defaultLovelyTrack;
    updateHeroDetails(cur);
  }

  function closeIpodPlayer() {
    if (!ipodPlayerModal) return;
    ipodPlayerModal.classList.remove('open');
    ipodPlayerModal.style.display = 'none';
  }

  // iPod Back Button closes player
  if (ipodBackBtn) {
    ipodBackBtn.addEventListener('click', closeIpodPlayer);
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

  // Mobile Playlist Cards & Chips
  document.querySelectorAll('.mobile-playlist-card').forEach(card => {
    card.addEventListener('click', () => {
      const genre = card.dataset.genre || 'global';
      loadTrending(genre);
      showToast(`Loading ${card.querySelector('.card-text').innerText.replace('\n', ' ')}`);
    });
  });

  document.querySelectorAll('.mobile-chip').forEach(chip => {
    chip.addEventListener('click', () => {
      document.querySelectorAll('.mobile-chip').forEach(c => c.classList.remove('active'));
      chip.classList.add('active');
      const genre = chip.dataset.genre || 'sweetener';
      loadTrending(genre);
    });
  });

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
    wheelShuffleBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      playClickHaptic();
      const isShuff = player.toggleShuffle();
      wheelShuffleBtn.classList.toggle('active', isShuff);
      showToast(isShuff ? 'Shuffle ON' : 'Shuffle OFF');
    });
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

  // iPod Timeline Scrubber
  if (ipodProgressRail) {
    ipodProgressRail.addEventListener('click', (e) => {
      const rect = ipodProgressRail.getBoundingClientRect();
      const pos = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
      if (player.duration > 0) {
        player.seekTo(pos * player.duration);
      }
    });
  }

  // Rotary Wheel Dragging Interaction
  let isDraggingWheel = false;
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
      if (e.target.closest('.wheel-btn') || e.target.closest('.wheel-center-btn')) return;
      isDraggingWheel = true;
      lastAngle = calculateWheelAngle(e);
    });

    window.addEventListener('pointermove', (e) => {
      if (!isDraggingWheel) return;
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
    });
  }

  // Initial Load with automatic network probing (Loads sweetener playlist by default)
  probeHosts().then(() => {
    loadTrending('sweetener');
  });
});

