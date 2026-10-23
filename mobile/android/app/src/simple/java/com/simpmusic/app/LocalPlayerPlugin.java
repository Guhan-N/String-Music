package com.simpmusic.app;

import android.app.Activity;
import android.content.ComponentName;
import android.net.Uri;

import androidx.core.content.ContextCompat;
import androidx.media3.common.MediaItem;
import androidx.media3.common.MediaMetadata;
import androidx.media3.common.Player;
import androidx.media3.session.MediaController;
import androidx.media3.session.SessionToken;

import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.google.common.util.concurrent.ListenableFuture;

import java.util.ArrayList;
import java.util.List;
import java.util.concurrent.TimeUnit;

/**
 * JS bridge for String Music Simple playback. A MediaController is attached to
 * LocalPlaybackService, so audio keeps playing in the background with a media
 * notification while the WebView is asleep.
 */
@CapacitorPlugin(name = "LocalPlayer")
public class LocalPlayerPlugin extends Plugin {

    private ListenableFuture<MediaController> controllerFuture;
    private MediaController controller;

    @Override
    public void load() {
        SessionToken token = new SessionToken(
                getContext(), new ComponentName(getContext(), LocalPlaybackService.class));
        controllerFuture = new MediaController.Builder(getContext(), token).buildAsync();
        controllerFuture.addListener(() -> {
            try {
                controller = controllerFuture.get();
            } catch (Exception e) {
                controller = null;
            }
        }, ContextCompat.getMainExecutor(getContext()));
    }

    @Override
    protected void handleOnDestroy() {
        if (controllerFuture != null) {
            MediaController.releaseFuture(controllerFuture);
            controllerFuture = null;
        }
        controller = null;
        super.handleOnDestroy();
    }

    private void onMain(Runnable action) {
        Activity activity = getActivity();
        if (activity != null) {
            activity.runOnUiThread(action);
        } else {
            action.run();
        }
    }

    /** Runs the action once the controller is connected (or gives up). */
    private void whenReady(PluginCall call, ControllerAction action) {
        if (controller != null) {
            // MediaController must only be touched on the main thread; plugin
            // methods arrive on Capacitor's background thread.
            final MediaController ready = controller;
            onMain(() -> action.run(ready, call));
            return;
        }
        new Thread(() -> {
            try {
                if (controllerFuture != null) {
                    MediaController c = controllerFuture.get(4, TimeUnit.SECONDS);
                    controller = c;
                    onMain(() -> action.run(c, call));
                    return;
                }
            } catch (Exception ignored) {
            }
            call.reject("Player is not ready yet");
        }, "stringmusic-player-ready").start();
    }

    private interface ControllerAction {
        void run(MediaController controller, PluginCall call);
    }

    @PluginMethod
    public void playQueue(final PluginCall call) {
        final JSArray uris = call.getArray("uris");
        final JSArray titles = call.getArray("titles");
        final JSArray artists = call.getArray("artists");
        final JSArray albums = call.getArray("albums");
        final JSArray artwork = call.getArray("artwork");
        final int start = call.getInt("startIndex", 0);
        if (uris == null || uris.length() == 0) {
            call.reject("uris required");
            return;
        }

        final List<MediaItem> items = new ArrayList<>(uris.length());
        for (int i = 0; i < uris.length(); i++) {
            String uri = stringAt(uris, i);
            if (uri == null) continue;
            MediaMetadata.Builder meta = new MediaMetadata.Builder()
                    .setTitle(stringAt(titles, i) != null ? stringAt(titles, i) : "Unknown title")
                    .setArtist(stringAt(artists, i) != null ? stringAt(artists, i) : "");
            String album = stringAt(albums, i);
            if (album != null && !album.isEmpty()) meta.setAlbumTitle(album);
            String art = stringAt(artwork, i);
            if (art != null && !art.isEmpty()) meta.setArtworkUri(Uri.parse(art));
            items.add(new MediaItem.Builder()
                    .setMediaId(uri)
                    .setUri(Uri.parse(uri))
                    .setMediaMetadata(meta.build())
                    .build());
        }
        final int startIndex = Math.max(0, Math.min(start, Math.max(0, items.size() - 1)));

        whenReady(call, (c, call2) -> {
            try {
                c.setMediaItems(items, startIndex, 0);
                c.prepare();
                c.play();
                call2.resolve();
            } catch (Exception e) {
                call2.reject("Could not start playback: " + e.getMessage());
            }
        });
    }

    @PluginMethod
    public void toggle(PluginCall call) {
        whenReady(call, (c, call2) -> {
            if (c.isPlaying()) c.pause(); else c.play();
            call2.resolve();
        });
    }

    @PluginMethod
    public void play(PluginCall call) {
        whenReady(call, (c, call2) -> { c.play(); call2.resolve(); });
    }

    @PluginMethod
    public void pause(PluginCall call) {
        whenReady(call, (c, call2) -> { c.pause(); call2.resolve(); });
    }

    @PluginMethod
    public void next(PluginCall call) {
        whenReady(call, (c, call2) -> {
            if (c.hasNextMediaItem()) c.seekToNextMediaItem();
            call2.resolve();
        });
    }

    @PluginMethod
    public void previous(PluginCall call) {
        whenReady(call, (c, call2) -> {
            if (c.getCurrentPosition() > 4000) {
                c.seekTo(0);
            } else if (c.hasPreviousMediaItem()) {
                c.seekToPreviousMediaItem();
            } else {
                c.seekTo(0);
            }
            call2.resolve();
        });
    }

    @PluginMethod
    public void seekTo(PluginCall call) {
        Double seconds = call.getDouble("positionSec");
        long ms = seconds != null ? (long) (seconds * 1000) : 0L;
        whenReady(call, (c, call2) -> {
            c.seekTo(Math.max(0, ms));
            call2.resolve();
        });
    }

    @PluginMethod
    public void stop(PluginCall call) {
        whenReady(call, (c, call2) -> {
            c.stop();
            c.clearMediaItems();
            call2.resolve();
        });
    }

    @PluginMethod
    public void status(PluginCall call) {
        whenReady(call, (c, call2) -> {
            JSObject ret = new JSObject();
            ret.put("ready", true);
            ret.put("playing", c.isPlaying());
            ret.put("buffering", c.getPlaybackState() == Player.STATE_BUFFERING);
            ret.put("ended", c.getPlaybackState() == Player.STATE_ENDED);
            ret.put("position", c.getCurrentPosition() / 1000.0);
            long duration = c.getDuration();
            ret.put("duration", duration > 0 ? duration / 1000.0 : 0);
            ret.put("index", c.getCurrentMediaItemIndex());
            ret.put("count", c.getMediaItemCount());
            MediaItem item = c.getCurrentMediaItem();
            ret.put("mediaId", item != null ? item.mediaId : null);
            if (item != null && item.mediaMetadata != null) {
                ret.put("title", item.mediaMetadata.title != null
                        ? item.mediaMetadata.title.toString() : "");
                ret.put("artist", item.mediaMetadata.artist != null
                        ? item.mediaMetadata.artist.toString() : "");
            }
            call2.resolve(ret);
        });
    }

    private static String stringAt(JSArray array, int index) {
        if (array == null || index < 0 || index >= array.length()) return null;
        try {
            String value = array.getString(index);
            return value;
        } catch (Exception e) {
            return null;
        }
    }
}
