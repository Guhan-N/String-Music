package com.simpmusic.app;

import android.net.Uri;

import androidx.media3.datasource.ContentDataSource;
import androidx.media3.datasource.DataSource;
import androidx.media3.datasource.DataSpec;
import androidx.media3.datasource.FileDataSource;
import androidx.media3.datasource.TransferListener;

import java.io.IOException;
import java.util.Map;

/**
 * v3.7.1: routes data-source opens by URI scheme.
 *
 * - http/https → the self-healing resolving pipeline (YouTube streams)
 * - content://  → MediaStore files (downloaded songs — offline playback)
 * - file://     → plain files
 *
 * One data source instance per open is created lazily so each upstream
 * keeps its own state (ExoPlayer calls open/close sequentially per load).
 */
public final class SchemeRoutingDataSource implements DataSource {

    private final DataSource.Factory httpFactory;
    private final ContentResolverHolder resolverHolder;
    private DataSource active;

    /** Supplies a Context for content:// opens (per-instance). */
    public interface ContentResolverHolder {
        android.content.Context get();
    }

    public SchemeRoutingDataSource(DataSource.Factory httpFactory,
                                   ContentResolverHolder resolverHolder) {
        this.httpFactory = httpFactory;
        this.resolverHolder = resolverHolder;
    }

    @Override
    public void addTransferListener(TransferListener transferListener) {
        // Forward to whichever upstream gets activated; simplest correct
        // approach: attach to all created instances via a shared holder.
        listeners.add(transferListener);
    }

    private final java.util.List<TransferListener> listeners = new java.util.ArrayList<>();

    @Override
    public long open(DataSpec dataSpec) throws IOException {
        String scheme = dataSpec.uri.getScheme();
        DataSource upstream;
        if ("http".equalsIgnoreCase(scheme) || "https".equalsIgnoreCase(scheme)) {
            upstream = httpFactory.createDataSource();
        } else if ("content".equalsIgnoreCase(scheme)) {
            upstream = new ContentDataSource(resolverHolder.get());
        } else if ("file".equalsIgnoreCase(scheme)) {
            upstream = new FileDataSource();
        } else {
            upstream = httpFactory.createDataSource();
        }
        for (TransferListener l : listeners) {
            upstream.addTransferListener(l);
        }
        active = upstream;
        return active.open(dataSpec);
    }

    @Override
    public int read(byte[] buffer, int offset, int length) throws IOException {
        return active.read(buffer, offset, length);
    }

    @Override
    public Uri getUri() {
        return active != null ? active.getUri() : null;
    }

    @Override
    public Map<String, java.util.List<String>> getResponseHeaders() {
        return active != null ? active.getResponseHeaders() : null;
    }

    @Override
    public void close() throws IOException {
        if (active != null) {
            try {
                active.close();
            } finally {
                active = null;
            }
        }
    }
}
