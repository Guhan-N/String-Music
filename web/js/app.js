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

      if (mobileMiniThumb) mobileMiniThumb.src = track.thumbnail;
      if (mobileMiniTitle) mobileMiniTitle.textContent = track.title;
      if (mobileMiniArtist) mobileMiniArtist.textContent = track.artist;

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

  // High quality starter songs if user has never played a song yet
  const defaultStarterRecents = [
    { videoId: '4NRXx6U8ABQ', title: 'Blinding Lights', artist: 'The Weeknd', album: 'After Hours', duration: '3:20', durationSec: 200, thumbnail: 'https://i.ytimg.com/vi/4NRXx6U8ABQ/hqdefault.jpg' },
    { videoId: 'DyDfgMOUjCI', title: 'bad guy', artist: 'Billie Eilish', album: 'Sweetener', duration: '3:14', durationSec: 194, thumbnail: 'https://i.ytimg.com/vi/DyDfgMOUjCI/hqdefault.jpg' },
    { videoId: 'JGwWNGJdvx8', title: 'Shape of You', artist: 'Ed Sheeran', album: 'Divide', duration: '3:53', durationSec: 233, thumbnail: 'https://i.ytimg.com/vi/JGwWNGJdvx8/hqdefault.jpg' },
    { videoId: 'OsfAnsMY21M', title: 'Levitating', artist: 'Dua Lipa', album: 'Future Nostalgia', duration: '3:23', durationSec: 203, thumbnail: 'https://i.ytimg.com/vi/OsfAnsMY21M/hqdefault.jpg' },
    { videoId: 'V1Pl8CzNzCw', title: 'lovely', artist: 'Billie Eilish, Khalid', album: '13 Reasons Why', duration: '3:20', durationSec: 200, thumbnail: 'https://i.ytimg.com/vi/V1Pl8CzNzCw/hqdefault.jpg' },
    { videoId: '3_g2un5M350', title: 'Starboy', artist: 'The Weeknd, Daft Punk', album: 'Starboy', duration: '3:50', durationSec: 230, thumbnail: 'https://i.ytimg.com/vi/3_g2un5M350/hqdefault.jpg' },
    { videoId: 'WMK3JXG3Fx0', title: 'Infinity', artist: 'Jaymes Young', album: 'Feel Something', duration: '3:58', durationSec: 238, thumbnail: 'https://i.ytimg.com/vi/WMK3JXG3Fx0/hqdefault.jpg' },
    { videoId: 'Ah0Ys50CqO8', title: 'you should see me in a crown', artist: 'Billie Eilish', album: 'Sweetener', duration: '3:01', durationSec: 181, thumbnail: 'https://i.ytimg.com/vi/Ah0Ys50CqO8/hqdefault.jpg' }
  ];

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

    const listToRender = (recentSongs && recentSongs.length > 0) ? recentSongs : defaultStarterRecents;

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
          <img class="mobile-v2-pick-img" src="${track.thumbnail}" alt="${escapeHtml(track.title)}" onerror="this.src='https://images.unsplash.com/photo-1511671782779-c97d3d27a1d4?w=200&auto=format&fit=crop&q=80'" />
          <div class="mobile-v2-pick-play-icon">
            <svg width="22" height="22" viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z"/></svg>
          </div>
        </div>
        <div class="mobile-v2-pick-name" title="${escapeHtml(track.title)}">${escapeHtml(track.title)}</div>
        <div class="mobile-v2-pick-sub" title="${escapeHtml(track.artist)}">${escapeHtml(track.artist)}</div>
      `;
      card.addEventListener('click', () => {
        player.playTrack(track, listToRender);
        if (mobileMiniDock) mobileMiniDock.style.display = 'flex';
        showToast(`Playing ${track.title}`);
      });
      return card;
    }

    row1Items.forEach(t => row1.appendChild(createRecentCard(t)));
    row2Items.forEach(t => row2.appendChild(createRecentCard(t)));
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
      if (e.target.closest('.mobile-v2-more-btn')) {
        e.stopPropagation();
        showToast(`Options: ${item.dataset.title || 'Song'}`);
        return;
      }
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
  const navHomeBtn = document.getElementById('mobileNavHomeBtn');
  const navSearchBtn = document.getElementById('mobileNavSearchBtn');
  const navPlaylistBtn = document.getElementById('mobileNavPlaylistBtn');
  const navProfileBtn = document.getElementById('mobileNavProfileBtn');
  const mobileSearchTrigger = document.getElementById('mobileSearchTrigger');
  const mobileSearchBackBtn = document.getElementById('mobileSearchBackBtn');
  const mobileSettingsBackBtn = document.getElementById('mobileSettingsBackBtn');
  const mobileHeaderSettingsBtn = document.getElementById('mobileHeaderSettingsBtn');

  function switchMobileView(viewName) {
    // Hide all main mobile subviews
    if (mobileHomeView) mobileHomeView.style.display = 'none';
    if (mobileSearchView) mobileSearchView.style.display = 'none';
    if (mobileSettingsView) mobileSettingsView.style.display = 'none';
    if (desktopTracklistView) desktopTracklistView.style.display = 'none';
    if (settingsView) settingsView.style.display = 'none';

    document.querySelectorAll('.mobile-v2-nav-item').forEach(b => b.classList.remove('active'));

    if (viewName === 'home') {
      if (mobileHomeView) mobileHomeView.style.display = 'block';
      navHomeBtn?.classList.add('active');
    } else if (viewName === 'search') {
      if (mobileSearchView) mobileSearchView.style.display = 'block';
      navSearchBtn?.classList.add('active');
      renderMobileSearchHistory();
      setTimeout(() => mobileSearchInput?.focus(), 150);
    } else if (viewName === 'library') {
      if (desktopTracklistView) desktopTracklistView.style.display = 'block';
      navPlaylistBtn?.classList.add('active');
      showToast('Viewing Library & Tracks');
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
      chip.innerHTML = `<span>🔍</span><span>${escapeHtml(term)}</span>`;
      chip.addEventListener('click', () => {
        if (mobileSearchInput) mobileSearchInput.value = term;
        performMobileSearch(term);
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
    mobileClearHistoryBtn.addEventListener('click', () => {
      mobileSearchHistory = [];
      localStorage.removeItem('simpmusic_search_history');
      renderMobileSearchHistory();
      showToast('Search history cleared');
    });
  }

  // Genre pills inside mobile search
  if (mobileSearchGenres) {
    mobileSearchGenres.querySelectorAll('.mobile-genre-pill').forEach(pill => {
      pill.addEventListener('click', () => {
        mobileSearchGenres.querySelectorAll('.mobile-genre-pill').forEach(p => p.classList.remove('active'));
        pill.classList.add('active');
        const genre = pill.dataset.genre;
        if (genre === 'all') {
          performMobileSearch('Top Global Songs');
        } else {
          performMobileSearch(`${genre} hits`);
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
        const allSongs = [...(CLIENT_CATALOG.global || []), ...(CLIENT_CATALOG.sweetener || [])];
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

  async function performMobileSearch(query) {
    if (!query || !query.trim()) return;
    const cleanQ = query.trim();
    addSearchHistory(cleanQ);
    if (mobileSearchSuggestions) mobileSearchSuggestions.classList.remove('active');
    if (mobileSearchResultsStatus) mobileSearchResultsStatus.textContent = `SEARCHING FOR "${cleanQ}"...`;
    if (mobileSearchResultsList) {
      mobileSearchResultsList.innerHTML = `
        <div style="text-align:center; padding:30px; color:#71717a;">
          <div style="font-size:1.5rem; margin-bottom:8px;">🔍</div>
          <div>Finding songs for "${escapeHtml(cleanQ)}"...</div>
        </div>
      `;
    }

    try {
      let results = [];
      if (!isCloudMode) {
        const searchEndpoint = API_BASE ? `${API_BASE}/api/search?q=${encodeURIComponent(cleanQ)}` : `/api/search?q=${encodeURIComponent(cleanQ)}`;
        const res = await fetch(searchEndpoint);
        if (res.ok) {
          results = await res.json();
        }
      }
      if (!results || results.length === 0) {
        // Standalone local client catalog search
        const allLocal = [...(CLIENT_CATALOG.global || []), ...(CLIENT_CATALOG.sweetener || [])];
        results = allLocal.filter(t => 
          t.title.toLowerCase().includes(cleanQ.toLowerCase()) ||
          t.artist.toLowerCase().includes(cleanQ.toLowerCase()) ||
          (t.album && t.album.toLowerCase().includes(cleanQ.toLowerCase()))
        );
        if (results.length === 0) {
          results = allLocal.slice(0, 8); // friendly fallback
        }
      }

      renderMobileSearchResults(results, cleanQ);
    } catch (err) {
      console.error('Mobile search error:', err);
      const allLocal = [...(CLIENT_CATALOG.global || []), ...(CLIENT_CATALOG.sweetener || [])];
      renderMobileSearchResults(allLocal.slice(0, 6), cleanQ);
    }
  }

  function renderMobileSearchResults(tracks, query) {
    if (!mobileSearchResultsList) return;
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
      mobileSearchResultsStatus.textContent = `RESULTS FOR "${query}" (${tracks.length})`;
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
      `;
      item.addEventListener('click', () => {
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
  const savedQuality = localStorage.getItem('simpmusic_audio_quality') || 'standard';
  if (mobileQualitySelector) {
    mobileQualitySelector.querySelectorAll('.mobile-quality-btn').forEach(btn => {
      if (btn.dataset.quality === savedQuality) btn.classList.add('active');
      else btn.classList.remove('active');

      btn.addEventListener('click', () => {
        mobileQualitySelector.querySelectorAll('.mobile-quality-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        localStorage.setItem('simpmusic_audio_quality', btn.dataset.quality);
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

  // Export / Copy Sync / Import on mobile
  if (mobileExportBtn) {
    mobileExportBtn.addEventListener('click', () => {
      const exportFileBtn = document.getElementById('exportFileBtn');
      if (exportFileBtn) exportFileBtn.click();
      else showToast('Exporting account backup...');
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
    mobileImportTriggerBtn.addEventListener('click', () => mobileImportFileInput.click());
    mobileImportFileInput.addEventListener('change', (e) => {
      const importFileInput = document.getElementById('importFileInput');
      if (importFileInput && e.target.files.length > 0) {
        importFileInput.files = e.target.files;
        const applyImportBtn = document.getElementById('applyImportBtn');
        if (applyImportBtn) applyImportBtn.click();
      }
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

  // Update profile and settings stats
  function updateDeviceProfileUI() {
    const statsLikesCount = document.getElementById('statsLikesCount');
    const statsQueueCount = document.getElementById('statsQueueCount');
    const mobileStatLikes = document.getElementById('mobileStatLikes');
    const mobileStatRecents = document.getElementById('mobileStatRecents');
    const mobileStatPlaylists = document.getElementById('mobileStatPlaylists');

    if (statsLikesCount) statsLikesCount.textContent = likedSongs.length;
    if (statsQueueCount) statsQueueCount.textContent = player.queue.length;
    if (mobileStatLikes) mobileStatLikes.textContent = likedSongs.length;
    if (mobileStatRecents) mobileStatRecents.textContent = recentSongs.length;
    if (mobileStatPlaylists) mobileStatPlaylists.textContent = '1';
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

  // Initial Mobile Ecosystem Initialization
  renderMobileRecentSongs();
  renderMobileSearchHistory();
  updateDeviceProfileUI();
  if (window.innerWidth <= 900) {
    switchMobileView('home');
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

