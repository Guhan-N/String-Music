package com.simpmusic.app;

import android.net.Uri;

import androidx.media3.datasource.DataSource;
import androidx.media3.datasource.DataSpec;
import androidx.media3.datasource.HttpDataSource;
import androidx.media3.datasource.TransferListener;

import java.io.IOException;
import java.util.Map;

/**
 * v3.4: HTTP DataSource that "self-heals" stale stream URLs.
 *
 * YouTube stream URLs (resolved via NewPipe) are short-lived and are
 * sometimes rejected with 403/410 — especially on a re-open of an already
 * used URL, or when a preloaded URL sat in the cache too long. Previously
 * that surfaced as a fatal player error → JS iframe fallback → full queue
 * reload (~5s stall).
 *
 * This wrapper resolves the videoId → real URL through a fixer (the same
 * logic ResolvingDataSource used, backed by the StreamResolver cache) and,
 * if the open fails with an auth/expiry status, drops the cached URL and
 * re-resolves FRESH before retrying the open once — turning a fatal error
 * into a seamless ~1s hiccup.
 */
public final class SelfHealingDataSource implements DataSource {

    /** Returns the DataSpec to open, swapping the placeholder URI (?v=<id>) for the real stream URL. */
    public interface UrlFixer {
        DataSpec fix(DataSpec spec) throws IOException;
    }

    private final DataSource upstream;
    private final UrlFixer fixer;

    public SelfHealingDataSource(DataSource upstream, UrlFixer fixer) {
        this.upstream = upstream;
        this.fixer = fixer;
    }

    @Override
    public void addTransferListener(TransferListener transferListener) {
        upstream.addTransferListener(transferListener);
    }

    @Override
    public long open(DataSpec dataSpec) throws IOException {
        try {
            return upstream.open(fixer.fix(dataSpec));
        } catch (IOException e) {
            if (!isAuthFailure(e)) throw e;
            // Stale/expired/rate-limited URL: drop the cached entry so the
            // next fix() performs a brand-new extraction, then retry once.
            String videoId = dataSpec.uri.getQueryParameter("v");
            if (videoId != null && !videoId.isEmpty()) {
                StreamResolver.invalidate(videoId);
            }
            return upstream.open(fixer.fix(dataSpec));
        }
    }

    @Override
    public void close() throws IOException {
        upstream.close();
    }

    @Override
    public int read(byte[] buffer, int offset, int length) throws IOException {
        return upstream.read(buffer, offset, length);
    }

    @Override
    public Uri getUri() {
        return upstream.getUri();
    }

    @Override
    public Map<String, java.util.List<String>> getResponseHeaders() {
        return upstream.getResponseHeaders();
    }

    static boolean isAuthFailure(IOException e) {
        if (e instanceof HttpDataSource.InvalidResponseCodeException) {
            int code = ((HttpDataSource.InvalidResponseCodeException) e).responseCode;
            return code == 403 || code == 410 || code == 429;
        }
        return false;
    }

    /** Factory that wraps a DefaultHttpDataSource-created source with self-healing. */
    public static final class Factory implements DataSource.Factory {
        private final DefaultHttpDataSourceFactoryHolder holder;
        private final UrlFixer fixer;

        public Factory(DefaultHttpDataSourceFactoryHolder holder, UrlFixer fixer) {
            this.holder = holder;
            this.fixer = fixer;
        }

        @Override
        public DataSource createDataSource() {
            return new SelfHealingDataSource(holder.create(), fixer);
        }
    }

    /** Simple indirection so the factory can create a fresh upstream per source. */
    public interface DefaultHttpDataSourceFactoryHolder {
        DataSource create();
    }
}
