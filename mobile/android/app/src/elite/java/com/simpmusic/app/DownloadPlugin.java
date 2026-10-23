package com.simpmusic.app;

import android.content.ContentValues;
import android.content.Context;
import android.database.Cursor;
import android.net.Uri;
import android.os.Build;
import android.os.Environment;
import android.provider.MediaStore;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import java.io.File;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.util.Locale;

/**
 * Downloads a song's audio stream to the user's device storage.
 *
 * Saves to Music/SimpMusic via MediaStore (Android 10+) so it shows up in
 * Files, and in music apps as "Artist - Title". No storage permission is
 * needed on Q+ (app-contributed media). Emits "progress" listener events.
 */
@CapacitorPlugin(name = "SimpMusicDownload")
public class DownloadPlugin extends Plugin {

    private static final String SUBDIR = "SimpMusic";

    @PluginMethod
    public void audio(final PluginCall call) {
        final String videoId = call.getString("videoId", "");
        final String title = call.getString("title", "SimpMusic");
        final String artist = call.getString("artist", "Unknown Artist");
        final boolean preferHigh = call.getBoolean("preferHighBitrate", false);
        if (videoId == null || videoId.isEmpty()) {
            call.reject("videoId required");
            return;
        }
        final Context ctx = getContext();
        new Thread(() -> {
            try {
                // Duplicate check: same "Artist - Title" already saved → report
                // it instead of writing a second copy (the JS UI toasts this).
                String fileName = safeFileName(title, artist);
                if (alreadySaved(ctx, fileName)) {
                    JSObject ret = new JSObject();
                    ret.put("existing", true);
                    ret.put("path", SUBDIR + "/" + fileName + ".m4a");
                    call.resolve(ret);
                    return;
                }
                String audioUrl = StreamResolver.resolveDownloadAudioUrl(videoId, preferHigh);
                String savedPath = downloadToMusic(ctx, audioUrl, videoId, title, artist);
                JSObject ret = new JSObject();
                ret.put("path", savedPath);
                call.resolve(ret);
            } catch (Exception e) {
                JSObject err = new JSObject();
                err.put("videoId", videoId);
                err.put("message", e.getMessage() != null ? e.getMessage() : "download failed");
                notifyListeners("error", err);
                call.reject("download failed: " + e.getMessage());
            }
        }, "simpmusic-download").start();
    }

    /** True when a file with this base name is already in Music/SimpMusic. */
    private boolean alreadySaved(Context ctx, String baseName) {
        Cursor c = null;
        try {
            c = ctx.getContentResolver().query(
                    MediaStore.Audio.Media.EXTERNAL_CONTENT_URI,
                    new String[] { MediaStore.Audio.Media._ID },
                    MediaStore.Audio.Media.RELATIVE_PATH + " LIKE ? AND "
                            + MediaStore.Audio.Media.DISPLAY_NAME + " LIKE ?",
                    new String[] { Environment.DIRECTORY_MUSIC + "/" + SUBDIR + "%",
                                   baseName + ".%" },
                    null);
            return c != null && c.moveToFirst();
        } catch (Exception e) {
            return false;
        } finally {
            if (c != null) try { c.close(); } catch (Exception ignored) {}
        }
    }

    private String downloadToMusic(Context ctx, String audioUrl, String videoId,
                                   String title, String artist) throws Exception {
        HttpURLConnection conn = (HttpURLConnection) new URL(audioUrl).openConnection();
        conn.setRequestProperty("User-Agent", StreamResolver.USER_AGENT);
        conn.setConnectTimeout(15000);
        conn.setReadTimeout(30000);
        conn.setRequestProperty("Accept-Encoding", "identity");
        int code = conn.getResponseCode();
        if (code < 200 || code >= 300) {
            throw new Exception("stream HTTP " + code);
        }
        String mime = conn.getContentType();
        if (mime == null || mime.isEmpty()) mime = "audio/mp4";
        mime = mime.split(";")[0].trim();
        long total = conn.getContentLength();

        String fileName = safeFileName(title, artist) + extForMime(mime);

        // v3.5.1: MediaStore's Audio collection rejects audio/webm on modern
        // Android ("unsupported mime type audio/webm"). M4A/AAC goes to
        // Music/SimpMusic as before; a rare WebM-only track is saved to
        // Download/SimpMusic instead so the download still succeeds.
        boolean isWebm = mime.contains("webm");
        boolean pendingDownloads = isWebm && Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q;

        ContentValues cv = new ContentValues();
        Uri uri;
        if (pendingDownloads) {
            cv.put(MediaStore.Downloads.DISPLAY_NAME, fileName);
            cv.put(MediaStore.Downloads.MIME_TYPE, mime);
            cv.put(MediaStore.Downloads.RELATIVE_PATH,
                    Environment.DIRECTORY_DOWNLOADS + "/" + SUBDIR);
            cv.put(MediaStore.Downloads.IS_PENDING, 1);
            uri = ctx.getContentResolver().insert(
                    MediaStore.Downloads.EXTERNAL_CONTENT_URI, cv);
        } else if (isWebm) {
            // Pre-Android-10: no MediaStore.Downloads — direct file write
            // (same approach the crash logger uses on old devices).
            java.io.File dir = new java.io.File(
                    Environment.getExternalStoragePublicDirectory(Environment.DIRECTORY_DOWNLOADS),
                    SUBDIR);
            dir.mkdirs();
            uri = Uri.fromFile(new java.io.File(dir, fileName));
        } else {
            cv.put(MediaStore.Audio.Media.DISPLAY_NAME, fileName);
            cv.put(MediaStore.Audio.Media.MIME_TYPE, mime);
            cv.put(MediaStore.Audio.Media.TITLE, title);
            cv.put(MediaStore.Audio.Media.ARTIST, artist);
            // v3.5.2: stash the videoId in COMPOSER (free-form string) so the
            // offline list can play the file back in-app.
            cv.put(MediaStore.Audio.Media.COMPOSER, videoId);
            cv.put(MediaStore.Audio.Media.RELATIVE_PATH,
                    Environment.DIRECTORY_MUSIC + "/" + SUBDIR);
            cv.put(MediaStore.Audio.Media.IS_PENDING, 1);
            uri = ctx.getContentResolver().insert(
                    MediaStore.Audio.Media.EXTERNAL_CONTENT_URI, cv);
        }
        if (uri == null) throw new Exception("MediaStore insert failed");

        long written = 0;
        long lastNotify = 0;
        try (InputStream in = conn.getInputStream();
             OutputStream out = "file".equals(uri.getScheme())
                     ? new FileOutputStream(new java.io.File(uri.getPath()))
                     : ctx.getContentResolver().openOutputStream(uri)) {
            if (out == null) throw new Exception("cannot open output stream");
            byte[] buf = new byte[8192];
            int n;
            while ((n = in.read(buf)) > 0) {
                out.write(buf, 0, n);
                written += n;
                long now = System.currentTimeMillis();
                if (total > 0 && now - lastNotify > 400) {
                    lastNotify = now;
                    JSObject p = new JSObject();
                    p.put("videoId", videoId);
                    p.put("percent", (int) Math.min(99, written * 100 / total));
                    notifyListeners("progress", p);
                }
            }
            out.flush();
        } catch (Exception e) {
            // Clean up the partial file (file:// URIs need File.delete()).
            try {
                if ("file".equals(uri.getScheme())) {
                    new java.io.File(uri.getPath()).delete();
                } else {
                    ctx.getContentResolver().delete(uri, null, null);
                }
            } catch (Exception ignored) {}
            throw e;
        } finally {
            conn.disconnect();
        }

        if (pendingDownloads) {
            cv.clear();
            cv.put(MediaStore.Downloads.IS_PENDING, 0);
            ctx.getContentResolver().update(uri, cv, null, null);
        } else if (!isWebm) {
            cv.clear();
            cv.put(MediaStore.Audio.Media.IS_PENDING, 0);
            ctx.getContentResolver().update(uri, cv, null, null);
        }

        JSObject done = new JSObject();
        done.put("videoId", videoId);
        done.put("percent", 100);
        notifyListeners("progress", done);

        // Path is relative to storage root so the UI can show where it went.
        return (isWebm ? "Download/" : "Music/") + SUBDIR + "/" + fileName;
    }

    /**
     * Lists every audio file the app saved under Music/SimpMusic (via MediaStore
     * query, not filesystem) so the UI can show a Downloads section. Resolves
     * with { files: [{title, artist, relativePath, size, addedAt}] }.
     */
    @PluginMethod
    public void list(final PluginCall call) {
        final Context ctx = getContext();
        new Thread(() -> {
            com.getcapacitor.JSArray files = new com.getcapacitor.JSArray();
            Cursor c = null;
            try {
                String sel = MediaStore.Audio.Media.RELATIVE_PATH + " LIKE ?";
                String[] args = { Environment.DIRECTORY_MUSIC + "/" + SUBDIR + "%" };
                c = ctx.getContentResolver().query(
                        MediaStore.Audio.Media.EXTERNAL_CONTENT_URI,
                        new String[] {
                                MediaStore.Audio.Media.DISPLAY_NAME,
                                MediaStore.Audio.Media.TITLE,
                                MediaStore.Audio.Media.ARTIST,
                                MediaStore.Audio.Media.RELATIVE_PATH,
                                MediaStore.Audio.Media.SIZE,
                                MediaStore.Audio.Media.DATE_ADDED,
                                MediaStore.Audio.Media.COMPOSER,
                                MediaStore.Audio.Media._ID
                        },
                        sel, args,
                        MediaStore.Audio.Media.DATE_ADDED + " DESC");
                if (c != null) {
                    while (c.moveToNext()) {
                        JSObject f = new JSObject();
                        // DISPLAY_NAME is the merge key for the JS-side
                        // videoId map (MediaStore wipes COMPOSER on rescan).
                        f.put("fileName", c.getString(0) != null ? c.getString(0) : "");
                        f.put("title", c.getString(1) != null ? c.getString(1) : "");
                        f.put("artist", c.getString(2) != null ? c.getString(2) : "");
                        f.put("relativePath", c.getString(3) != null ? c.getString(3) : "");
                        f.put("size", c.getLong(4));
                        f.put("addedAt", c.getLong(5));
                        // videoId stashed at download time (COMPOSER column);
                        // empty for files saved before v3.5.2.
                        f.put("videoId", c.getString(6) != null ? c.getString(6) : "");
                        f.put("_id", c.getLong(7));
                        files.put(f);
                    }
                }
                JSObject ret = new JSObject();
                ret.put("files", files);
                call.resolve(ret);
            } catch (Exception e) {
                call.reject("list failed: " + e.getMessage());
            } finally {
                if (c != null) try { c.close(); } catch (Exception ignored) {}
            }
        }, "simpmusic-dllist").start();
    }

    /**
     * v3.7: OFFLINE PLAYBACK. Finds the saved file for a track (by its
     * deterministic file name) and hands the content:// URI to the playback
     * service, which plays the LOCAL file — no network, no stream resolve.
     * Resolves { ok: true, uri } or rejects when the file isn't downloaded.
     */
    @PluginMethod
    public void playLocal(final PluginCall call) {
        final String videoId = call.getString("videoId", "");
        final String baseName = call.getString("fileName", "");
        final String title = call.getString("title", "SimpMusic");
        final String artist = call.getString("artist", "");
        final String thumbnail = call.getString("thumbnail", "");
        final long durationSec = call.getInt("durationSec", 0) == null
                ? 0 : call.getInt("durationSec", 0).longValue();
        if (baseName == null || baseName.isEmpty()) {
            call.reject("fileName required");
            return;
        }
        final Context ctx = getContext();
        new Thread(() -> {
            Cursor c = null;
            try {
                // list() returns the FULL display name (with extension), so
                // match exactly first; the LIKE variant covers bare names.
                c = ctx.getContentResolver().query(
                        MediaStore.Audio.Media.EXTERNAL_CONTENT_URI,
                        new String[] { MediaStore.Audio.Media._ID },
                        MediaStore.Audio.Media.DISPLAY_NAME + " = ? AND "
                                + MediaStore.Audio.Media.RELATIVE_PATH + " LIKE ?",
                        new String[] { baseName,
                                       Environment.DIRECTORY_MUSIC + "/" + SUBDIR + "%" },
                        null);
                if (c == null || !c.moveToFirst()) {
                    if (c != null) c.close();
                    c = ctx.getContentResolver().query(
                            MediaStore.Audio.Media.EXTERNAL_CONTENT_URI,
                            new String[] { MediaStore.Audio.Media._ID },
                            MediaStore.Audio.Media.DISPLAY_NAME + " LIKE ? AND "
                                    + MediaStore.Audio.Media.RELATIVE_PATH + " LIKE ?",
                            new String[] { baseName + ".%",
                                           Environment.DIRECTORY_MUSIC + "/" + SUBDIR + "%" },
                            null);
                }
                if (c == null || !c.moveToFirst()) {
                    call.reject("not downloaded");
                    return;
                }
                Uri uri = android.content.ContentUris.withAppendedId(
                        MediaStore.Audio.Media.EXTERNAL_CONTENT_URI, c.getLong(0));
                android.content.Intent i = new android.content.Intent(ctx, PlaybackKeepAliveService.class);
                i.setAction(PlaybackKeepAliveService.ACTION_PLAY_LOCAL);
                i.putExtra("uri", uri.toString());
                i.putExtra("videoId", videoId);
                i.putExtra("title", title);
                i.putExtra("artist", artist);
                i.putExtra("thumbnail", thumbnail);
                i.putExtra("durationSec", durationSec);
                if (android.os.Build.VERSION.SDK_INT >= android.os.Build.VERSION_CODES.O) {
                    ctx.startForegroundService(i);
                } else {
                    ctx.startService(i);
                }
                JSObject ret = new JSObject();
                ret.put("ok", true);
                ret.put("uri", uri.toString());
                call.resolve(ret);
            } catch (Exception e) {
                call.reject("playLocal failed: " + e.getMessage());
            } finally {
                if (c != null) try { c.close(); } catch (Exception ignored) {}
            }
        }, "simpmusic-dlplay").start();
    }

    /**
     * v3.5.2: deletes a downloaded file by MediaStore _id (the ✕ button in
     * the offline section). Resolves { deleted: true|false }.
     */
    @PluginMethod
    public void remove(final PluginCall call) {
        final Context ctx = getContext();
        final long id = call.getInt("id", -1).longValue();
        new Thread(() -> {
            try {
                int n = ctx.getContentResolver().delete(
                        MediaStore.Audio.Media.EXTERNAL_CONTENT_URI,
                        MediaStore.Audio.Media._ID + " = ?",
                        new String[] { String.valueOf(id) });
                JSObject ret = new JSObject();
                ret.put("deleted", n > 0);
                call.resolve(ret);
            } catch (Exception e) {
                call.reject("remove failed: " + e.getMessage());
            }
        }, "simpmusic-dlremove").start();
    }

    private static String safeFileName(String title, String artist) {
        String raw = artist + " - " + title;
        String s = raw.replaceAll("[\\\\/:*?\"<>|]", "").trim();
        if (s.length() > 90) s = s.substring(0, 90).trim();
        return s.isEmpty() ? "SimpMusic-" + System.currentTimeMillis() : s;
    }

    private static String extForMime(String mime) {
        switch (mime) {
            case "audio/mp4": case "audio/m4a": case "audio/x-m4a": return ".m4a";
            case "audio/webm": return ".webm";
            case "audio/mpeg": case "audio/mp3": return ".mp3";
            case "audio/ogg": return ".ogg";
            case "audio/wav": case "audio/x-wav": return ".wav";
            default: return String.format(Locale.US, ".bin");
        }
    }
}
