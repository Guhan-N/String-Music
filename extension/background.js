/**
 * SimpMusic Extension Service Worker (Manifest V3)
 * Manages Offscreen Audio Document and coordinates playback state
 */

let creatingOffscreenPromise = null;

async function setupOffscreenDocument() {
  const offscreenUrl = chrome.runtime.getURL('offscreen.html');
  const existingContexts = await chrome.runtime.getContexts({
    contextTypes: ['OFFSCREEN_DOCUMENT'],
    documentUrls: [offscreenUrl]
  });

  if (existingContexts.length > 0) {
    return;
  }

  if (creatingOffscreenPromise) {
    await creatingOffscreenPromise;
  } else {
    creatingOffscreenPromise = chrome.offscreen.createDocument({
      url: 'offscreen.html',
      reasons: ['AUDIO_PLAYBACK'],
      justification: 'Uninterrupted music playback and media control across browser tabs'
    });
    await creatingOffscreenPromise;
    creatingOffscreenPromise = null;
  }
}

// Ensure offscreen document exists whenever a playback message arrives
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  (async () => {
    try {
      if (['PLAY_TRACK', 'PAUSE', 'RESUME', 'TOGGLE_PLAY', 'SEEK', 'SET_VOLUME'].includes(message.type)) {
        await setupOffscreenDocument();
      }

      // If message is from popup, forward to offscreen document
      if (message.target === 'offscreen') {
        await setupOffscreenDocument();
        chrome.runtime.sendMessage({ ...message, target: 'offscreen_internal' });
        sendResponse({ status: 'forwarded' });
        return;
      }

      // If message is state update from offscreen, store state in local storage
      if (message.type === 'STATE_UPDATE') {
        chrome.storage.local.set({ playbackState: message.payload });
        sendResponse({ status: 'stored' });
        return;
      }

      sendResponse({ status: 'ok' });
    } catch (err) {
      console.error('Background worker error:', err);
      sendResponse({ status: 'error', error: err.message });
    }
  })();
  return true; // Keep message channel open for async response
});

// Setup on extension install
chrome.runtime.onInstalled.addListener(async () => {
  console.log('SimpMusic Extension installed.');
  chrome.storage.local.set({
    playbackState: {
      isPlaying: false,
      track: null,
      currentTime: 0,
      duration: 0,
      volume: 80
    }
  });
});
