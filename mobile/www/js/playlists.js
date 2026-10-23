/**
 * Playlists module
 * - Library (mobile + desktop) shows ONLY playlists (no raw song lists).
 * - Create playlist (styled overlay), delete, open detail, play all.
 * - "Add to playlist" bottom-sheet reachable from any song's ⋮ button
 *   (New Releases, search results).
 * Storage: localStorage 'simpmusic_playlists' = [{id,name,createdAt,tracks:[]}]
 */
(function () {
  'use strict';

  var KEY = 'simpmusic_playlists';
  var LIKED_ID = 'liked_songs';

  function all() {
    var list = [];
    try {
      var arr = JSON.parse(localStorage.getItem(KEY) || '[]');
      if (Array.isArray(arr)) list = arr;
    } catch (e) {}
    // v3.6: virtual, always-pinned Liked Songs playlist. Its tracks are
    // derived LIVE from simpmusic_likes (the same store the ♥ button uses),
    // so likes anywhere in the app appear here automatically.
    var likes = [];
    try {
      likes = JSON.parse(localStorage.getItem('simpmusic_likes') || '[]');
      if (!Array.isArray(likes)) likes = [];
    } catch (e) {}
    var liked = {
      id: LIKED_ID,
      name: 'Liked Songs',
      createdAt: 0,
      virtual: true,
      tracks: likes.map(function (l) {
        return {
          videoId: l.videoId,
          title: l.title || 'Unknown',
          artist: l.artist || '',
          album: l.album || '',
          duration: l.duration || '3:30',
          durationSec: l.durationSec || 0,
          thumbnail: l.thumbnail || ('https://i.ytimg.com/vi/' + l.videoId + '/hqdefault.jpg')
        };
      })
    };
    return [liked].concat(list.filter(function (p) { return p && p.id !== LIKED_ID; }));
  }

  function save(list) {
    try { localStorage.setItem(KEY, JSON.stringify(list)); } catch (e) {}
  }

  function byId(id) {
    return all().filter(function (p) { return p.id === id; })[0] || null;
  }

  function create(name) {
    var list = all().filter(function (p) { return !p.virtual; }); // never persist the virtual one
    var pl = {
      id: 'pl_' + Date.now() + '_' + Math.floor(Math.random() * 1e4),
      name: String(name || 'My Playlist').trim() || 'My Playlist',
      createdAt: Date.now(),
      tracks: []
    };
    list.push(pl);
    save(list);
    return pl;
  }

  function remove(id) {
    if (id === LIKED_ID) return; // pinned — cannot be deleted
    save(all().filter(function (p) { return p.id !== id && !p.virtual; }));
  }

  function addTrack(id, track) {
    if (id === LIKED_ID) {
      // Adding to "Liked Songs" = liking the song (same store the ♥ uses).
      var likes = [];
      try { likes = JSON.parse(localStorage.getItem('simpmusic_likes') || '[]'); } catch (e) {}
      if (!Array.isArray(likes)) likes = [];
      if (likes.some(function (l) { return l.videoId === track.videoId; })) return false;
      likes.unshift({
        videoId: track.videoId,
        title: track.title || 'Unknown',
        artist: track.artist || '',
        album: track.album || '',
        duration: track.duration || '3:30',
        durationSec: track.durationSec || 0,
        thumbnail: track.thumbnail || ('https://i.ytimg.com/vi/' + track.videoId + '/hqdefault.jpg')
      });
      try { localStorage.setItem('simpmusic_likes', JSON.stringify(likes)); } catch (e) {}
      return true;
    }
    var list = all().filter(function (p) { return !p.virtual; }); // never persist the virtual one
    var pl = list.filter(function (p) { return p.id === id; })[0];
    if (!pl) return false;
    if (!pl.tracks.some(function (t) { return t.videoId === track.videoId; })) {
      pl.tracks.push({
        videoId: track.videoId,
        title: track.title || 'Unknown',
        artist: track.artist || '',
        album: track.album || '',
        duration: track.duration || '3:30',
        durationSec: track.durationSec || 0,
        thumbnail: track.thumbnail || ('https://i.ytimg.com/vi/' + track.videoId + '/hqdefault.jpg')
      });
      save(list);
      return true;
    }
    return false; // already present
  }

  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  function playTrack(track) {
    if (window.player && window.player.playTrack) {
      window.player.playTrack(track, [track]);
    } else {
      window.dispatchEvent(new CustomEvent('simpmusic:play-track', { detail: track }));
    }
    var dock = document.getElementById('mobileMiniDock');
    if (dock) dock.style.display = 'flex';
  }

  function playAll(pl) {
    if (!pl.tracks.length) return;
    if (window.player && window.player.playTrack) {
      window.player.playTrack(pl.tracks[0], pl.tracks);
    } else {
      window.dispatchEvent(new CustomEvent('simpmusic:play-track', { detail: pl.tracks[0], tracks: pl.tracks }));
    }
    var dock = document.getElementById('mobileMiniDock');
    if (dock) dock.style.display = 'flex';
  }

  // ---------------- UI: library grids ----------------

  function cardHtml(pl) {
    var cover = pl.tracks.length ? pl.tracks[0].thumbnail : '';
    var delBtn = pl.virtual
      ? ''
      : '<button class="pl-card-del" title="Delete playlist">✕</button>';
    var badge = pl.virtual ? '<span class="pl-pin-badge">♥</span>' : '';
    return '<div class="pl-card" data-id="' + esc(pl.id) + '">'
      + '<div class="pl-card-cover">'
      + (pl.virtual
          ? '<span class="pl-liked-cover">♥</span>'
          : (cover ? '<img loading="lazy" src="' + esc(cover) + '" alt="" />' : '<span>🎵</span>'))
      + '<button class="pl-card-play" title="Play all">▶</button>'
      + '</div>'
      + '<div class="pl-card-name">' + esc(pl.name) + badge + '</div>'
      + '<div class="pl-card-count">' + pl.tracks.length + ' song' + (pl.tracks.length === 1 ? '' : 's') + '</div>'
      + delBtn
      + '</div>';
  }

  function renderMobile() {
    var grid = document.getElementById('mobilePlaylistsGrid');
    if (!grid) return;
    var list = all();
    if (!list.length) {
      grid.innerHTML = '<div class="pl-empty">No playlists yet.<br>Tap <b>+ New Playlist</b> to start one,<br>open it, then use <b>+ Add Songs</b>.</div>';
      return;
    }
    grid.innerHTML = list.map(cardHtml).join('');
    bindGrid(grid);
  }

  function renderDesktop() {
    var grid = document.getElementById('desktopPlaylistsGrid');
    var container = document.getElementById('numberedTracklist');
    if (!grid) {
      if (!container) return;
      // Fallback: render into the tracklist container area
      grid = document.createElement('div');
      grid.id = 'desktopPlaylistsGrid';
      container.parentNode.insertBefore(grid, container);
      container.style.display = 'none';
    }
    var list = all();
    if (!list.length) {
      grid.innerHTML = '<div class="pl-empty">No playlists yet — create one below.</div>';
    } else {
      grid.innerHTML = '<div class="pl-grid">' + list.map(cardHtml).join('') + '</div>';
    }
    var add = document.getElementById('desktopNewPlaylistBtn');
    if (add) add.style.display = 'inline-block';
    bindGrid(grid);
  }

  function bindGrid(grid) {
    grid.querySelectorAll('.pl-card').forEach(function (card) {
      var id = card.dataset.id;
      card.querySelector('.pl-card-play').addEventListener('click', function (e) {
        e.stopPropagation();
        var pl = byId(id);
        if (pl && pl.tracks.length) { playAll(pl); if (window.showToast) window.showToast('Playing ' + pl.name); }
      });
      // The pinned Liked Songs card has no ✕ button — guard against null.
      var delBtn = card.querySelector('.pl-card-del');
      if (delBtn) {
        delBtn.addEventListener('click', function (e) {
          e.stopPropagation();
          var pl = byId(id);
          if (pl && confirm('Delete playlist "' + pl.name + '"?')) {
            remove(id);
            renderMobile(); renderDesktop();
            if (window.showToast) window.showToast('Playlist deleted');
          }
        });
      }
      card.addEventListener('click', function () { openDetail(id); });
    });
  }

  function openDetail(id) {
    var pl = byId(id);
    if (!pl) return;
    window.dispatchEvent(new CustomEvent('simpmusic:open-playlist', { detail: pl }));
  }

  // ---------------- UI: create overlay ----------------

  function createOverlayHtml() {
    return '<div class="cat-overlay pl-overlay" id="plOverlay">'
      + '<div class="pl-dialog">'
      + '<div class="pl-dialog-title">New Playlist</div>'
      + '<input type="text" id="plNameInput" class="pl-name-input" placeholder="Playlist name" maxlength="60" />'
      + '<div class="pl-dialog-actions">'
      + '<button class="pl-btn pl-btn-ghost" id="plCancelBtn">Cancel</button>'
      + '<button class="pl-btn pl-btn-primary" id="plCreateBtn">Create</button>'
      + '</div>'
      + '</div></div>';
  }

  function createFlow() {
    if (document.getElementById('plOverlay')) return;
    var wrap = document.createElement('div');
    wrap.innerHTML = createOverlayHtml();
    document.body.appendChild(wrap.firstChild);
    var overlay = document.getElementById('plOverlay');
    var input = document.getElementById('plNameInput');
    requestAnimationFrame(function () { overlay.classList.add('active'); input.focus(); });

    function close() {
      overlay.classList.remove('active');
      setTimeout(function () { overlay.remove(); }, 200);
    }
    function commit() {
      var name = input.value.trim();
      if (!name) { input.focus(); return; }
      var pl = create(name);
      close();
      renderMobile(); renderDesktop();
      if (window.showToast) window.showToast('Playlist "' + pl.name + '" created');
    }
    document.getElementById('plCancelBtn').addEventListener('click', close);
    document.getElementById('plCreateBtn').addEventListener('click', commit);
    input.addEventListener('keydown', function (e) { if (e.key === 'Enter') commit(); });
    overlay.addEventListener('click', function (e) { if (e.target === overlay) close(); });
  }

  // ---------------- UI: universal song menu (3-dot on every song) -------
  // Options: Add to playlist · Play next · Download (offline)

  function songMenu(track) {
    closeSheet();
    var playlists = all();
    var sheet = document.createElement('div');
    sheet.className = 'cat-overlay pl-sheet-wrap';
    sheet.id = 'plSheet';
    var items = playlists.map(function (p) {
      return '<button class="pl-sheet-item" data-add="' + esc(p.id) + '"><span class="pl-sheet-ico">🎵</span>' + esc(p.name) + '</button>';
    }).join('');
    // v3.18.7: show a Downloaded ✓ state when the song is already offline
    var downloaded = false;
    try {
      var dlMap = JSON.parse(localStorage.getItem('simpmusic_dl_ids') || '{}');
      downloaded = Object.keys(dlMap).some(function (k) { return dlMap[k] === track.videoId; });
    } catch (e) {}
    var thumb = track.thumbnail || '';
    var thumbHtml = thumb
      ? '<img class="pl-sheet-thumb" src="' + esc(thumb) + '" onerror="this.style.display=\'none\'" />'
      : '<span class="pl-sheet-thumb pl-sheet-thumb-ph">🎵</span>';
    sheet.innerHTML = '<div class="pl-sheet">'
      + '<div class="pl-sheet-grab"></div>'
      + '<div class="pl-sheet-song">'
      +   thumbHtml
      +   '<div class="pl-sheet-song-info"><b>' + esc(track.title) + '</b><span>' + esc(track.artist || '') + '</span></div>'
      + '</div>'
      + '<button class="pl-sheet-item" data-playnext="1"><span class="pl-sheet-ico">⏭</span>Play next</button>'
      + '<button class="pl-sheet-item" data-addqueue="1"><span class="pl-sheet-ico">➕</span>Add to queue</button>'
      + '<button class="pl-sheet-item" data-playlistmode="1"><span class="pl-sheet-ico">🎵</span>Add to playlist</button>'
      + (window.STORE_BUILD ? '' : '<button class="pl-sheet-item" data-download="1"><span class="pl-sheet-ico">⬇</span>' + (downloaded ? 'Downloaded ✓ — download again' : 'Download for offline') + '</button>')
      + '<div class="pl-sheet-sep"></div>'
      + '<button class="pl-sheet-item pl-sheet-danger" data-notforme="1"><span class="pl-sheet-ico">🚫</span>Not for me</button>'
      + '<div class="pl-sheet-sep" id="plSheetLists" style="display:none;">CHOOSE A PLAYLIST</div>'
      + '<div id="plSheetListsWrap" style="display:none;">'
      + (items || '<div class="pl-sheet-none">No playlists yet — create one in Library</div>')
      + '<button class="pl-sheet-item" data-new="1"><span class="pl-sheet-ico">🎵</span>New playlist…</button>'
      + '</div>'
      + '<button class="pl-sheet-item pl-sheet-cancel" data-cancel="1">Cancel</button>'
      + '</div>';
    document.body.appendChild(sheet);
    requestAnimationFrame(function () { sheet.classList.add('active'); });

    function closeSheet() {
      var s = document.getElementById('plSheet');
      if (s) { s.classList.remove('active'); setTimeout(function () { s.remove(); }, 200); }
    }
    sheet.addEventListener('click', function (e) {
      var btn = e.target.closest('.pl-sheet-item');
      if (e.target === sheet) { closeSheet(); return; }
      if (!btn) return;
      if (btn.dataset.playlistmode) {
        // Expand the in-sheet playlist chooser (Library-free, works anywhere)
        var sep = document.getElementById('plSheetLists');
        var wrap = document.getElementById('plSheetListsWrap');
        if (sep) sep.style.display = '';
        if (wrap) wrap.style.display = '';
        btn.style.display = 'none';
        return;
      }
      if (btn.dataset.addqueue) {
        closeSheet();
        // v3.12.2: append at the end of the queue (behind current music)
        if (window.player && window.player.addToQueue) {
          window.player.addToQueue(track);
          if (window.showToast) window.showToast('Added to queue');
        }
      } else if (btn.dataset.playnext) {
        closeSheet();
        playNext(track);
      } else if (btn.dataset.download) {
        closeSheet();
        if (window.SimpMusicDownloads) window.SimpMusicDownloads.download(track);
        else if (window.showToast) window.showToast('Downloads need the Android app');
      } else if (btn.dataset.notforme) {
        closeSheet();
        // v3.5: feed the recommendation engine (blocks this song + penalizes)
        if (window.SimpMusicReco) window.SimpMusicReco.dislike(track);
        if (window.showToast) window.showToast('Got it — we\'ll show less of this');
      } else if (btn.dataset.new) {
        closeSheet();
        pendingAdd = track; createFlowWithPending();
      } else if (btn.dataset.add) {
        var pl = byId(btn.dataset.add);
        var added = pl ? addTrack(pl.id, track) : false;
        closeSheet();
        renderMobile(); renderDesktop();
        if (window.showToast) window.showToast(added ? 'Added to ' + pl.name : 'Already in ' + (pl ? pl.name : 'playlist'));
      } else if (btn.dataset.cancel) {
        closeSheet();
      }
    });
  }

  function playNext(track) {
    if (!track || !track.videoId) return;
    var p = window.player;
    // v3.19.9: single delegated path — the player handles native + JS queues,
    // dedupes, and inserts right after the current song. It answers false
    // when the track is the one ALREADY PLAYING (previously that queued a
    // duplicate of the current song, so rapid taps repeated it).
    if (p && typeof p.addToQueueNext === 'function') {
      var ok = p.addToQueueNext(track);
      if (window.showToast) {
        window.showToast(ok ? 'Playing next: ' + track.title : 'Already playing — ' + track.title);
      }
    } else if (window.showToast) {
      window.showToast('Play something first');
    }
  }

  var pendingAdd = null;

  // ---------------- v3.17: YouTube playlist link import ----------------
  // Paste a public youtube.com/playlist?list=… link → native NewPipe
  // extraction → preview → saved as a normal (playable) playlist.

  function importFlow() {
    if (document.getElementById('plImportOverlay')) return;
    var wrap = document.createElement('div');
    wrap.innerHTML = '<div class="cat-overlay pl-overlay" id="plImportOverlay">'
      + '<div class="pl-dialog">'
      + '<div class="pl-dialog-title">🔗 Import Playlist Link</div>'
      + '<input type="url" id="plImportUrl" class="pl-name-input" placeholder="Paste a playlist link…" style="margin-bottom:12px;" />'
      + '<div id="plImportPreview"></div>'
      + '<div class="pl-dialog-actions">'
      + '<button class="pl-btn pl-btn-ghost" id="plImportCancel">Cancel</button>'
      + '<button class="pl-btn pl-btn-primary" id="plImportGo">Fetch</button>'
      + '</div>'
      + '</div></div>';
    document.body.appendChild(wrap.firstChild);
    var overlay = document.getElementById('plImportOverlay');
    var input = document.getElementById('plImportUrl');
    var preview = document.getElementById('plImportPreview');
    var goBtn = document.getElementById('plImportGo');
    requestAnimationFrame(function () { overlay.classList.add('active'); input.focus(); });

    function close() {
      overlay.classList.remove('active');
      setTimeout(function () { overlay.remove(); }, 200);
    }

    function fetchPlaylist() {
      var url = input.value.trim();
      if (!url) { input.focus(); return; }
      goBtn.disabled = true; goBtn.textContent = 'Fetching…';
      preview.innerHTML = '<div class="pl-add-hint">Resolving playlist…</div>';
      var native = window.Capacitor && window.Capacitor.isPluginAvailable && window.Capacitor.isPluginAvailable('PlaybackKeeper');
      if (!native) {
        preview.innerHTML = '<div class="pl-add-hint">Playlist import needs the Android app.</div>';
        goBtn.disabled = false; goBtn.textContent = 'Fetch';
        return;
      }
      window.Capacitor.Plugins.PlaybackKeeper.resolvePlaylist({ url: url })
        .then(function (res) {
          var data = JSON.parse(res.playlist);
          if (!data.tracks || !data.tracks.length) throw new Error('empty');
          var first3 = data.tracks.slice(0, 3).map(function (t) {
            return '<div style="font-size:0.78rem; color:#a1a1aa; padding:2px 0;">• ' + esc(t.title) + '</div>';
          }).join('');
          preview.innerHTML = '<div style="margin:10px 0 12px; padding:12px; border-radius:14px; background:rgba(255,255,255,0.05);">'
            + '<div style="color:#fff; font-weight:800; font-size:0.95rem;">' + esc(data.name) + '</div>'
            + '<div style="color:#71717a; font-size:0.75rem; margin-bottom:8px;">by ' + esc(data.creator || 'Unknown') + ' · ' + data.count + ' songs</div>'
            + first3
            + (data.count > 3 ? '<div style="font-size:0.72rem; color:#565968;">…and ' + (data.count - 3) + ' more</div>' : '')
            + '</div>';
          goBtn.textContent = 'Show songs';
          goBtn.disabled = false;
          goBtn.onclick = function () {
            // v3.17.2: preview inside the dialog — the user browses & plays
            // the tracks; import is a separate "Add to Library" button.
            var listHtml = data.tracks.slice(0, 12).map(function (t, i) {
              return '<div class="pl-preview-row" data-i="' + i + '" style="display:flex; align-items:center; gap:10px; padding:6px 4px; cursor:pointer;">'
                + '<span style="color:#565968; font-size:0.72rem; width:18px; text-align:center; flex:none;">' + (i + 1) + '</span>'
                + '<img src="' + esc(t.thumbnail || '') + '" style="width:40px; height:40px; border-radius:8px; object-fit:cover; flex:none;" onerror="this.style.visibility=\'hidden\'" />'
                + '<div style="min-width:0;"><div style="color:#fff; font-size:0.82rem; font-weight:600; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;">' + esc(t.title) + '</div>'
                + '<div style="color:#71717a; font-size:0.7rem;">' + esc(t.artist || '') + (t.duration ? ' · ' + esc(t.duration) : '') + '</div></div>'
                + '</div>';
            }).join('');
            preview.innerHTML = '<div style="margin:10px 0 12px; padding:12px; border-radius:14px; background:rgba(255,255,255,0.05);">'
              + '<div style="color:#fff; font-weight:800; font-size:0.95rem;">' + esc(data.name) + '</div>'
              + '<div style="color:#71717a; font-size:0.75rem; margin-bottom:8px;">by ' + esc(data.creator || 'Unknown') + ' · ' + data.count + ' songs</div>'
              + '<div id="plPrevRows" style="max-height:40vh; overflow-y:auto;">' + listHtml + '</div>'
              + (data.count > 12 ? '<div style="font-size:0.72rem; color:#565968; margin-top:6px;">…and ' + (data.count - 12) + ' more</div>' : '')
              + '</div>'
              + '<div class="pl-dialog-actions" style="margin-top:8px;">'
              + '<button class="pl-btn pl-btn-primary" id="plInlineAdd">➕ Add to Library (' + data.count + ')</button>'
              + '</div>';
            goBtn.style.display = 'none';
            var rows = document.getElementById('plPrevRows');
            rows.addEventListener('click', function (ev) {
              var rowEl = ev.target.closest('.pl-preview-row');
              if (!rowEl) return;
              var t = data.tracks[parseInt(rowEl.dataset.i, 10)];
              if (t && window.player && window.player.playTrack) {
                window.player.playTrack(t, data.tracks);
                var dock = document.getElementById('mobileMiniDock');
                if (dock) dock.style.display = 'flex';
                if (window.showToast) window.showToast('Playing ' + t.title);
              }
            });
            document.getElementById('plInlineAdd').addEventListener('click', function () {
              var pl = create(data.name);
              data.tracks.forEach(function (t) { addTrack(pl.id, t); });
              close();
              renderMobile(); renderDesktop();
              if (window.showToast) window.showToast('"' + pl.name + '" saved to Library (' + data.count + ' songs)');
            });
          };
        })
        .catch(function (err) {
          var msg = (err && err.message) ? err.message : 'Import failed';
          if (msg.indexOf('empty') >= 0) msg = 'No songs found in that playlist';
          if (msg.length > 120) msg = 'Playlist not found, private, or unreachable';
          preview.innerHTML = '<div class="pl-add-hint" style="color:#f87171;">' + esc(msg) + '</div>';
          goBtn.disabled = false; goBtn.textContent = 'Fetch';
        });
    }

    goBtn.addEventListener('click', fetchPlaylist);
    input.addEventListener('keydown', function (e) { if (e.key === 'Enter') fetchPlaylist(); });
    document.getElementById('plImportCancel').addEventListener('click', close);
    overlay.addEventListener('click', function (e) { if (e.target === overlay) close(); });
  }

  // ---------------- Add Songs: search overlay (Library-only) ----------------

  var addSongsFor = null; // playlist id currently adding songs to

  function openAddSongs(plId) {
    var pl = byId(plId);
    if (!pl) return;
    addSongsFor = plId;
    var overlay = document.getElementById('plAddSongsOverlay');
    var input = document.getElementById('plAddSongsInput');
    var results = document.getElementById('plAddSongsResults');
    if (!overlay || !input || !results) return;
    results.innerHTML = '<div class="pl-add-hint">Search and tap a song to add it to "' + esc(pl.name) + '".</div>';
    input.value = '';
    overlay.style.display = 'flex';
    setTimeout(function () { input.focus(); }, 150);
  }

  function closeAddSongs() {
    addSongsFor = null;
    var overlay = document.getElementById('plAddSongsOverlay');
    if (overlay) overlay.style.display = 'none';
  }

  function doAddSongsSearch(q) {
    var results = document.getElementById('plAddSongsResults');
    if (!results) return;
    var query = String(q || '').trim();
    if (!query) return;
    results.innerHTML = '<div class="pl-add-hint">Searching “' + esc(query) + '”…</div>';
    var native = window.Capacitor && window.Capacitor.isPluginAvailable && window.Capacitor.isPluginAvailable('PlaybackKeeper');
    if (native) {
      try {
        window.Capacitor.Plugins.PlaybackKeeper.search({ query: query }).then(function (res) {
          var arr = [];
          try { arr = JSON.parse(res.results || '[]'); } catch (e) {}
          renderAddResults(arr);
        }).catch(function () {
          results.innerHTML = '<div class="pl-add-hint">Search failed. Try again.</div>';
        });
      } catch (e) { results.innerHTML = '<div class="pl-add-hint">Search failed.</div>'; }
    } else {
      fetch('/api/search?q=' + encodeURIComponent(query)).then(function (r) { return r.json(); }).then(function (arr) {
        renderAddResults(arr || []);
      }).catch(function () {
        results.innerHTML = '<div class="pl-add-hint">Search failed. Is the server running?</div>';
      });
    }
  }

  function renderAddResults(arr) {
    var results = document.getElementById('plAddSongsResults');
    if (!results) return;
    if (!arr.length) {
      results.innerHTML = '<div class="pl-add-hint">No results.</div>';
      return;
    }
    results.innerHTML = arr.map(function (t) {
      return '<div class="pl-add-row" data-video="' + esc(t.videoId) + '" data-title="' + esc(t.title) + '"'
        + ' data-artist="' + esc(t.artist || '') + '" data-thumb="' + esc(t.thumbnail || '') + '"'
        + ' data-duration="' + esc(t.duration || '') + '">'
        + '<img class="pl-add-thumb" loading="lazy" src="' + esc(t.thumbnail || '') + '" alt="" />'
        + '<div class="pl-add-info"><div class="pl-add-title">' + esc(t.title) + '</div>'
        + '<div class="pl-add-artist">' + esc(t.artist || '') + '</div></div>'
        + '<button class="pl-add-btn">＋ Add</button></div>';
    }).join('');
  }

  function addFromRow(row) {
    if (!addSongsFor || !row) return;
    var track = {
      videoId: row.dataset.video,
      title: row.dataset.title || 'Song',
      artist: row.dataset.artist || '',
      album: '',
      duration: row.dataset.duration || '',
      durationSec: 0,
      thumbnail: row.dataset.thumb || ''
    };
    var ok = addTrack(addSongsFor, track);
    if (window.showToast) window.showToast(ok ? 'Added to ' + (byId(addSongsFor) || {}).name : 'Already in playlist');
    if (ok) {
      renderMobile(); renderDesktop();
      // Refresh an open detail view so the new song appears immediately
      var pl = byId(addSongsFor);
      if (pl) window.dispatchEvent(new CustomEvent('simpmusic:open-playlist', { detail: pl }));
    }
  }

  function bindAddSongs() {
    var openBtn = document.getElementById('addSongsHeroBtn');
    if (openBtn) openBtn.addEventListener('click', function () { openAddSongs(currentOpenPlaylistId()); });
    var close1 = document.getElementById('plAddSongsClose');
    if (close1) close1.addEventListener('click', closeAddSongs);
    var overlay = document.getElementById('plAddSongsOverlay');
    if (overlay) overlay.addEventListener('click', function (e) { if (e.target === overlay) closeAddSongs(); });
    var input = document.getElementById('plAddSongsInput');
    if (input) input.addEventListener('keydown', function (e) {
      if (e.key === 'Enter') { doAddSongsSearch(input.value); }
    });
    var go = document.getElementById('plAddSongsGo');
    if (go) go.addEventListener('click', function () { doAddSongsSearch(input ? input.value : ''); });
    var results = document.getElementById('plAddSongsResults');
    if (results) results.addEventListener('click', function (e) {
      var row = e.target.closest('.pl-add-row');
      if (row) addFromRow(row);
    });
  }

  function currentOpenPlaylistId() {
    var el = document.getElementById('heroTitle');
    var name = el ? el.textContent : '';
    var pl = all().find(function (p) { return p.name === name; });
    return pl ? pl.id : (all()[0] ? all()[0].id : null);
  }

  function createFlowWithPending() {
    if (document.getElementById('plOverlay')) return;
    var wrap = document.createElement('div');
    wrap.innerHTML = createOverlayHtml();
    document.body.appendChild(wrap.firstChild);
    var overlay = document.getElementById('plOverlay');
    var input = document.getElementById('plNameInput');
    requestAnimationFrame(function () { overlay.classList.add('active'); input.focus(); });
    function close() { overlay.classList.remove('active'); setTimeout(function () { overlay.remove(); }, 200); }
    function commit() {
      var name = input.value.trim();
      if (!name) { input.focus(); return; }
      var pl = create(name);
      if (pendingAdd) { addTrack(pl.id, pendingAdd); pendingAdd = null; }
      close();
      renderMobile(); renderDesktop();
      if (window.showToast) window.showToast('Added to "' + pl.name + '"');
    }
    document.getElementById('plCancelBtn').addEventListener('click', close);
    document.getElementById('plCreateBtn').addEventListener('click', commit);
    input.addEventListener('keydown', function (e) { if (e.key === 'Enter') commit(); });
  }

  // ---------------- Delegated ⋮ handler (works for dynamic content) ------

  function trackFromEl(el) {
    return {
      videoId: el.dataset.video || '',
      title: el.dataset.title || 'Song',
      artist: el.dataset.artist || '',
      album: el.dataset.album || '',
      // v3.19.11: the attribute is written as data-durationsec (lowercase),
      // but this read dataset.durationSec (camelCase) — ALWAYS undefined,
      // so every 3-dot menu track (Play next / Add to queue) entered the
      // queue with durationSec 0 and the Queue sheet showed 0:00.
      durationSec: parseInt(el.getAttribute('data-durationsec') || el.dataset.durationsec || el.dataset.durationSec || '0', 10) || 0,
      thumbnail: el.dataset.thumb || el.querySelector('img')?.src || ''
    };
  }

  // Universal 3-dot song menu — works on ANY page (search, home, playlist
  // rows, recents) via the .song-menu-btn data attributes.
  document.addEventListener('click', function (e) {
    var more = e.target.closest('.song-menu-btn');
    if (!more) return;
    e.preventDefault();
    e.stopPropagation();
    songMenu(trackFromEl(more));
  }, true); // capture: runs before per-item handlers

  // ---------------- Boot / public API ----------------

  window.SimpMusicPlaylists = {
    all: all, create: create, remove: remove, addTrack: addTrack, byId: byId,
    renderMobile: renderMobile, renderDesktop: renderDesktop,
    createFlow: createFlow, songMenu: songMenu, playAll: playAll,
    importFlow: importFlow, openAddSongs: openAddSongs
  };

  function boot() {
    var mBtn = document.getElementById('mobileNewPlaylistBtn');
    var dBtn = document.getElementById('desktopNewPlaylistBtn');
    if (mBtn) mBtn.addEventListener('click', createFlow);
    if (dBtn) dBtn.addEventListener('click', function () { createFlow(); renderDesktop(); });
    bindAddSongs();
    renderMobile();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
})();
