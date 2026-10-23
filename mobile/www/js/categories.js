/**
 * Language Categories feature
 * - Shows a one-time picker on first launch (Tamil, English, Hindi, ...).
 * - Saves selection to localStorage (simpmusic_categories).
 * - Home page "New Releases" is rendered per selected language and refreshes
 *   every visit: native NewPipe search inside the APK, backend genres on web.
 */
(function () {
  'use strict';

  var STORAGE_KEY = 'simpmusic_categories';

  var CATEGORIES = [
    { id: 'tamil',     label: 'தமிழ் Tamil',    query: 'Tamil latest hit songs' },
    { id: 'english',   label: 'English',         query: 'English top hits songs' },
    { id: 'hindi',     label: 'हिंदी Hindi',     query: 'Hindi latest hit songs' },
    { id: 'marathi',   label: 'मराठी Marathi',   query: 'Marathi latest hit songs' },
    { id: 'telugu',    label: 'తెలుగు Telugu',    query: 'Telugu latest hit songs' },
    { id: 'malayalam', label: 'മലയാളം Malayalam', query: 'Malayalam latest hit songs' },
    { id: 'kannada',   label: 'ಕನ್ನಡ Kannada',    query: 'Kannada latest hit songs' },
    { id: 'punjabi',   label: 'ਪੰਜਾਬੀ Punjabi',   query: 'Punjabi latest hit songs' }
  ];

  function getSelected() {
    try {
      var raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return null;
      var arr = JSON.parse(raw);
      return Array.isArray(arr) && arr.length > 0 ? arr : null;
    } catch (e) { return null; }
  }

  function saveSelected(arr) {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(arr)); } catch (e) {}
  }

  /**
   * v3.20.8: tell the rest of the app that the language list changed, so Home's
   * "Current Trending" and the chart cards re-query in the new languages instead
   * of keeping whatever they rendered before the pick.
   */
  function notifyLanguagesChanged() {
    try {
      window.dispatchEvent(new CustomEvent('simp:languages-changed'));
    } catch (e) {
      // Very old WebView without CustomEvent: the caches still expire on TTL.
    }
  }

  function nativeSearch(query, timeoutMs) {
    timeoutMs = timeoutMs || 10000;
    return new Promise(function (resolve) {
      try {
        var cap = window.Capacitor;
        if (!cap || !cap.isPluginAvailable || !cap.isPluginAvailable('PlaybackKeeper')) {
          resolve(null);
          return;
        }
        var done = false;
        var timer = setTimeout(function () {
          if (!done) { done = true; resolve(null); }
        }, timeoutMs);
        cap.Plugins.PlaybackKeeper.search({ query: query }).then(function (res) {
          if (done) return;
          done = true;
          clearTimeout(timer);
          try {
            var parsed = JSON.parse(res.results);
            resolve(Array.isArray(parsed) ? parsed : null);
          } catch (e) { resolve(null); }
        }).catch(function () {
          if (!done) { done = true; clearTimeout(timer); resolve(null); }
        });
      } catch (e) { resolve(null); }
    });
  }

  function backendSearch(query, timeoutMs) {
    return new Promise(function (resolve) {
      try {
        var controller = new AbortController();
        var timer = setTimeout(function () { controller.abort(); }, timeoutMs || 8000);
        fetch('/api/search?q=' + encodeURIComponent(query), { signal: controller.signal })
          .then(function (r) { clearTimeout(timer); return r.ok ? r.json() : null; })
          .then(function (data) { resolve(Array.isArray(data) && data.length ? data : null); })
          .catch(function () { resolve(null); });
      } catch (e) { resolve(null); }
    });
  }

  /**
   * v3.20.4: one fixed query per language meant every language row (and the
   * Home "Current Trending" list, which is built from these searches) showed
   * the exact same songs forever. Rotate through freshness-angled variants in
   * 6h buckets — the language word stays first so results stay on-language,
   * while the month/year stamp surfaces newly released songs.
   */
  function queryVariants(cat) {
    var now = new Date();
    var year = now.getFullYear();
    var month = now.toLocaleString('en-US', { month: 'long' });
    // "தமிழ் Tamil" → "Tamil" (the ASCII language name drives the query).
    var name = String(cat.label || cat.id).replace(/[^\x20-\x7E]/g, '').trim() || cat.id;
    return [
      cat.query,
      name + ' new songs ' + month + ' ' + year,
      name + ' top hits this week',
      name + ' trending songs ' + year
    ];
  }

  function rotatedQuery(cat) {
    var variants = queryVariants(cat);
    var bucket = Math.floor(Date.now() / (6 * 60 * 60 * 1000));
    return variants[Math.abs(bucket) % variants.length];
  }

  function fetchForCategory(cat) {
    var query = rotatedQuery(cat);
    return nativeSearch(query).then(function (r) {
      // Empty result (or the variant got nothing usable) → evergreen query.
      if (r && r.length) return r;
      return nativeSearch(cat.query);
    }).then(function (r) {
      if (r && r.length) return r;
      return backendSearch(query);
    });
  }

  function trackFromItem(t) {
    return {
      videoId: t.videoId,
      title: t.title || 'Unknown',
      artist: t.artist || '',
      album: t.album || t.title || '',
      duration: t.duration || '3:30',
      durationSec: t.durationSec || 0,
      thumbnail: t.thumbnail || ('https://i.ytimg.com/vi/' + t.videoId + '/hqdefault.jpg')
    };
  }

  // ---------------- Picker overlay ----------------

  function buildOverlay() {
    var overlay = document.createElement('div');
    overlay.className = 'cat-overlay';
    overlay.id = 'catOverlay';

    var html = '';
    html += '<div class="cat-logo">🎵 String <span>Music</span></div>';
    html += '<div class="cat-sub">Pick your languages — we\'ll build your New Releases from them.<br>You can change this anytime in Settings.</div>';
    html += '<div class="cat-grid" id="catGrid"></div>';
    html += '<button class="cat-continue" id="catContinue" disabled>Continue</button>';
    html += '<button class="cat-skip" id="catSkip">Skip for now</button>';
    overlay.innerHTML = html;

    var grid = overlay.querySelector('#catGrid');
    CATEGORIES.forEach(function (cat) {
      var chip = document.createElement('div');
      chip.className = 'cat-chip';
      chip.dataset.id = cat.id;
      chip.textContent = cat.label;
      chip.addEventListener('click', function () {
        chip.classList.toggle('selected');
        updateContinue();
      });
      grid.appendChild(chip);
    });

    function updateContinue() {
      var any = overlay.querySelectorAll('.cat-chip.selected').length > 0;
      overlay.querySelector('#catContinue').disabled = !any;
    }

    overlay.querySelector('#catContinue').addEventListener('click', function () {
      var picked = [];
      overlay.querySelectorAll('.cat-chip.selected').forEach(function (chip) {
        picked.push(chip.dataset.id);
      });
      if (picked.length === 0) return;
      saveSelected(picked);
      overlay.classList.remove('active');
      setTimeout(function () { overlay.remove(); }, 250);
      loadNewReleases();
      refreshSummaries();
      notifyLanguagesChanged();
    });

    overlay.querySelector('#catSkip').addEventListener('click', function () {
      saveSelected(['english']); // sensible default rather than empty
      notifyLanguagesChanged();
      overlay.classList.remove('active');
      setTimeout(function () { overlay.remove(); }, 250);
      loadNewReleases();
      refreshSummaries();
    });

    document.body.appendChild(overlay);
    requestAnimationFrame(function () { overlay.classList.add('active'); });
  }

  function maybeShowPicker() {
    if (getSelected() === null) buildOverlay();
  }

  // ---------------- New releases rendering ----------------

  function ensureSkeleton() {
    var list = document.getElementById('mobileNewReleasesList');
    if (!list) return null;
    var section = list.closest('.mobile-v2-releases-section');
    if (section && !document.getElementById('mobileNewReleasesRow')) {
      var row = document.createElement('div');
      row.className = 'cat-lang-row';
      row.id = 'mobileNewReleasesRow';
      row.textContent = 'LOADING…';
      section.insertBefore(row, list);
    }
    return list;
  }

  function releaseItemHtml(t) {
    var thumb = t.thumbnail || ('https://i.ytimg.com/vi/' + t.videoId + '/hqdefault.jpg');
    return '<div class="mobile-v2-release-item" data-video="' + t.videoId + '"'
      + ' data-title="' + escapeAttr(t.title) + '"'
      + ' data-artist="' + escapeAttr(t.artist) + '"'
      + ' data-thumb="' + escapeAttr(thumb) + '">'
      + '<img class="mobile-v2-release-thumb" loading="lazy" src="' + escapeAttr(thumb) + '" alt="" />'
      + '<div class="mobile-v2-release-info">'
      + '<div class="mobile-v2-release-title">' + escapeHtml(t.title) + '</div>'
      + '<div class="mobile-v2-release-artist">' + escapeHtml(t.artist) + '</div>'
      + '</div>'
      + '<button class="song-menu-btn" title="More" data-video="' + escapeAttr(t.videoId) + '" data-title="' + escapeHtml(t.title) + '" data-artist="' + escapeHtml(t.artist) + '" data-thumb="' + escapeAttr(t.thumbnail || '') + '" data-durationsec="' + Math.round(t.durationSec || 0) + '">'
      + '<svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><circle cx="12" cy="5" r="2"/><circle cx="12" cy="12" r="2"/><circle cx="12" cy="19" r="2"/></svg>'
      + '</button></div>';
  }

  function escapeHtml(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  function escapeAttr(s) { return escapeHtml(s); }

  function labelFor(id) {
    var cat = CATEGORIES.filter(function (c) { return c.id === id; })[0];
    return cat ? cat.label : id;
  }

  function loadNewReleases() {
    var cats = getSelected();
    var list = ensureSkeleton();
    if (!list) return;
    if (!cats) {
      list.innerHTML = '';
      return;
    }

    var row = document.getElementById('mobileNewReleasesRow');
    if (row) row.textContent = cats.map(labelFor).join('  •  ').toUpperCase();

    list.innerHTML = '<div style="text-align:center;padding:24px;color:#71717a;font-size:0.85rem;">Loading your new releases…</div>';

    // Interleave per-language results so mixed selections show variety.
    var promises = cats.map(function (id) {
      var cat = CATEGORIES.filter(function (c) { return c.id === id; })[0];
      if (!cat) return Promise.resolve([]);
      return fetchForCategory(cat).then(function (results) {
        return (results || []).slice(0, 6).map(trackFromItem);
      });
    });

    Promise.all(promises).then(function (perLang) {
      var merged = [];
      var maxLen = Math.max.apply(null, perLang.map(function (a) { return a.length; }).concat([0]));
      for (var i = 0; i < maxLen; i++) {
        perLang.forEach(function (arr) { if (arr[i]) merged.push(arr[i]); });
      }
      // De-dupe by videoId, keep order
      var seen = {};
      merged = merged.filter(function (t) {
        if (seen[t.videoId]) return false;
        seen[t.videoId] = true;
        return true;
      });

      if (merged.length === 0) {
        list.innerHTML = '<div style="text-align:center;padding:24px;color:#71717a;font-size:0.85rem;">Could not load releases — check your connection and refresh.</div>';
        return;
      }

      list.innerHTML = merged.slice(0, 12).map(releaseItemHtml).join('');
      bindReleaseItems(list);
    });
  }

  // ---------------- Item interactions ----------------

  function bindReleaseItems(list) {
    list.querySelectorAll('.mobile-v2-release-item').forEach(function (item) {
      item.addEventListener('click', function (e) {
        if (e.target.closest('.song-menu-btn')) return; // menu button handles itself
        var track = {
          videoId: item.dataset.video,
          title: item.dataset.title || 'Song',
          artist: item.dataset.artist || '',
          album: 'New Releases',
          duration: '3:30',
          // v3.19.11: read the real length from the row's menu button
          // (data-durationsec) instead of hardcoding 0 — queued New-Release
          // tracks used to show 0:00 in the Queue sheet.
          durationSec: parseInt((function (b) { return b ? b.getAttribute('data-durationsec') : '0'; })(item.querySelector('.song-menu-btn')) || '0', 10) || 0,
          thumbnail: item.dataset.thumb || ''
        };
        if (window.player && window.player.playTrack) {
          window.player.playTrack(track, [track]);
        }
        var dock = document.getElementById('mobileMiniDock');
        if (dock) dock.style.display = 'flex';
        if (window.showToast) window.showToast('Playing ' + track.title);
      });
    });
  }

  // ---------------- Public API + boot ----------------

  window.SimpMusicCategories = {
    get: getSelected,
    set: function (arr) { saveSelected(arr); loadNewReleases(); refreshSummaries(); notifyLanguagesChanged(); },
    reload: loadNewReleases,
    showPicker: function () { if (document.getElementById('catOverlay')) return; buildOverlay(); },
    CATEGORIES: CATEGORIES,
    // v3.14: search one language's hits (native NewPipe in the APK, backend
    // on web) — used by the Search tab's language-aware Discover prefill.
    searchLanguage: function (id, limit) {
      var cat = CATEGORIES.filter(function (c) { return c.id === id; })[0];
      if (!cat) return Promise.resolve([]);
      return fetchForCategory(cat).then(function (results) {
        return (results || []).slice(0, limit || 6).map(trackFromItem);
      });
    }
  };

  // ---------------- Settings screen integration ----------------

  function refreshSummaries() {
    var cats = getSelected() || [];
    var text = cats.length ? cats.map(labelFor).join(', ') : 'No languages selected yet';
    var m = document.getElementById('mobileLanguagesSummary');
    var d = document.getElementById('desktopLanguagesSummary');
    if (m) m.textContent = text;
    if (d) d.textContent = text;
  }

  function bindSettings() {
    var mBtn = document.getElementById('mobileEditLanguagesBtn');
    var dBtn = document.getElementById('desktopEditLanguagesBtn');
    var open = function () {
      buildOverlay();
      // Preselect the saved choices
      var cats = getSelected() || [];
      var overlay = document.getElementById('catOverlay');
      if (overlay) {
        cats.forEach(function (id) {
          var chip = overlay.querySelector('.cat-chip[data-id="' + id + '"]');
          if (chip) chip.classList.add('selected');
        });
        var btn = overlay.querySelector('#catContinue');
        if (btn) btn.disabled = cats.length === 0;
        var skip = overlay.querySelector('#catSkip');
        if (skip) skip.style.display = 'none'; // editing, not first-run
      }
    };
    if (mBtn) mBtn.addEventListener('click', open);
    if (dBtn) dBtn.addEventListener('click', open);
    refreshSummaries();
  }

  function boot() {
    maybeShowPicker();
    loadNewReleases();
    bindSettings();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
})();
