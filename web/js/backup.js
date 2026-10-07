/**
 * String Music — Backup & Restore (v3.11)
 * ========================================
 * Protects user data: likes, playlists, recents, search history, downloads
 * map, recommendation profile, dislikes and settings live only in
 * localStorage — cleared storage or an uninstall wipes everything.
 *
 * Export → single .json file, saved via the Android share sheet
 * (Drive / WhatsApp / Files) or a browser download.
 * Import → pick the file back, merge or replace, re-hydrate the UI.
 *
 * Modular surface (window.SimpMusicBackup):
 *   collect()   — build the full backup payload
 *   export()    — share (native) or download (browser)
 *   importFrom(filePickerResultOrObject) — validate + restore
 *   restore(data, mode) — 'merge' | 'replace'
 */
(function () {
  'use strict';

  var APP = 'string-music';
  var FORMAT = 2; // bump when the payload shape changes

  /** Every user-data key we protect, with what it holds. */
  var KEYS = [
    'simpmusic_likes',            // liked songs
    'simpmusic_playlists',        // playlists (Liked Songs is derived, not stored)
    'simpmusic_recent_songs',     // listening history
    'simpmusic_dl_ids',           // download filename → videoId map
    'simpmusic_dislikes',         // "Not for me"
    'simpmusic_rec_events',       // recommendation behavior log
    'simpmusic_rec_prefs',        // cached preference profile
    'simpmusic_categories',       // onboarding language picks
    'simpmusic_search_history',   // search history
    'simpmusic_audio_quality',    // settings
    'simpmusic_amoled',
    'simpmusic_autoplay',
    'simpmusic_autolyrics',
    'simpmusic_glow',
    'simpmusic_device_name'
  ];

  function loadJSON(key, fallback) {
    try {
      var raw = localStorage.getItem(key);
      return raw ? JSON.parse(raw) : fallback;
    } catch (e) { return fallback; }
  }

  /** Build the full backup payload from every protected key. */
  function collect() {
    var payload = {
      app: APP,
      format: FORMAT,
      exportedAt: new Date().toISOString(),
      data: {}
    };
    KEYS.forEach(function (k) {
      var v = localStorage.getItem(k);
      if (v !== null) payload.data[k] = v;
    });
    var likes = loadJSON('simpmusic_likes', []) || [];
    var pls = loadJSON('simpmusic_playlists', []) || [];
    payload.counts = {
      likes: likes.length,
      playlists: pls.length,
      recents: (loadJSON('simpmusic_recent_songs', []) || []).length,
      downloads: Object.keys(loadJSON('simpmusic_dl_ids', {}) || {}).length
    };
    return payload;
  }

  function backupFileName() {
    var d = new Date();
    var pad = function (n) { return (n < 10 ? '0' : '') + n; };
    return 'string-music-backup-' + d.getFullYear() + pad(d.getMonth() + 1) +
           pad(d.getDate()) + '-' + pad(d.getHours()) + pad(d.getMinutes()) + '.json';
  }

  /** Validate a parsed payload; returns error string or null. */
  function validate(p) {
    if (!p || typeof p !== 'object') return 'Not a backup file';
    if (p.app !== APP) return 'This file was not exported from String Music';
    if (typeof p.data !== 'object' || p.data === null) return 'Backup is missing its data section';
    return null;
  }

  /**
   * Restore a payload into localStorage.
   * mode 'merge'    — likes/playlists/recents/search-history are unioned by
   *                   id (existing entries win); settings overwritten.
   * mode 'replace'  — protected keys are wiped first, then restored.
   */
  function restore(payload, mode) {
    var err = validate(payload);
    if (err) throw new Error(err);
    var data = payload.data;

    if (mode === 'replace') {
      KEYS.forEach(function (k) { localStorage.removeItem(k); });
    }

    // ---- Mergeable collections --------------------------------------
    ['simpmusic_likes', 'simpmusic_recent_songs', 'simpmusic_dislikes']
      .forEach(function (key) {
        if (!(key in data)) return;
        var incoming = safeArr(data[key]);
        if (mode !== 'replace' && incoming.length) {
          var existing = loadJSON(key, []) || [];
          var seen = {};
          existing.forEach(function (t) { if (t && t.videoId) seen[t.videoId] = t; });
          incoming.forEach(function (t) { if (t && t.videoId && !seen[t.videoId]) { seen[t.videoId] = t; existing.push(t); } });
          localStorage.setItem(key, JSON.stringify(existing));
        } else {
          localStorage.setItem(key, typeof data[key] === 'string' ? data[key] : JSON.stringify(incoming));
        }
      });

    // ---- Playlists: merge by id, concat tracks ----------------------
    if ('simpmusic_playlists' in data) {
      var incomingPls = safeArr(data.simpmusic_playlists);
      if (mode !== 'replace' && incomingPls.length) {
        var existingPls = loadJSON('simpmusic_playlists', []) || [];
        var byId = {};
        existingPls.forEach(function (p) { if (p && p.id) byId[p.id] = p; });
        incomingPls.forEach(function (p) {
          if (!p || !p.id) return;
          if (byId[p.id]) {
            var have = {};
            (byId[p.id].tracks || []).forEach(function (t) { if (t && t.videoId) have[t.videoId] = 1; });
            (p.tracks || []).forEach(function (t) {
              if (t && t.videoId && !have[t.videoId]) { have[t.videoId] = 1; byId[p.id].tracks.push(t); }
            });
          } else {
            existingPls.push(p);
          }
        });
        localStorage.setItem('simpmusic_playlists', JSON.stringify(existingPls));
      } else {
        localStorage.setItem('simpmusic_playlists', typeof data.simpmusic_playlists === 'string'
          ? data.simpmusic_playlists : JSON.stringify(incomingPls));
      }
    }

    // ---- Download map: plain object merge ---------------------------
    if ('simpmusic_dl_ids' in data) {
      var incomingMap = safeObj(data.simpmusic_dl_ids);
      if (mode !== 'replace') {
        var existingMap = loadJSON('simpmusic_dl_ids', {}) || {};
        Object.keys(incomingMap).forEach(function (k) {
          if (!existingMap[k]) existingMap[k] = incomingMap[k];
        });
        localStorage.setItem('simpmusic_dl_ids', JSON.stringify(existingMap));
      } else {
        localStorage.setItem('simpmusic_dl_ids', JSON.stringify(incomingMap));
      }
    }

    // ---- Rec events / prefs: restore as-is (recommendation history) -
    ['simpmusic_rec_events', 'simpmusic_rec_prefs'].forEach(function (key) {
      if (key in data) localStorage.setItem(key, typeof data[key] === 'string' ? data[key] : JSON.stringify(data[key]));
    });

    // ---- Categories / search history: merge lists -------------------
    ['simpmusic_categories'].forEach(function (key) {
      if (!(key in data)) return;
      var incoming = safeArr(data[key]);
      if (mode !== 'replace' && incoming.length) {
        var existing = loadJSON(key, []) || [];
        incoming.forEach(function (c) { if (existing.indexOf(c) === -1) existing.push(c); });
        localStorage.setItem(key, JSON.stringify(existing));
      } else {
        localStorage.setItem(key, typeof data[key] === 'string' ? data[key] : JSON.stringify(incoming));
      }
    });

    ['simpmusic_search_history'].forEach(function (key) {
      if (!(key in data)) return;
      var incoming = safeArr(data[key]);
      if (mode !== 'replace' && incoming.length) {
        var existing = loadJSON(key, []) || [];
        incoming.forEach(function (s) { if (existing.indexOf(s) === -1) existing.push(s); });
        localStorage.setItem(key, JSON.stringify(existing));
      } else {
        localStorage.setItem(key, typeof data[key] === 'string' ? data[key] : JSON.stringify(incoming));
      }
    });

    // ---- Plain settings: overwrite ----------------------------------
    ['simpmusic_audio_quality', 'simpmusic_amoled', 'simpmusic_autoplay',
     'simpmusic_autolyrics', 'simpmusic_glow', 'simpmusic_device_name']
      .forEach(function (key) {
        if (key in data) {
          var v = data[key];
          localStorage.setItem(key, typeof v === 'string' ? v : JSON.stringify(v));
        }
      });

    return countsOf(payload);
  }

  function countsOf(payload) {
    var c = payload && payload.counts;
    if (c) return c;
    return {
      likes: safeArr((payload.data || {})['simpmusic_likes']).length,
      playlists: safeArr((payload.data || {})['simpmusic_playlists']).length,
      recents: safeArr((payload.data || {})['simpmusic_recent_songs']).length,
      downloads: Object.keys(safeObj((payload.data || {})['simpmusic_dl_ids'])).length
    };
  }

  function safeArr(v) { try { var x = typeof v === 'string' ? JSON.parse(v) : v; return Array.isArray(x) ? x : []; } catch (e) { return []; } }
  function safeObj(v) { try { var x = typeof v === 'string' ? JSON.parse(v) : v; return (x && typeof x === 'object' && !Array.isArray(x)) ? x : {}; } catch (e) { return {}; } }

  // ---- Export ---------------------------------------------------------
  function isNative() {
    return !!(window.Capacitor && window.Capacitor.isPluginAvailable &&
              window.Capacitor.isPluginAvailable('SimpMusicBackup'));
  }

  function toast(msg) {
    try { if (typeof window.showToast === 'function') window.showToast(msg); } catch (e) {}
  }

  function doExport() {
    var payload = collect();
    var json = JSON.stringify(payload);
    if (isNative()) {
      var cap = window.Capacitor.Plugins.SimpMusicBackup;
      cap.saveBackup({ json: json, fileName: backupFileName() })
        .then(function () { toast('📤 Backup ready — choose where to save it'); })
        .catch(function (e) { toast('Backup failed: ' + (e && e.message || 'error')); });
      return;
    }
    // Browser fallback: classic blob download.
    try {
      var blob = new Blob([json], { type: 'application/json' });
      var url = URL.createObjectURL(blob);
      var a = document.createElement('a');
      a.href = url;
      a.download = backupFileName();
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      setTimeout(function () { URL.revokeObjectURL(url); }, 2000);
      toast('✓ Backup downloaded');
    } catch (e) {
      toast('Backup failed: ' + (e && e.message || 'error'));
    }
  }

  // ---- Import ---------------------------------------------------------
  function isPluginCallResult(r) {
    // Native picker resolves { cancelled, content, uri }
    return r && typeof r === 'object' && ('cancelled' in r) && ('content' in r);
  }

  function importFrom(rawResult) {
    if (!rawResult) return;
    var text;
    if (isPluginCallResult(rawResult)) {
      if (rawResult.cancelled) return;
      text = rawResult.content;
    } else if (typeof rawResult === 'string') {
      text = rawResult;
    } else {
      return;
    }
    var payload;
    try { payload = JSON.parse(text); } catch (e) { toast('❌ Invalid backup file'); return; }
    var err = validate(payload);
    if (err) { toast('❌ ' + err); return; }
    // Ask merge vs replace with a native confirm; merge is the default.
    var replace = false;
    try {
      replace = window.confirm('Restore mode?\n\nOK = Replace everything on this device\nCancel = Merge with current data');
    } catch (e) {}
    var mode = replace ? 'replace' : 'merge';
    try {
      var counts = restore(payload, mode);
      toast('✓ Restored ' + (counts.likes || 0) + ' likes, ' +
            (counts.playlists || 0) + ' playlists — reloading…');
      setTimeout(function () { window.location.reload(); }, 1200);
    } catch (e) {
      toast('❌ Restore failed: ' + (e && e.message || 'error'));
    }
  }

  /** Hidden <input type=file> path — works in browsers AND inside the
   *  Android WebView (Capacitor implements onShowFileChooser), so it is our
   *  universal fallback if the native picker result is dropped. */
  function importViaInput() {
    var input = document.getElementById('simpmusicBackupFileInput');
    if (!input) {
      input = document.createElement('input');
      input.type = 'file';
      input.accept = '.json,application/json,application/octet-stream,text/plain';
      input.id = 'simpmusicBackupFileInput';
      input.style.display = 'none';
      input.addEventListener('change', function (e) {
        var f = e.target.files && e.target.files[0];
        if (!f) return;
        var reader = new FileReader();
        reader.onload = function (evt) { importFrom(String(evt.target.result || '')); };
        reader.onerror = function () { toast('❌ Could not read the selected file'); };
        reader.readAsText(f);
        input.value = '';
      });
      document.body.appendChild(input);
    }
    input.click();
  }

  function importViaPicker() {
    if (isNative()) {
      var settled = false;
      // Safety net: if the picker result never arrives (dropped by the
      // activity lifecycle), fall back to the WebView file chooser instead
      // of leaving the user with a silent no-op.
      var timer = setTimeout(function () {
        if (!settled) {
          settled = true;
          toast('⏳ Picker did not respond — opening file chooser…');
          importViaInput();
        }
      }, 15000);
      window.Capacitor.Plugins.SimpMusicBackup.pickBackup()
        .then(function (res) {
          if (settled) return;
          settled = true;
          clearTimeout(timer);
          if (res && res.cancelled) { toast('Import cancelled'); return; }
          importFrom(res);
        })
        .catch(function (e) {
          if (settled) return;
          settled = true;
          clearTimeout(timer);
          // Native path failed → try the WebView chooser before giving up.
          importViaInput();
        });
      return;
    }
    importViaInput();
  }

  // ---- Public API ------------------------------------------------------
  window.SimpMusicBackup = {
    collect: collect,
    export: doExport,
    importFrom: importFrom,
    importViaPicker: importViaPicker,
    restore: restore,
    validate: validate,
    FORMAT: FORMAT
  };
})();
