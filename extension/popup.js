/**
 * SimpMusic Extension Mini-Player Controller
 * Communicates with background service worker & offscreen audio player
 */

document.addEventListener('DOMContentLoaded', async () => {
  const API_BASE = 'http://localhost:3000';
  let currentTrack = null;
  let isPlaying = false;
  let queue = [];
  let currentIndex = 0;
  let lyricsList = [];
  let activeLyricIdx = -1;

  // Elements
  const popupSearch = document.getElementById('popupSearch');
  const popupTracksList = document.getElementById('popupTracksList');
  const popupLyricsStream = document.getElementById('popupLyricsStream');
  const playerThumb = document.getElementById('playerThumb');
  const playerTitle = document.getElementById('playerTitle');
  const playerArtist = document.getElementById('playerArtist');
  const popupPlayBtn = document.getElementById('popupPlayBtn');
  const popupPrevBtn = document.getElementById('popupPrevBtn');
  const popupNextBtn = document.getElementById('popupNextBtn');
  const popupCurTime = document.getElementById('popupCurTime');
  const popupDurTime = document.getElementById('popupDurTime');
  const popupRail = document.getElementById('popupRail');
  const popupFill = document.getElementById('popupFill');
  const tabChips = document.querySelectorAll('.chip');
  const tabPanes = document.querySelectorAll('.tab-pane');

  function formatTime(sec) {
    if (isNaN(sec) || sec < 0) return '0:00';
    const m = Math.floor(sec / 60);
    const s = Math.floor(sec % 60);
    return `${m}:${s < 10 ? '0' : ''}${s}`;
  }

  // Restore state from chrome.storage
  chrome.storage.local.get(['playbackState'], (res) => {
    if (res && res.playbackState) {
      applyState(res.playbackState);
    }
  });

  // Listen for real-time state updates from background/offscreen
  chrome.runtime.onMessage.addListener((msg) => {
    if (msg.type === 'STATE_UPDATE' && msg.payload) {
      applyState(msg.payload);
    }
    if (msg.type === 'TRACK_ENDED') {
      playNext();
    }
  });

  function applyState(state) {
    isPlaying = state.isPlaying;
    popupPlayBtn.textContent = isPlaying ? '⏸' : '▶';

    if (state.track) {
      currentTrack = state.track;
      playerThumb.src = state.track.thumbnail;
      playerTitle.textContent = state.track.title;
      playerArtist.textContent = state.track.artist;
    }

    if (state.duration > 0) {
      popupCurTime.textContent = formatTime(state.currentTime);
      popupDurTime.textContent = formatTime(state.duration);
      const pct = (state.currentTime / state.duration) * 100;
      popupFill.style.width = `${pct}%`;
      updateLyricHighlight(state.currentTime);
    }
  }

  // Tab switching (Trending vs Lyrics)
  tabChips.forEach(chip => {
    chip.addEventListener('click', () => {
      tabChips.forEach(c => c.classList.remove('active'));
      tabPanes.forEach(p => p.classList.remove('active'));
      chip.classList.add('active');

      const targetTab = chip.dataset.tab === 'trending' ? 'tracksTab' : 'lyricsTab';
      document.getElementById(targetTab).classList.add('active');

      if (chip.dataset.tab === 'lyrics' && currentTrack) {
        loadLyricsForTrack(currentTrack);
      }
    });
  });

  // Load Trending songs
  async function loadTrending() {
    popupTracksList.innerHTML = '<div class="loading-state">Loading trending songs...</div>';
    try {
      const res = await fetch(`${API_BASE}/api/trending?genre=global`);
      const tracks = await res.json();
      queue = tracks;
      renderTracks(tracks);
    } catch (err) {
      popupTracksList.innerHTML = '<div class="loading-state">Make sure SimpMusic Web/Backend is running on localhost:3000</div>';
    }
  }

  function renderTracks(tracks) {
    popupTracksList.innerHTML = '';
    if (!tracks || tracks.length === 0) {
      popupTracksList.innerHTML = '<div class="loading-state">No songs found.</div>';
      return;
    }

    const fragment = document.createDocumentFragment();
    tracks.forEach((track, idx) => {
      const row = document.createElement('div');
      row.className = 'track-row';
      row.innerHTML = `
        <img class="track-row-thumb" src="${track.thumbnail}" alt="" />
        <div class="track-row-details">
          <div class="track-row-title">${track.title}</div>
          <div class="track-row-artist">${track.artist}</div>
        </div>
        <span class="track-row-dur">${track.duration || '3:30'}</span>
      `;
      row.addEventListener('click', () => {
        currentIndex = idx;
        playTrack(track);
      });
      fragment.appendChild(row);
    });
    popupTracksList.appendChild(fragment);
  }

  // Play track via background message
  function playTrack(track) {
    currentTrack = track;
    playerThumb.src = track.thumbnail;
    playerTitle.textContent = track.title;
    playerArtist.textContent = track.artist;
    popupPlayBtn.textContent = '⏸';

    chrome.runtime.sendMessage({
      target: 'offscreen',
      type: 'PLAY_TRACK',
      track
    });

    loadLyricsForTrack(track);
  }

  function playNext() {
    if (queue.length > 0) {
      currentIndex = (currentIndex + 1) % queue.length;
      playTrack(queue[currentIndex]);
    }
  }

  function playPrev() {
    if (queue.length > 0) {
      currentIndex = (currentIndex - 1 + queue.length) % queue.length;
      playTrack(queue[currentIndex]);
    }
  }

  // Controls
  popupPlayBtn.addEventListener('click', () => {
    chrome.runtime.sendMessage({
      target: 'offscreen',
      type: 'TOGGLE_PLAY'
    });
  });

  popupPrevBtn.addEventListener('click', playPrev);
  popupNextBtn.addEventListener('click', playNext);

  // Scrubber Seek
  popupRail.addEventListener('click', (e) => {
    if (!currentTrack) return;
    const rect = popupRail.getBoundingClientRect();
    const pos = (e.clientX - rect.left) / rect.width;
    const dur = currentTrack.durationSec || 200;
    const targetSec = pos * dur;

    chrome.runtime.sendMessage({
      target: 'offscreen',
      type: 'SEEK',
      seconds: targetSec
    });
  });

  // Search input
  let searchTimer = null;
  popupSearch.addEventListener('input', (e) => {
    const q = e.target.value.trim();
    clearTimeout(searchTimer);
    if (!q) {
      loadTrending();
      return;
    }
    searchTimer = setTimeout(async () => {
      popupTracksList.innerHTML = '<div class="loading-state">Searching...</div>';
      try {
        const res = await fetch(`${API_BASE}/api/search?q=${encodeURIComponent(q)}`);
        const results = await res.json();
        queue = results;
        renderTracks(results);
      } catch (err) {
        popupTracksList.innerHTML = '<div class="loading-state">Search failed.</div>';
      }
    }, 300);
  });

  // Lyrics loader
  async function loadLyricsForTrack(track) {
    if (!track) return;
    popupLyricsStream.innerHTML = '<div class="lyrics-placeholder">Loading lyrics...</div>';
    try {
      const res = await fetch(`${API_BASE}/api/lyrics?title=${encodeURIComponent(track.title)}&artist=${encodeURIComponent(track.artist)}&duration=${track.durationSec || 0}`);
      const data = await res.json();

      if (data.isSynced && data.parsedLyrics && data.parsedLyrics.length > 0) {
        lyricsList = data.parsedLyrics;
        renderPopupLyrics(data.parsedLyrics);
      } else if (data.plainLyrics) {
        popupLyricsStream.innerHTML = `<div style="line-height:1.8; color:var(--text-muted); font-size:0.85rem;">${data.plainLyrics}</div>`;
      } else {
        popupLyricsStream.innerHTML = '<div class="lyrics-placeholder">No lyrics found.</div>';
      }
    } catch (e) {
      popupLyricsStream.innerHTML = '<div class="lyrics-placeholder">Lyrics unavailable.</div>';
    }
  }

  function renderPopupLyrics(lines) {
    popupLyricsStream.innerHTML = '';
    const frag = document.createDocumentFragment();
    lines.forEach((item, idx) => {
      const line = document.createElement('div');
      line.className = 'popup-lyric-line';
      line.dataset.time = item.time;
      line.textContent = item.text || '♪';
      line.addEventListener('click', () => {
        chrome.runtime.sendMessage({
          target: 'offscreen',
          type: 'SEEK',
          seconds: item.time
        });
      });
      frag.appendChild(line);
    });
    popupLyricsStream.appendChild(frag);
  }

  function updateLyricHighlight(curTime) {
    if (lyricsList.length === 0) return;
    let idx = -1;
    for (let i = 0; i < lyricsList.length; i++) {
      if (curTime >= lyricsList[i].time - 0.2) {
        idx = i;
      } else break;
    }

    if (idx !== activeLyricIdx && idx !== -1) {
      activeLyricIdx = idx;
      const lines = popupLyricsStream.querySelectorAll('.popup-lyric-line');
      lines.forEach((l, i) => l.classList.toggle('active', i === idx));

      const activeEl = lines[idx];
      if (activeEl) {
        activeEl.scrollIntoView({ behavior: 'smooth', block: 'center' });
      }
    }
  }

  // Initial load
  loadTrending();
});
