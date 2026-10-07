/**
 * SimpMusic Synchronized Lyrics Engine
 * Interacts with LRCLIB API, parses LRC timestamps, and provides auto-scrolling karaoke
 */

class LyricsController {
  constructor(player) {
    this.player = player;
    this.container = document.getElementById('lyricsStream');
    this.currentLyrics = [];
    this.activeLineIndex = -1;
    this.isSynced = false;
    this.plainText = '';
    this.userScrolling = false;
    this.scrollTimeout = null;

    this.bindEvents();
  }

  bindEvents() {
    if (this.container) {
      this.container.addEventListener('scroll', () => {
        this.userScrolling = true;
        clearTimeout(this.scrollTimeout);
        this.scrollTimeout = setTimeout(() => {
          this.userScrolling = false;
        }, 2500);
      });
    }

    // Sync with player progress
    this.player.on('timeupdate', ({ currentTime }) => {
      this.updateActiveLine(currentTime);
    });
  }

  async loadLyrics(track) {
    if (!track) return;
    this.renderLoading();
    this.activeLineIndex = -1;
    this.currentLyrics = [];

    try {
      const apiBase = window.API_BASE || '';
      let url = `${apiBase}/api/lyrics?title=${encodeURIComponent(track.title)}&artist=${encodeURIComponent(track.artist)}&duration=${track.durationSec || 0}`;
      let data = null;

      try {
        const res = await fetch(url);
        if (res.ok) {
          data = await res.json();
        } else {
          throw new Error('Backend returned status ' + res.status);
        }
      } catch (backendErr) {
        // Backend unreachable (e.g. Android APK: no Express server on device).
        // Query LRCLIB directly — ALWAYS with the duration, otherwise LRCLIB
        // often returns a different version (live/remix/sped-up) whose
        // timestamps don't match the playing audio (lyrics desync).
        const cleanTitle = track.title.replace(/\(.*?\)|\[.*?\]/g, '').trim();
        const cleanArtist = (track.artist || '').replace(/\(.*?\)|\[.*?\]/g, '').trim();
        const wantDur = Math.round(track.durationSec || 0);
        const toData = (d) => ({
          isSynced: !!d.syncedLyrics,
          syncedLyrics: d.syncedLyrics,
          plainLyrics: d.plainLyrics,
          parsedLyrics: d.syncedLyrics ? this.parseDirectLrc(d.syncedLyrics) : []
        });
        try {
          const lrcRes = await fetch(`https://lrclib.net/api/get?track_name=${encodeURIComponent(cleanTitle)}&artist_name=${encodeURIComponent(cleanArtist)}&duration=${wantDur}`);
          if (lrcRes.ok) data = toData(await lrcRes.json());
        } catch (e) { /* fall through to search */ }
        // /api/get without a good match (or network hiccup): search and pick
        // the result whose duration is closest to the playing track.
        if (!data || (!data.isSynced && !data.plainLyrics)) {
          try {
            const sRes = await fetch(`https://lrclib.net/api/search?track_name=${encodeURIComponent(cleanTitle)}&artist_name=${encodeURIComponent(cleanArtist)}`);
            if (sRes.ok) {
              const list = await sRes.json();
              if (Array.isArray(list) && list.length) {
                const scored = list
                  .filter(d => d.syncedLyrics || d.plainLyrics)
                  .map(d => ({ d, diff: wantDur > 0 ? Math.abs((d.duration || 0) - wantDur) : 0 }))
                  .sort((a, b) => a.diff - b.diff);
                // Only accept a close-duration match; a far-off version would desync
                const best = scored.find(s => wantDur === 0 || s.diff <= 8);
                if (best) data = toData(best.d);
              }
            }
          } catch (e) { /* no lyrics */ }
        }
      }

      if (data && data.isSynced && data.parsedLyrics && data.parsedLyrics.length > 0) {
        this.isSynced = true;
        this.currentLyrics = data.parsedLyrics;
        this.renderSyncedLyrics();
      } else if (data && data.plainLyrics) {
        this.isSynced = false;
        this.plainText = data.plainLyrics;
        this.renderPlainLyrics();
      } else {
        this.renderEmpty('No lyrics available for this song.');
      }
    } catch (err) {
      console.error('Failed to load lyrics:', err);
      this.renderEmpty('Unable to load lyrics at this time.');
    }
  }

  parseDirectLrc(lrcText) {
    if (!lrcText) return [];
    const lines = lrcText.split('\n');
    const result = [];
    const timeRegex = /\[(\d{2}):(\d{2})\.(\d{2,3})\](.*)/;
    for (const line of lines) {
      const match = line.match(timeRegex);
      if (match) {
        const total = parseInt(match[1], 10) * 60 + parseInt(match[2], 10) + parseFloat('0.' + match[3]);
        result.push({ time: Math.round(total * 100) / 100, text: match[4].trim() });
      }
    }
    return result.sort((a, b) => a.time - b.time);
  }

  renderLoading() {
    if (!this.container) return;
    this.container.innerHTML = `
      <div class="lyrics-plain">
        <p style="color: var(--primary);">Searching LRCLIB synchronized database...</p>
      </div>
    `;
  }

  renderEmpty(msg) {
    if (!this.container) return;
    this.container.innerHTML = `
      <div class="lyrics-plain">
        <p>${msg}</p>
      </div>
    `;
  }

  renderPlainLyrics() {
    if (!this.container) return;
    this.container.innerHTML = `
      <div class="lyrics-plain">
        ${this.plainText}
      </div>
    `;
  }

  renderSyncedLyrics() {
    if (!this.container) return;
    this.container.innerHTML = '';

    const fragment = document.createDocumentFragment();
    this.currentLyrics.forEach((item, index) => {
      const lineEl = document.createElement('div');
      lineEl.className = 'lyric-line';
      lineEl.dataset.index = index;
      lineEl.dataset.time = item.time;
      lineEl.textContent = item.text || '♪';

      // Click lyric line to seek immediately
      lineEl.addEventListener('click', () => {
        this.player.seekTo(item.time);
      });

      fragment.appendChild(lineEl);
    });

    this.container.appendChild(fragment);
  }

  updateActiveLine(currentTime) {
    if (!this.isSynced || this.currentLyrics.length === 0) return;

    // Find the latest lyric line before currentTime
    let newIndex = -1;
    for (let i = 0; i < this.currentLyrics.length; i++) {
      if (currentTime >= this.currentLyrics[i].time - 0.25) {
        newIndex = i;
      } else {
        break;
      }
    }

    if (newIndex !== this.activeLineIndex && newIndex !== -1) {
      this.activeLineIndex = newIndex;
      this.highlightAndScroll(newIndex);
    }
  }

  highlightAndScroll(index) {
    if (!this.container) return;
    const lines = this.container.querySelectorAll('.lyric-line');
    
    lines.forEach((line, idx) => {
      if (idx === index) {
        line.classList.add('active');
      } else {
        line.classList.remove('active');
      }
    });

    // Auto-scroll to active line unless user is manually dragging/scrolling
    if (!this.userScrolling) {
      const activeEl = lines[index];
      if (activeEl) {
        const containerHeight = this.container.clientHeight;
        const lineTop = activeEl.offsetTop;
        const lineHeight = activeEl.clientHeight;
        const targetScroll = lineTop - (containerHeight / 2) + (lineHeight / 2);

        this.container.scrollTo({
          top: Math.max(0, targetScroll),
          behavior: 'smooth'
        });
      }
    }
  }
}

window.LyricsController = LyricsController;
