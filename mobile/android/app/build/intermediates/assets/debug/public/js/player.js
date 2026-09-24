/**
 * SimpMusic Playback Engine
 * Integrates YouTube IFrame API with Audio Queue, Background Support & MediaSession API
 */

// Background Audio Persistence: Override Page Visibility API so YouTube never auto-pauses on screen lock
(function ensureBackgroundAudio() {
  try {
    Object.defineProperty(document, 'hidden', { get: () => false, configurable: true });
    Object.defineProperty(document, 'visibilityState', { get: () => 'visible', configurable: true });
    Object.defineProperty(document, 'webkitVisibilityState', { get: () => 'visible', configurable: true });
    window.addEventListener('visibilitychange', (e) => e.stopImmediatePropagation(), true);
  } catch (e) {}
})();

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
    this.rafId = null;

    this.initYouTubeApi();
    this.setupMediaSession();
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
    // Inject YouTube IFrame API script if not already present
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
          // Auto advance if video fails to load
          setTimeout(() => this.next(), 1000);
        }
      }
    });
  }

  onPlayerStateChange(event) {
    if (!window.YT) return;
    switch (event.data) {
      case YT.PlayerState.PLAYING:
        this.isPlaying = true;
        this.userPaused = false;
        this.startProgressTicker();
        this.emit('play', this.currentTrack);
        this.updateMediaSessionState('playing');
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
        this.stopProgressTicker();
        this.emit('pause');
        this.updateMediaSessionState('paused');
        break;
      case YT.PlayerState.ENDED:
        this.isPlaying = false;
        this.stopProgressTicker();
        this.emit('ended');
        this.onTrackEnded();
        break;
      case YT.PlayerState.BUFFERING:
        this.emit('buffering');
        break;
    }
  }

  startProgressTicker() {
    this.stopProgressTicker();
    const updateTime = () => {
      if (this.ytPlayer && this.ytPlayer.getCurrentTime) {
        try {
          const cur = this.ytPlayer.getCurrentTime() || 0;
          const dur = this.ytPlayer.getDuration() || (this.currentTrack ? this.currentTrack.durationSec : 0);
          this.currentTime = cur;
          this.duration = dur;
          this.emit('timeupdate', { currentTime: cur, duration: dur });
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
    if (this.rafId) {
      cancelAnimationFrame(this.rafId);
      this.rafId = null;
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
    this.loadVideo(track.videoId);
    this.updateMediaSessionMetadata(track);
  }

  loadVideo(videoId) {
    if (!this.ytPlayer || !this.isReady) {
      // Retry when player is ready
      setTimeout(() => this.loadVideo(videoId), 300);
      return;
    }
    try {
      this.ytPlayer.loadVideoById({
        videoId: videoId,
        suggestedQuality: 'small'
      });
      this.ytPlayer.playVideo();
    } catch (err) {
      console.error('Error loading video:', err);
    }
  }

  play() {
    this.userPaused = false;
    if (this.ytPlayer && this.ytPlayer.playVideo) {
      this.ytPlayer.playVideo();
    }
  }

  pause() {
    this.userPaused = true;
    if (this.ytPlayer && this.ytPlayer.pauseVideo) {
      this.ytPlayer.pauseVideo();
    }
  }

  togglePlay() {
    if (this.isPlaying) {
      this.pause();
    } else {
      this.play();
    }
  }

  next() {
    if (this.queue.length === 0) return;

    if (this.repeatMode === 'one') {
      this.seekTo(0);
      this.play();
      return;
    }

    if (this.shuffle) {
      let nextIdx = Math.floor(Math.random() * this.queue.length);
      if (this.queue.length > 1 && nextIdx === this.currentIndex) {
        nextIdx = (nextIdx + 1) % this.queue.length;
      }
      this.currentIndex = nextIdx;
    } else {
      if (this.currentIndex < this.queue.length - 1) {
        this.currentIndex++;
      } else if (this.repeatMode === 'all') {
        this.currentIndex = 0;
      } else {
        // Queue ended; fetch recommendations or stop
        this.emit('queueEnded');
        return;
      }
    }

    const nextTrack = this.queue[this.currentIndex];
    this.playTrack(nextTrack);
  }

  previous() {
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
    return this.shuffle;
  }

  toggleRepeat() {
    const modes = ['off', 'all', 'one'];
    const nextIdx = (modes.indexOf(this.repeatMode) + 1) % modes.length;
    this.repeatMode = modes[nextIdx];
    this.emit('repeatmodechange', this.repeatMode);
    return this.repeatMode;
  }

  addToQueue(track) {
    if (!track) return;
    this.queue.push(track);
    this.emit('queueupdate', { queue: this.queue, currentIndex: this.currentIndex });
  }

  removeFromQueue(index) {
    if (index < 0 || index >= this.queue.length) return;
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

  clearQueue() {
    const current = this.currentTrack;
    this.queue = current ? [current] : [];
    this.currentIndex = current ? 0 : -1;
    this.emit('queueupdate', { queue: this.queue, currentIndex: this.currentIndex });
  }

  onTrackEnded() {
    this.next();
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
        album: track.album || 'SimpMusic',
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
