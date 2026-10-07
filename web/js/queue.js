/**
 * String Music — Queue View (v3.12)
 * =================================
 * Bottom sheet listing the playback queue:
 *   • current track highlighted ("Now playing")
 *   • tap a row           → skip to that track   (player.skipTo)
 *   • drag the ⠿ handle   → reorder upcoming     (player.moveInQueue)
 *   • ✕ on an upcoming row→ remove from queue    (player.removeFromQueue)
 *   • "Clear upcoming"    → remove everything after the current track
 *
 * Opens from: the mini-dock queue button and the iPod view queue button.
 * Works in both native (service queueOps) and browser (array ops) modes.
 */
(function () {
  'use strict';

  var sheet, listEl, titleCountEl, clearBtn, closeBtn;
  var bound = false;

  function el(id) { return document.getElementById(id); }

  function fmtDur(sec) {
    sec = Math.max(0, Math.round(sec || 0));
    var m = Math.floor(sec / 60), s = sec % 60;
    return m + ':' + (s < 10 ? '0' : '') + s;
  }

  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function ensureDom() {
    if (sheet) return true;
    sheet = el('queueSheet');
    if (!sheet) {
      // Inject the sheet markup once (kept here so index.html stays lean).
      var wrap = document.createElement('div');
      wrap.id = 'queueSheet';
      wrap.className = 'queue-sheet-wrap';
      wrap.innerHTML =
        '<div class="queue-sheet-backdrop"></div>' +
        '<div class="queue-sheet">' +
        '  <div class="queue-sheet-head">' +
        '    <div class="queue-sheet-titles">' +
        '      <div class="queue-sheet-title">Queue</div>' +
        '      <div class="queue-sheet-count" id="queueSheetCount"></div>' +
        '    </div>' +
        '    <button class="queue-sheet-clear" id="queueClearBtn">Clear upcoming</button>' +
        '    <button class="queue-sheet-close" id="queueCloseBtn" title="Close">✕</button>' +
        '  </div>' +
        '  <div class="queue-sheet-list" id="queueSheetList"></div>' +
        '</div>';
      document.body.appendChild(wrap);
      sheet = wrap;
    }
    listEl = el('queueSheetList');
    titleCountEl = el('queueSheetCount');
    clearBtn = el('queueClearBtn');
    closeBtn = el('queueCloseBtn');
    if (!bound) { bind(); bound = true; }
    return true;
  }

  function getQueue() {
    var p = window.player;
    if (!p) return { queue: [], index: -1 };
    return { queue: p.queue || [], index: p.currentIndex };
  }

  function render() {
    if (!ensureDom()) return;
    var p = window.player;
    if (!p) return;
    var q = p.queue || [];
    var idx = p.currentIndex;
    titleCountEl.textContent = q.length ? (q.length + ' song' + (q.length === 1 ? '' : 's')) : 'Empty';
    clearBtn.style.display = (idx >= 0 && idx < q.length - 1) ? '' : 'none';

    if (!q.length) {
      listEl.innerHTML = '<div class="queue-empty">No songs queued.<br>Play something to build a queue.</div>';
      return;
    }

    var html = '';
    for (var i = 0; i < q.length; i++) {
      var t = q[i];
      var isCur = i === idx;
      var isPast = i < idx;
      html +=
        '<div class="queue-row' + (isCur ? ' current' : '') + (isPast ? ' past' : '') + '" data-i="' + i + '">' +
        (isCur
          ? '<span class="queue-eq" aria-hidden="true"><i></i><i></i><i></i></span>'
          : (isPast ? '<span class="queue-idx">✓</span>' : '<span class="queue-drag" data-drag="' + i + '">⠿</span>')) +
        '<img class="queue-thumb" loading="lazy" src="' + esc(t.thumbnail || '') + '" onerror="this.style.visibility=\'hidden\'">' +
        '<div class="queue-meta">' +
        '  <div class="queue-title">' + esc(t.title) + '</div>' +
        '  <div class="queue-artist">' + esc(t.artist) + '</div>' +
        '</div>' +
        // v3.19.11: unknown length shows –:– instead of a fake 0:00 (the
        // player backfills the real value into the queue entry on play).
        '<span class="queue-dur">' + (t.durationSec > 0 ? fmtDur(t.durationSec) : '–:–') + '</span>' +
        (isCur ? '' : '<button class="queue-remove" data-remove="' + i + '" title="Remove">✕</button>') +
        '</div>';
    }
    listEl.innerHTML = html;
  }

  // ---- interactions -------------------------------------------------

  function bind() {
    closeBtn.addEventListener('click', close);
    sheet.querySelector('.queue-sheet-backdrop').addEventListener('click', close);

    clearBtn.addEventListener('click', function () {
      var p = window.player;
      if (!p) return;
      // Remove upcoming tracks from the end so indices stay valid.
      for (var i = p.queue.length - 1; i > p.currentIndex; i--) {
        p.removeFromQueue(i);
      }
      render();
    });

    // Delegate: skip (row tap), remove (✕), drag (handle).
    listEl.addEventListener('click', function (e) {
      var rm = e.target.closest('.queue-remove');
      if (rm) {
        var ri = parseInt(rm.getAttribute('data-remove'), 10);
        window.player.removeFromQueue(ri);
        render();
        return;
      }
      var row = e.target.closest('.queue-row');
      if (row && !e.target.closest('.queue-drag')) {
        var i = parseInt(row.getAttribute('data-i'), 10);
        if (!row.classList.contains('past')) {
          window.player.skipTo(i);
          setTimeout(render, 250);
        }
      }
    });

    // Pointer-based drag & drop on the ⠿ handle.
    var drag = null;
    listEl.addEventListener('pointerdown', function (e) {
      var handle = e.target.closest('.queue-drag');
      if (!handle) return;
      var fromIdx = parseInt(handle.getAttribute('data-drag'), 10);
      var row = handle.closest('.queue-row');
      drag = { from: fromIdx, row: row, startY: e.clientY, moved: false };
      row.classList.add('dragging');
      try { row.setPointerCapture(e.pointerId); } catch (err) {}
      e.preventDefault();
    });
    listEl.addEventListener('pointermove', function (e) {
      if (!drag) return;
      var dy = e.clientY - drag.startY;
      if (Math.abs(dy) > 6) drag.moved = true;
      drag.row.style.transform = 'translateY(' + dy + 'px)';
      // Highlight the row currently under the finger.
      var over = document.elementFromPoint(e.clientX, e.clientY);
      var target = over && over.closest ? over.closest('.queue-row') : null;
      listEl.querySelectorAll('.queue-row.drop-target').forEach(function (r) {
        if (r !== drag.row) r.classList.remove('drop-target');
      });
      if (target && target !== drag.row && !target.classList.contains('current') && !target.classList.contains('past')) {
        target.classList.add('drop-target');
      }
    });
    listEl.addEventListener('pointerup', function (e) {
      if (!drag) return;
      var over = document.elementFromPoint(e.clientX, e.clientY);
      var target = over && over.closest ? over.closest('.queue-row') : null;
      drag.row.classList.remove('dragging');
      drag.row.style.transform = '';
      listEl.querySelectorAll('.queue-row.drop-target').forEach(function (r) { r.classList.remove('drop-target'); });
      if (drag.moved && target) {
        var toIdx = parseInt(target.getAttribute('data-i'), 10);
        if (!target.classList.contains('current') && !target.classList.contains('past') && toIdx !== drag.from) {
          window.player.moveInQueue(drag.from, toIdx);
        }
      }
      drag = null;
      render();
    });
    listEl.addEventListener('pointercancel', function () {
      if (drag) { drag.row.classList.remove('dragging'); drag.row.style.transform = ''; drag = null; render(); }
    });
  }

  function open() {
    if (!ensureDom()) return;
    render();
    sheet.classList.add('open');
  }

  function close() {
    if (sheet) sheet.classList.remove('open');
  }

  function toggle() {
    if (sheet && sheet.classList.contains('open')) close();
    else open();
  }

  // Keep the sheet fresh while open: queue changes + track changes.
  document.addEventListener('DOMContentLoaded', function () {
    ensureDom();
    var p = window.player;
    if (!p) return;
    p.on('queueupdate', function () { if (sheet.classList.contains('open')) render(); });
    p.on('play', function () { if (sheet.classList.contains('open')) render(); });
  });

  window.SimpMusicQueue = { open: open, close: close, toggle: toggle, render: render };
})();
