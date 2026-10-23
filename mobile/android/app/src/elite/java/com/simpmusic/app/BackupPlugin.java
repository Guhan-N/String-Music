package com.simpmusic.app;

import android.app.Activity;
import android.content.Intent;
import android.net.Uri;
import androidx.activity.result.ActivityResult;
import androidx.core.content.FileProvider;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.ActivityCallback;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.io.BufferedReader;
import java.io.File;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.io.InputStreamReader;
import java.nio.charset.StandardCharsets;

/**
 * Backup & Restore for local app data (likes, playlists, recents,
 * downloads map, recommendations profile).
 *
 * saveBackup: writes the JSON payload to the app's private files dir, then
 * fires an ACTION_SEND chooser (Drive, WhatsApp, Files, ...) with a
 * FileProvider content:// URI — no storage permissions needed.
 *
 * pickBackup: opens the system document picker (ACTION_OPEN_DOCUMENT) via
 * Capacitor's official startActivityForResult(call, intent, callback) API —
 * the callback survives the activity pause while the picker is open (a raw
 * startActivityForResult + handleOnActivityResult pattern can silently drop
 * the result on Capacitor 6).
 */
@CapacitorPlugin(name = "SimpMusicBackup")
public class BackupPlugin extends Plugin {

  @PluginMethod
  public void saveBackup(final PluginCall call) {
    final String json = call.getString("json", "");
    final String fileName = call.getString("fileName", "string-music-backup.json");
    if (json == null || json.isEmpty()) {
      call.reject("json payload required");
      return;
    }
    try {
      File dir = new File(getContext().getFilesDir(), "backups");
      if (!dir.exists()) dir.mkdirs();
      // Fixed name: overwriting keeps at most one staging file instead of
      // accumulating copies every time the user exports.
      File out = new File(dir, fileName);
      try (FileOutputStream fos = new FileOutputStream(out)) {
        fos.write(json.getBytes(StandardCharsets.UTF_8));
        fos.getFD().sync();
      }
      // Keep the staging dir tidy: drop staging files older than this one.
      File[] stale = dir.listFiles();
      if (stale != null) {
        for (File f : stale) {
          if (f.isFile() && f.lastModified() < out.lastModified()) f.delete();
        }
      }

      Uri uri = FileProvider.getUriForFile(
          getContext(), getContext().getPackageName() + ".fileprovider", out);

      Intent send = new Intent(Intent.ACTION_SEND);
      send.setType("application/json");
      send.putExtra(Intent.EXTRA_STREAM, uri);
      send.putExtra(Intent.EXTRA_SUBJECT, fileName);
      send.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);

      Activity activity = getActivity();
      if (activity == null) {
        call.reject("no activity");
        return;
      }
      Intent chooser = Intent.createChooser(send, "Save your backup to");
      chooser.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
      activity.startActivity(chooser);
      call.resolve();
    } catch (Exception e) {
      call.reject("saveBackup failed: " + e.getMessage());
    }
  }

  @PluginMethod
  public void pickBackup(final PluginCall call) {
    Activity activity = getActivity();
    if (activity == null) {
      call.reject("no activity");
      return;
    }
    try {
      Intent intent = new Intent(Intent.ACTION_OPEN_DOCUMENT);
      intent.addCategory(Intent.CATEGORY_OPENABLE);
      intent.setType("*/*");
      // .json files are sometimes served as application/octet-stream or
      // text/plain, so offer the generic mime filter plus common json types.
      intent.putExtra(Intent.EXTRA_MIME_TYPES,
          new String[] { "application/json", "text/plain", "application/octet-stream" });
      // Official Capacitor routing: the call is kept alive across the
      // picker's activity pause and delivered to @ActivityCallback.
      startActivityForResult(call, intent, "pickResult");
    } catch (Exception e) {
      call.reject("picker failed: " + e.getMessage());
    }
  }

  /** Resolved when the document picker closes ( Capacitor @ActivityCallback). */
  @ActivityCallback
  private void pickResult(PluginCall call, ActivityResult result) {
    if (call == null) return;
    int resultCode = result != null ? result.getResultCode() : Activity.RESULT_CANCELED;
    Intent data = result != null ? result.getData() : null;
    if (resultCode != Activity.RESULT_OK || data == null || data.getData() == null) {
      JSObject ret = new JSObject();
      ret.put("cancelled", true);
      call.resolve(ret);
      return;
    }
    Uri uri = data.getData();
    try {
      StringBuilder sb = new StringBuilder();
      InputStream is = getContext().getContentResolver().openInputStream(uri);
      if (is == null) {
        call.reject("cannot open selected file");
        return;
      }
      BufferedReader reader = new BufferedReader(new InputStreamReader(is, StandardCharsets.UTF_8));
      char[] buf = new char[8192];
      int n;
      while ((n = reader.read(buf)) > 0) sb.append(buf, 0, n);
      try { reader.close(); } catch (Exception ignored) {}
      String content = sb.toString();
      if (content.length() > 4_000_000) {
        call.reject("backup file too large");
        return;
      }
      JSObject ret = new JSObject();
      ret.put("cancelled", false);
      ret.put("content", content);
      ret.put("uri", uri.toString());
      call.resolve(ret);
    } catch (Exception e) {
      call.reject("read failed: " + e.getMessage());
    }
  }
}
