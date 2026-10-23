/**
 * SimpMusic Playback Engine
 * Integrates YouTube IFrame API with Audio Queue, Background Support & MediaSession API
 */

/**
 * v3.20.5: normalized "song identity" of a title. Every upload of ONE song
 * ("Song (Official Video)", "Song (Lyrical)", "Song - Remix", "Song | Movie")
 * collapses to the same key, so auto-advance can tell that the next search
 * result is the same song rather than a new one. Letters/digits are kept
 * Unicode-wide so Tamil/Telugu/Hindi titles stay distinct.
 */
function songKey(title) {
  if (!title) return '';
  let t = String(title).toLowerCase()
    .replace(/\([^)]*\)/g, ' ')
    .replace(/\[[^\]]*\]/g, ' ')
    .replace(/\{[^}]*\}/g, ' ');
  const markers = [' - ', ' \u2013 ', ' \u2014 ', ' |', ' \u2022 ', ' feat', ' ft.', ' ft ', ' official',
    ' lyric', ' audio', ' video song', ' remix', ' version', ' cover', ' live ',
    ' slowed', ' sped up', ' reverb', ' mashup', ' 8d ', ' remake', ' reprise',
    ' title track', ' full song', ' making of', ' karaoke', ' instrumental',
    ' whatsa', ' status', ' ringtone'];
  let cut = t.length;
  for (const m of markers) {
    const i = t.indexOf(m);
    if (i > 0 && i < cut) cut = i;
  }
  t = t.slice(0, cut);
  try {
    return t.replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
  } catch (e) {
    // Very old WebView without Unicode property escapes.
    return t.replace(/[^a-z0-9\u00C0-\uFFFF]+/g, ' ').trim();
  }
}

/**
 * v3.20.6: "saver" | "standard" | "high" are the values the Settings card
 * sends ("low" is the legacy spelling of "saver"). Normalizing in one place
 * keeps the stored setting, the active button and the native push in sync.
 */
function normalizeAudioQuality(q) {
  const v = String(q || '').toLowerCase().trim();
  if (v === 'saver' || v === 'low' || v === 'data' || v === 'datasaver') return 'saver';
  if (v === 'high' || v === 'highres' || v === 'best') return 'high';
  return 'standard';
}

/**
 * v3.20.7: verified "we really have no network" check.
 *
 * Every offline branch below used to read `navigator.onLine` (plus the legacy
 * `navigator.connection.type`) directly. In the Android WebView that flag can
 * stay false after connectivity returns — and the `online` event is missed
 * while the WebView is frozen — which sent every tap down the offline path
 * (play the downloaded copy / playOfflineIfAvailable) long after the network
 * was back. SimpMusicNet probes for real, so this now asks it. When the helper
 * is absent we fall back to the raw signals, defaulting to ONLINE so playback
 * always tries the live stream first.
 */
function isOfflineNow() {
  const net = window.SimpMusicNet;
  if (net && typeof net.isOffline === 'function') return net.isOffline();
  return (navigator.connection && navigator.connection.type === 'none')
    || navigator.onLine === false;
}

class MusicPlayer {
  constructor() {
    this.ytPlayer = null;
    this.isReady = false;
    this.queue = [];
    this.currentIndex = -1;
    this.isPlaying = false;
    this.userPaused = false;
    this.shuffle = false;
    this.repeatMode = 'off'; // 'off' | 'all' | 'one'
    this.volume = 80;
    this.currentTime = 0;
    this.duration = 0;
    this.listeners = {};
    this.tickerInterval = null;
    this.heartbeatInterval = null;
    this.silentAudio = null;

    // --- Native (ExoPlayer) playback mode ---
    // On Android the queue is handed to the native ExoPlayer service, which
    // owns the audio and survives backgrounding. The WebView mirrors state
    // from "playbackkeeper-*" events and mutes the iframe while native audio
    // is active. If native resolution/playback fails, we fall back to the
    // iframe path automatically.
    this.nativeMode = false;
    this.nativeHandoffPending = false;
    this.nativeRetries = 0;
    // v3.12: crossfade seconds (persisted; pushed to native when available)
    this.crossfadeSec = parseInt(localStorage.getItem('simpmusic_crossfade') || '0', 10) || 0;
    // v3.12.2: audio quality — push the stored choice to native at startup.
    this.audioQuality = normalizeAudioQuality(localStorage.getItem('simpmusic_audio_quality'));
    this.setupNativeListeners();

    this.initYouTubeApi();
    this.setupMediaSession();
    this.probeNativeRestore();
  }

  /** After a WebView reload, re-adopt a native player that kept playing. */
  probeNativeRestore() {
    if (!this.nativeAvailable) return;
    try {
      window.Capacitor.Plugins.PlaybackKeeper.status();
      if (this.crossfadeSec > 0) {
        window.Capacitor.Plugins.PlaybackKeeper.setCrossfade({ seconds: this.crossfadeSec });
      }
      if (this.audioQuality && this.audioQuality !== 'standard') {
        window.Capacitor.Plugins.PlaybackKeeper.setAudioQuality({ quality: this.audioQuality });
      }
    } catch (e) { /* ignore */ }
    this.startNativeEventDrain();
  }

  /**
   * Drain raw native events from the plugin backlog every 500ms.
   * triggerWindowJSEvent can lose the JSON payload on some devices
   * (progress frozen at 0 → lyrics/ipod never update); this pull channel
   * always delivers the data.
   */
  startNativeEventDrain() {
    if (this._drainTimer || !this.nativeAvailable) return;
    const keeper = window.Capacitor.Plugins.PlaybackKeeper;
    const drain = async () => {
      try {
        const res = await keeper.getRecentEvents();
        const evts = (res && res.events) || [];
        for (const e of evts) {
          let d = {};
          try { d = JSON.parse(e.json || '{}'); } catch (err) { d = {}; }
          this.onNativeEvent(e.event, d);
        }
      } catch (err) { /* plugin unavailable */ }
    };
    drain();
    this._drainTimer = setInterval(drain, 500);
  }

  get nativeAvailable() {
    try {
      const cap = window.Capacitor;
      return !!(cap && cap.isPluginAvailable && cap.isPluginAvailable('PlaybackKeeper'));
    } catch (e) { return false; }
  }

  setupNativeListeners() {
    // Capacitor's triggerWindowJSEvent may deliver detail as an object or a
    // JSON string; normalize both before handing to onNativeEvent.
    const events = ['progress', 'trackchange', 'state', 'ended', 'error', 'restored', 'queuechanged'];
    events.forEach(name => {
      window.addEventListener(`playbackkeeper-${name}`, (e) => {
        // While the reliable drain loop is active, push events are redundant
        // (and arrive payload-less on some devices) — skip to avoid doubles.
        if (this._drainTimer) return;
        let detail = e.detail;
        if (typeof detail === 'string') {
          try { detail = JSON.parse(detail); } catch (err) { detail = {}; }
        }
        this.onNativeEvent(name, detail || {});
      });
    });
  }

  onNativeEvent(name, d) {
    switch (name) {
      case 'progress': {
        // Native player is the source of truth while it owns playback.
        if (!this.nativeMode) { this.adoptNativeIfNeeded(); if (!this.nativeMode) return; }
        this.nativeHandoffPending = false;
        this.nativeRetries = 0;
        this.currentTime = d.positionSec || 0;
        if (d.durationSec > 0) this.duration = d.durationSec;
        this.emit('timeupdate', { currentTime: this.currentTime, duration: this.duration });
        break;
      }
      case 'trackchange': {
        if (!this.nativeMode) { this.adoptNativeIfNeeded(); if (!this.nativeMode) return; }
        // v3.12.5: remember the full track so a fresh app open can replay it.
        try { localStorage.setItem('simpmusic_last_track', JSON.stringify(this.currentTrack)); } catch (e) {}
        // v3.12.3: prune finished songs in the JS mirror too — keep the
        // immediately previous track, drop everything older (matches the
        // service-side pruneFinishedTracks so both lists stay aligned).
        if (this.currentIndex > 1) {
          this.queue.splice(0, this.currentIndex - 1);
          this.currentIndex = 1;
          this.emit('queueupdate', { queue: this.queue, currentIndex: this.currentIndex });
        }
        // v3.9: tracks the service picked itself (auto-queue recommendations
        // / local files) aren't in the JS queue yet — adopt them from the
        // event payload so the UI shows what is actually playing.
        let tIdx = this.queue.findIndex(t => t.videoId === d.videoId);
        if (tIdx === -1 && d.videoId) {
          this.queue.push({
            videoId: d.videoId,
            title: d.title || 'String Music',
            artist: d.artist || '',
            thumbnail: d.thumbnail || '',
            durationSec: Number(d.durationSec) || 0
          });
          tIdx = this.queue.length - 1;
        }
        this.currentIndex = Math.max(0, tIdx);
        const track = this.queue[this.currentIndex];
        if (track) {
          // v3.19.11: backfill the REAL duration once the service reports it —
          // tracks queued from menus/sources without a length kept showing
          // 0:00 in the Queue sheet forever.
          if (d.durationSec > 0 && track.durationSec !== Math.round(d.durationSec)) {
            track.durationSec = Math.round(d.durationSec);
          }
          this.currentTime = 0;
          this.duration = d.durationSec || track.durationSec || 0;
          this.isPlaying = true;
          this.emit('queueupdate', { queue: this.queue, currentIndex: this.currentIndex });
          this.updateMediaSessionMetadata(track);
          this.emit('play', track);
          // v3.13: refill the service's recommendation pool on every track
          // change — queue-end autoplay drains it, and this keeps the
          // notification NEXT button alive even when the WebView was idle.
          this.syncAutoQueue();
        }
        break;
      }
      case 'state': {
        if (!this.nativeMode) { this.adoptNativeIfNeeded(); if (!this.nativeMode) return; }
        if (d.state === 'playing' && !this.isPlaying) {
          this.isPlaying = true;
          this.emit('play', this.currentTrack);
        } else if (d.state === 'paused' && this.isPlaying) {
          this.isPlaying = false;
          this.emit('pause');
        } else if (d.state === 'sleep-timer-done') {
          this.isPlaying = false;
          this.emit('pause');
          this.emit('sleepdone');
        }
        break;
      }
      case 'queuechanged': {
        // v3.12.3: the service's queue list is authoritative — replace the
        // JS mirror wholesale (fixes Play next / Add to queue / pruning
        // ever drifting out of sync with the native player).
        if (!Array.isArray(d.queue)) break;
        this.queue = d.queue.map(t => ({
          videoId: t.videoId, title: t.title, artist: t.artist || '',
          thumbnail: t.thumbnail || '', durationSec: t.durationSec || 0
        }));
        this.currentIndex = Math.max(0, Math.min(d.index | 0, this.queue.length - 1));
        this.emit('queueupdate', { queue: this.queue, currentIndex: this.currentIndex });
        break;
      }

      case 'ended': {
        if (!this.nativeMode) return;
        this.isPlaying = false;
        this.emit('queueEnded');
        break;
      }
      case 'error': {
        if (!this.nativeMode) return;
        // v3.20.3: the native service now DROPS an unplayable track and starts
        // the next one. Treating that as a hard failure was the bug behind
        // "music just stops": the previous song was torn down, the fallback
        // iframe stayed silent, and the UI kept claiming it was playing.
        if (d && d.skipping) {
          console.warn('Skipping unplayable track:', d.skipped, d.state || '');
          if (window.showToast) {
            window.showToast(`Skipping “${String(d.skipped || 'that track').slice(0, 40)}” — can\'t be played`);
          }
          // Leave the transport state alone: the service starts the next track
          // within a moment and the trackchange event re-syncs the UI.
          break;
        }
        this.nativeRetries = (this.nativeRetries || 0) + 1;
        if (this.isPlaying) { this.isPlaying = false; this.emit('pause'); }
        console.warn('Native playback error, falling back to iframe:', d.state || d);
        // v3.7: offline (no network)? The iframe cannot play either — switch
        // to the downloaded local file instead of a doomed fallback.
        const offlineNow = isOfflineNow();
        if (offlineNow) {
          this.playOfflineIfAvailable().then((ok) => { if (!ok) this.fallbackToIframe(); });
        } else {
          this.fallbackToIframe();
        }
        break;
      }
      case 'restored': {
        // The WebView was reloaded (or its renderer killed) while the native
        // service kept playing. Re-adopt the running player instead of
        // starting a duplicate: restore queue, position and play state.
        if (!d.videoId || !Array.isArray(d.queue) || d.queue.length === 0) return;
        if (this.nativeMode) return; // already in sync
        this.queue = d.queue.map(t => ({
          videoId: t.videoId,
          title: t.title || 'String Music',
          artist: t.artist || '',
          thumbnail: t.thumbnail || '',
          durationSec: Number(t.durationSec) || 0
        }));
        this.currentIndex = Math.max(0, Math.min(d.index | 0, this.queue.length - 1));
        this.nativeMode = true;
        this.nativeHandoffPending = false;
        this.isPlaying = !!d.playing;
        this.currentTime = d.positionSec || 0;
        this.duration = this.queue[this.currentIndex].durationSec || 0;
        this.shuffle = !!d.shuffle;
        this.repeatMode = d.repeatMode || 'off';
        this.muteIframeForNative(true);
        try { document.body.classList.add('native-playback'); } catch (e) {}
        this.updateMediaSessionMetadata(this.queue[this.currentIndex]);
        this.emit('queueupdate', { queue: this.queue, currentIndex: this.currentIndex });
        this.emit('timeupdate', { currentTime: this.currentTime, duration: this.duration });
        if (this.isPlaying) {
          this.emit('play', this.queue[this.currentIndex]);
        } else {
          this.emit('pause');
        }
        break;
      }
    }
  }

  /**
   * v3.7.1: the service is the single audio owner — if it reports activity
   * while JS thinks playback is elsewhere (offline playLocal started by a
   * previous page, or a WebView reload), adopt native mode instead of
   * ignoring the events. Mirrors the essential part of the 'restored' flow.
   */
  adoptNativeIfNeeded() {
    if (this.nativeMode || !this.nativeAvailable) return;
    this.nativeMode = true;
    this.nativeHandoffPending = false;
    this.muteIframeForNative(true);
    try { document.body.classList.add('native-playback'); } catch (e) {}
  }

  /** Give up on native playback and resume via the YouTube iframe. */
  fallbackToIframe() {
    this.nativeMode = false;
    this.nativeHandoffPending = false;
    this.muteIframeForNative(false);
    try { document.body.classList.remove('native-playback'); } catch (e) {}
    const track = this.currentTrack;
    if (track && this.ytPlayer && this.isReady) {
      this.loadVideo(track.videoId);
    }
  }

  /** True while native handoff is allowed (bounded retries). */
  get nativeUsable() {
    return this.nativeAvailable && (this.nativeRetries || 0) < 2;
  }

  /** Mute/unmute + pause the iframe while native audio owns playback. */
  muteIframeForNative(mute) {
    try {
      if (this.ytPlayer && this.ytPlayer.setVolume) {
        this.ytPlayer.setVolume(mute ? 0 : this.volume);
        if (mute && this.ytPlayer.pauseVideo) this.ytPlayer.pauseVideo();
      }
    } catch (e) { /* ignore */ }
  }

  /** Send the current queue to the native ExoPlayer service and start it. */
  nativeSyncAndPlay() {
    try {
      const cap = window.Capacitor;
      if (!this.nativeAvailable || !cap) return false;
      const keeper = cap.Plugins.PlaybackKeeper;
      keeper.syncQueue({
        videoIds: this.queue.map(t => t.videoId),
        titles: this.queue.map(t => t.title || 'String Music'),
        artists: this.queue.map(t => t.artist || ''),
        thumbnails: this.queue.map(t => t.thumbnail || ''),
        durations: this.queue.map(t => Math.round(t.durationSec || 0)),
        startIndex: Math.max(0, this.currentIndex),
        shuffle: !!this.shuffle,
        repeatMode: this.repeatMode || 'off'
      });
      this.nativeMode = true;
      this.nativeHandoffPending = true;
      this.muteIframeForNative(true);
      // Lightweight renderer mode while native audio owns playback: disables
      // heavy blurs/animations so WebView crashes can never affect music.
      try { document.body.classList.add('native-playback'); } catch (e) {}
      // v3.9: stock the service with recommendations for queue-end autoplay.
      this.syncAutoQueue();
      return true;
    } catch (e) {
      console.warn('nativeSyncAndPlay failed:', e);
      return false;
    }
  }

  on(event, callback) {
    if (!this.listeners[event]) this.listeners[event] = [];
    this.listeners[event].push(callback);
  }

  emit(event, data) {
    if (this.listeners[event]) {
      this.listeners[event].forEach(cb => cb(data));
    }
  }

  initYouTubeApi() {
    if (!window.YT) {
      const tag = document.createElement('script');
      tag.src = 'https://www.youtube.com/iframe_api';
      const firstScriptTag = document.getElementsByTagName('script')[0];
      firstScriptTag.parentNode.insertBefore(tag, firstScriptTag);

      window.onYouTubeIframeAPIReady = () => {
        this.createPlayer();
      };
    } else {
      this.createPlayer();
    }
  }

  createPlayer() {
    const container = document.getElementById('yt-player-container');
    if (!container) return;

    this.ytPlayer = new YT.Player('yt-player-container', {
      height: '100',
      width: '100',
      playerVars: {
        autoplay: 1,
        controls: 0,
        disablekb: 1,
        enablejsapi: 1,
        fs: 0,
        modestbranding: 1,
        playsinline: 1,
        rel: 0,
        origin: window.location.origin
      },
      events: {
        onReady: () => {
          this.isReady = true;
          this.setVolume(this.volume);
          this.emit('ready');
        },
        onStateChange: (event) => this.onPlayerStateChange(event),
        onError: (err) => {
          console.warn('YouTube Player Error:', err.data);
          this.emit('error', err.data);
          setTimeout(() => this.next(), 1000);
        }
      }
    });
  }

  onPlayerStateChange(event) {
    if (!window.YT) return;
    switch (event.data) {
      case YT.PlayerState.PLAYING:
        // Native owns playback: never let the muted iframe start producing
        // audio — it would steal audio focus and pause ExoPlayer.
        if (this.nativeMode && this.nativeAvailable) {
          this.muteIframeForNative(true);
          return;
        }
        this.isPlaying = true;
        this.userPaused = false;
        this.keepAudioEngineAlive();
        this.startProgressTicker();
        this.emit('play', this.currentTrack);
        this.updateMediaSessionState('playing');
        // First iframe playback in the app: hand the queue over to the native
        // ExoPlayer service. The iframe is muted+paused right after.
        if (!this.nativeMode && this.nativeUsable && this.queue.length > 0) {
          this.nativeSyncAndPlay();
        }
        break;
      case YT.PlayerState.PAUSED:
        // Involuntary background pause detection: If user didn't hit pause, resume immediately!
        if (this.isPlaying && !this.userPaused) {
          setTimeout(() => {
            if (!this.userPaused && this.ytPlayer && this.ytPlayer.playVideo) {
              this.ytPlayer.playVideo();
            }
          }, 150);
          return;
        }
        this.isPlaying = false;
        this.pauseAudioEngine();
        this.stopProgressTicker();
        this.emit('pause');
        this.updateMediaSessionState('paused');
        // Keep the foreground service alive (notification shows Play) but
        // drop the wake lock and mark paused on the lock screen.
        this.notifyNativeState(false, this.currentTime);
        break;
      case YT.PlayerState.ENDED:
        this.isPlaying = false;
        this.pauseAudioEngine();
        this.stopProgressTicker();
        this.emit('ended');
        this.onTrackEnded();
        break;
      case YT.PlayerState.BUFFERING:
        this.emit('buffering');
        break;
    }
  }

  // --- Legacy native hooks (kept for compatibility; native playback is now
  // driven by syncQueue + playbackkeeper-* events instead of mirroring). ---
  notifyNativePlayback(action) {
    if (action === 'stop' && this.nativeAvailable) {
      try { window.Capacitor.Plugins.PlaybackKeeper.stop(); } catch (e) {}
    }
  }

  notifyNativeState(isPlaying, positionSec) { /* superseded by native events */ }

  startProgressTicker() {
    this.stopProgressTicker();
    this.nativeStateTick = 0;
    if (this.nativeMode) return; // native progress arrives via events
    const tick = () => {
      if (this.ytPlayer && this.ytPlayer.getCurrentTime) {
        try {
          const cur = this.ytPlayer.getCurrentTime() || 0;
          const dur = this.ytPlayer.getDuration() || (this.currentTrack ? this.currentTrack.durationSec : 0);
          this.currentTime = cur;
          this.duration = dur;
          // v3.19.11: backfill the real duration into the queue entry (JS
          // mode) so Queue-sheet rows show the length instead of 0:00.
          const ct = this.currentTrack;
          if (ct && dur > 0 && ct.durationSec !== Math.round(dur)) {
            ct.durationSec = Math.round(dur);
            this.emit('queueupdate', { queue: this.queue, currentIndex: this.currentIndex });
          }
          this.emit('timeupdate', { currentTime: cur, duration: dur });
          // Sync native MediaSession position roughly every 5 seconds (~300 rAF frames)
          if (++this.nativeStateTick >= 300) {
            this.nativeStateTick = 0;
            this.notifyNativeState(true, cur);
          }
        } catch (e) {}
      }
    };
    this.tickerInterval = setInterval(updateTime, 500);
    updateTime();
  }

  stopProgressTicker() {
    if (this.tickerInterval) {
      clearInterval(this.tickerInterval);
      this.tickerInterval = null;
    }
  }

  get currentTrack() {
    if (this.currentIndex >= 0 && this.currentIndex < this.queue.length) {
      return this.queue[this.currentIndex];
    }
    return null;
  }

  playTrack(track, queue = null) {
    if (!track) return;
    // Capture what is playing NOW, before the queue below is replaced —
    // used to detect a tap on the already-playing song.
    const prevVideoId = this.currentTrack ? this.currentTrack.videoId : null;
    if (queue && Array.isArray(queue)) {
      this.queue = [...queue];
      this.currentIndex = this.queue.findIndex(t => t.videoId === track.videoId);
      if (this.currentIndex === -1) {
        this.queue.unshift(track);
        this.currentIndex = 0;
      }
    } else if (!this.queue.some(t => t.videoId === track.videoId)) {
      this.queue.push(track);
      this.currentIndex = this.queue.length - 1;
    } else {
      this.currentIndex = this.queue.findIndex(t => t.videoId === track.videoId);
    }

    this.emit('queueupdate', { queue: this.queue, currentIndex: this.currentIndex });

    // Prefer native playback outright when available — no iframe blip.
    // Never re-handoff automatically after a native error: the error→
    // fallback→handoff cycle repeatedly calls startForegroundService and can
    // get the whole app killed. Only the first play (or explicit user retry
    // after a successful fallback) goes native.
    if (this.nativeUsable && !this.nativeMode && (this.nativeRetries || 0) === 0) {
      this._tryNativeFirst = true;
    }

    // Native mode: the service owns playback — re-sync it on every song
    // change (syncQueue stops the old track, loads the new queue, plays).
    // Without this, tapping a new song only updated JS state while ExoPlayer
    // kept playing the previous track.
    if (this.nativeMode && this.nativeAvailable) {
      if (track.videoId === prevVideoId && this.isPlaying) {
        // Same track already playing natively — nothing to switch
        this.updateMediaSessionMetadata(track);
        return;
      }
      // v3.7: offline? Skip the doomed stream sync and play the downloaded
      // local file directly when we have it.
      const offlineNow = isOfflineNow();
      if (offlineNow) {
        this.playOfflineIfAvailable(track).then((ok) => {
          if (!ok) console.warn('Offline: no downloaded copy of', track.title);
        });
        this.updateMediaSessionMetadata(track);
        return;
      }
      const synced = this.nativeSyncAndPlay();
      if (synced) {
        this.updateMediaSessionMetadata(track);
        return;
      }
      // syncQueue failed — drop native ownership and finish via iframe
      this.fallbackToIframe();
      return;
    }

    // Handoff path: first play (or retry after fallback) pushes the whole
    // queue to ExoPlayer instead of loadVideo on the iframe.
    if (this.nativeAvailable && (this.nativeHandoffPending || this._tryNativeFirst)) {
      this._tryNativeFirst = false;
      if (this.nativeSyncAndPlay()) {
        this.updateMediaSessionMetadata(track);
        return;
      }
    }

    this.loadVideo(track.videoId);
    this.updateMediaSessionMetadata(track);
  }

  loadVideo(videoId) {
    if (!this.ytPlayer || !this.isReady) {
      setTimeout(() => this.loadVideo(videoId), 300);
      return;
    }
    try {
      this.keepAudioEngineAlive();
      this.ytPlayer.loadVideoById({
        videoId: videoId,
        suggestedQuality: 'small'
      });
      this.ytPlayer.playVideo();
    } catch (err) {
      console.error('Error loading video:', err);
    }
  }

  /**
   * v3.7: attempts to play the downloaded local copy of the current (or
   * next queued) track. Resolves true when playback was handed to the
   * native service, false when nothing is available offline.
   */
  async playOfflineIfAvailable(track) {
    try {
      const cap = window.Capacitor;
      if (!cap || !cap.isPluginAvailable || !cap.isPluginAvailable('SimpMusicDownload')) return false;
      const dl = cap.Plugins.SimpMusicDownload;
      const res = await dl.list();
      const files = (res && res.files) || [];
      if (!files.length) return false;
      let map = {};
      try { map = JSON.parse(localStorage.getItem('simpmusic_dl_ids') || '{}'); } catch (e) {}
      const wanted = track || this.currentTrack;
      const qIdx = wanted ? this.queue.findIndex(t => t.videoId === wanted.videoId) : -1;
      const candidates = [];
      if (wanted) candidates.push(wanted);
      for (let i = qIdx + 1; i < this.queue.length && i < qIdx + 4; i++) candidates.push(this.queue[i]);
      for (const t of candidates) {
        if (!t) continue;
        const key = `${t.artist || 'Unknown'} - ${t.title || ''}`;
        const f = files.find(x =>
          (t.videoId && x.videoId === t.videoId) ||
          (map[x.fileName || ''] === t.videoId) ||
          (map[`${x.artist || 'Unknown'} - ${x.title || ''}`] === t.videoId) ||
          ((x.title || '').toLowerCase() === (t.title || '').toLowerCase()));
        if (f) {
          this.nativeMode = true;
          this.isPlaying = false;
          await dl.playLocal({
            fileName: f.fileName,
            videoId: t.videoId || f.videoId || '',
            title: t.title || f.title || 'String Music',
            artist: t.artist || f.artist || '',
            thumbnail: t.thumbnail || '',
            durationSec: Math.round(t.durationSec || 0)
          });
          return true;
        }
      }
    } catch (e) { /* fall through */ }
    return false;
  }

  play() {
    // v3.12.5: nothing queued → play the last listened song.
    if (!this.currentTrack) {
      const last = this.lastPlayedTrack();
      if (last) { this.playTrack(last, [last]); return; }
    }
    if (this.nativeMode && this.nativeAvailable) {
      // v3.7: offline → .toggle() would crash the whole app (FGS contract:
      // startForegroundService MUST reach startForeground; the old TOGGLE
      // handler returned START_NOT_STICKY without it when nothing was
      // queued). When a downloaded copy exists we play it locally instead.
      const offlineNow = isOfflineNow();
      if (offlineNow) {
        this.playOfflineIfAvailable().then((ok) => {
          if (!ok) console.warn('Offline: no downloaded songs available');
        });
        return;
      }
      try { window.Capacitor.Plugins.PlaybackKeeper.toggle(); } catch (e) {}
      return;
    }
    if (this.ytPlayer && this.ytPlayer.playVideo) {
      this.ytPlayer.playVideo();
    }
  }

  pause() {
    if (this.nativeMode && this.nativeAvailable) {
      try { window.Capacitor.Plugins.PlaybackKeeper.toggle(); } catch (e) {}
      return;
    }
    if (this.ytPlayer && this.ytPlayer.pauseVideo) {
      this.ytPlayer.pauseVideo();
    }
  }

  togglePlay() {
    // v3.12.5: nothing queued (fresh app open)? Restart the LAST song the
    // user listened to instead of doing nothing ("no song selected" feel).
    if (!this.currentTrack) {
      const last = this.lastPlayedTrack();
      if (last) { this.playTrack(last, [last]); return; }
    }
    if (this.nativeMode && this.nativeAvailable) {
      try { window.Capacitor.Plugins.PlaybackKeeper.toggle(); } catch (e) {}
      return;
    }
    if (this.isPlaying) {
      this.pause();
    } else {
      this.play();
    }
  }

  /** v3.12.5: the full track object of the most recent listening session. */
  lastPlayedTrack() {
    try {
      const t = JSON.parse(localStorage.getItem('simpmusic_last_track') || 'null');
      return (t && t.videoId) ? t : null;
    } catch (e) { return null; }
  }

  /**
   * v3.20.5: first queue slot holding a DIFFERENT song than the one playing,
   * or -1 when the rest of the queue is just more uploads of the same song.
   * {@code wrap} lets shuffle / repeat-all come back around the list.
   */
  firstDifferentSongIndex(from, wrap) {
    const n = this.queue.length;
    if (!n) return -1;
    const cur = this.currentTrack;
    const curKey = cur ? songKey(cur.title) : '';
    if (!curKey) return (from >= 0 && from < n) ? from : (wrap ? 0 : -1);
    if (from < 0) from = 0;
    for (let step = 0; step < n; step++) {
      let i = from + step;
      if (i >= n) {
        if (!wrap) return -1;
        i -= n;
      }
      if (i === this.currentIndex) continue;
      if (songKey(this.queue[i].title) !== curKey) return i;
    }
    return -1;
  }

  next() {
    if (this.nativeMode && this.nativeAvailable) {
      try { window.Capacitor.Plugins.PlaybackKeeper.next(); } catch (e) {}
      return;
    }
    if (this.queue.length === 0) return;

    if (this.repeatMode === 'one') {
      this.seekTo(0);
      this.play();
      return;
    }

    if (this.shuffle) {
      // v3.20.5: shuffle must not land on another upload of the song already
      // playing either.
      const r = Math.floor(Math.random() * this.queue.length);
      const idx = this.firstDifferentSongIndex(r, true);
      this.currentIndex = idx >= 0 ? idx : r;
    } else {
      // v3.20.5: a search for one song returns mostly its own variants
      // ("(Official Video)", "- Remix", "Lyrical") — stepping into those is
      // exactly "it plays all 20 versions of the same song".
      let nextIdx = -1;
      if (this.currentIndex < this.queue.length - 1) {
        nextIdx = this.firstDifferentSongIndex(this.currentIndex + 1, false);
      }
      if (nextIdx < 0 && this.repeatMode === 'all') nextIdx = 0;
      if (nextIdx < 0) {
        // v3.12.1: queue ended (or only same-song variants left) — try a
        // similar-song search (current artist) before giving up, mirroring the
        // native behavior. v3.19.10: rapid taps while a search is in flight
        // wait silently (no stop, no duplicate append) instead of stacking
        // parallel searches.
        this.findSimilarAndPlay().then(added => {
          if (added === 'inflight') return;
          if (!added) {
            this.emit('queueEnded');
            this.notifyNativePlayback('stop');
            this.notifyNativeState(false, 0);
          }
        });
        return;
      }
      this.currentIndex = nextIdx;
    }

    const nextTrack = this.queue[this.currentIndex];
    this.playTrack(nextTrack);
  }

  previous() {
    if (this.nativeMode && this.nativeAvailable) {
      try { window.Capacitor.Plugins.PlaybackKeeper.previous(); } catch (e) {}
      return;
    }
    if (this.currentTime > 4) {
      this.seekTo(0);
      return;
    }
    if (this.currentIndex > 0) {
      this.currentIndex--;
      this.playTrack(this.queue[this.currentIndex]);
    } else if (this.repeatMode === 'all') {
      this.currentIndex = this.queue.length - 1;
      this.playTrack(this.queue[this.currentIndex]);
    } else {
      this.seekTo(0);
    }
  }

  seekTo(seconds) {
    if (this.nativeMode && this.nativeAvailable) {
      try {
        window.Capacitor.Plugins.PlaybackKeeper.seekTo({ positionSec: seconds });
        this.currentTime = seconds;
        this.emit('timeupdate', { currentTime: seconds, duration: this.duration });
      } catch (e) {}
      return;
    }
    if (this.ytPlayer && this.ytPlayer.seekTo) {
      this.ytPlayer.seekTo(seconds, true);
      this.currentTime = seconds;
      this.emit('timeupdate', { currentTime: seconds, duration: this.duration });
    }
  }

  setVolume(volumePercent) {
    this.volume = Math.max(0, Math.min(100, volumePercent));
    if (this.ytPlayer && this.ytPlayer.setVolume) {
      this.ytPlayer.setVolume(this.volume);
    }
    this.emit('volumechange', this.volume);
  }

  toggleShuffle() {
    this.shuffle = !this.shuffle;
    this.emit('shuffletoggle', this.shuffle);
    if (this.nativeMode && this.nativeAvailable) {
      try {
        window.Capacitor.Plugins.PlaybackKeeper.options({ shuffle: this.shuffle, repeatMode: this.repeatMode });
      } catch (e) {}
    }
    return this.shuffle;
  }

  toggleRepeat() {
    const modes = ['off', 'all', 'one'];
    const nextIdx = (modes.indexOf(this.repeatMode) + 1) % modes.length;
    this.repeatMode = modes[nextIdx];
    this.emit('repeatmodechange', this.repeatMode);
    if (this.nativeMode && this.nativeAvailable) {
      try {
        window.Capacitor.Plugins.PlaybackKeeper.options({ shuffle: this.shuffle, repeatMode: this.repeatMode });
      } catch (e) {}
    }
    return this.repeatMode;
  }

  addToQueue(track) {
    if (!track) return;
    // v3.12.5: "Add to queue" appends at the END in BOTH modes (native
    // addToQueue intent carries atEnd=true; Play next keeps inserting).
    if (this.nativeMode && this.nativeAvailable) {
      try {
        window.Capacitor.Plugins.PlaybackKeeper.addToQueue({
          videoId: track.videoId, title: track.title || 'String Music',
          artist: track.artist || '', thumbnail: track.thumbnail || '',
          durationSec: Math.round(track.durationSec || 0)
        });
      } catch (e) {}
    }
    this.queue = this.queue.filter(t => t.videoId !== track.videoId);
    this.queue.push(track);
    this.emit('queueupdate', { queue: this.queue, currentIndex: this.currentIndex });
  }

  /**
   * v3.12.1: "Play next" — the track takes the slot right after the current
   * song. v3.19.9 fixes three queue bugs:
   *   1. Tapping "Play next" on the song ALREADY PLAYING queued a duplicate
   *      of it right after the current slot (the song repeated back-to-back).
   *      It is now a no-op (returns false so the caller can toast).
   *   2. The native-mode mirror pushed the track to the queue END while the
   *      service inserted it after current — Queue sheet order desynced.
   *   3. Removing a pending duplicate that sat BEFORE the current index
   *      shifted positions without adjusting currentIndex.
   */
  addToQueueNext(track) {
    if (!track || !track.videoId) return false;
    if (this.currentTrack && this.currentTrack.videoId === track.videoId) return false;
    const insertAfterCurrent = (q) => {
      const dupIdx = q.findIndex(t => t.videoId === track.videoId);
      if (dupIdx >= 0 && dupIdx !== this.currentIndex) {
        q.splice(dupIdx, 1);
        if (dupIdx < this.currentIndex) this.currentIndex--;
      }
      q.splice(this.currentIndex + 1, 0, track);
    };
    if (this.nativeMode && this.nativeAvailable) {
      try {
        window.Capacitor.Plugins.PlaybackKeeper.playNext({
          videoId: track.videoId, title: track.title || 'String Music',
          artist: track.artist || '', thumbnail: track.thumbnail || '',
          durationSec: Math.round(track.durationSec || 0)
        });
        // Mirror exactly what the service did: dedupe elsewhere + insert
        // right after the current slot.
        insertAfterCurrent(this.queue);
        this.emit('queueupdate', { queue: this.queue, currentIndex: this.currentIndex });
        return true;
      } catch (e) { /* fall through */ }
    }
    insertAfterCurrent(this.queue);
    this.emit('queueupdate', { queue: this.queue, currentIndex: this.currentIndex });
    return true;
  }

  removeFromQueue(index) {
    if (index < 0 || index >= this.queue.length) return;
    // v3.12: native mode delegates the live player mutation to the service.
    if (this.nativeMode && this.nativeAvailable) {
      if (index === this.currentIndex) return; // use skip/end instead
      try {
        window.Capacitor.Plugins.PlaybackKeeper.queueOps({ op: 'remove', arg: index });
        if (index < this.currentIndex) this.currentIndex--;
        this.queue.splice(index, 1);
        this.emit('queueupdate', { queue: this.queue, currentIndex: this.currentIndex });
      } catch (e) {}
      return;
    }
    this.queue.splice(index, 1);
    if (index < this.currentIndex) {
      this.currentIndex--;
    } else if (index === this.currentIndex) {
      if (this.currentIndex < this.queue.length) {
        this.playTrack(this.queue[this.currentIndex]);
      } else if (this.queue.length > 0) {
        this.currentIndex = 0;
        this.playTrack(this.queue[0]);
      }
    }
    this.emit('queueupdate', { queue: this.queue, currentIndex: this.currentIndex });
  }

  /** v3.12: reorder an upcoming track (Queue sheet drag & drop). */
  moveInQueue(from, to) {
    if (from === to) return;
    if (from < 0 || from >= this.queue.length || to < 0 || to >= this.queue.length) return;
    if (this.nativeMode && this.nativeAvailable) {
      if (from === this.currentIndex || to === this.currentIndex) return;
      try {
        window.Capacitor.Plugins.PlaybackKeeper.queueOps({ op: 'move', arg: from, arg2: to });
      } catch (e) {}
    } else if (from === this.currentIndex || to === this.currentIndex) {
      return;
    }
    const [t] = this.queue.splice(from, 1);
    this.queue.splice(to, 0, t);
    // A move across the current track shifts its index — keep in sync.
    if (from < this.currentIndex && to >= this.currentIndex) this.currentIndex--;
    else if (from > this.currentIndex && to <= this.currentIndex) this.currentIndex++;
    this.emit('queueupdate', { queue: this.queue, currentIndex: this.currentIndex });
  }

  /** v3.12: jump straight to a queued track (Queue sheet tap). */
  skipTo(index) {
    if (index < 0 || index >= this.queue.length) return;
    if (this.nativeMode && this.nativeAvailable) {
      try {
        window.Capacitor.Plugins.PlaybackKeeper.queueOps({ op: 'skip', arg: index });
        this.currentIndex = index;
        this.emit('queueupdate', { queue: this.queue, currentIndex: this.currentIndex });
      } catch (e) {}
      return;
    }
    this.currentIndex = index;
    this.playTrack(this.queue[index]);
  }

  /**
   * v3.12.2: audio quality ("low" | "standard" | "high"). Persists and
   * pushes to the native resolver (cache is invalidated there), so the
   * NEXT resolved stream uses the selected band.
   */
  setAudioQuality(q) {
    const nq = normalizeAudioQuality(q);
    this.audioQuality = nq;
    try { localStorage.setItem('simpmusic_audio_quality', nq); } catch (e) {}
    if (this.nativeAvailable) {
      try {
        window.Capacitor.Plugins.PlaybackKeeper.setAudioQuality({ quality: nq });
      } catch (e) {}
    }
    this.emit('qualitychange', nq);
    return nq;
  }

  /** v3.12: set crossfade seconds (0 = off); persists + pushes to native. */
  setCrossfade(seconds) {
    const sec = Math.max(0, Math.min(12, parseInt(seconds, 10) || 0));
    this.crossfadeSec = sec;
    try { localStorage.setItem('simpmusic_crossfade', String(sec)); } catch (e) {}
    if (this.nativeAvailable) {
      try {
        window.Capacitor.Plugins.PlaybackKeeper.setCrossfade({ seconds: sec });
      } catch (e) {}
    }
    this.emit('crossfadechange', sec);
    return sec;
  }

  /**
   * v3.16: sleep timer. `{ minutes: n }` = countdown (native fade-out at the
   * last 10s), `{ endOfTrack: true }` = pause after the current song,
   * `{}` = cancel. Playback lives in the service, so this is native-only.
   */
  setSleepTimer(opts = {}) {
    const minutes = parseInt(opts.minutes, 10) || 0;
    const endOfTrack = !!opts.endOfTrack;
    try {
      localStorage.setItem('simpmusic_sleep',
        JSON.stringify({ mode: endOfTrack ? 'eot' : (minutes > 0 ? String(minutes) : 'off') }));
    } catch (e) {}
    if (this.nativeAvailable) {
      try {
        window.Capacitor.Plugins.PlaybackKeeper.setSleepTimer({ minutes, endOfTrack });
      } catch (e) {}
    }
    return { minutes, endOfTrack };
  }

  clearQueue() {
    const current = this.currentTrack;
    this.queue = current ? [current] : [];
    this.currentIndex = current ? 0 : -1;
    this.emit('queueupdate', { queue: this.queue, currentIndex: this.currentIndex });
  }

  onTrackEnded() {
    // v3.9: browser (iframe) mode — when the queue is exhausted, extend it
    // with a recommended song based on the user's interest and keep playing.
    if (!(this.nativeMode && this.nativeAvailable)
        && this.currentIndex >= this.queue.length - 1
        && this.repeatMode === 'off') {
      const reco = this.nextRecommendation();
      if (reco) {
        this.queue.push(reco);
        this.currentIndex = this.queue.length - 1;
        this.emit('queueupdate', { queue: this.queue, currentIndex: this.currentIndex });
        this.playTrack(reco);
        return;
      }
    }
    this.next();
  }

  /**
   * v3.9: pick the best recommended track not already in the queue, using
   * the user's interest profile (SimpMusicReco section rankings).
   */
  nextRecommendation() {
    try {
      const reco = window.SimpMusicReco;
      if (!reco || !reco.getSections) return null;
      const inQueue = new Set(this.queue.map(t => t.videoId));
      // v3.20.5: a recommendation can be the same song in another upload —
      // skipping it here is what stops "the same song again, twenty times".
      const curKey = songKey((this.currentTrack || {}).title || '');
      const sections = reco.getSections() || [];
      for (const s of sections) {
        if (s.kind === 'recent') continue; // history is not a recommendation
        for (const t of s.tracks) {
          if (!t || !t.videoId || inQueue.has(t.videoId)) continue;
          if (curKey && songKey(t.title) === curKey) continue;
          return t;
        }
      }
    } catch (e) {}
    return null;
  }

  /**
   * v3.12.1: browser-mode similar-song fallback. Searches the backend for
   * the current artist and appends the first track not already queued.
   */
  /**
   * v3.19.10: guard so repeated NEXT taps at queue-end don't stack parallel
   * searches. Two overlapping searches for the same seed return the same
   * result list, and EACH appended + played the same first candidate — the
   * "skipping fast repeats the same song" bug.
   */
  _findingSimilar = false;

  async findSimilarAndPlay() {
    // 'inflight' → a search is already deciding the next song; the caller
    // (next) must NOT treat that as queue-ended and stop playback.
    if (this._findingSimilar) return 'inflight';
    this._findingSimilar = true;
    try {
      return await this._findSimilarAndPlayInner();
    } finally {
      this._findingSimilar = false;
    }
  }

  async _findSimilarAndPlayInner() {
    const cur = this.currentTrack;
    if (!cur) return false;
    const seed = cur.artist || cur.title || '';
    if (!seed) return false;
    try {
      let results = null;
      if (this.nativeAvailable) {
        const res = await window.Capacitor.Plugins.PlaybackKeeper.search({ query: seed });
        results = res && res.results ? JSON.parse(res.results) : null;
      } else if (typeof window.apiSearch === 'function') {
        results = await window.apiSearch(seed);
      }
      if (!Array.isArray(results)) return false;
      // v3.19.10: dedupe against the QUEUE **and** recent history. Previously
      // only the live queue was excluded, so once a song left the queue the
      // next search happily re-appended it — old songs kept cycling back.
      let recentIds = {};
      try {
        (JSON.parse(localStorage.getItem('simpmusic_recent_songs') || '[]') || [])
          .slice(-14)
          .forEach(t => { if (t && t.videoId) recentIds[t.videoId] = true; });
      } catch (e) {}
      const inQ = new Set(this.queue.map(t => t.videoId));
      const buildTrack = (r) => ({
        videoId: r.videoId,
        title: r.title || 'Similar song',
        artist: r.artist || '',
        thumbnail: r.thumbnail || ('https://i.ytimg.com/vi/' + r.videoId + '/hqdefault.jpg'),
        durationSec: r.durationSec || 0
      });
      // v3.20.5: "similar" must not be another upload of the SAME song.
      const curKey = songKey(cur.title);
      // Pass 1: skip anything queued or heard recently.
      for (const r of results) {
        if (!r || !r.videoId || r.videoId === cur.videoId) continue;
        if (curKey && songKey(r.title) === curKey) continue;
        if (inQ.has(r.videoId) || recentIds[r.videoId]) continue;
        const t = buildTrack(r);
        this.queue.push(t);
        this.currentIndex = this.queue.length - 1;
        this.emit('queueupdate', { queue: this.queue, currentIndex: this.currentIndex });
        this.playTrack(t);
        return true;
      }
      // Pass 2 (fallback): nothing fresh from this artist — allow older
      // history repeats rather than dead-ending the queue.
      for (const r of results) {
        if (!r || !r.videoId || r.videoId === cur.videoId || inQ.has(r.videoId)) continue;
        if (curKey && songKey(r.title) === curKey) continue;
        const t = buildTrack(r);
        this.queue.push(t);
        this.currentIndex = this.queue.length - 1;
        this.emit('queueupdate', { queue: this.queue, currentIndex: this.currentIndex });
        this.playTrack(t);
        return true;
      }
    } catch (e) { /* fall through */ }
    return false;
  }

  /**
   * v3.9: keep the native service stocked with recommendations so it can
   * extend the queue itself when the last song ends — even if the WebView
   * is frozen in the background at that moment.
   */
  syncAutoQueue() {
    try {
      const cap = window.Capacitor;
      if (!cap || !cap.isPluginAvailable || !cap.isPluginAvailable('PlaybackKeeper')) return;
      const reco = window.SimpMusicReco;
      if (!reco || !reco.getSections) return;
      const inQueue = new Set(this.queue.map(t => t.videoId));
      const picks = [];
      const sections = reco.getSections() || [];
      for (const s of sections) {
        if (s.kind === 'recent') continue;
        for (const t of s.tracks) {
          if (t && t.videoId && !inQueue.has(t.videoId) && picks.length < 10) {
            picks.push(t);
            inQueue.add(t.videoId);
          }
        }
      }
      if (!picks.length) {
        // v3.13: brand-new user — reco sections are still empty, so seed the
        // native auto-queue from the client trending catalog. Without this
        // the lock-screen/notification NEXT button dead-ends on a fresh
        // install instead of playing something like it does inside the app.
        for (const t of (window.getClientTrending('global') || [])) {
          if (t && t.videoId && !inQueue.has(t.videoId)) {
            picks.push(t);
            inQueue.add(t.videoId);
            if (picks.length >= 10) break;
          }
        }
      }
      if (!picks.length) return;
      cap.Plugins.PlaybackKeeper.setAutoQueue({
        videoIds: picks.map(t => t.videoId),
        titles: picks.map(t => t.title || 'String Music'),
        artists: picks.map(t => t.artist || ''),
        thumbnails: picks.map(t => t.thumbnail || ''),
        durations: picks.map(t => Math.round(t.durationSec || 0))
      });
    } catch (e) { /* never block playback */ }
  }

  /* Browser MediaSession API Integration */
  setupMediaSession() {
    if ('mediaSession' in navigator) {
      navigator.mediaSession.setActionHandler('play', () => this.play());
      navigator.mediaSession.setActionHandler('pause', () => this.pause());
      navigator.mediaSession.setActionHandler('previoustrack', () => this.previous());
      navigator.mediaSession.setActionHandler('nexttrack', () => this.next());
      navigator.mediaSession.setActionHandler('seekto', (details) => {
        if (details.seekTime !== undefined) {
          this.seekTo(details.seekTime);
        }
      });
      navigator.mediaSession.setActionHandler('seekbackward', (details) => {
        this.seekTo(Math.max(0, this.currentTime - (details.seekOffset || 10)));
      });
      navigator.mediaSession.setActionHandler('seekforward', (details) => {
        this.seekTo(Math.min(this.duration, this.currentTime + (details.seekOffset || 10)));
      });
    }
  }

  updateMediaSessionMetadata(track) {
    if ('mediaSession' in navigator && track) {
      navigator.mediaSession.metadata = new MediaMetadata({
        title: track.title,
        artist: track.artist,
        album: track.album || 'String Music',
        artwork: [
          { src: track.thumbnail, sizes: '512x512', type: 'image/jpeg' }
        ]
      });
    }
  }

  updateMediaSessionState(state) {
    if ('mediaSession' in navigator) {
      navigator.mediaSession.playbackState = state;
    }
  }
}

window.MusicPlayer = MusicPlayer;
