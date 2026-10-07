package com.simpmusic.app;

import android.content.Context;
import android.content.Intent;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

/**
 * JS bridge for native (ExoPlayer) playback.
 *
 * Web → Native: hand the full queue to the service, control playback
 * (toggle/next/prev/seek), update shuffle/repeat, or stop the service.
 * Native → Web: progress ticks, track changes, play/pause state, queue end
 * and playback errors are dispatched as window events so the WebView UI
 * (progress bar, lyrics, queue view) stays in sync with the native player.
 */
@CapacitorPlugin(name = "PlaybackKeeper")
public class PlaybackKeeperPlugin extends Plugin {

    private static PlaybackKeeperPlugin instance;

    /** True while the WebView renderer is down; JS events are suppressed. */
    private static volatile boolean rendererDown = false;

    /**
     * Backlog of raw native events. Capacitor 6.2's triggerWindowJSEvent can
     * deliver the window event WITHOUT the JSON payload (observed on device),
     * which froze progress/lyrics at 0. JS therefore drains this backlog via
     * getRecentEvents() — a reliable pull channel alongside the push events.
     */
    private static final java.util.Deque<String[]> RAW_EVENTS = new java.util.concurrent.ConcurrentLinkedDeque<>();
    private static final int RAW_MAX = 200;

    /** Called by MainActivity when the renderer dies / comes back. */
    public static void setRendererDown(boolean down) {
        rendererDown = down;
    }

    public PlaybackKeeperPlugin() {
        instance = this;
    }

    /** Event dispatch from the service → WebView. */
    public static void dispatchServiceEvent(String event, String json) {
        // Always record into the backlog (JS drains this via getRecentEvents).
        synchronized (RAW_EVENTS) {
            RAW_EVENTS.addLast(new String[]{event, json});
            while (RAW_EVENTS.size() > RAW_MAX) RAW_EVENTS.pollFirst();
        }
        // Poking a dead renderer with evaluateJavascript can crash the whole
        // process (which would also stop the music). Drop events until the
        // fresh WebView is up; it re-syncs via the "restored" flow.
        if (rendererDown) return;
        PlaybackKeeperPlugin plugin = instance;
        if (plugin == null || plugin.bridge == null) return;
        try {
            plugin.bridge.triggerWindowJSEvent("playbackkeeper-" + event, json);
        } catch (Exception ignored) {
        }
    }

    private Intent baseIntent(String action) {
        Intent intent = new Intent(getContext(), PlaybackKeepAliveService.class);
        intent.setAction(action);
        // v3.12.2: carry the user's audio quality on every service command.
        try {
            android.content.SharedPreferences prefs =
                getContext().getSharedPreferences("simpmusic_prefs", Context.MODE_PRIVATE);
            String q = prefs.getString("audio_quality", null);
            if (q == null) {
                // Fall back to the WebView localStorage copy if present.
                q = prefs.getString("simpmusic_audio_quality", "standard");
            }
            intent.putExtra("quality", q != null ? q : "standard");
        } catch (Exception ignored) {}
        return intent;
    }

    private void startService(Intent intent) {
        if (android.os.Build.VERSION.SDK_INT >= android.os.Build.VERSION_CODES.O) {
            getContext().startForegroundService(intent);
        } else {
            getContext().startService(intent);
        }
    }

    /** Hand the whole queue to the native player and start playback. */
    @PluginMethod
    public void syncQueue(PluginCall call) {
        try {
            com.getcapacitor.JSArray ids = call.getArray("videoIds");
            com.getcapacitor.JSArray titles = call.getArray("titles");
            com.getcapacitor.JSArray artists = call.getArray("artists");
            com.getcapacitor.JSArray thumbs = call.getArray("thumbnails");
            com.getcapacitor.JSArray durs = call.getArray("durations");
            if (ids == null || ids.length() == 0) {
                call.reject("videoIds required");
                return;
            }
            Intent i = baseIntent(PlaybackKeepAliveService.ACTION_LOAD_QUEUE);
            i.putExtra("videoIds", strArray(ids));
            i.putExtra("titles", strArray(titles));
            i.putExtra("artists", strArray(artists));
            i.putExtra("thumbnails", strArray(thumbs));
            i.putExtra("durations", toIntArray(durs));
            i.putExtra("startIndex", call.getInt("startIndex", 0));
            i.putExtra("shuffle", call.getBoolean("shuffle", false));
            i.putExtra("repeatMode", call.getString("repeatMode", "off"));
            startService(i);
            call.resolve();
        } catch (Exception ex) {
            call.reject("Failed to sync queue: " + ex.getMessage());
        }
    }

    @PluginMethod
    public void toggle(PluginCall call) {
        try {
            startService(baseIntent(PlaybackKeepAliveService.ACTION_TOGGLE));
            call.resolve();
        } catch (Exception ex) {
            call.reject("toggle failed: " + ex.getMessage());
        }
    }

    @PluginMethod
    public void next(PluginCall call) {
        try {
            startService(baseIntent(PlaybackKeepAliveService.ACTION_NEXT));
            call.resolve();
        } catch (Exception ex) {
            call.reject("next failed: " + ex.getMessage());
        }
    }

    @PluginMethod
    public void previous(PluginCall call) {
        try {
            startService(baseIntent(PlaybackKeepAliveService.ACTION_PREV));
            call.resolve();
        } catch (Exception ex) {
            call.reject("previous failed: " + ex.getMessage());
        }
    }

    @PluginMethod
    public void seekTo(PluginCall call) {
        try {
            Double posSec = call.getDouble("positionSec");
            long ms = posSec != null ? (long) (posSec * 1000) : 0;
            Intent i = baseIntent(PlaybackKeepAliveService.ACTION_SEEK);
            i.putExtra("positionMs", ms);
            startService(i);
            call.resolve();
        } catch (Exception ex) {
            call.reject("seekTo failed: " + ex.getMessage());
        }
    }

    /**
     * Native YouTube search via NewPipe — used inside the APK where the
     * Express backend isn't reachable (WebView loads from its own localhost).
     * Resolves with { results: "<json array>" } or rejects; JS falls back to
     * the backend path when this is unavailable or fails.
     */
    @PluginMethod
    public void search(final PluginCall call) {
        final String q = call.getString("query", "");
        final String type = call.getString("type", "songs");
        new Thread(() -> {
            try {
                String json = StreamResolver.searchAny(q, type);
                JSObject ret = new JSObject();
                ret.put("results", json);
                call.resolve(ret);
            } catch (Exception e) {
                call.reject("search failed: " + e.getMessage());
            }
        }, "simpmusic-search").start();
    }

    /** v3.17: resolve a public YouTube playlist URL into a track list. */
    @PluginMethod
    public void resolvePlaylist(final PluginCall call) {
        final String url = call.getString("url", "");
        new Thread(() -> {
            try {
                String json = StreamResolver.resolvePlaylist(url);
                JSObject ret = new JSObject();
                ret.put("playlist", json);
                call.resolve(ret);
            } catch (Exception e) {
                call.reject(e.getMessage(), e);
            }
        }, "simpmusic-playlist").start();
    }

    /** Asks the service to publish its current state via a "restored" event. */
    @PluginMethod
    public void status(PluginCall call) {
        try {
            startService(baseIntent(PlaybackKeepAliveService.ACTION_STATUS));
            call.resolve();
        } catch (Exception ex) {
            call.reject("status failed: " + ex.getMessage());
        }
    }

    /** "Play next": insert a track after the current one, keep playback. */
    @PluginMethod
    public void playNext(PluginCall call) {
        try {
            Intent i = baseIntent(PlaybackKeepAliveService.ACTION_PLAY_NEXT);
            i.putExtra("videoId", call.getString("videoId", ""));
            i.putExtra("title", call.getString("title", "SimpMusic"));
            i.putExtra("artist", call.getString("artist", ""));
            i.putExtra("thumbnail", call.getString("thumbnail", ""));
            i.putExtra("durationSec", (long) call.getInt("durationSec", 0));
            startService(i);
            call.resolve();
        } catch (Exception ex) {
            call.reject("playNext failed: " + ex.getMessage());
        }
    }

    /** v3.12.5: "Add to queue" - append at the END of the queue. */
    @PluginMethod
    public void addToQueue(PluginCall call) {
        try {
            Intent i = baseIntent(PlaybackKeepAliveService.ACTION_PLAY_NEXT);
            i.putExtra("videoId", call.getString("videoId", ""));
            i.putExtra("title", call.getString("title", "String Music"));
            i.putExtra("artist", call.getString("artist", ""));
            i.putExtra("thumbnail", call.getString("thumbnail", ""));
            i.putExtra("durationSec", (long) call.getInt("durationSec", 0));
            i.putExtra("atEnd", true);
            startService(i);
            call.resolve();
        } catch (Exception ex) {
            call.reject("addToQueue failed: " + ex.getMessage());
        }
    }

    /**
     * v3.9: push recommendation candidates to the service. When the queue
     * reaches its end, the service extends it with these tracks (user-
     * interest-based autoplay instead of stopping dead).
     */
    @PluginMethod
    public void setAutoQueue(PluginCall call) {
        try {
            com.getcapacitor.JSArray ids = call.getArray("videoIds");
            com.getcapacitor.JSArray titles = call.getArray("titles");
            com.getcapacitor.JSArray artists = call.getArray("artists");
            com.getcapacitor.JSArray thumbs = call.getArray("thumbnails");
            com.getcapacitor.JSArray durs = call.getArray("durations");
            Intent i = baseIntent(PlaybackKeepAliveService.ACTION_SET_AUTO_QUEUE);
            i.putExtra("videoIds", strArray(ids));
            i.putExtra("titles", strArray(titles));
            i.putExtra("artists", strArray(artists));
            i.putExtra("thumbnails", strArray(thumbs));
            i.putExtra("durations", toIntArray(durs));
            if (android.os.Build.VERSION.SDK_INT >= android.os.Build.VERSION_CODES.O) {
                getContext().startForegroundService(i);
            } else {
                getContext().startService(i);
            }
            call.resolve();
        } catch (Exception ex) {
            call.reject("setAutoQueue failed: " + ex.getMessage());
        }
    }

    /** Update native shuffle/repeat without restarting playback. */
    @PluginMethod
    public void options(PluginCall call) {
        try {
            Intent i = baseIntent(PlaybackKeepAliveService.ACTION_OPTIONS);
            i.putExtra("shuffle", call.getBoolean("shuffle", false));
            i.putExtra("repeatMode", call.getString("repeatMode", "off"));
            startService(i);
            call.resolve();
        } catch (Exception ex) {
            call.reject("options failed: " + ex.getMessage());
        }
    }

    /**
     * v3.12: queue management from the Queue sheet.
     * op = "skip"   → arg = index to jump to
     * op = "remove" → arg = index to remove
     * op = "move"   → arg = from index, arg2 = to index
     */
    @PluginMethod
    public void queueOps(PluginCall call) {
        try {
            Intent i = baseIntent(PlaybackKeepAliveService.ACTION_QUEUE_OP);
            i.putExtra("op", call.getString("op", ""));
            i.putExtra("arg", call.getInt("arg", -1));
            i.putExtra("arg2", call.getInt("arg2", -1));
            startService(i);
            call.resolve();
        } catch (Exception ex) {
            call.reject("queueOps failed: " + ex.getMessage());
        }
    }

    /** v3.12.2: persist the audio-quality choice for the native side. */
    @PluginMethod
    public void setAudioQuality(PluginCall call) {
        try {
            String q = call.getString("quality", "standard");
            if (!"low".equals(q) && !"high".equals(q)) q = "standard";
            android.content.SharedPreferences prefs =
                getContext().getSharedPreferences("simpmusic_prefs", Context.MODE_PRIVATE);
            prefs.edit().putString("audio_quality", q).apply();
            StreamResolver.setQuality(q);
            call.resolve();
        } catch (Exception ex) {
            call.reject("setAudioQuality failed: " + ex.getMessage());
        }
    }

    /** v3.12: crossfade duration in seconds (0 = off, max 12). */
    @PluginMethod
    public void setCrossfade(PluginCall call) {
        try {
            Intent i = baseIntent(PlaybackKeepAliveService.ACTION_SET_CROSSFADE);
            i.putExtra("seconds", call.getInt("seconds", 0));
            startService(i);
            call.resolve();
        } catch (Exception ex) {
            call.reject("setCrossfade failed: " + ex.getMessage());
        }
    }

    /** v3.16: sleep timer — minutes countdown, endOfTrack mode, or cancel. */
    @PluginMethod
    public void setSleepTimer(PluginCall call) {
        try {
            Intent i = baseIntent(PlaybackKeepAliveService.ACTION_SET_SLEEP_TIMER);
            i.putExtra("minutes", call.getInt("minutes", 0));
            i.putExtra("endOfTrack", call.getBoolean("endOfTrack", false));
            startService(i);
            call.resolve();
        } catch (Exception ex) {
            call.reject("setSleepTimer failed: " + ex.getMessage());
        }
    }

    @PluginMethod
    public void stop(PluginCall call) {
        try {
            startService(baseIntent(PlaybackKeepAliveService.ACTION_STOP));
            call.resolve();
        } catch (Exception ex) {
            call.reject("stop failed: " + ex.getMessage());
        }
    }

    /** JS drains raw native events from here (reliable pull channel). */
    @PluginMethod
    public void getRecentEvents(PluginCall call) {
        com.getcapacitor.JSArray out = new com.getcapacitor.JSArray();
        synchronized (RAW_EVENTS) {
            while (!RAW_EVENTS.isEmpty()) {
                String[] e = RAW_EVENTS.pollFirst();
                if (e == null) break;
                JSObject o = new JSObject();
                o.put("event", e[0]);
                o.put("json", e[1]);
                out.put(o);
            }
        }
        JSObject ret = new JSObject();
        ret.put("events", out);
        call.resolve(ret);
    }

    private static String[] strArray(com.getcapacitor.JSArray arr) {
        if (arr == null) return new String[0];
        try {
            java.util.List<Object> list = arr.toList();
            String[] out = new String[list.size()];
            for (int i = 0; i < list.size(); i++) {
                Object o = list.get(i);
                out[i] = o != null ? String.valueOf(o) : "";
            }
            return out;
        } catch (Exception e) {
            return new String[0];
        }
    }

    private static int[] toIntArray(com.getcapacitor.JSArray arr) {
        if (arr == null) return new int[0];
        try {
            java.util.List<Object> list = arr.toList();
            int[] out = new int[list.size()];
            for (int i = 0; i < list.size(); i++) {
                Object o = list.get(i);
                out[i] = o instanceof Number ? ((Number) o).intValue() : 0;
            }
            return out;
        } catch (Exception e) {
            return new int[0];
        }
    }
}
