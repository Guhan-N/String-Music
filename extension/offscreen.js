/**
 * SimpMusic Offscreen Audio Player Engine (Manifest V3)
 * Runs YouTube IFrame player continuously in background with Chrome MediaSession sync
 */

let player = null;
let currentTrack = null;
let isPlaying = false;
let duration = 0;
let currentTime = 0;
let ticker = null;
let currentVolume = 80;

function broadcastState() {
  const payload = {
    isPlaying,
    track: currentTrack,
    currentTime,
    duration,
    volume: currentVolume
  };

  chrome.runtime.sendMessage({
    type: 'STATE_UPDATE',
    payload
  }).catch(() => {});
}

function startTicker() {
  stopTicker();
  ticker = setInterval(() => {
    if (player && player.getCurrentTime) {
      try {
        currentTime = player.getCurrentTime() || 0;
        duration = player.getDuration() || (currentTrack ? currentTrack.durationSec : 0);
        broadcastState();
      } catch (e) {}
    }
  }, 500);
}

function stopTicker() {
  if (ticker) {
    clearInterval(ticker);
    ticker = null;
  }
}

window.onYouTubeIframeAPIReady = function() {
  player = new YT.Player('yt-audio-player', {
    height: '100',
    width: '100',
    playerVars: {
      autoplay: 1,
      controls: 0,
      disablekb: 1,
      enablejsapi: 1,
      playsinline: 1
    },
    events: {
      onReady: () => {
        player.setVolume(currentVolume);
      },
      onStateChange: (event) => {
        if (event.data === YT.PlayerState.PLAYING) {
          isPlaying = true;
          startTicker();
          updateMediaSessionState('playing');
        } else if (event.data === YT.PlayerState.PAUSED) {
          isPlaying = false;
          stopTicker();
          updateMediaSessionState('paused');
        } else if (event.data === YT.PlayerState.ENDED) {
          isPlaying = false;
          stopTicker();
          chrome.runtime.sendMessage({ type: 'TRACK_ENDED' }).catch(() => {});
        }
        broadcastState();
      }
    }
  });
};

function updateMediaSession(track) {
  if ('mediaSession' in navigator && track) {
    navigator.mediaSession.metadata = new MediaMetadata({
      title: track.title,
      artist: track.artist,
      album: track.album || 'SimpMusic',
      artwork: [
        { src: track.thumbnail, sizes: '512x512', type: 'image/jpeg' }
      ]
    });

    navigator.mediaSession.setActionHandler('play', () => {
      if (player && player.playVideo) player.playVideo();
    });
    navigator.mediaSession.setActionHandler('pause', () => {
      if (player && player.pauseVideo) player.pauseVideo();
    });
    navigator.mediaSession.setActionHandler('seekto', (details) => {
      if (details.seekTime !== undefined && player) {
        player.seekTo(details.seekTime, true);
      }
    });
  }
}

function updateMediaSessionState(state) {
  if ('mediaSession' in navigator) {
    navigator.mediaSession.playbackState = state;
  }
}

// Listen for playback control commands
chrome.runtime.onMessage.addListener((message) => {
  if (message.target !== 'offscreen_internal') return;

  switch (message.type) {
    case 'PLAY_TRACK':
      currentTrack = message.track;
      if (player && player.loadVideoById) {
        player.loadVideoById(message.track.videoId);
        player.playVideo();
        updateMediaSession(message.track);
      }
      break;

    case 'PAUSE':
      if (player && player.pauseVideo) player.pauseVideo();
      break;

    case 'RESUME':
      if (player && player.playVideo) player.playVideo();
      break;

    case 'TOGGLE_PLAY':
      if (isPlaying) {
        if (player && player.pauseVideo) player.pauseVideo();
      } else {
        if (player && player.playVideo) player.playVideo();
      }
      break;

    case 'SEEK':
      if (player && player.seekTo) {
        player.seekTo(message.seconds, true);
        currentTime = message.seconds;
        broadcastState();
      }
      break;

    case 'SET_VOLUME':
      currentVolume = message.volume;
      if (player && player.setVolume) {
        player.setVolume(message.volume);
        broadcastState();
      }
      break;
  }
});
