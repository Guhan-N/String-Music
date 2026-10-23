/**
 * Artist & Album pages (v3.21)
 *
 * Tapping an artist name anywhere in the app opens a full-height sheet:
 * header (photo, name), "Top songs" and the artist's Albums / Singles row.
 * Tapping an album opens its track list, and either list plays as a queue.
 *
 * Data comes from YouTube Music's artist/album browse pages:
 *   - in the APK  → PlaybackKeeper.artist() / .album()  (NewPipe-free InnerTube)
 *   - in the browser → /api/artist?name= / /api/album?id=
 * Both return the same shape, so the UI has one renderer.
 *
 * Nothing here is required for playback: if the lookup fails the sheet shows a
 * short message and the rest of the app keeps working.
 */
(function () {
  'use strict';

  var CACHE_TTL = 30 * 60 * 1000;
  var artistCache = {};
  var albumCache = {};

  var root = null;          // sheet wrapper (built lazily)
  var scrollEl = null;
  var titleEl = null;
  var backBtn = null;
  var viewStack = [];       // [{kind:'artist'|'album', key, parent}]

  // ---------------------------------------------------------------- data

  function plugin() {
    var cap = window.Capacitor;
    if (!cap || !cap.Plugins) return null;
    try {
      if (typeof cap.isPluginAvailable === 'function' && !cap.isPluginAvailable('PlaybackKeeper')) {
        return null;
      }
    } catch (e) { return null; }
    return cap.Plugins.PlaybackKeeper || null;
  }

  function apiBase() {
    // The WebView loads from its own origin, so a relative /api/* call only
    // works when the Express backend is serving this page.
    return (typeof window.API_BASE === 'string' && window.API_BASE) ? window.API_BASE : '';
  }

  function loadJson(url) {
    return fetch(url).then(function (r) {
      if (!r.ok) throw new Error('HTTP ' + r.status);
      return r.json();
    });
  }

  function getArtist(name) {
    var key = String(name || '').trim();
    if (!key) return Promise.reject(new Error('no name'));
    var hit = artistCache[key.toLowerCase()];
    if (hit && Date.now() - hit.at < CACHE_TTL) return Promise.resolve(hit.data);

    var p = plugin();
    var request;
    if (p && typeof p.artist === 'function') {
      request = p.artist({ name: key }).then(function (res) {
        return JSON.parse((res && res.artist) || 'null');
      });
    } else {
      request = loadJson(apiBase() + '/api/artist?name=' + encodeURIComponent(key));
    }
    return request.then(function (data) {
      if (!data || !Array.isArray(data.songs) || !data.songs.length) {
        throw new Error('artist not found');
      }
      artistCache[key.toLowerCase()] = { at: Date.now(), data: data };
      return data;
    });
  }

  function getAlbum(albumId) {
    if (!albumId) return Promise.reject(new Error('no album'));
    var hit = albumCache[albumId];
    if (hit && Date.now() - hit.at < CACHE_TTL) return Promise.resolve(hit.data);

    var p = plugin();
    var request;
    if (p && typeof p.album === 'function') {
      request = p.album({ id: albumId }).then(function (res) {
        return JSON.parse((res && res.album) || 'null');
      });
    } else {
      request = loadJson(apiBase() + '/api/album?id=' + encodeURIComponent(albumId));
    }
    return request.then(function (data) {
      if (!data || !Array.isArray(data.tracks) || !data.tracks.length) {
        throw new Error('album empty');
      }
      albumCache[albumId] = { at: Date.now(), data: data };
      return data;
    });
  }

  // ---------------------------------------------------------------- utils

  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  function toast(msg) {
    if (typeof window.showToast === 'function') window.showToast(msg);
  }

  function fmtDur(sec) {
    if (!sec || sec < 0) return '';
    var m = Math.floor(sec / 60);
    var s = Math.round(sec % 60);
    return m + ':' + (s < 10 ? '0' + s : s);
  }

  function fallbackImg() {
    return 'https://images.unsplash.com/photo-1511671782779-c97d3d27a1d4?w=600&auto=format&fit=crop&q=80';
  }

  function songThumb(t) {
    return t.thumbnail || ('https://i.ytimg.com/vi/' + t.videoId + '/hqdefault.jpg');
  }

  // ---------------------------------------------------------------- sheet

  function ensureSheet() {
    if (root) return;
    root = document.createElement('div');
    root.className = 'artist-sheet-wrap';
    root.id = 'artistSheet';
    root.innerHTML =
      '<div class="artist-sheet-backdrop" data-artist-close="1"></div>' +
      '<div class="artist-sheet" role="dialog" aria-modal="true" aria-label="Artist">' +
        '<div class="artist-sheet-bar">' +
          '<button class="artist-sheet-back" id="artistSheetBack" aria-label="Back" hidden>' +
            '<svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor">' +
              '<path d="M15.5 4.5 8 12l7.5 7.5 1.4-1.4L10.8 12l6.1-6.1z"/></svg>' +
          '</button>' +
          '<div class="artist-sheet-title" id="artistSheetTitle"></div>' +
          '<button class="artist-sheet-close" id="artistSheetClose" aria-label="Close">' +
            '<svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">' +
              '<path d="m6.4 5 5.6 5.6L17.6 5 19 6.4 13.4 12 19 17.6 17.6 19 12 13.4 6.4 19 5 17.6 10.6 12 5 6.4z"/></svg>' +
          '</button>' +
        '</div>' +
        '<div class="artist-sheet-scroll" id="artistSheetScroll"></div>' +
      '</div>';
    document.body.appendChild(root);

    scrollEl = root.querySelector('#artistSheetScroll');
    titleEl = root.querySelector('#artistSheetTitle');
    backBtn = root.querySelector('#artistSheetBack');

    root.querySelector('#artistSheetClose').addEventListener('click', close);
    root.querySelector('.artist-sheet-backdrop').addEventListener('click', close);
    backBtn.addEventListener('click', function () {
      var prev = viewStack.length > 1 ? viewStack[viewStack.length - 2] : null;
      viewStack = viewStack.slice(0, -1);
      if (prev) {
        if (prev.kind === 'artist') renderArtist(prev.data, true);
        else renderAlbum(prev.data, true);
      }
    });
  }

  function openSheet() {
    ensureSheet();
    root.classList.add('open');
    document.body.classList.add('artist-sheet-open');
  }

  function close() {
    if (!root) return;
    root.classList.remove('open');
    document.body.classList.remove('artist-sheet-open');
    viewStack = [];
  }

  // ---------------------------------------------------------------- render

  function playList(tracks, startIndex) {
    if (!tracks || !tracks.length) return;
    var from = startIndex || 0;
    if (window.player && typeof window.player.playTrack === 'function') {
      window.player.playTrack(tracks[from], tracks);
    }
    toast('Playing ' + tracks[from].title);
  }

  function songRow(track, index, list) {
    var row = document.createElement('div');
    row.className = 'artist-song-row';
    row.innerHTML =
      '<div class="artist-song-num">' + (index + 1) + '</div>' +
      '<img class="artist-song-thumb" loading="lazy" alt="" src="' + esc(songThumb(track)) + '" ' +
        'onerror="this.style.visibility=\'hidden\'" />' +
      '<div class="artist-song-info">' +
        '<div class="artist-song-title">' + esc(track.title) + '</div>' +
        '<div class="artist-song-sub">' + esc(track.artist || '') + '</div>' +
      '</div>' +
      '<div class="artist-song-dur">' +
        esc(track.durationKnown === false ? '' : fmtDur(track.durationSec)) + '</div>';
    row.addEventListener('click', function () { playList(list, index); });
    return row;
  }

  function albumCard(album, parentArtist) {
    var card = document.createElement('div');
    card.className = 'artist-album-card';
    card.innerHTML =
      '<img class="artist-album-img" loading="lazy" alt="" src="' +
        esc(album.thumbnail || fallbackImg()) + '" onerror="this.src=\'' + fallbackImg() + '\'" />' +
      '<div class="artist-album-name">' + esc(album.title) + '</div>' +
      '<div class="artist-album-year">' + esc(album.year || '') + '</div>';
    card.addEventListener('click', function () {
      openAlbum(album.albumId, parentArtist);
    });
    return card;
  }

  function renderArtist(data, keepStack) {
    ensureSheet();
    titleEl.textContent = data.name || 'Artist';
    backBtn.hidden = viewStack.length <= 1;
    scrollEl.innerHTML = '';
    scrollEl.scrollTop = 0;

    var head = document.createElement('div');
    head.className = 'artist-head';
    head.innerHTML =
      '<img class="artist-head-img" alt="" src="' + esc(data.thumbnail || fallbackImg()) +
        '" onerror="this.src=\'' + fallbackImg() + '\'" />' +
      '<div class="artist-head-name">' + esc(data.name || 'Artist') + '</div>' +
      '<div class="artist-head-meta">' +
        (data.songs ? data.songs.length + ' top songs' : '') +
        (data.albums && data.albums.length ? ' · ' + data.albums.length + ' releases' : '') +
      '</div>';
    var playAll = document.createElement('button');
    playAll.className = 'artist-play-all';
    playAll.innerHTML = '<svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor">' +
      '<path d="M8 5v14l11-7z"/></svg><span>Play</span>';
    playAll.addEventListener('click', function () { playList(data.songs || [], 0); });
    head.appendChild(playAll);
    scrollEl.appendChild(head);

    if (data.songs && data.songs.length) {
      var h = document.createElement('div');
      h.className = 'artist-section-title';
      h.textContent = 'Top songs';
      scrollEl.appendChild(h);
      data.songs.forEach(function (t, i) {
        scrollEl.appendChild(songRow(t, i, data.songs));
      });
    }

    if (data.albums && data.albums.length) {
      var ah = document.createElement('div');
      ah.className = 'artist-section-title';
      ah.textContent = 'Albums & singles';
      scrollEl.appendChild(ah);
      var strip = document.createElement('div');
      strip.className = 'artist-album-row';
      data.albums.forEach(function (a) { strip.appendChild(albumCard(a, data)); });
      scrollEl.appendChild(strip);
    }

    if (!keepStack) {
      viewStack = [{ kind: 'artist', data: data }];
    } else {
      viewStack[viewStack.length - 1] = { kind: 'artist', data: data };
      backBtn.hidden = viewStack.length <= 1;
    }
    openSheet();
  }

  function renderAlbum(data, keepStack) {
    ensureSheet();
    titleEl.textContent = data.name || 'Album';
    scrollEl.innerHTML = '';
    scrollEl.scrollTop = 0;

    var head = document.createElement('div');
    head.className = 'artist-head artist-head-album';
    head.innerHTML =
      '<img class="artist-head-img" alt="" src="' + esc(data.thumbnail || fallbackImg()) +
        '" onerror="this.src=\'' + fallbackImg() + '\'" />' +
      '<div class="artist-head-name">' + esc(data.name || 'Album') + '</div>' +
      '<div class="artist-head-meta">' +
        esc([data.artist, data.year].filter(Boolean).join(' · ')) +
      '</div>';
    var playAll = document.createElement('button');
    playAll.className = 'artist-play-all';
    playAll.innerHTML = '<svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor">' +
      '<path d="M8 5v14l11-7z"/></svg><span>Play album</span>';
    playAll.addEventListener('click', function () { playList(data.tracks || [], 0); });
    head.appendChild(playAll);
    scrollEl.appendChild(head);

    (data.tracks || []).forEach(function (t, i) {
      scrollEl.appendChild(songRow(t, i, data.tracks));
    });

    if (!keepStack) {
      viewStack = [{ kind: 'album', data: data }];
    } else {
      viewStack[viewStack.length - 1] = { kind: 'album', data: data };
    }
    backBtn.hidden = viewStack.length <= 1;
    openSheet();
  }

  function showLoading(name) {
    ensureSheet();
    titleEl.textContent = name || 'Artist';
    backBtn.hidden = viewStack.length <= 1;
    scrollEl.innerHTML = '<div class="artist-loading">Loading ' + esc(name || 'artist') + '…</div>';
    openSheet();
  }

  function showError(name, retry) {
    ensureSheet();
    scrollEl.innerHTML = '';
    var box = document.createElement('div');
    box.className = 'artist-empty';
    box.innerHTML = '<div class="artist-empty-title">Could not load ' + esc(name || 'this artist') + '</div>' +
      '<div class="artist-empty-sub">Check your connection and try again.</div>';
    var btn = document.createElement('button');
    btn.className = 'artist-retry';
    btn.textContent = 'Retry';
    btn.addEventListener('click', retry);
    box.appendChild(btn);
    scrollEl.appendChild(box);
  }

  // ---------------------------------------------------------------- API

  function open(name) {
    var clean = String(name || '').trim();
    if (!clean) return;
    var cached = artistCache[clean.toLowerCase()];
    if (cached) { renderArtist(cached.data, false); return; }
    showLoading(clean);
    getArtist(clean).then(function (data) {
      renderArtist(data, false);
    }).catch(function () {
      showError(clean, function () { open(clean); });
    });
  }

  function openAlbum(albumId, parentArtist) {
    if (!albumId) return;
    var known = parentArtist && parentArtist.albums
      ? parentArtist.albums.filter(function (a) { return a.albumId === albumId; })[0]
      : null;
    showLoading(known ? known.title : 'album');
    var parentView = parentArtist
      ? { kind: 'artist', data: parentArtist }
      : (viewStack.length && viewStack[viewStack.length - 1].kind === 'artist'
        ? viewStack[viewStack.length - 1] : null);
    getAlbum(albumId).then(function (data) {
      renderAlbum(data, false);
      if (parentView) {
        viewStack = [parentView, { kind: 'album', data: data }];
        backBtn.hidden = false;
      }
    }).catch(function () {
      showError('this album', function () { openAlbum(albumId, parentArtist); });
    });
  }

  // Delegated: any element with data-artist-open="<name>" opens the sheet.
  document.addEventListener('click', function (e) {
    var target = e.target && e.target.closest ? e.target.closest('[data-artist-open]') : null;
    if (!target) return;
    var name = target.getAttribute('data-artist-open');
    if (!name) return;
    e.preventDefault();
    e.stopPropagation();
    open(name);
  }, true);

  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape' && root && root.classList.contains('open')) {
      if (viewStack.length > 1) backBtn.click();
      else close();
    }
  });

  window.SimpMusicArtist = {
    open: open,
    openAlbum: openAlbum,
    close: close
  };
})();
