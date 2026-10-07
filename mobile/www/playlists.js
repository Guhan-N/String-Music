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

  function all() {
    try {
      var arr = JSON.parse(localStorage.getItem(KEY) || '[]');
      return Array.isArray(arr) ? arr : [];
    } catch (e) { return []; }
  }

  function save(list) {
    try { localStorage.setItem(KEY, JSON.stringify(list)); } catch (e) {}
  }

  function byId(id) {
    return all().filter(function (p) { return p.id === id; })[0] || null;
  }

  function create(name) {
    var list = all();
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
    save(all().filter(function (p) { return p.id !== id; }));
  }

  function addTrack(id, track) {
    var list = all();
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
    return '<div class="pl-card" data-id="' + esc(pl.id) + '">'
      + '<div class="pl-card-cover">'
      + (cover ? '<img loading="lazy" src="' + esc(cover) + '" alt="" />' : '<span>🎵</span>')
      + '<button class="pl-card-play" title="Play all">▶</button>'
      + '</div>'
      + '<div class="pl-card-name">' + esc(pl.name) + '</div>'
      + '<div class="pl-card-count">' + pl.tracks.length + ' song' + (pl.tracks.length === 1 ? '' : 's') + '</div>'
      + '<button class="pl-card-del" title="Delete playlist">✕</button>'
      + '</div>';
  }

  function renderMobile() {
    var grid = document.getElementById('mobilePlaylistsGrid');
    if (!grid) return;
    var list = all();
    if (!list.length) {
      grid.innerHTML = '<div class="pl-empty">No playlists yet.<br>Tap <b>+ New Playlist</b> to start one,<br>then add songs via the ⋮ button on any song.</div>';
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
      card.querySelector('.pl-card-del').addEventListener('click', function (e) {
        e.stopPropagation();
        var pl = byId(id);
        if (pl && confirm('Delete playlist "' + pl.name + '"?')) {
          remove(id);
          renderMobile(); renderDesktop();
          if (window.showToast) window.showToast('Playlist deleted');
        }
      });
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

  // ---------------- UI: action sheet (⋮ on any song) ----------------

  function actionSheet(track) {
    closeSheet();
    var playlists = all();
    var sheet = document.createElement('div');
    sheet.className = 'cat-overlay pl-sheet-wrap';
    sheet.id = 'plSheet';
    var items = playlists.map(function (p) {
      return '<button class="pl-sheet-item" data-add="' + esc(p.id) + '">➕ ' + esc(p.name) + '</button>';
    }).join('');
    sheet.innerHTML = '<div class="pl-sheet">'
      + '<div class="pl-sheet-song"><b>' + esc(track.title) + '</b><span>' + esc(track.artist || '') + '</span></div>'
      + '<button class="pl-sheet-item" data-play="1">▶&nbsp; Play now</button>'
      + '<div class="pl-sheet-sep">ADD TO PLAYLIST</div>'
      + (items || '<div class="pl-sheet-none">No playlists yet</div>')
      + '<button class="pl-sheet-item" data-new="1">🎵 New playlist…</button>'
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
      if (btn.dataset.play) {
        closeSheet(); playTrack(track);
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

  var pendingAdd = null;

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
      durationSec: parseInt(el.dataset.durationSec || '0', 10) || 0,
      thumbnail: el.dataset.thumb || el.querySelector('img')?.src || ''
    };
  }

  document.addEventListener('click', function (e) {
    var more = e.target.closest('.mobile-v2-more-btn');
    if (!more) return;
    // Playlist sheet is Library-only: New Releases / search / home must not
    // offer it — only elements inside the Library views qualify.
    var inLibrary = more.closest('#mobileLibraryView, #desktopPlaylistsView, .pl-card, .pl-sheet');
    if (!inLibrary) return;
    var item = more.closest('[data-video]');
    if (!item) return;
    e.preventDefault();
    e.stopPropagation();
    actionSheet(trackFromEl(item));
  }, true); // capture: runs before per-item handlers

  // ---------------- Boot / public API ----------------

  window.SimpMusicPlaylists = {
    all: all, create: create, remove: remove, addTrack: addTrack, byId: byId,
    renderMobile: renderMobile, renderDesktop: renderDesktop,
    createFlow: createFlow, actionSheet: actionSheet, playAll: playAll
  };

  function boot() {
    var mBtn = document.getElementById('mobileNewPlaylistBtn');
    var dBtn = document.getElementById('desktopNewPlaylistBtn');
    if (mBtn) mBtn.addEventListener('click', createFlow);
    if (dBtn) dBtn.addEventListener('click', function () { createFlow(); renderDesktop(); });
    renderMobile();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
})();
