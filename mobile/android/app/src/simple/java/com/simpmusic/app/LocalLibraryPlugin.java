package com.simpmusic.app;

import android.Manifest;
import android.content.ContentUris;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.database.Cursor;
import android.graphics.Bitmap;
import android.graphics.BitmapFactory;
import android.net.Uri;
import android.os.Build;
import android.provider.MediaStore;
import android.util.Base64;

import androidx.core.app.ActivityCompat;
import androidx.core.content.ContextCompat;

import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.util.HashMap;
import java.util.Map;

/**
 * String Music Simple — reads the audio files already on the device through
 * MediaStore. Nothing here touches the network: the whole plugin is a cursor
 * over local media plus a browser hand-off for the Elite info link.
 */
@CapacitorPlugin(name = "LocalLibrary")
public class LocalLibraryPlugin extends Plugin {

    private static final int REQ_AUDIO = 7301;
    private static final Uri ALBUM_ART_BASE =
            Uri.parse("content://media/external/audio/albumart");

    private PluginCall pendingAccessCall;

    /** Small in-memory cache so scrolling does not re-decode the same cover. */
    private final Map<Long, String> artworkCache = new HashMap<>();

    private String audioPermission() {
        return Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU
                ? Manifest.permission.READ_MEDIA_AUDIO
                : Manifest.permission.READ_EXTERNAL_STORAGE;
    }

    /** Ensure the media permission is granted; resolves {granted:boolean}. */
    @PluginMethod
    public void ensureAccess(PluginCall call) {
        String permission = audioPermission();
        if (ContextCompat.checkSelfPermission(getContext(), permission)
                == PackageManager.PERMISSION_GRANTED) {
            resolveAccess(call, true);
            return;
        }
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            // READ_MEDIA_AUDIO exists only on 33+; on older versions the
            // manifest-declared READ_EXTERNAL_STORAGE is what we request.
            ActivityCompat.requestPermissions(getActivity(),
                    new String[]{Manifest.permission.READ_MEDIA_AUDIO}, REQ_AUDIO);
        } else {
            ActivityCompat.requestPermissions(getActivity(),
                    new String[]{Manifest.permission.READ_EXTERNAL_STORAGE}, REQ_AUDIO);
        }
        pendingAccessCall = call;
    }

    private void resolveAccess(PluginCall call, boolean granted) {
        if (call == null) return;
        JSObject ret = new JSObject();
        ret.put("granted", granted);
        call.resolve(ret);
    }

    @Override
    public void handleRequestPermissionsResult(int requestCode, String[] permissions,
                                               int[] grantResults) {
        super.handleRequestPermissionsResult(requestCode, permissions, grantResults);
        if (requestCode != REQ_AUDIO) return;
        boolean granted = grantResults.length > 0
                && grantResults[0] == PackageManager.PERMISSION_GRANTED;
        PluginCall call = pendingAccessCall;
        pendingAccessCall = null;
        resolveAccess(call, granted);
    }

    /** Every playable audio file MediaStore knows about, sorted by title. */
    @PluginMethod
    public void getSongs(PluginCall call) {
        JSArray songs = new JSArray();
        String[] projection = {
                MediaStore.Audio.Media._ID,
                MediaStore.Audio.Media.TITLE,
                MediaStore.Audio.Media.ARTIST,
                MediaStore.Audio.Media.ALBUM,
                MediaStore.Audio.Media.ALBUM_ID,
                MediaStore.Audio.Media.DURATION,
                MediaStore.Audio.Media.MIME_TYPE,
                MediaStore.Audio.Media.SIZE
        };
        String selection = MediaStore.Audio.Media.IS_MUSIC + " != 0 AND "
                + MediaStore.Audio.Media.DURATION + " > 0";
        Cursor cursor = null;
        try {
            cursor = getContext().getContentResolver().query(
                    MediaStore.Audio.Media.EXTERNAL_CONTENT_URI,
                    projection, selection, null,
                    MediaStore.Audio.Media.TITLE + " COLLATE NOCASE ASC");
            if (cursor != null) {
                while (cursor.moveToNext()) {
                    long id = cursor.getLong(0);
                    long albumId = cursor.getLong(4);
                    JSObject song = new JSObject();
                    song.put("id", String.valueOf(id));
                    song.put("title", safe(cursor.getString(1), "Unknown title"));
                    song.put("artist", safe(cursor.getString(2), "Unknown artist"));
                    song.put("album", safe(cursor.getString(3), ""));
                    song.put("albumId", albumId);
                    song.put("duration", cursor.getLong(5) / 1000.0);
                    song.put("mime", safe(cursor.getString(6), ""));
                    song.put("size", cursor.getLong(7));
                    song.put("uri", ContentUris.withAppendedId(
                            MediaStore.Audio.Media.EXTERNAL_CONTENT_URI, id).toString());
                    songs.put(song);
                }
            }
        } catch (Exception e) {
            call.reject("Could not read the device library: " + e.getMessage());
            return;
        } finally {
            if (cursor != null) cursor.close();
        }

        JSObject ret = new JSObject();
        ret.put("songs", songs);
        call.resolve(ret);
    }

    /** Album cover for one album id, as a data: URL (null when none). */
    @PluginMethod
    public void getArtwork(PluginCall call) {
        long albumId = call.getLong("albumId", -1L);
        if (albumId <= 0) {
            JSObject ret = new JSObject();
            ret.put("artwork", null);
            call.resolve(ret);
            return;
        }
        String cached;
        synchronized (artworkCache) {
            cached = artworkCache.get(albumId);
        }
        if (cached != null) {
            JSObject ret = new JSObject();
            ret.put("artwork", cached);
            call.resolve(ret);
            return;
        }

        String data = null;
        try (InputStream is = getContext().getContentResolver().openInputStream(
                ContentUris.withAppendedId(ALBUM_ART_BASE, albumId))) {
            if (is != null) {
                BitmapFactory.Options bounds = new BitmapFactory.Options();
                bounds.inJustDecodeBounds = true;
                BitmapFactory.decodeStream(is, null, bounds);
                BitmapFactory.Options opts = new BitmapFactory.Options();
                opts.inSampleSize = Math.max(1, bounds.outWidth / 320);
                try (InputStream is2 = getContext().getContentResolver().openInputStream(
                        ContentUris.withAppendedId(ALBUM_ART_BASE, albumId))) {
                    Bitmap bmp = is2 != null ? BitmapFactory.decodeStream(is2, null, opts) : null;
                    if (bmp != null) {
                        ByteArrayOutputStream out = new ByteArrayOutputStream();
                        bmp.compress(Bitmap.CompressFormat.JPEG, 84, out);
                        bmp.recycle();
                        data = "data:image/jpeg;base64,"
                                + Base64.encodeToString(out.toByteArray(), Base64.NO_WRAP);
                    }
                }
            }
        } catch (Exception ignored) {
        }

        if (data != null) {
            synchronized (artworkCache) {
                if (artworkCache.size() > 120) artworkCache.clear();
                artworkCache.put(albumId, data);
            }
        }
        JSObject ret = new JSObject();
        ret.put("artwork", data);
        call.resolve(ret);
    }

    /**
     * Opens an http(s) URL in the device browser. Used ONLY for the Elite
     * information link in Settings — this never downloads or installs
     * anything, it just hands the URL to Chrome.
     */
    @PluginMethod
    public void openExternal(PluginCall call) {
        String url = call.getString("url", "");
        if (url == null || !(url.startsWith("https://") || url.startsWith("http://"))) {
            call.reject("Only http(s) URLs can be opened");
            return;
        }
        try {
            Intent intent = new Intent(Intent.ACTION_VIEW, Uri.parse(url));
            intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            getContext().startActivity(intent);
            call.resolve();
        } catch (Exception e) {
            call.reject("No browser available: " + e.getMessage());
        }
    }

    private static String safe(String value, String fallback) {
        return value == null || value.trim().isEmpty() ? fallback : value;
    }
}
