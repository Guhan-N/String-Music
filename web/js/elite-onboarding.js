/* String Music Elite — first-launch hand-off from String Music Simple.
 *
 * Shown exactly once per install. The user can paste the sync code exported
 * from Simple's Settings screen; liked songs and settings are merged into this
 * install's localStorage. "Start Fresh" just dismisses the screen.
 */
(function () {
  'use strict';

  var DONE_KEY = 'stringmusic_elite_onboarded';
  var LIKES_KEY = 'simpmusic_likes';

  // Only the Elite edition carries this screen.
  if (window.ELITE_BUILD === false) return;
  try {
    if (localStorage.getItem(DONE_KEY) === '1') return;
  } catch (e) {
    return;
  }

  function finish() {
    try { localStorage.setItem(DONE_KEY, '1'); } catch (e) {}
    var el = document.getElementById('eliteOnboarding');
    if (el && el.parentNode) el.parentNode.removeChild(el);
  }

  function decodeCode(raw) {
    var clean = String(raw || '').trim().replace(/\s+/g, '');
    if (!clean) throw new Error('Paste the code from Simple first.');
    var json;
    try {
      json = decodeURIComponent(escape(atob(clean)));
    } catch (e) {
      throw new Error('That does not look like a sync code.');
    }
    var data = JSON.parse(json);
    if (!data || typeof data !== 'object') throw new Error('Sync code is empty.');
    return data;
  }

  function mergeImport(data) {
    var incoming = Array.isArray(data.liked) ? data.liked : [];
    var existing = [];
    try {
      existing = JSON.parse(localStorage.getItem(LIKES_KEY) || '[]') || [];
    } catch (e) {
      existing = [];
    }
    if (!Array.isArray(existing)) existing = [];

    var seen = {};
    existing.forEach(function (track) {
      if (!track) return;
      var key = ((track.title || '') + '|' + (track.artist || '')).toLowerCase();
      seen[key] = true;
    });

    var added = 0;
    incoming.forEach(function (song) {
      if (!song || !song.title) return;
      var key = ((song.title || '') + '|' + (song.artist || '')).toLowerCase();
      if (seen[key]) return;
      seen[key] = true;
      existing.push({
        // No YouTube id yet: player.js resolves it by title + artist the
        // first time the track is played.
        videoId: '',
        title: song.title,
        artist: song.artist || '',
        album: song.album || '',
        duration: song.duration || 0,
        thumbnail: '',
        fromSimple: true
      });
      added++;
    });
    try {
      localStorage.setItem(LIKES_KEY, JSON.stringify(existing));
    } catch (e) {}

    var settings = data.settings || {};
    var map = {
      crossfade: 'simpmusic_crossfade',
      audioQuality: 'simpmusic_audio_quality',
      autoplay: 'simpmusic_autoplay',
      autoLyrics: 'simpmusic_autolyrics',
      theme: 'simpmusic_theme'
    };
    Object.keys(map).forEach(function (key) {
      if (settings[key] === undefined || settings[key] === null) return;
      try {
        localStorage.setItem(map[key], String(settings[key]));
      } catch (e) {}
    });

    return added;
  }

  function build() {
    var style = document.createElement('style');
    style.textContent = [
      '#eliteOnboarding{position:fixed;inset:0;z-index:20000;display:flex;align-items:flex-end;justify-content:center;',
      'background:rgba(0,0,0,.72);backdrop-filter:blur(6px);padding:14px;padding-bottom:calc(14px + env(safe-area-inset-bottom,0px))}',
      '#eliteOnboarding .eo-sheet{width:100%;max-width:560px;background:#141419;border:1px solid rgba(255,255,255,.08);',
      'border-radius:22px;padding:22px 18px 16px;box-shadow:0 -18px 60px rgba(0,0,0,.6)}',
      '#eliteOnboarding h2{margin:0 0 8px;font-size:1.12rem;color:#fff;font-weight:800;letter-spacing:-.01em}',
      '#eliteOnboarding p{margin:0 0 10px;font-size:.82rem;line-height:1.6;color:#a9a9b8}',
      '#eliteOnboarding .eo-step{color:#c4b5fd}',
      '#eliteOnboarding textarea{width:100%;min-height:76px;border-radius:12px;border:1px solid rgba(255,255,255,.09);',
      'background:#0d0d12;color:#d4d4dc;font-family:ui-monospace,Menlo,monospace;font-size:.7rem;padding:10px;resize:none}',
      '#eliteOnboarding .eo-actions{display:flex;flex-direction:column;gap:8px;margin-top:14px}',
      '#eliteOnboarding button{height:46px;border-radius:13px;border:1px solid rgba(255,255,255,.08);cursor:pointer;',
      'font-size:.87rem;font-weight:700}',
      '#eliteOnboarding .eo-import{background:linear-gradient(150deg,#a855f7,#7c3aed);color:#fff;border-color:transparent}',
      '#eliteOnboarding .eo-fresh{background:transparent;color:#9a9aa8}',
      '#eliteOnboarding .eo-err{color:#fca5a5;font-size:.76rem;min-height:16px;margin-top:8px}'
    ].join('');
    document.head.appendChild(style);

    var wrap = document.createElement('div');
    wrap.id = 'eliteOnboarding';
    wrap.innerHTML =
      '<div class="eo-sheet" role="dialog" aria-modal="true">' +
      '<h2>Already used String Music Simple?</h2>' +
      '<p>Go to <span class="eo-step">Simple → Settings → Export Sync Code</span>, then paste it here.</p>' +
      '<textarea id="eoCode" spellcheck="false" placeholder="Paste your sync code"></textarea>' +
      '<div class="eo-err" id="eoErr"></div>' +
      '<div class="eo-actions">' +
      '<button class="eo-import" id="eoImport" type="button">Import My Data</button>' +
      '<button class="eo-fresh" id="eoFresh" type="button">Start Fresh</button>' +
      '</div></div>';
    document.body.appendChild(wrap);

    document.getElementById('eoImport').addEventListener('click', function () {
      var err = document.getElementById('eoErr');
      try {
        var data = decodeCode(document.getElementById('eoCode').value);
        var added = mergeImport(data);
        finish();
        // Reload so the freshly merged likes/settings are read by the app.
        if (added > 0) {
          location.reload();
        }
      } catch (e) {
        err.textContent = (e && e.message) || 'Could not import that code.';
      }
    });

    document.getElementById('eoFresh').addEventListener('click', finish);
  }

  if (document.body) {
    build();
  } else {
    document.addEventListener('DOMContentLoaded', build);
  }
})();
