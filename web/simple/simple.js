/* String Music Simple — local library player.
 *
 * Everything here works with files already on the device. There is no fetch(),
 * no stream URL, no API client: the native bridge reads MediaStore and plays
 * content:// URIs through ExoPlayer.
 */
(function () {
  'use strict';

  var APP_VERSION = '1.0.0';
  var LIKED_KEY = 'stringmusic_simple_liked';
  var SETTINGS_KEY = 'stringmusic_simple_settings';

  // Injected by js/build-config.js. Defaults keep a broken/missing config from
  // taking the app down.
  var IS_ELITE = typeof window.ELITE_BUILD === 'boolean' ? window.ELITE_BUILD : false;
  var RELEASES_URL = window.ELITE_RELEASES_URL ||
    'https://github.com/Guhan-N/String-Music/releases/latest';

  var plugins = (window.Capacitor && window.Capacitor.Plugins) || {};
  var Library = plugins.LocalLibrary || null;
  var Native = plugins.LocalPlayer || null;

  var state = {
    songs: [],
    liked: loadLiked(),
    filter: '',
    tab: 'songs',
    currentUri: null,
    playing: false,
    position: 0,
    duration: 0,
    seeking: false,
    scanned: false
  };

  /* ── elements ─────────────────────────────────────────── */
  var $ = function (id) { return document.getElementById(id); };
  var libMeta = $('libMeta');
  var searchInput = $('search');
  var songList = $('songList');
  var likedList = $('likedList');
  var songsEmpty = $('songsEmpty');
  var likedEmpty = $('likedEmpty');
  var playerBar = $('playerBar');
  var seek = $('seek');
  var tNow = $('tNow');
  var tEnd = $('tEnd');
  var npArt = $('npArt');
  var npTitle = $('npTitle');
  var npArtist = $('npArtist');
  var playBtn = $('playBtn');
  var likeBtn = $('likeBtn');
  var syncCode = $('syncCode');

  /* ── helpers ──────────────────────────────────────────── */

  function fmt(seconds) {
    if (!isFinite(seconds) || seconds <= 0) return '0:00';
    var total = Math.floor(seconds);
    var m = Math.floor(total / 60);
    var s = total % 60;
    return m + ':' + (s < 10 ? '0' : '') + s;
  }

  function toast(message) {
    var el = $('toast');
    el.textContent = message;
    el.hidden = false;
    clearTimeout(toast._t);
    toast._t = setTimeout(function () { el.hidden = true; }, 2400);
  }

  function loadLiked() {
    try {
      var raw = JSON.parse(localStorage.getItem(LIKED_KEY) || '[]');
      return Array.isArray(raw) ? raw : [];
    } catch (e) {
      return [];
    }
  }

  function saveLiked() {
    try {
      localStorage.setItem(LIKED_KEY, JSON.stringify(state.liked));
    } catch (e) { /* storage full — likes still work for this session */ }
    $('statLiked').textContent = state.liked.length;
  }

  function settings() {
    try {
      return JSON.parse(localStorage.getItem(SETTINGS_KEY) || '{}');
    } catch (e) {
      return {};
    }
  }

  // MediaStore reports missing artist tags as the literal "<unknown>".
  function artistName(song) {
    var name = (song && song.artist) || '';
    if (!name || /^<?unknown>?$/i.test(name.trim())) return 'Unknown artist';
    return name;
  }

  function isLiked(song) {
    return state.liked.some(function (s) { return s.uri === song.uri; });
  }

  function toggleLike(song) {
    if (!song) return;
    var index = -1;
    for (var i = 0; i < state.liked.length; i++) {
      if (state.liked[i].uri === song.uri) { index = i; break; }
    }
    if (index >= 0) {
      state.liked.splice(index, 1);
      toast('Removed from liked songs');
    } else {
      state.liked.unshift({
        uri: song.uri,
        id: song.id,
        title: song.title,
        artist: song.artist,
        album: song.album,
        albumId: song.albumId,
        duration: song.duration
      });
      toast('Added to liked songs');
    }
    saveLiked();
    renderLiked();
    renderSongs();
    updateLikeButtons();
  }

  function currentSong() {
    for (var i = 0; i < state.songs.length; i++) {
      if (state.songs[i].uri === state.currentUri) return state.songs[i];
    }
    for (var j = 0; j < state.liked.length; j++) {
      if (state.liked[j].uri === state.currentUri) return state.liked[j];
    }
    return null;
  }

  /* ── artwork (native decode, cached) ─────────────────── */

  var artCache = {};
  var artQueue = [];
  var artBusy = false;

  function paintArt(box, song) {
    if (!song || !song.albumId || !Library) return;
    var cached = artCache[song.albumId];
    if (cached === null) return;
    if (cached) {
      setArt(box, cached);
      return;
    }
    artQueue.push({ box: box, albumId: song.albumId });
    if (!artBusy) drainArtQueue();
  }

  function drainArtQueue() {
    var job = artQueue.shift();
    if (!job) { artBusy = false; return; }
    artBusy = true;
    Library.getArtwork({ albumId: job.albumId }).then(function (res) {
      var data = res && res.artwork ? res.artwork : null;
      artCache[job.albumId] = data;
      if (data && job.box.isConnected) setArt(job.box, data);
    }).catch(function () {
      artCache[job.albumId] = null;
    }).then(function () {
      // Yield to the UI thread between decodes.
      setTimeout(drainArtQueue, 0);
    });
  }

  function setArt(box, dataUrl) {
    box.innerHTML = '';
    var img = document.createElement('img');
    img.src = dataUrl;
    img.alt = '';
    box.appendChild(img);
  }

  /* ── rendering ────────────────────────────────────────── */

  function visibleSongs() {
    var q = state.filter.trim().toLowerCase();
    if (!q) return state.songs;
    return state.songs.filter(function (s) {
      return (s.title || '').toLowerCase().indexOf(q) !== -1 ||
        (s.artist || '').toLowerCase().indexOf(q) !== -1 ||
        (s.album || '').toLowerCase().indexOf(q) !== -1;
    });
  }

  function buildRow(song, queue) {
    var li = document.createElement('li');
    li.className = 'row' + (song.uri === state.currentUri ? ' playing' : '');
    li.setAttribute('data-uri', song.uri);

    var art = document.createElement('div');
    art.className = 'row-art';
    art.textContent = '♪';
    paintArt(art, song);

    var info = document.createElement('div');
    info.className = 'row-info';
    var title = document.createElement('div');
    title.className = 'row-title';
    title.textContent = song.title || 'Unknown title';
    var sub = document.createElement('div');
    sub.className = 'row-sub';
    sub.textContent = artistName(song) +
      (song.album ? ' · ' + song.album : '');
    info.appendChild(title);
    info.appendChild(sub);

    var dur = document.createElement('span');
    dur.className = 'row-dur';
    dur.textContent = fmt(song.duration);

    var like = document.createElement('button');
    like.className = 'row-like' + (isLiked(song) ? ' liked' : '');
    like.type = 'button';
    like.textContent = isLiked(song) ? '♥' : '♡';
    like.setAttribute('aria-label', 'Like song');
    like.addEventListener('click', function (event) {
      event.stopPropagation();
      toggleLike(song);
    });

    li.appendChild(art);
    li.appendChild(info);
    li.appendChild(dur);
    li.appendChild(like);
    li.addEventListener('click', function () { playFromList(song, queue); });
    return li;
  }

  function renderSongs() {
    var songs = visibleSongs();
    songList.innerHTML = '';
    var fragment = document.createDocumentFragment();
    songs.forEach(function (song) {
      fragment.appendChild(buildRow(song, songs));
    });
    songList.appendChild(fragment);

    var blocked = !state.scanned && !songs.length;
    songsEmpty.hidden = songs.length > 0;
    if (!songs.length) {
      songsEmpty.innerHTML = '';
      var glyph = document.createElement('div');
      glyph.className = 'empty-glyph';
      glyph.textContent = state.filter ? '🔍' : '🎧';
      var heading = document.createElement('h2');
      heading.textContent = state.filter
        ? 'No matches for "' + state.filter + '"'
        : (blocked ? 'No music access yet' : 'No audio files found');
      var note = document.createElement('p');
      note.textContent = state.filter
        ? 'Try a different title, artist or album.'
        : 'String Music shows MP3, FLAC, AAC and other audio files stored on this device.';
      songsEmpty.appendChild(glyph);
      songsEmpty.appendChild(heading);
      songsEmpty.appendChild(note);

      if (!state.filter && blocked) {
        var allow = document.createElement('button');
        allow.className = 'btn';
        allow.type = 'button';
        allow.textContent = 'Allow access to my music';
        allow.addEventListener('click', function () { requestAccess(true); });
        songsEmpty.appendChild(allow);
      }
    }
  }

  function renderLiked() {
    likedList.innerHTML = '';
    var fragment = document.createDocumentFragment();
    state.liked.forEach(function (song) {
      fragment.appendChild(buildRow(song, state.liked));
    });
    likedList.appendChild(fragment);
    likedEmpty.hidden = state.liked.length > 0;
    $('statLiked').textContent = state.liked.length;
  }

  function highlightCurrent() {
    var rows = document.querySelectorAll('.row');
    for (var i = 0; i < rows.length; i++) {
      var row = rows[i];
      var active = state.currentUri && row.getAttribute('data-uri') === state.currentUri;
      row.classList.toggle('playing', !!active);
    }
  }

  /* ── library scan ─────────────────────────────────────── */

  function requestAccess(interactive) {
    if (!Library) {
      libMeta.textContent = 'Browser preview — open the app on your phone';
      state.scanned = true;
      renderSongs();
      return Promise.resolve(false);
    }
    return Library.ensureAccess().then(function (res) {
      if (res && res.granted) return scanLibrary();
      state.scanned = true;
      libMeta.textContent = 'Music access is off';
      renderSongs();
      if (interactive) toast('Allow music access to see your songs');
      return false;
    }).catch(function () {
      state.scanned = true;
      libMeta.textContent = 'Could not read the library';
      renderSongs();
    });
  }

  function scanLibrary() {
    libMeta.textContent = 'Scanning your library…';
    return Library.getSongs().then(function (res) {
      var songs = (res && res.songs) || [];
      state.songs = songs.filter(function (s) { return s && s.uri; });
      state.scanned = true;
      var artists = {};
      state.songs.forEach(function (s) { artists[artistName(s)] = 1; });
      $('statSongs').textContent = state.songs.length;
      $('statArtists').textContent = Object.keys(artists).length;
      libMeta.textContent = state.songs.length
        ? state.songs.length + ' songs · ' + Object.keys(artists).length + ' artists'
        : 'No audio files found';
      renderSongs();
      renderLiked();
      return true;
    }).catch(function () {
      state.scanned = true;
      libMeta.textContent = 'Could not read the library';
      renderSongs();
      return false;
    });
  }

  /* ── playback ─────────────────────────────────────────── */

  function playFromList(song, queue) {
    if (!Native) {
      toast('Playback is available in the Android app');
      return;
    }
    var albumArt = function (item) {
      return item.albumId ? 'content://media/external/audio/albumart/' + item.albumId : '';
    };
    var startIndex = 0;
    for (var i = 0; i < queue.length; i++) {
      if (queue[i].uri === song.uri) { startIndex = i; break; }
    }
    Native.playQueue({
      uris: queue.map(function (s) { return s.uri; }),
      titles: queue.map(function (s) { return s.title || ''; }),
      artists: queue.map(function (s) { return s.artist || ''; }),
      albums: queue.map(function (s) { return s.album || ''; }),
      artwork: queue.map(albumArt),
      startIndex: startIndex
    }).then(function () {
      setNowPlaying(song);
      state.playing = true;
      state.duration = song.duration || 0;
      state.position = 0;
      renderPlayer();
      renderSongs();
    }).catch(function () {
      toast('Could not play this file');
    });
  }

  function setNowPlaying(song) {
    state.currentUri = song.uri;
    npTitle.textContent = song.title || 'Unknown title';
    npArtist.textContent = artistName(song);
    npArt.innerHTML = '<span>♪</span>';
    paintArt(npArt, song);
    playerBar.hidden = false;
    highlightCurrent();
    updateLikeButtons();
  }

  function updateLikeButtons() {
    var song = currentSong();
    var liked = song ? isLiked(song) : false;
    likeBtn.textContent = liked ? '♥' : '♡';
    likeBtn.classList.toggle('liked', liked);
  }

  function renderPlayer() {
    playBtn.textContent = state.playing ? '❚❚' : '▶';
    tNow.textContent = fmt(state.position);
    tEnd.textContent = fmt(state.duration);
    if (state.seeking) return;
    var max = Math.max(1, state.duration);
    seek.value = String(Math.round((state.position / max) * 1000));
  }

  function pollStatus() {
    if (!Native || playerBar.hidden) return;
    Native.status().then(function (st) {
      if (!st || !st.ready) return;
      state.playing = !!st.playing;
      if (!state.seeking) {
        state.position = st.position || 0;
        if (st.duration) state.duration = st.duration;
      }
      if (st.mediaId && st.mediaId !== state.currentUri) {
        state.currentUri = st.mediaId;
        npTitle.textContent = st.title || 'Unknown title';
        npArtist.textContent = st.artist || '';
        npArt.innerHTML = '<span>♪</span>';
        paintArt(npArt, currentSong() || { albumId: 0 });
        highlightCurrent();
        updateLikeButtons();
      }
      renderPlayer();
    }).catch(function () {});
  }

  if (Native) {
    setInterval(pollStatus, 500);
  }

  /* ── export / copy ────────────────────────────────────── */

  function buildSyncCode() {
    var payload = {
      app: 'stringmusic-simple',
      version: 1,
      exportedAt: new Date().toISOString(),
      liked: state.liked,
      settings: settings()
    };
    var json = JSON.stringify(payload);
    return btoa(unescape(encodeURIComponent(json)));
  }

  $('exportBtn').addEventListener('click', function () {
    syncCode.value = buildSyncCode();
    syncCode.hidden = false;
    $('copyBtn').hidden = false;
    syncCode.focus();
    syncCode.select();
    toast('Sync code ready');
  });

  $('copyBtn').addEventListener('click', function () {
    var text = syncCode.value || buildSyncCode();
    var done = function () { toast('Copied'); };
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(done).catch(function () {
        syncCode.select();
        toast('Long-press the code to copy');
      });
    } else {
      syncCode.select();
      toast('Long-press the code to copy');
    }
  });

  /* ── terms + Elite link ───────────────────────────────── */

  $('learnMoreBtn').addEventListener('click', function () {
    $('termsOverlay').hidden = false;
  });

  $('termsCancel').addEventListener('click', function () {
    $('termsOverlay').hidden = true;
  });

  $('termsContinue').addEventListener('click', function () {
    $('termsOverlay').hidden = true;
    openExternal(RELEASES_URL);
  });

  function openExternal(url) {
    // Hand-off only: the app opens a browser URL and does nothing else.
    var opened = null;
    try {
      opened = window.open(url, '_system');
    } catch (e) {
      opened = null;
    }
    if (!opened && Library && Library.openExternal) {
      Library.openExternal({ url: url }).catch(function () {
        toast('Could not open a browser');
      });
    }
  }

  /* ── tabs / search ────────────────────────────────────── */

  var tabs = document.querySelectorAll('.tab');
  Array.prototype.forEach.call(tabs, function (tab) {
    tab.addEventListener('click', function () {
      var name = tab.getAttribute('data-tab');
      state.tab = name;
      Array.prototype.forEach.call(tabs, function (other) {
        other.classList.toggle('active', other === tab);
      });
      $('view-songs').hidden = name !== 'songs';
      $('view-liked').hidden = name !== 'liked';
      $('view-settings').hidden = name !== 'settings';
      // Each tab starts at its own top instead of inheriting the last scroll.
      var main = document.querySelector('.main');
      if (main) main.scrollTop = 0;
    });
  });

  searchInput.addEventListener('input', function () {
    state.filter = searchInput.value || '';
    renderSongs();
  });

  $('rescanBtn').addEventListener('click', function () {
    var button = $('rescanBtn');
    button.classList.add('spin');
    artCache = {};
    requestAccess(false).then(function () {
      button.classList.remove('spin');
    });
  });

  playBtn.addEventListener('click', function () {
    if (!Native) { toast('Playback is available in the Android app'); return; }
    Native.toggle().then(function () {
      state.playing = !state.playing;
      renderPlayer();
    }).catch(function () {});
  });

  $('nextBtn').addEventListener('click', function () {
    if (Native) Native.next().catch(function () {});
  });

  $('prevBtn').addEventListener('click', function () {
    if (Native) Native.previous().catch(function () {});
  });

  likeBtn.addEventListener('click', function () {
    toggleLike(currentSong());
  });

  seek.addEventListener('input', function () {
    state.seeking = true;
    var max = Math.max(1, state.duration);
    tNow.textContent = fmt((Number(seek.value) / 1000) * max);
  });

  seek.addEventListener('change', function () {
    var max = Math.max(1, state.duration);
    var target = (Number(seek.value) / 1000) * max;
    state.seeking = false;
    state.position = target;
    tNow.textContent = fmt(target);
    if (Native) Native.seekTo({ positionSec: target }).catch(function () {});
  });

  /* ── boot ─────────────────────────────────────────────── */

  // Elite builds never show the Play-Store-era card or the terms screen.
  if (IS_ELITE) {
    var card = $('eliteCard');
    if (card) card.remove();
  }

  $('appVersion').textContent = APP_VERSION;
  $('statLiked').textContent = state.liked.length;
  renderLiked();
  renderSongs();
  requestAccess(false);
})();
