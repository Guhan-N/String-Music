package com.simpmusic.app;

import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.content.Context;
import android.content.Intent;
import android.net.Uri;
import android.os.Build;
import android.os.Handler;
import android.os.Looper;
import android.os.PowerManager;
import android.util.Log;

import androidx.annotation.Nullable;
import androidx.media3.common.AudioAttributes;
import androidx.media3.common.C;
import androidx.media3.datasource.DataSource;
import androidx.media3.common.MediaItem;
import androidx.media3.common.MediaMetadata;
import androidx.media3.common.ForwardingPlayer;
import androidx.media3.common.PlaybackException;
import androidx.media3.common.Player;
import androidx.media3.datasource.DefaultHttpDataSource;
import androidx.media3.exoplayer.ExoPlayer;
import androidx.media3.exoplayer.source.DefaultMediaSourceFactory;
import androidx.media3.session.MediaSession;
import androidx.media3.session.MediaSessionService;

import java.io.IOException;
import java.util.ArrayList;
import java.util.List;

/**
 * Media3 {@link MediaSessionService} that OWNS audio playback for SimpMusic.
 *
 * Unlike the previous mirror-only design, a real ExoPlayer lives here. The
 * queue is provided by the WebView UI (videoId + metadata), but the audio is
 * decoded and rendered by ExoPlayer on the native side. Stream URLs are
 * resolved lazily, at open time, through {@link ResolvingDataSource} +
 * {@link StreamResolver} (NewPipe Extractor), so a URL is only fetched when
 * a track actually starts — stale URLs and pre-fetching are avoided.
 *
 * Because audio no longer depends on the WebView, background playback
 * survives even if Android freezes the UI process: the service keeps the
 * process in the foreground via the media notification. Progress, track
 * changes and queue end are pushed back to the WebView through
 * {@link PlaybackKeeperPlugin} events.
 */
public class PlaybackKeepAliveService extends MediaSessionService {

    private static final String TAG = "SimpMusic/Playback";
    private static final String CHANNEL_ID = "simpmusic_playback";

    public static final String ACTION_STOP = "STOP";
    public static final String ACTION_LOAD_QUEUE = "LOAD_QUEUE";
    public static final String ACTION_TOGGLE = "TOGGLE";
    public static final String ACTION_NEXT = "NEXT";
    public static final String ACTION_PREV = "PREV";
    public static final String ACTION_SEEK = "SEEK";
    public static final String ACTION_OPTIONS = "OPTIONS";
    public static final String ACTION_PLAY_NEXT = "PLAY_NEXT";
    public static final String ACTION_STATUS = "STATUS";
    /** v3.7: play a downloaded local file (offline playback). */
    public static final String ACTION_PLAY_LOCAL = "PLAY_LOCAL";
    /** v3.9: recommendation candidates pushed by the WebView reco engine. */
    public static final String ACTION_SET_AUTO_QUEUE = "SET_AUTO_QUEUE";
    /** v3.12: queue management from the Queue sheet (skip/remove/move). */
    public static final String ACTION_QUEUE_OP = "QUEUE_OP";
    /** v3.12: crossfade duration change (seconds, 0 = off). */
    public static final String ACTION_SET_CROSSFADE = "SET_CROSSFADE";

    public static final String ACTION_SET_SLEEP_TIMER = "SET_SLEEP_TIMER";

    /** Event names pushed to the WebView. */
    public static final String EV_PROGRESS = "progress";
    public static final String EV_TRACKCHANGE = "trackchange";
    public static final String EV_STATE = "state";
    public static final String EV_ENDED = "ended";
    public static final String EV_ERROR = "error";
    public static final String EV_RESTORED = "restored";
    /** v3.12.3: the authoritative queue list after any mutation. */
    public static final String EV_QUEUE = "queuechanged";

    private static final long PROGRESS_PERIOD_MS = 500;

    private ExoPlayer player;
    private MediaSession mediaSession;
    private Handler mainHandler;
    private PowerManager.WakeLock wakeLock;
    private boolean queueSynced = false;
    private String lastPreloadedId = null;

    // -------- v3.12 crossfade (dual-player fade & swap) --------
    /** Fading-in player; becomes `player` after the swap. */
    private ExoPlayer nextPlayer;
    /** Crossfade duration in seconds (0 = disabled). */
    private volatile int crossfadeSec = 0;
    /** Guards against scheduling two swaps for the same transition. */
    private boolean crossfadeArmed = false;
    /** True while the swap is running (progress events must not flip state). */
    private volatile boolean swapping = false;
    /** Positions (ms) of both players when a swap starts; used to splice. */
    private long swapFromPos = 0;
    private long swapAtPos = 0;

    // -------- v3.16 sleep timer --------
    /** Wall-clock (elapsedRealtime) ms when playback should stop; 0 = off. */
    private volatile long sleepEndsAt = 0;
    /** "End of track" mode: pause when the CURRENT song finishes. */
    private volatile boolean sleepAtTrackEnd = false;
    /** Guards against double-fires of the fade/pause. */
    private volatile boolean sleepFiring = false;

    private final Runnable progressTick = this::emitProgress;

    // -------- queue data (mirrors the JS player queue) --------

    private static final class Track {
        String videoId;
        String title;
        String artist;
        String artworkUrl;
        long durationSec;
    }

    private final List<Track> queue = new ArrayList<>();
    /** v3.9: recommended tracks used to extend the queue when it ends. */
    private final List<Track> autoQueue = new ArrayList<>();
    private int currentIndex = -1;
    private boolean playing = false;
    private String repeatMode = "off"; // off | all | one
    private boolean shuffle = false;

    // ---------------- Service lifecycle ----------------

    @Override
    public void onCreate() {
        super.onCreate();
        createChannel();
        mainHandler = new Handler(Looper.getMainLooper());
        // v3.16: restore a pending sleep timer after a START_STICKY restart.
        long saved = getSharedPreferences("simpmusic_prefs", MODE_PRIVATE)
                .getLong("sleep_ends_at_elapsed", 0);
        if (saved > android.os.SystemClock.elapsedRealtime()) {
            sleepEndsAt = saved;
            sleepFiring = false;
            mainHandler.postDelayed(sleepTick, 1000);
            Log.d(TAG, "Sleep timer restored, ends at " + saved);
        } else if (saved > 0) {
            getSharedPreferences("simpmusic_prefs", MODE_PRIVATE).edit().remove("sleep_ends_at_elapsed").apply();
        }

        DefaultHttpDataSource.Factory httpFactory = new DefaultHttpDataSource.Factory()
                .setUserAgent(StreamResolver.USER_AGENT)
                .setAllowCrossProtocolRedirects(true)
                .setConnectTimeoutMs(12_000)
                .setReadTimeoutMs(20_000);

        // Resolve the real audio URL just-in-time, every time ExoPlayer opens
        // the source, using the videoId encoded in the MediaItem's localUri.
        // v3.4: wrapped in SelfHealingDataSource — a stale/cached URL rejected
        // with 403/410/429 is dropped and re-resolved fresh, then the open is
        // retried once, instead of failing playback and triggering the slow
        // JS iframe-fallback reload.
        SelfHealingDataSource.Factory resolvingFactory = new SelfHealingDataSource.Factory(
                httpFactory::createDataSource,
                dataSpec -> {
                    String videoId = dataSpec.uri.getQueryParameter("v");
                    if (videoId == null || videoId.isEmpty()) {
                        throw new IllegalStateException("Missing videoId in DataSpec URI");
                    }
                    // NOTE: only IOException may leave this lambda — throwing a
                    // RuntimeException here escapes ExoPlayer's loader thread
                    // and kills the whole process. surface as Player error.
                    try {
                        String url = StreamResolver.resolveAudioUrl(videoId);
                        Log.d(TAG, "Resolved stream for " + videoId);
                        return dataSpec.buildUpon().setUri(Uri.parse(url)).build();
                    } catch (Exception first) {
                        // Cached URL may have gone stale — one retry with a
                        // fresh extraction, then give up as a clean IOException.
                        StreamResolver.invalidate(videoId);
                        try {
                            String url = StreamResolver.resolveAudioUrl(videoId);
                            return dataSpec.buildUpon().setUri(Uri.parse(url)).build();
                        } catch (Exception second) {
                            Log.e(TAG, "Stream resolution failed for " + videoId, second);
                            throw new IOException("Resolution failed: " + second.getMessage(), second);
                        }
                    }
                });

        AudioAttributes audioAttributes = new AudioAttributes.Builder()
                .setUsage(C.USAGE_MEDIA)
                .setContentType(C.AUDIO_CONTENT_TYPE_MUSIC)
                .build();

        // v3.7.1: route by URI scheme. HTTP(S) → the self-healing resolving
        // pipeline (stream playback). content:// / file:// → Android's local
        // data sources, so downloaded files (MediaStore) can play OFFLINE —
        // the HTTP factory cannot open content:// URIs (froze at pos 0 and
        // errored before this fix).
        DataSource.Factory routingFactory = () -> new SchemeRoutingDataSource(
                resolvingFactory::createDataSource,
                () -> getApplicationContext());

        player = new ExoPlayer.Builder(this)
                .setMediaSourceFactory(new DefaultMediaSourceFactory(routingFactory))
                .setAudioAttributes(audioAttributes, true)
                .setHandleAudioBecomingNoisy(true)
                .setWakeMode(C.WAKE_MODE_LOCAL)
                .build();

        // v3.12: listener wiring extracted (identity-guarded) so the
        // crossfade swap can attach identical behavior to the new player.
        attachPlayerListener(player);

        // v3.13.1: expose a wrapper player so the lock-screen/notification
        // NEXT keeps working when the queue is empty or at its end (a new
        // user with no queue gets a fresh song instead of a dead button).
        mediaSession = new MediaSession.Builder(this, mediaPlayer()).build();
    }

    @Nullable
    @Override
    public MediaSession onGetSession(MediaSession.ControllerInfo controllerInfo) {
        return mediaSession;
    }

    private boolean foregroundEntered = false;

    /**
     * Placeholder foreground notification. Posted SYNCHRONOUSLY in
     * onStartCommand() to fulfill the startForegroundService() contract
     * immediately; media3 replaces it with the rich media notification once
     * playback actually starts (same notification ID).
     */
    private android.app.Notification buildPlaceholderNotification() {
        return new android.app.Notification.Builder(this, CHANNEL_ID)
                .setSmallIcon(android.R.drawable.ic_media_play)
                .setContentTitle("SimpMusic")
                .setOngoing(true)
                .setContentIntent(android.app.PendingIntent.getActivity(
                        this, 0,
                        new android.content.Intent()
                                .setPackage(getPackageName())
                                .setAction(android.content.Intent.ACTION_MAIN)
                                .addCategory(android.content.Intent.CATEGORY_LAUNCHER),
                        android.app.PendingIntent.FLAG_IMMUTABLE))
                .build();
    }

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        // FULFILL THE startForegroundService() CONTRACT IMMEDIATELY — before
        // anything that can fail or be slow. Media3 only promotes the service
        // after playback starts; if stream extraction is slow/fails first,
        // the ~10s timeout fires and Android KILLS the app (the exact crash:
        // ForegroundServiceDidNotStartInTimeException from syncQueue).
        //
        // v3.4: call startForeground on EVERY command, not just the first.
        // The old foregroundEntered flag was never cleared when onPlayerError
        // called stopForeground(), so the next syncQueue skipped it and the
        // app was killed ~10s later (seen in crash log 20260926-150808).
        // Calling it again is always safe/idempotent.
        foregroundEntered = true;
        try {
            startForeground(
                    androidx.media3.session.DefaultMediaNotificationProvider.DEFAULT_NOTIFICATION_ID,
                    buildPlaceholderNotification());
        } catch (Exception e) {
            Log.w(TAG, "startForeground failed", e);
        }

        String action = intent != null && intent.getAction() != null
                ? intent.getAction() : ACTION_TOGGLE;

        switch (action) {
            case ACTION_STOP:
                queueSynced = false;
                queue.clear();
                autoQueue.clear();
                currentIndex = -1;
                swapping = false;
                if (nextPlayer != null) { try { nextPlayer.release(); } catch (Exception ignored) {} nextPlayer = null; }
                player.stop();
                player.clearMediaItems();
                releaseWakeLock();
                // Leave the foreground BEFORE stopSelf(): a later command
                // re-enters startForeground() at the top of onStartCommand.
                stopForegroundAndNotification();
                stopSelf();
                return START_NOT_STICKY;

            case ACTION_LOAD_QUEUE:
                loadQueue(intent);
                break;

            case ACTION_TOGGLE:
                if (player.isCommandAvailable(Player.COMMAND_PLAY_PAUSE) && queueSynced) {
                    if (playing) player.pause(); else player.play();
                } else if (!queueSynced || queue.isEmpty()) {
                    // v3.13.1: nothing loaded (fresh user) — give them a song
                    fetchFreshSuggestion(true);
                }
                break;

            case ACTION_NEXT:
                handleNext(false);
                break;

            case ACTION_PREV:
                if (player.getCurrentPosition() > 4000) {
                    player.seekTo(0);
                } else if (currentIndex > 0) {
                    player.seekToPreviousMediaItem();
                    player.play();
                } else {
                    player.seekTo(0);
                }
                break;

            case ACTION_SEEK:
                long posMs = intent.getLongExtra("positionMs", 0);
                player.seekTo(Math.max(0, posMs));
                break;

            case ACTION_PLAY_NEXT: {
                // Insert a track right after the current one WITHOUT touching
                // playback ("Play next" from the song menu).
                Track t = new Track();
                t.videoId = intent.getStringExtra("videoId");
                t.title = intent.getStringExtra("title") != null ? intent.getStringExtra("title") : "SimpMusic";
                t.artist = intent.getStringExtra("artist") != null ? intent.getStringExtra("artist") : "";
                t.artworkUrl = intent.getStringExtra("thumbnail") != null ? intent.getStringExtra("thumbnail") : "";
                t.durationSec = intent.getLongExtra("durationSec", 0);
                if (t.videoId != null && !t.videoId.isEmpty() && player != null) {
                    // v3.19.9: "Play next" on the song ALREADY PLAYING is a
                    // no-op — it used to insert a duplicate right after the
                    // current slot, so rapid taps repeated the same song.
                    if (currentIndex >= 0 && currentIndex < queue.size()
                            && t.videoId.equals(queue.get(currentIndex).videoId)) {
                        break;
                    }
                    // v3.12.4: classic "Play next" — the song takes the NEXT
                    // slot right after the current one (pushing the previous
                    // upcoming songs back). Duplicates elsewhere are removed
                    // first so the track appears exactly once, in this slot.
                    int dupIdx = -1;
                    for (int qi = 0; qi < queue.size(); qi++) {
                        if (qi != currentIndex && queue.get(qi).videoId.equals(t.videoId)) { dupIdx = qi; break; }
                    }
                    if (dupIdx >= 0) {
                        queue.remove(dupIdx);
                        player.removeMediaItem(dupIdx);
                        if (dupIdx < currentIndex) currentIndex--;
                    }
                    // v3.12.5: "atEnd=true" (Add to queue) appends at the
                    // end; default (Play next) takes the slot right after
                    // the current song.
                    int at = intent.getBooleanExtra("atEnd", false)
                            ? queue.size()
                            : Math.min(currentIndex + 1, queue.size());
                    queue.add(at, t);
                    player.addMediaItem(at, new MediaItem.Builder()
                            .setMediaId(t.videoId)
                            .setUri(Uri.parse("https://simpmusic.local/stream?v=" + t.videoId))
                            .setMediaMetadata(buildMetadata(t))
                            .build());
                    preloadNextAudio();
                    emitQueueChanged();
                }
                break;
            }

            case ACTION_STATUS:
                publishRestoreState();
                break;

            case ACTION_SET_AUTO_QUEUE: {
                // v3.9: replace the recommendation pool (keeps the service
                // self-sufficient even if the WebView is frozen later).
                autoQueue.clear();
                String[] aIds = intent.getStringArrayExtra("videoIds");
                String[] aTitles = intent.getStringArrayExtra("titles");
                String[] aArtists = intent.getStringArrayExtra("artists");
                String[] aThumbs = intent.getStringArrayExtra("thumbnails");
                int[] aDurs = intent.getIntArrayExtra("durations");
                int aN = aIds != null ? aIds.length : 0;
                for (int i = 0; i < aN; i++) {
                    Track t = new Track();
                    t.videoId = aIds[i];
                    t.title = aTitles != null && i < aTitles.length && aTitles[i] != null ? aTitles[i] : "SimpMusic";
                    t.artist = aArtists != null && i < aArtists.length ? aArtists[i] : "";
                    t.artworkUrl = aThumbs != null && i < aThumbs.length ? aThumbs[i] : "";
                    t.durationSec = aDurs != null && i < aDurs.length ? aDurs[i] : 0;
                    autoQueue.add(t);
                }
                Log.d(TAG, "Auto-queue updated: " + aN + " recommendations");
                break;
            }

            case ACTION_PLAY_LOCAL: {
                // v3.7: OFFLINE PLAYBACK — open the saved file directly from
                // MediaStore (no stream resolve, works with no network). Only
                // touches the player on success, so a bad URI never leaves
                // the service in a broken half-stopped state.
                String uri = intent.getStringExtra("uri");
                if (uri != null && !uri.isEmpty()) {
                    Track t = new Track();
                    t.videoId = intent.getStringExtra("videoId");
                    if (t.videoId == null || t.videoId.isEmpty()) t.videoId = "local:" + uri;
                    t.title = intent.getStringExtra("title") != null ? intent.getStringExtra("title") : "SimpMusic";
                    t.artist = intent.getStringExtra("artist") != null ? intent.getStringExtra("artist") : "";
                    t.artworkUrl = intent.getStringExtra("thumbnail") != null ? intent.getStringExtra("thumbnail") : "";
                    t.durationSec = intent.getLongExtra("durationSec", 0);
                    queue.clear();
                    queue.add(t);
                    currentIndex = 0;
                    queueSynced = true;
                    MediaItem mi = new MediaItem.Builder()
                            .setMediaId(t.videoId)
                            .setUri(Uri.parse(uri))
                            .setMediaMetadata(buildMetadata(t))
                        .build();
                    swapping = false;
                    if (nextPlayer != null) { try { nextPlayer.release(); } catch (Exception ignored) {} nextPlayer = null; }
                    player.setMediaItem(mi);
                    player.prepare();
                    player.play();
                    Log.d(TAG, "Playing local file: " + t.title);
                }
                break;
            }

            case ACTION_QUEUE_OP: {
                // v3.12: skip / remove / move coming from the Queue sheet.
                String op = intent.getStringExtra("op");
                int arg = intent.getIntExtra("arg", -1);
                int arg2 = intent.getIntExtra("arg2", -1);
                if ("skip".equals(op)) {
                    if (arg >= 0 && arg < queue.size()) {
                        currentIndex = arg;
                        player.seekTo(arg, C.TIME_UNSET);
                        player.play();
                        preloadNextAudio();
                        emitQueueChanged();
                    }
                } else if ("remove".equals(op)) {
                    if (arg > currentIndex && arg < queue.size()) {
                        Track removed = queue.remove(arg);
                        player.removeMediaItem(arg);
                        Log.d(TAG, "Removed from queue: " + removed.title);
                        emitQueueChanged();
                    } else if (arg == currentIndex && queue.size() > 1) {
                        // Removing the current track: let ExoPlayer advance
                        // (or wrap) and drop the item cleanly.
                        player.removeMediaItem(arg);
                        if (currentIndex >= queue.size()) currentIndex = queue.size() - 1;
                        emitQueueChanged();
                    }
                } else if ("move".equals(op)) {
                    if (arg >= 0 && arg < queue.size() && arg2 >= 0 && arg2 < queue.size()
                            && arg != currentIndex && arg2 != currentIndex
                            && player.getMediaItemCount() == queue.size()) {
                        Track moved = queue.remove(arg);
                        queue.add(arg2, moved);
                        player.moveMediaItem(arg, arg2);
                        // Moving across the current track shifts its index in
                        // both ExoPlayer and our list — keep bookkeeping in sync.
                        if (arg < currentIndex && arg2 >= currentIndex) currentIndex--;
                        else if (arg > currentIndex && arg2 <= currentIndex) currentIndex++;
                        Log.d(TAG, "Queue move " + arg + " -> " + arg2 + " (cur=" + currentIndex + ")");
                        emitQueueChanged();
                    }
                }
                break;
            }

            case ACTION_SET_CROSSFADE: {
                // v3.12: 0 disables; 1..12 seconds enables the fade & swap.
                int sec = intent.getIntExtra("seconds", 0);
                crossfadeSec = Math.max(0, Math.min(12, sec));
                Log.d(TAG, "Crossfade set to " + crossfadeSec + "s");
                break;
            }

            case ACTION_SET_SLEEP_TIMER: {
                // v3.16: minutes > 0 → countdown; endOfTrack=true → pause after
                // the current song; minutes == 0 && !endOfTrack → cancel.
                boolean endOfTrack = intent.getBooleanExtra("endOfTrack", false);
                int minutes = intent.getIntExtra("minutes", 0);
                if (endOfTrack) {
                    sleepAtTrackEnd = true;
                    sleepEndsAt = 0;
                    mainHandler.removeCallbacks(sleepTick);
                } else if (minutes > 0) {
                    sleepAtTrackEnd = false;
                    sleepFiring = false;
                    sleepEndsAt = android.os.SystemClock.elapsedRealtime() + minutes * 60_000L;
                    mainHandler.removeCallbacks(sleepTick);
                    mainHandler.postDelayed(sleepTick, 1000);
                    // Survive a process kill (START_STICKY restart).
                    getSharedPreferences("simpmusic_prefs", MODE_PRIVATE)
                            .edit()
                            .putLong("sleep_ends_at_elapsed", sleepEndsAt)
                            .apply();
                } else {
                    cancelSleepTimer();
                }
                Log.d(TAG, "Sleep timer: endOfTrack=" + endOfTrack + " minutes=" + minutes);
                break;
            }

            case ACTION_OPTIONS:
                setOptions(intent.getBooleanExtra("shuffle", false),
                        intent.getStringExtra("repeatMode"));
                break;
        }
        return START_STICKY;
    }

    // ---------------- queue handling ----------------

    private void loadQueue(Intent intent) {
        String[] ids = intent.getStringArrayExtra("videoIds");
        String[] titles = intent.getStringArrayExtra("titles");
        String[] artists = intent.getStringArrayExtra("artists");
        String[] thumbs = intent.getStringArrayExtra("thumbnails");
        int[] durations = intent.getIntArrayExtra("durations");
        int start = intent.getIntExtra("startIndex", 0);        // Apply JS shuffle/repeat preferences to the native player so lock-screen
        // next/prev and auto-advance follow the same behavior as the in-app queue.
        setOptions(intent.getBooleanExtra("shuffle", false),
                intent.getStringExtra("repeatMode"));

        // v3.4 FAST PATH: detect "same queue, different start index" (the common
        // tap-another-song-in-the-same-list case) BEFORE mutating any state, so
        // we can just seek — no stop/clear/prepare teardown — and the target
        // stream is usually already preloaded (preloadNextAudio) or cached.
        // NOTE: the check must happen before currentIndex is reassigned below
        // (an earlier version assigned currentIndex = start first, which made
        // start != currentIndex always false and the path dead).
        int n = ids != null ? ids.length : 0;
        boolean sameQueue = queueSynced && n == queue.size() && n > 0
                && currentIndex >= 0 && start >= 0 && start < n && start != currentIndex;
        if (sameQueue) {
            for (int i = 0; i < n; i++) {
                if (!ids[i].equals(queue.get(i).videoId)) { sameQueue = false; break; }
            }
        }

        queue.clear();
        for (int i = 0; i < n; i++) {
            Track t = new Track();
            t.videoId = ids[i];
            t.title = titles != null && i < titles.length && titles[i] != null ? titles[i] : "SimpMusic";
            t.artist = artists != null && i < artists.length && artists[i] != null ? artists[i] : "";
            t.artworkUrl = thumbs != null && i < thumbs.length ? thumbs[i] : "";
            t.durationSec = durations != null && i < durations.length ? durations[i] : 0;
            queue.add(t);
        }
        if (queue.isEmpty()) return;
        if (start < 0 || start >= queue.size()) start = 0;

        if (sameQueue) {
            Log.d(TAG, "loadQueue fast-path seek to " + start);
            currentIndex = start;
            player.seekTo(start, C.TIME_UNSET);
            player.play();
            return;
        }

        currentIndex = start;

        // Replace the playlist; first track plays immediately. Each item's
        // localUri encodes the videoId (?v=<id>) which the SelfHealing
        // fixer swaps for the real stream URL at open time.
        List<MediaItem> items = new ArrayList<>(queue.size());
        for (Track t : queue) {
            items.add(new MediaItem.Builder()
                    .setMediaId(t.videoId)
                    .setUri(Uri.parse("https://simpmusic.local/stream?v=" + t.videoId))
                    .setMediaMetadata(buildMetadata(t))
                    .build());
        }

        swapping = false;
        if (nextPlayer != null) { try { nextPlayer.release(); } catch (Exception ignored) {} nextPlayer = null; }
        player.stop();
        player.clearMediaItems();
        player.setMediaItems(items, start, C.TIME_UNSET);
        player.prepare();
        player.play();
        queueSynced = true;
        autoQueue.clear(); // fresh queue → the WebView pushes fresh recos
        Log.d(TAG, "Queue loaded: " + queue.size() + " items, start=" + start);
        emitQueueChanged();
    }


    /**
     * v3.12.2: COMPLETED SONGS LEAVE THE QUEUE — remove everything before
     * the previous track so finished music does not pile up behind the
     * current one (the Queue sheet shows only Now playing + upcoming, plus
     * the immediately previous song for context). Also re-syncs the player
     * playlist indices after removal.
     */
    private void pruneFinishedTracks() {
        if (queue.isEmpty() || currentIndex <= 1) return;
        int removeUpTo = currentIndex - 1; // keep one track of history
        for (int i = 0; i < removeUpTo && queue.size() > 1; i++) {
            if (player.getCurrentMediaItemIndex() == 0) break; // safety: never remove the playing item
            queue.remove(0);
            currentIndex--;
            player.removeMediaItem(0);
        }
        if (removeUpTo > 0) {
            Log.d(TAG, "Pruned " + removeUpTo + " finished track(s); cur=" + currentIndex);
            emitQueueChanged();
        }
    }

    /**
     * v3.4: resolve the NEXT track's stream URL in the background so that
     * switching tracks finds it in the StreamResolver cache — ExoPlayer opens
     * the stream instantly instead of waiting ~1-3s for extraction.
     */
    private void preloadNextAudio() {
        int nxt = currentIndex + 1;
        if (nxt < 0 || nxt >= queue.size()) return;
        final String nextId = queue.get(nxt).videoId;
        if (nextId == null || nextId.isEmpty() || nextId.equals(lastPreloadedId)) return;
        if (StreamResolver.isCached(nextId)) return;
        lastPreloadedId = nextId;
        new Thread(() -> {
            try {
                StreamResolver.resolveAudioUrl(nextId);
                Log.d(TAG, "Preloaded next stream: " + nextId);
            } catch (Exception e) {
                Log.w(TAG, "Preload failed for " + nextId + ": " + e.getMessage());
            }
        }, "simpmusic-preload").start();
    }

    // ---------------- v3.12 crossfade engine ----------------

    /**
     * Dual-player fade & swap: a second ExoPlayer starts the NEXT track
     * immediately (its stream is preloaded by preloadNextAudio, so it opens
     * in tens of ms), volumes ramp linearly over the crossfade window, then
     * the new player atomically becomes the primary and the media session
     * re-binds (lock screen / notification follow without a blink).
     */
    private void startCrossfade(long posMs, long durMs) {
        if (swapping || crossfadeSec <= 0 || player == null) return;
        int nextIdx;
        if (shuffle && queue.size() > 1) {
            nextIdx = (int) (Math.random() * queue.size());
            if (nextIdx == currentIndex) nextIdx = (nextIdx + 1) % queue.size();
        } else if (currentIndex < queue.size() - 1) {
            nextIdx = currentIndex + 1;
        } else if ("all".equals(repeatMode)) {
            nextIdx = 0;
        } else {
            if (appendRecommendation()) {
                nextIdx = queue.size() - 1;
            } else {
                return; // nothing next - the normal end-of-queue path applies
            }
        }
        final Track t = queue.get(nextIdx);
        if (t == null || t.videoId == null || t.videoId.isEmpty()) return;

        swapping = true;
        final long fadeMs = crossfadeSec * 1000L;
        final ExoPlayer oldPlayer = player;
        final int newIdx = nextIdx;

        Log.d(TAG, "Crossfade: starting swap to " + t.title);
        oldPlayer.pause();

        nextPlayer = new ExoPlayer.Builder(this)
                .setMediaSourceFactory(resolvingFactoryForNextPlayer())
                .setAudioAttributes(new AudioAttributes.Builder()
                        .setUsage(C.USAGE_MEDIA)
                        .setContentType(C.AUDIO_CONTENT_TYPE_MUSIC)
                        .build(), true)
                .setHandleAudioBecomingNoisy(true)
                .setWakeMode(C.WAKE_MODE_LOCAL)
                .build();
        nextPlayer.setVolume(0f);
        MediaItem mi = new MediaItem.Builder()
                .setMediaId(t.videoId)
                .setUri(Uri.parse("https://simpmusic.local/stream?v=" + t.videoId))
                .setMediaMetadata(buildMetadata(t))
                .build();
        nextPlayer.setMediaItem(mi);
        nextPlayer.prepare();
        nextPlayer.play();

        // Linear volume ramp, 50ms ticks, both players.
        final long t0 = android.os.SystemClock.uptimeMillis();
        final Runnable[] fadeTick = new Runnable[1];
        fadeTick[0] = new Runnable() {
            @Override
            public void run() {
                if (!swapping) return; // aborted meanwhile
                float f = (android.os.SystemClock.uptimeMillis() - t0) / (float) fadeMs;
                if (f > 1f) f = 1f;
                try {
                    if (nextPlayer != null) nextPlayer.setVolume(f);
                    if (oldPlayer != null) oldPlayer.setVolume(1f - f);
                } catch (Exception ignored) {}
                if (f < 1f) mainHandler.postDelayed(fadeTick[0], 50);
                else finishCrossfade(oldPlayer, newIdx);
            }
        };
        mainHandler.postDelayed(fadeTick[0], 50);

        // Watchdog: next player never left the idle state -> abort cleanly.
        mainHandler.postDelayed(() -> {
            if (!swapping || nextPlayer == null) return;
            int st = nextPlayer.getPlaybackState();
            if (!nextPlayer.isPlaying() && st != Player.STATE_READY && st != Player.STATE_BUFFERING) {
                Log.w(TAG, "Crossfade aborted: next player never started");
                abortCrossfade(oldPlayer);
            }
        }, 6000);
    }

    /** Swap completion: rebind session, release the old player, notify JS. */
    private void finishCrossfade(ExoPlayer oldPlayer, int newIdx) {
        ExoPlayer np = nextPlayer;
        nextPlayer = null;
        swapping = false;
        if (np == null) { abortCrossfade(oldPlayer); return; }
        try {
            player = np;
            np.setVolume(1f);
            currentIndex = newIdx;
            queueSynced = true;
            attachPlayerListener(np);
            if (mediaSession != null) {
                try { mediaSession.setPlayer(mediaPlayer()); } catch (Exception ignored) {}
            }
            try { oldPlayer.stop(); oldPlayer.clearMediaItems(); oldPlayer.release(); } catch (Exception ignored) {}
            // v3.12.2: the fade-in player holds only ONE media item. Rebuild
            // the full playlist (positioned at the current track) so the
            // player playlist mirrors the queue again — otherwise NEXT /
            // playNext / queue ops are desynced after any crossfade.
            try {
                np.pause();
                List<MediaItem> items = new ArrayList<>(queue.size());
                for (Track qt : queue) {
                    items.add(new MediaItem.Builder()
                            .setMediaId(qt.videoId)
                            .setUri(Uri.parse("https://simpmusic.local/stream?v=" + qt.videoId))
                            .setMediaMetadata(buildMetadata(qt))
                            .build());
                }
                np.setMediaItems(items, currentIndex, 0);
                np.prepare();
                np.play();
            } catch (Exception e) {
                Log.w(TAG, "Crossfade playlist rebuild failed: " + e.getMessage());
            }
            Track t = queue.get(currentIndex);
            emitQueueChanged();
            PlaybackKeeperPlugin.dispatchServiceEvent(EV_TRACKCHANGE, mkTrack(t));
            PlaybackKeeperPlugin.dispatchServiceEvent(EV_STATE, mkState("playing"));
            preloadNextAudio();
            Log.d(TAG, "Crossfade complete: now playing " + t.title + " (playlist rebuilt: " + queue.size() + " items)");
        } catch (Exception e) {
            Log.e(TAG, "Crossfade finish failed", e);
            swapping = false;
        }
    }

    /** Swap failed (resolve error etc.): keep the old player playing. */
    private void abortCrossfade(ExoPlayer oldPlayer) {
        swapping = false;
        try {
            if (nextPlayer != null) { nextPlayer.stop(); nextPlayer.release(); }
        } catch (Exception ignored) {}
        nextPlayer = null;
        try {
            oldPlayer.setVolume(1f);
            oldPlayer.play();
        } catch (Exception ignored) {}
        Log.w(TAG, "Crossfade aborted; original track resumed");
    }

    /** Resolving pipeline for the fade-in player (same as onCreate's). */
    private DefaultMediaSourceFactory resolvingFactoryForNextPlayer() {
        DefaultHttpDataSource.Factory httpFactory = new DefaultHttpDataSource.Factory()
                .setUserAgent(StreamResolver.USER_AGENT)
                .setAllowCrossProtocolRedirects(true)
                .setConnectTimeoutMs(12_000)
                .setReadTimeoutMs(20_000);
        SelfHealingDataSource.Factory resolving = new SelfHealingDataSource.Factory(
                httpFactory::createDataSource,
                dataSpec -> {
                    String videoId = dataSpec.uri.getQueryParameter("v");
                    if (videoId == null || videoId.isEmpty()) {
                        throw new IllegalStateException("Missing videoId in DataSpec URI");
                    }
                    try {
                        String url = StreamResolver.resolveAudioUrl(videoId);
                        return dataSpec.buildUpon().setUri(Uri.parse(url)).build();
                    } catch (Exception first) {
                        StreamResolver.invalidate(videoId);
                        try {
                            String url = StreamResolver.resolveAudioUrl(videoId);
                            return dataSpec.buildUpon().setUri(Uri.parse(url)).build();
                        } catch (Exception second) {
                            throw new IOException("Resolution failed: " + second.getMessage(), second);
                        }
                    }
                });
        return new DefaultMediaSourceFactory(resolving);
    }

    /** Identity-guarded listener; stale events from a swapped-out player are dropped. */
    private void attachPlayerListener(ExoPlayer p) {
        p.addListener(new Player.Listener() {
            @Override
            public void onIsPlayingChanged(boolean isPlaying) {
                if (p != player) return;
                playing = isPlaying;
                if (isPlaying) {
                    ensureWakeLock();
                    mainHandler.removeCallbacks(progressTick);
                    mainHandler.postDelayed(progressTick, PROGRESS_PERIOD_MS);
                    PlaybackKeeperPlugin.dispatchServiceEvent(EV_STATE, mkState("playing"));
                } else {
                    releaseWakeLock();
                    mainHandler.removeCallbacks(progressTick);
                    PlaybackKeeperPlugin.dispatchServiceEvent(EV_STATE, mkState("paused"));
                }
            }

            @Override
            public void onMediaItemTransition(@Nullable MediaItem mediaItem, int reason) {
                if (p != player) return;
                int idx = player.getCurrentMediaItemIndex();
                if (idx >= 0 && idx < queue.size()) {
                    currentIndex = idx;
                    Track t = queue.get(idx);
                    mainHandler.post(() -> {
                        pruneFinishedTracks();
                        PlaybackKeeperPlugin.dispatchServiceEvent(EV_TRACKCHANGE, mkTrack(t));
                        preloadNextAudio();
                    });
                }
            }

            @Override
            public void onPlaybackStateChanged(int playbackState) {
                if (p != player) return;
                if (playbackState == Player.STATE_ENDED) {
                    handleTrackEnded();
                }
            }

            @Override
            public void onPlayerError(PlaybackException error) {
                if (p != player) return;
                Log.e(TAG, "Player error", error);
                PlaybackKeeperPlugin.dispatchServiceEvent(EV_ERROR,
                        mkState(error.getMessage() != null ? error.getMessage() : "playback error"));
                // Stay in the foreground (see ACTION_STOP notes): dropping it
                // during an in-flight startForegroundService kills the app.
                releaseWakeLock();
            }
        });
    }

    private void handleNext(boolean fromEnd) {
        if (queue.isEmpty()) {
            // v3.13.1: fresh user with NO queue at all — fetch a trending
            // song and start playing instead of dead-ending the notification.
            fetchFreshSuggestion(true);
            return;
        }
        if (queue.size() == 1 && "all".equals(repeatMode)) {
            player.seekTo(0);
            player.play();
            return;
        }
        int nextIdx;
        if (shuffle && queue.size() > 1) {
            nextIdx = (int) (Math.random() * queue.size());
            if (nextIdx == currentIndex) nextIdx = (nextIdx + 1) % queue.size();
        } else if (currentIndex < queue.size() - 1) {
            nextIdx = currentIndex + 1;
        } else if ("all".equals(repeatMode)) {
            nextIdx = 0;
        } else {
            // v3.9: no next song in the queue — extend it with a recommended
            // song based on the user's interest (auto-queue synced from the
            // recommendation engine). Works for both auto-advance (fromEnd)
            // and a manual NEXT tap on the last track.
            if (appendRecommendation()) {
                player.seekTo(queue.size() - 1, C.TIME_UNSET);
                player.play();
                preloadNextAudio();
                return;
            }
            // v3.12.1: reco pool empty → search YouTube for songs similar to
            // the current one (same artist) and append the first new hit.
            // Offline/search failure falls back to the classic queue-end path.
            if (findSimilarAndPlay(fromEnd)) return;
            if (fromEnd) {
                PlaybackKeeperPlugin.dispatchServiceEvent(EV_ENDED, mkState("queue ended"));
                player.pause();
                player.seekTo(0);
            }
            return;
        }
        player.seekTo(nextIdx, C.TIME_UNSET);
        player.play();
        preloadNextAudio();
    }

    /** Guard so repeated NEXT taps don't stack parallel searches. */
    private volatile boolean findingSimilar = false;

    /**
     * v3.13.1: the player handed to the MediaSession. Wraps the real player
     * so the notification/lock-screen controls always behave:
     *  - COMMAND_SEEK_TO_NEXT/NEXT/SEEK_TO_NEXT_MEDIA_ITEM keep the button
     *    visible even with a 1-song queue and route through handleNext()
     *    (recommendation → similar-artist → trending fallback chain).
     *  - COMMAND_PLAY_PAUSE toggles, or fetches a fresh song when nothing is
     *    loaded at all (brand-new user).
     */
    private Player mediaPlayer() {
        return new ForwardingPlayer(player) {
            /**
             * v3.13.2: the session and SystemUI (lock screen / quick settings)
             * decide which buttons to SHOW from getAvailableCommands() — the
             * Commands bitmask — not from isCommandAvailable(). Without the
             * NEXT/PREVIOUS bits added here, Android hides or greys out the
             * buttons when the queue has a single item, even though our
             * seekToNext() override knows how to extend the queue.
             */
            @Override
            public Player.Commands getAvailableCommands() {
                return super.getAvailableCommands().buildUpon()
                        .add(Player.COMMAND_SEEK_TO_NEXT)
                        .add(Player.COMMAND_SEEK_TO_NEXT_MEDIA_ITEM)
                        .add(Player.COMMAND_SEEK_TO_NEXT_WINDOW)
                        .add(Player.COMMAND_SEEK_TO_PREVIOUS)
                        .add(Player.COMMAND_SEEK_TO_PREVIOUS_MEDIA_ITEM)
                        .add(Player.COMMAND_SEEK_TO_PREVIOUS_WINDOW)
                        .add(Player.COMMAND_PLAY_PAUSE)
                        .build();
            }

            @Override
            public boolean isCommandAvailable(int command) {
                if (command == Player.COMMAND_SEEK_TO_NEXT
                        || command == Player.COMMAND_SEEK_TO_NEXT_MEDIA_ITEM
                        || command == Player.COMMAND_SEEK_TO_NEXT_WINDOW) {
                    return true;
                }
                return super.isCommandAvailable(command);
            }

            @Override
            public void seekToNext() { handleNext(false); }

            @Override
            public void seekToNextMediaItem() { handleNext(false); }

            @Override
            public void seekToNextWindow() { handleNext(false); }

            @Override
            public void seekToPrevious() {
                if (player.getCurrentPosition() > 4000) {
                    player.seekTo(0);
                } else if (currentIndex > 0) {
                    player.seekToPreviousMediaItem();
                    player.play();
                } else {
                    player.seekTo(0);
                }
            }

            @Override
            public void seekToPreviousMediaItem() { seekToPrevious(); }

            @Override
            public void seekToPreviousWindow() { seekToPrevious(); }

            @Override
            public void play() {
                if (queueSynced && !queue.isEmpty()) {
                    super.play();
                } else {
                    fetchFreshSuggestion(true);
                }
            }
        };
    }

    /**
     * v3.13.1: nothing queued and nothing recommended — search YouTube for a
     * popular song and start it as a brand-new queue. `playIt` is true when
     * the caller wants immediate playback (notification NEXT/PLAY).
     */
    private void fetchFreshSuggestion(boolean playIt) {
        if (findingSimilar) return; // a fetch is already in flight
        findingSimilar = true;
        PlaybackKeeperPlugin.dispatchServiceEvent(EV_STATE, mkState("fetching suggestion"));
        new Thread(() -> {
            Track picked = null;
            try {
                String json = StreamResolver.searchSongs("top hits");
                org.json.JSONArray arr = new org.json.JSONArray(json);
                if (arr.length() > 0) {
                    org.json.JSONObject o = arr.getJSONObject((int) (Math.random() * Math.min(5, arr.length())));
                    Track t = new Track();
                    t.videoId = o.optString("videoId", "");
                    t.title = o.optString("title", "Similar song");
                    t.artist = o.optString("artist", "");
                    t.artworkUrl = o.optString("thumbnail", "");
                    t.durationSec = o.optLong("durationSec", 0);
                    if (!t.videoId.isEmpty()) picked = t;
                }
            } catch (Exception e) {
                Log.w(TAG, "Fresh-suggestion search failed: " + e.getMessage());
            }
            final Track f = picked;
            mainHandler.post(() -> {
                findingSimilar = false;
                if (f == null) {
                    Log.d(TAG, "No fresh suggestion found");
                    return;
                }
                // Start a brand-new queue with the picked song (like the app
                // does when the user taps a song card in the search list).
                queue.clear();
                autoQueue.clear();
                queue.add(f);
                currentIndex = 0;
                queueSynced = true;
                player.setMediaItem(new MediaItem.Builder()
                        .setMediaId(f.videoId)
                        .setUri(Uri.parse("https://simpmusic.local/stream?v=" + f.videoId))
                        .setMediaMetadata(buildMetadata(f))
                        .build());
                player.prepare();
                if (playIt) {
                    player.play();
                    PlaybackKeeperPlugin.dispatchServiceEvent(EV_TRACKCHANGE, mkTrack(f));
                    preloadNextAudio();
                    emitQueueChanged();

                }
                Log.d(TAG, "Fresh suggestion: " + f.title + " (" + f.artist + ")");
            });
        }, "simpmusic-fresh").start();
    }

    /**
     * v3.12.1: "sometime the next song button not working" — when the queue
     * and the recommendation pool are exhausted, search YouTube Music for
     * the current artist's songs, append the first one not already queued,
     * and keep playing. Returns false when nothing could be found (offline),
     * letting the caller fall back to the old end-of-queue behavior.
     */
    private boolean findSimilarAndPlay(final boolean fromEnd) {
        if (findingSimilar) return true; // a search is already in flight
        final Track cur = (currentIndex >= 0 && currentIndex < queue.size())
                ? queue.get(currentIndex) : null;
        if (cur == null) return false;
        final String seed = (cur.artist != null && !cur.artist.isEmpty())
                ? cur.artist : cur.title;
        findingSimilar = true;
        PlaybackKeeperPlugin.dispatchServiceEvent(EV_STATE, mkState("finding similar"));
        new Thread(() -> {
            boolean appended = false;
            try {
                String json = StreamResolver.searchSongs(seed);
                org.json.JSONArray arr = new org.json.JSONArray(json);
                for (int i = 0; i < arr.length() && !appended; i++) {
                    org.json.JSONObject o = arr.getJSONObject(i);
                    String id = o.optString("videoId", "");
                    if (id.isEmpty() || id.equals(cur.videoId)) continue;
                    boolean dup = false;
                    for (Track q : queue) if (q.videoId.equals(id)) { dup = true; break; }
                    if (dup) continue;
                    Track t = new Track();
                    t.videoId = id;
                    t.title = o.optString("title", "Similar song");
                    t.artist = o.optString("artist", "");
                    t.artworkUrl = o.optString("thumbnail", "");
                    t.durationSec = o.optLong("durationSec", 0);
                    final Track f = t;
                    mainHandler.post(() -> {
                        appendAndPlay(f);
                        Log.d(TAG, "Appended similar song: " + f.title + " (" + f.artist + ")");
                    });
                    appended = true;
                }
            } catch (Exception e) {
                Log.w(TAG, "Similar-song search failed: " + e.getMessage());
            }
            final boolean ok = appended;
            mainHandler.post(() -> {
                findingSimilar = false;
                if (!ok) {
                    // v3.13: the artist search found nothing new (offline,
                    // duplicates, unknown artist) — try a generic trending
                    // seed before ending the queue, so the lock-screen/
                    // notification NEXT never dead-ends (checklist bug #4).
                    Log.d(TAG, "No similar song found; trying trending fallback");
                    searchAndAppendGeneric("top hits");
                }
            });
        }, "simpmusic-similar").start();
        return true;
    }

    /**
     * v3.13: queue-end helper shared by findSimilarAndPlay and the trending
     * fallback — appends the track, jumps to it and notifies the WebView.
     * MUST run on the main thread.
     */
    private void appendAndPlay(final Track f) {
        queue.add(f);
        player.addMediaItem(new MediaItem.Builder()
                .setMediaId(f.videoId)
                .setUri(Uri.parse("https://simpmusic.local/stream?v=" + f.videoId))
                .setMediaMetadata(buildMetadata(f))
                .build());
        currentIndex = queue.size() - 1;
        player.seekTo(currentIndex, C.TIME_UNSET);
        player.play();
        PlaybackKeeperPlugin.dispatchServiceEvent(EV_TRACKCHANGE, mkTrack(f));
        preloadNextAudio();
        emitQueueChanged();
    }

    /**
     * v3.13: last-resort fallback for a brand-new user — the artist search
     * can fail (empty/unknown artist, only duplicates already queued), which
     * used to end the queue. Search a generic trending seed and append the
     * first non-duplicate so notification NEXT keeps playing like it does
     * inside the app.
     */
    private void searchAndAppendGeneric(final String seed) {
        new Thread(() -> {
            try {
                String json = StreamResolver.searchSongs(seed);
                org.json.JSONArray arr = new org.json.JSONArray(json);
                for (int i = 0; i < arr.length(); i++) {
                    org.json.JSONObject o = arr.getJSONObject(i);
                    String id = o.optString("videoId", "");
                    if (id.isEmpty()) continue;
                    boolean dup = false;
                    for (Track q : queue) if (q.videoId.equals(id)) { dup = true; break; }
                    if (dup) continue;
                    Track t = new Track();
                    t.videoId = id;
                    t.title = o.optString("title", "Similar song");
                    t.artist = o.optString("artist", "");
                    t.artworkUrl = o.optString("thumbnail", "");
                    t.durationSec = o.optLong("durationSec", 0);
                    final Track f = t;
                    mainHandler.post(() -> {
                        appendAndPlay(f);
                        Log.d(TAG, "Appended trending fallback: " + f.title + " (" + f.artist + ")");
                    });
                    return;
                }
            } catch (Exception e) {
                Log.w(TAG, "Trending fallback search failed: " + e.getMessage());
            }
            // Nothing found at all — genuinely end the queue.
            mainHandler.post(() -> {
                PlaybackKeeperPlugin.dispatchServiceEvent(EV_ENDED, mkState("queue ended"));
                try {
                    player.pause();
                    player.seekTo(0);
                } catch (Exception ignored) {}
            });
        }, "simpmusic-trending-fallback").start();
    }

    /**
     * v3.9: appends the first non-duplicate recommended track to the queue.
     * Returns true when a track was appended (playback continues forever
     * with songs matching the user's taste instead of stopping dead).
     */
    private boolean appendRecommendation() {
        while (!autoQueue.isEmpty()) {
            Track cand = autoQueue.remove(0);
            boolean dup = false;
            for (Track q : queue) {
                if (q.videoId.equals(cand.videoId)) { dup = true; break; }
            }
            if (!dup) {
                queue.add(cand);
                player.addMediaItem(new MediaItem.Builder()
                        .setMediaId(cand.videoId)
                        .setUri(Uri.parse("https://simpmusic.local/stream?v=" + cand.videoId))
                        .setMediaMetadata(buildMetadata(cand))
                        .build());
                Log.d(TAG, "Auto-extended queue with recommendation: " + cand.title);
                return true;
            }
        }
        return false;
    }

    private void handleTrackEnded() {
        // v3.16: "End of track" sleep mode — pause instead of advancing.
        if (sleepAtTrackEnd) {
            fireSleepPause("end of track");
            return;
        }
        if ("one".equals(repeatMode)) {
            player.seekTo(0);
            player.play();
        } else {
            handleNext(true);
        }
    }

    // ---------------- v3.16 sleep timer ----------------

    /** 1-second countdown tick; arms the fade at T-10s, pauses at T. */
    private final Runnable sleepTick = new Runnable() {
        @Override
        public void run() {
            if (sleepEndsAt <= 0) return;
            long remaining = sleepEndsAt - android.os.SystemClock.elapsedRealtime();
            if (remaining <= 0) {
                fireSleepPause("timer");
                return;
            }
            if (remaining <= 10_000 && player != null && playing && !sleepFiring) {
                sleepFiring = true;
                startSleepFade(remaining);
            }
            mainHandler.postDelayed(this, 1000);
        }
    };

    /** Linear ~10s volume fade, then pause + restore volume for next play. */
    private void startSleepFade(long remainingMs) {
        final long fadeMs = Math.max(3000, Math.min(remainingMs, 10_000));
        final long t0 = android.os.SystemClock.uptimeMillis();
        final ExoPlayer p = player;
        final Runnable[] tick = new Runnable[1];
        tick[0] = new Runnable() {
            @Override
            public void run() {
                float f = (android.os.SystemClock.uptimeMillis() - t0) / (float) fadeMs;
                if (f > 1f) f = 1f;
                try { p.setVolume(1f - f); } catch (Exception ignored) {}
                if (f < 1f) {
                    mainHandler.postDelayed(tick[0], 100);
                } else {
                    try {
                        p.pause();
                        p.setVolume(1f);
                    } catch (Exception ignored) {}
                    completeSleepPause("timer");
                }
            }
        };
        mainHandler.postDelayed(tick[0], 100);
    }

    /** Immediate pause for end-of-track mode (no fade needed). */
    private void fireSleepPause(String why) {
        if (sleepFiring && "timer".equals(why)) return;
        try {
            player.pause();
        } catch (Exception ignored) {}
        completeSleepPause(why);
    }

    /** Shared completion: clear state, prefs, notify WebView. */
    private void completeSleepPause(String why) {
        cancelSleepTimer();
        PlaybackKeeperPlugin.dispatchServiceEvent(EV_STATE, mkState("paused"));
        PlaybackKeeperPlugin.dispatchServiceEvent(EV_STATE, mkState("sleep-timer-done"));
        Log.d(TAG, "Sleep timer fired (" + why + ")");
    }

    private void cancelSleepTimer() {
        sleepEndsAt = 0;
        sleepAtTrackEnd = false;
        sleepFiring = false;
        mainHandler.removeCallbacks(sleepTick);
        getSharedPreferences("simpmusic_prefs", MODE_PRIVATE)
                .edit().remove("sleep_ends_at_elapsed").apply();
    }

    // ---------------- events to the WebView ----------------

    /**
     * Publishes the service's full playback state to the WebView. Called when
     * JS asks (e.g. after the WebView was killed and reloaded while music kept
     * playing) so the UI can re-adopt the running native player instead of
     * starting a duplicate one.
     */
    private void publishRestoreState() {
        if (player == null || queue.isEmpty() || currentIndex < 0
                || currentIndex >= queue.size()) {
            return; // nothing playing; JS stays in iframe/local mode
        }
        Track t = queue.get(currentIndex);
        boolean isPlaying = player.isPlaying();
        StringBuilder sb = new StringBuilder();
        sb.append("{\"videoId\":\"").append(js(t.videoId))
          .append("\",\"title\":\"").append(js(t.title))
          .append("\",\"artist\":\"").append(js(t.artist))
          .append("\",\"thumbnail\":\"").append(js(t.artworkUrl))
          .append("\",\"durationSec\":").append(t.durationSec)
          .append(",\"index\":").append(currentIndex)
          .append(",\"positionSec\":").append(player.getCurrentPosition() / 1000.0)
          .append(",\"playing\":").append(isPlaying)
          .append(",\"queue\":[");
        for (int i = 0; i < queue.size(); i++) {
            Track q = queue.get(i);
            if (i > 0) sb.append(',');
            sb.append("{\"videoId\":\"").append(js(q.videoId))
              .append("\",\"title\":").append("\"").append(js(q.title))
              .append("\",\"artist\":\"").append(js(q.artist))
              .append("\",\"thumbnail\":\"").append(js(q.artworkUrl))
              .append("\",\"durationSec\":").append(q.durationSec).append('}');
        }
        sb.append("],\"shuffle\":").append(shuffle)
          .append(",\"repeatMode\":\"").append(repeatMode).append("\"}");
        PlaybackKeeperPlugin.dispatchServiceEvent(EV_RESTORED, sb.toString());
    }

    private void emitProgress() {
        if (player == null || !player.isCommandAvailable(Player.COMMAND_GET_CURRENT_MEDIA_ITEM)) return;
        long pos = player.getCurrentPosition();
        long dur = player.getDuration();
        // v3.12: entering the final crossfadeSec -> start the fade & swap.
        if (!swapping && crossfadeSec > 0 && dur > 0 && pos > 0
                && pos >= dur - crossfadeSec * 1000L) {
            startCrossfade(pos, dur);
        }
        int idx = player.getCurrentMediaItemIndex();
        String videoId = idx >= 0 && idx < queue.size() ? queue.get(idx).videoId : "";
        mainHandler.postDelayed(progressTick, PROGRESS_PERIOD_MS);
        PlaybackKeeperPlugin.dispatchServiceEvent(EV_PROGRESS, mkProgress(videoId, pos, dur));
    }

    // ---------------- JS-settable options ----------------

    /** Called by the plugin when JS changes shuffle/repeat. */
    public void setOptions(boolean shuffle, String repeatMode) {
        this.shuffle = shuffle;
        this.repeatMode = repeatMode != null ? repeatMode : "off";
        if (player != null) {
            player.setShuffleModeEnabled(shuffle);
            int mode;
            switch (this.repeatMode) {
                case "one": mode = Player.REPEAT_MODE_ONE; break;
                case "all": mode = Player.REPEAT_MODE_ALL; break;
                default:    mode = Player.REPEAT_MODE_OFF; break;
            }
            player.setRepeatMode(mode);
        }
    }

    // ---------------- helpers ----------------

    private MediaMetadata buildMetadata(Track t) {
        return new MediaMetadata.Builder()
                .setTitle(t.title)
                .setArtist(t.artist)
                .setArtworkUri(t.artworkUrl != null && !t.artworkUrl.isEmpty()
                        ? Uri.parse(t.artworkUrl) : null)
                .build();
    }

    private String mkState(String state) {
        return "{\"state\":\"" + state + "\"}";
    }

    /**
     * v3.12.3: publish the authoritative queue to the WebView after every
     * mutation (load, add, remove, move, prune, crossfade rebuild). The JS
     * side adopts this as the single source of truth, so the Queue sheet,
     * Play next, and Add-to-queue can never drift out of sync again.
     */
    private void emitQueueChanged() {
        StringBuilder sb = new StringBuilder("{\"index\":").append(currentIndex)
                .append(",\"queue\":[");
        for (int i = 0; i < queue.size(); i++) {
            Track q = queue.get(i);
            if (i > 0) sb.append(',');
            sb.append("{\"videoId\":\"").append(js(q.videoId))
              .append("\",\"title\":\"").append(js(q.title))
              .append("\",\"artist\":\"").append(js(q.artist))
              .append("\",\"thumbnail\":\"").append(js(q.artworkUrl))
              .append("\",\"durationSec\":").append(q.durationSec).append('}');
        }
        sb.append("]}");
        PlaybackKeeperPlugin.dispatchServiceEvent(EV_QUEUE, sb.toString());
    }

    private String mkTrack(Track t) {
        int br = t.videoId != null ? StreamResolver.getBitrate(t.videoId) : -1;
        return "{\"videoId\":\"" + js(t.videoId) + "\",\"title\":\"" + js(t.title)
                + "\",\"artist\":\"" + js(t.artist) + "\",\"thumbnail\":\"" + js(t.artworkUrl)
                + "\",\"durationSec\":" + t.durationSec + ",\"index\":" + currentIndex
                + ",\"bitrate\":" + br + "}";
    }

    private String mkProgress(String videoId, long posMs, long durMs) {
        return "{\"videoId\":\"" + js(videoId) + "\",\"positionSec\":" + (posMs / 1000.0)
                + ",\"durationSec\":" + (durMs / 1000.0) + "}";
    }

    private static String js(String s) {
        if (s == null) return "";
        return s.replace("\\", "\\\\").replace("\"", "\\\"").replace("\n", " ").replace("\r", " ");
    }

    private void ensureWakeLock() {
        if (wakeLock == null) {
            PowerManager pm = (PowerManager) getSystemService(Context.POWER_SERVICE);
            wakeLock = pm.newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "SimpMusic:PlaybackKeepAlive");
            wakeLock.setReferenceCounted(false);
        }
        if (!wakeLock.isHeld()) {
            wakeLock.acquire(8 * 60 * 60 * 1000L); // 8h safety cap
        }
    }

    private void releaseWakeLock() {
        if (wakeLock != null && wakeLock.isHeld()) wakeLock.release();
    }

    @Override
    public void onTaskRemoved(@Nullable Intent rootIntent) {
        // Keep playing when the task is swiped away; stop only if paused.
        if (!playing) {
            releaseWakeLock();
            stopForegroundAndNotification();
            foregroundEntered = false;
            stopSelf();
        }
        super.onTaskRemoved(rootIntent);
    }

    /** Leaves foreground state and removes the notification (API-safe). */
    private void stopForegroundAndNotification() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.N) {
            stopForeground(STOP_FOREGROUND_REMOVE);
        } else {
            //noinspection deprecation
            stopForeground(true);
        }
    }

    @Override
    public void onDestroy() {
        mainHandler.removeCallbacks(progressTick);
        releaseWakeLock();
        if (mediaSession != null) {
            mediaSession.release();
            mediaSession = null;
        }
        if (player != null) {
            player.release();
            player = null;
        }
        super.onDestroy();
    }

    private void createChannel() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            NotificationChannel channel = new NotificationChannel(
                    CHANNEL_ID,
                    "Music Playback",
                    NotificationManager.IMPORTANCE_LOW);
            channel.setDescription("Shown while SimpMusic plays music in the background");
            channel.setShowBadge(false);
            NotificationManager nm = getSystemService(NotificationManager.class);
            if (nm != null) nm.createNotificationChannel(channel);
        }
    }
}
