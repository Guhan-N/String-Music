package com.simpmusic.app;

import android.Manifest;
import android.content.ContentValues;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.os.Environment;
import android.os.PowerManager;
import android.os.SystemClock;
import android.provider.MediaStore;
import android.provider.Settings;
import android.webkit.RenderProcessGoneDetail;
import android.webkit.WebView;

import androidx.activity.OnBackPressedCallback;
import androidx.core.app.ActivityCompat;
import androidx.core.content.ContextCompat;

import com.getcapacitor.Bridge;
import com.getcapacitor.BridgeActivity;
import com.getcapacitor.BridgeWebViewClient;

import java.io.OutputStream;
import java.text.SimpleDateFormat;
import java.util.Date;
import java.util.Locale;

public class MainActivity extends BridgeActivity {
  private static final int REQ_POST_NOTIFICATIONS = 4001;

  /** Renderer reloads since the last successful page load. */
  private int rendererReloads = 0;

  /** Maximum renderer reloads; beyond this we wait for the user to return. */
  private static final int MAX_RENDERER_RELOADS = 3;

  /** Backoff between renderer reloads (ms). */
  private long nextRendererReloadAt = 0;

  @Override
  public void onCreate(Bundle savedInstanceState) {
    // Must run BEFORE super.onCreate(): the Capacitor bridge and its plugin
    // registry are constructed inside super.onCreate(), so plugins registered
    // afterwards are silently dropped.
    registerPlugin(PlaybackKeeperPlugin.class);
    registerPlugin(DownloadPlugin.class);
    registerPlugin(BackupPlugin.class);
    super.onCreate(savedInstanceState);
    installCrashLogger();
    requestNotificationPermissionIfNeeded();
    requestBatteryOptimizationExemption();
    installRendererRecovery();
    installSmartBack();
  }

  /**
   * v3.15.2: the Android BACK button walks the app's UI stack — iPod view,
   * open sheets/dialogs, then Library → Settings → Home — instead of
   * exiting. The WebView decides: window.SimpMusicBack.handle() returns
   * true when it consumed the press (closed an overlay or stepped the view
   * back), false when nothing is left to close — only then the activity
   * moves to the background (moveTaskToBack = home-button semantics; the
   * playback service keeps running either way).
   */
  private void installSmartBack() {
    getOnBackPressedDispatcher().addCallback(this, new OnBackPressedCallback(true) {
      @Override
      public void handleOnBackPressed() {
        try {
          final WebView wv = bridge != null ? bridge.getWebView() : null;
          android.util.Log.d("SmartBack", "press; webview=" + (wv != null));
          if (wv == null) { moveTaskToBack(true); return; }
          wv.evaluateJavascript(
              "(function(){try{return (window.SimpMusicBack&&window.SimpMusicBack.handle())?'yes':'no';}catch(e){return 'no';}})()",
              value -> {
                android.util.Log.d("SmartBack", "js result=" + value);
                if (value == null || !value.contains("yes")) {
                  moveTaskToBack(true);
                }
              });
        } catch (Exception e) {
          android.util.Log.d("SmartBack", "exception=" + e);
          moveTaskToBack(true);
        }
      }
    });
  }

  @Override
  public void onResume() {
    super.onResume();
    // User returned: give the renderer fresh reload budget.
    rendererReloads = 0;
    nextRendererReloadAt = 0;
  }

  /** Android 13+: the media notification is hidden until POST_NOTIFICATIONS is granted. */
  private void requestNotificationPermissionIfNeeded() {
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
      if (ContextCompat.checkSelfPermission(this, Manifest.permission.POST_NOTIFICATIONS)
          != PackageManager.PERMISSION_GRANTED) {
        ActivityCompat.requestPermissions(this,
            new String[]{Manifest.permission.POST_NOTIFICATIONS}, REQ_POST_NOTIFICATIONS);
      }
    }
  }

  /**
   * Ask Android to exempt the app from battery optimizations (Doze etc.).
   * Requires the REQUEST_IGNORE_BATTERY_OPTIMIZATIONS permission in the
   * manifest or startActivity() throws SecurityException.
   */
  private void requestBatteryOptimizationExemption() {
    try {
      PowerManager pm = (PowerManager) getSystemService(POWER_SERVICE);
      String pkg = getPackageName();
      if (pm == null || pm.isIgnoringBatteryOptimizations(pkg)) return;
      // v3.12.1: ask only on the FIRST launch (like the notification
      // permission). If the user declines, never nag again — background
      // playback still works in the foreground; this is best-effort.
      android.content.SharedPreferences prefs =
          getSharedPreferences("simpmusic_prefs", MODE_PRIVATE);
      if (prefs.getBoolean("battery_asked", false)) return;
      prefs.edit().putBoolean("battery_asked", true).apply();
      Intent i = new Intent(Settings.ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS,
          Uri.parse("package:" + pkg));
      startActivity(i);
    } catch (Exception ignored) {
    }
  }

  /**
   * WebView renderer recovery.
   *
   * CRITICAL: onRenderProcessGone must return TRUE for every renderer death.
   * Returning false tells Android the crash is unhandled and the SYSTEM
   * KILLS THE WHOLE PROCESS — which also stops the music service. Instead we
   * always reload the WebView (playback lives in the service; the fresh page
   * re-adopts the running player via PlaybackKeeper.status() → "restored").
   */
  private void installRendererRecovery() {
    try {
      Bridge bridge = this.bridge;
      if (bridge == null || bridge.getWebView() == null) return;
      bridge.setWebViewClient(new BridgeWebViewClient(bridge) {
        @Override
        public boolean onRenderProcessGone(WebView view, RenderProcessGoneDetail detail) {
          rendererReloads++;
          logCrash("WebViewRendererGone #" + rendererReloads,
              "didCrash=" + (detail != null && detail.didCrash()));
          PlaybackKeeperPlugin.setRendererDown(true);
          final long now = SystemClock.uptimeMillis();
          if (rendererReloads > MAX_RENDERER_RELOADS || now < nextRendererReloadAt) {
            // Too many deaths in a row: keep the process alive but stop the
            // reload loop (music keeps playing via the service). The next
            // onResume() gives the user another chance.
            return true;
            // NOTE: still returns true — returning false would kill the app.
          }
          nextRendererReloadAt = now + 10_000; // ≥10s between reload attempts
          view.post(() -> {
            try {
              view.reload();
            } catch (Exception ignored) {
            }
          });
          return true; // ALWAYS handled — never let the system kill the process
        }

        @Override
        public void onPageFinished(WebView view, String url) {
          super.onPageFinished(view, url);
          PlaybackKeeperPlugin.setRendererDown(false); // fresh WebView is up
        }
      });
    } catch (Exception ignored) {
    }
  }

  /**
   * Writes any uncaught crash to Downloads/SimpMusic-crash/ (MediaStore) so
   * it can be read on-device without adb: Files app → Downloads →
   * SimpMusic-crash. Keeps the 5 newest.
   */
  private void installCrashLogger() {
    final Thread.UncaughtExceptionHandler previous =
        Thread.getDefaultUncaughtExceptionHandler();
    Thread.setDefaultUncaughtExceptionHandler((thread, throwable) -> {
      try {
        logCrash("UncaughtException-" + thread.getName(),
            android.util.Log.getStackTraceString(throwable));
      } catch (Exception ignored) {
      }
      if (previous != null) previous.uncaughtException(thread, throwable);
    });
  }

  private void logCrash(String tag, String detail) {
    try {
      String name = "simpmusic-crash-"
          + new SimpleDateFormat("yyyyMMdd-HHmmss", Locale.US).format(new Date())
          + ".txt";
      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
        ContentValues cv = new ContentValues();
        cv.put(MediaStore.Downloads.DISPLAY_NAME, name);
        cv.put(MediaStore.Downloads.MIME_TYPE, "text/plain");
        cv.put(MediaStore.Downloads.RELATIVE_PATH,
            Environment.DIRECTORY_DOWNLOADS + "/SimpMusic-crash");
        Uri uri = getContentResolver().insert(
            MediaStore.Downloads.EXTERNAL_CONTENT_URI, cv);
        if (uri != null) {
          try (OutputStream os = getContentResolver().openOutputStream(uri)) {
            if (os != null) {
              os.write(("[" + new Date() + "] " + tag + "\n" + detail)
                  .getBytes(java.nio.charset.StandardCharsets.UTF_8));
            }
          }
        }
      } else {
        java.io.File dir = new java.io.File(
            Environment.getExternalStoragePublicDirectory(Environment.DIRECTORY_DOWNLOADS),
            "SimpMusic-crash");
        dir.mkdirs();
        try (java.io.PrintWriter pw = new java.io.PrintWriter(
            new java.io.FileWriter(new java.io.File(dir, name)))) {
          pw.println("[" + new Date() + "] " + tag);
          pw.println(detail);
        }
      }
    } catch (Exception ignored) {
    }
  }
}
