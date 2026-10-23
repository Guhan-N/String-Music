package com.simpmusic.app;

import android.util.Log;

import org.schabi.newpipe.extractor.InfoItem;
import org.schabi.newpipe.extractor.NewPipe;
import org.schabi.newpipe.extractor.ServiceList;
import org.schabi.newpipe.extractor.downloader.Downloader;
import org.schabi.newpipe.extractor.downloader.Request;
import org.schabi.newpipe.extractor.downloader.Response;
import org.schabi.newpipe.extractor.exceptions.ReCaptchaException;
import org.schabi.newpipe.extractor.channel.ChannelInfoItem;
import org.schabi.newpipe.extractor.linkhandler.ListLinkHandler;
import org.schabi.newpipe.extractor.linkhandler.SearchQueryHandler;
import org.schabi.newpipe.extractor.playlist.PlaylistExtractor;
import org.schabi.newpipe.extractor.playlist.PlaylistInfo;
import org.schabi.newpipe.extractor.playlist.PlaylistInfoItem;
import org.schabi.newpipe.extractor.search.SearchInfo;
import org.schabi.newpipe.extractor.services.youtube.YoutubeService;
import org.schabi.newpipe.extractor.services.youtube.linkHandler.YoutubeSearchQueryHandlerFactory;
import org.schabi.newpipe.extractor.stream.AudioStream;
import org.schabi.newpipe.extractor.stream.StreamInfo;
import org.schabi.newpipe.extractor.stream.StreamInfoItem;
import org.schabi.newpipe.extractor.stream.StreamType;

import java.io.IOException;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.concurrent.TimeUnit;

import okhttp3.OkHttpClient;
import okhttp3.RequestBody;
import okhttp3.ResponseBody;

/**
 * Resolves playable audio URLs for YouTube video ids using NewPipe Extractor.
 *
 * The WebView player hands us the id (it may not know the real stream URL);
 * NewPipe performs the same negotiation the NewPipe app does (player config,
 * signature deciphering, client selection) and returns direct progressive /
 * HLS audio URLs that ExoPlayer can open. Results are cached per video id so
 * seeking and repeat plays don't re-extract.
 */
public final class StreamResolver {

    private static final String TAG = "SimpMusic/StreamRes";
    private static final String YT_SERVICE_ID = "YouTube";
    public static final String USER_AGENT =
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
                    + "(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";

    private static final Object INIT_LOCK = new Object();
    private static boolean initialized = false;

    /** cacheKey → resolved stream URL. */
    private static final Map<String, String> CACHE = new LinkedHashMap<>();
    /** cacheKey → System.currentTimeMillis() when it was resolved. */
    private static final Map<String, Long> CACHE_AT = new LinkedHashMap<>();
    private static final int CACHE_MAX = 24;

    /**
     * v3.20.7: playback URLs are cached under {@code videoId@quality} and
     * downloads under {@code dl:videoId}. The keys MUST be built in one place:
     * invalidate() and isCached() used to look up the bare videoId, so every
     * "drop the dead URL" call was a silent no-op. A stream URL that had expired
     * stayed in the map, resolution kept handing back the same dead URL, the
     * retry failed too — and the track was dropped and skipped. Restarting the
     * app (which clears this map) made the very same song play again, which is
     * exactly the "some songs won't play until I restart" report.
     */
    private static String playbackKey(String videoId) {
        return videoId + "@" + quality;
    }

    /** Fallback lifetime for a URL that does not advertise its own expiry. */
    private static final long CACHE_MAX_AGE_MS = 3 * 60 * 60 * 1000L;
    /** Re-resolve this long before the URL's own `expire` timestamp. */
    private static final long EXPIRY_MARGIN_MS = 60 * 1000L;

    /** Epoch ms when this URL dies, parsed from its own {@code expire=} param (0 = unknown). */
    private static long urlExpiryMs(String url) {
        try {
            java.util.regex.Matcher m = java.util.regex.Pattern
                    .compile("[?&]expire=(\\d{9,})").matcher(url);
            if (m.find()) return Long.parseLong(m.group(1)) * 1000L;
        } catch (Exception ignored) { }
        return 0L;
    }

    /** True when the cached entry may no longer be used. Caller holds the lock. */
    private static boolean isStale(String key, String url) {
        Long at = CACHE_AT.get(key);
        long now = System.currentTimeMillis();
        if (at == null) return true;
        long exp = urlExpiryMs(url);
        if (exp > 0) return now + EXPIRY_MARGIN_MS >= exp;
        return now - at >= CACHE_MAX_AGE_MS;
    }

    /** Puts a URL in the cache with its resolve time. Caller holds the lock. */
    private static void cachePut(String key, String url) {
        CACHE.put(key, url);
        CACHE_AT.put(key, System.currentTimeMillis());
    }

    /** Drops the oldest entry (insertion order) plus its bookkeeping. */
    private static void evictOldest() {
        java.util.Iterator<String> it = CACHE.keySet().iterator();
        if (!it.hasNext()) return;
        String oldest = it.next();
        it.remove();
        CACHE_AT.remove(oldest);
        // Only drop the bitrate badge that belongs to the evicted entry, and
        // only when it is there: this used to assume BITRATES always had an
        // entry, and threw NoSuchElementException inside the resolve call when
        // it did not (dl: entries and repeat resolves at another quality).
        String id = oldest.startsWith("dl:") ? oldest.substring(3)
                : oldest.substring(0, Math.max(0, oldest.indexOf('@')));
        BITRATES.remove(id);
    }

    /** v3.12.4: videoId → chosen average bitrate (kbps) for the UI badge. */
    private static final Map<String, Integer> BITRATES = new LinkedHashMap<>();

    /**
     * v3.12.2: user-selected audio quality ("saver" | "standard" | "high").
     * Changing it invalidates the cache so the next resolve re-picks streams.
     */
    private static volatile String quality = "standard";

    private StreamResolver() {}

    /**
     * v3.20.6: the Settings card offers saver | standard | high, but only
     * "low"/"high" used to survive normalization — tapping Saver silently
     * became Standard, so two of the three buttons did exactly the same thing.
     * "low" stays accepted as the legacy spelling of "saver".
     */
    public static String normalizeQuality(String q) {
        if (q == null) return "standard";
        String v = q.trim().toLowerCase(java.util.Locale.ROOT);
        if (v.equals("saver") || v.equals("low") || v.equals("data")
                || v.equals("datasaver") || v.equals("data_saver")) return "saver";
        if (v.equals("high") || v.equals("highres") || v.equals("high_res")
                || v.equals("best") || v.equals("highest")) return "high";
        return "standard";
    }

    /** Returns true when the value actually changed (cache was cleared). */
    public static boolean setQuality(String q) {
        String nq = normalizeQuality(q);
        if (!nq.equals(quality)) {
            quality = nq;
            synchronized (CACHE) { CACHE.clear(); CACHE_AT.clear(); }
            Log.d(TAG, "Audio quality set to " + nq + " (cache cleared)");
            return true;
        }
        return false;
    }

    public static String getQuality() { return quality; }

    /** v3.12.4: the average bitrate (kbps) chosen for this videoId, or -1. */
    public static int getBitrate(String videoId) {
        Integer b = BITRATES.get(videoId);
        return b != null ? b : -1;
    }

    /** Returns a direct audio URL for the given video id (cached). */
    public static String resolveAudioUrl(String videoId) throws IOException {
        return resolveAudioUrl(videoId, false);
    }

    /**
     * Returns a direct audio URL for the given video id (cached).
     * When preferHigh is true, higher bitrates are favored more aggressively
     * (used by downloads when the user picked High audio quality).
     */
    public static String resolveAudioUrl(String videoId, boolean preferHigh) throws IOException {
        if (videoId == null || videoId.isEmpty()) {
            throw new IOException("Empty video id");
        }
        String cacheKey = playbackKey(videoId);
        synchronized (CACHE) {
            String cached = CACHE.get(cacheKey);
            // v3.20.7: never hand out a URL that already expired (or waited too
            // long) — that is what turned into a 403 and a skipped song.
            if (cached != null && !isStale(cacheKey, cached)) return cached;
            if (cached != null) CACHE.remove(cacheKey);
        }

        ensureInitialized();

        try {
            StreamInfo info = StreamInfo.getInfo(YT_URL_BASE + videoId);
            if (info.getStreamType() == StreamType.LIVE_STREAM) {
                throw new IOException("Live streams are not supported for native playback");
            }

            List<AudioStream> streams = info.getAudioStreams();
            if (streams == null || streams.isEmpty()) {
                throw new IOException("No audio streams (possibly age-restricted)");
            }

            AudioStream best = pickBestAudio(streams, preferHigh, quality);
            if (best == null) throw new IOException("No usable audio stream found");

            synchronized (CACHE) {
                if (CACHE.size() >= CACHE_MAX) evictOldest();
                cachePut(cacheKey, best.getUrl());
                BITRATES.put(videoId, best.getAverageBitrate());
            }
            Log.d(TAG, "Resolved " + videoId + " (" + streams.size()
                    + " streams, quality=" + quality
                    + ", picked " + best.getAverageBitrate() + "kbps "
                    + (best.getFormat() != null ? best.getFormat().getSuffix() : "") + ")");
            return best.getUrl();
        } catch (IOException e) {
            throw e;
        } catch (Exception e) {
            Log.w(TAG, "Extraction failed for " + videoId + ": " + e);
            throw new IOException("Extraction failed: " + e.getMessage(), e);
        }
    }

    /**
     * v3.5.1: resolves a DOWNLOAD-friendly audio URL for the given video id.
     * MediaStore's Audio collection rejects audio/webm on modern Android
     * ("unsupported mime type"), so downloads prefer the M4A/AAC progressive
     * stream and only fall back to WebM when no M4A exists (the caller then
     * saves it under Downloads/ instead of Music/). Separate cache namespace
     * ("dl:") because playback prefers Opus while downloads prefer M4A.
     */
    public static String resolveDownloadAudioUrl(String videoId, boolean preferHigh) throws IOException {
        if (videoId == null || videoId.isEmpty()) {
            throw new IOException("Empty video id");
        }
        String cacheKey = "dl:" + videoId;
        synchronized (CACHE) {
            String cached = CACHE.get(cacheKey);
            if (cached != null && !isStale(cacheKey, cached)) return cached;
            if (cached != null) CACHE.remove(cacheKey);
        }

        ensureInitialized();

        try {
            StreamInfo info = StreamInfo.getInfo(YT_URL_BASE + videoId);
            if (info.getStreamType() == StreamType.LIVE_STREAM) {
                throw new IOException("Live streams are not supported for downloads");
            }
            List<AudioStream> streams = info.getAudioStreams();
            if (streams == null || streams.isEmpty()) {
                throw new IOException("No audio streams (possibly age-restricted)");
            }
            String best = pickDownloadAudio(streams, preferHigh);
            if (best == null) throw new IOException("No usable audio stream found");

            synchronized (CACHE) {
                if (CACHE.size() >= CACHE_MAX) evictOldest();
                cachePut(cacheKey, best);
            }
            Log.d(TAG, "Resolved download stream for " + videoId);
            return best;
        } catch (IOException e) {
            throw e;
        } catch (Exception e) {
            Log.w(TAG, "Download extraction failed for " + videoId + ": " + e);
            throw new IOException("Extraction failed: " + e.getMessage(), e);
        }
    }

    /** True when the video id's download stream is the WebM fallback. */
    public static boolean isWebmDownload(String videoId) {
        synchronized (CACHE) {
            String url = CACHE.get("dl:" + videoId);
            return url != null && url.contains(".webm");
        }
    }

    /** Highest-bitrate M4A/AAC/MP4 progressive stream (MediaStore-safe). */
    private static String pickDownloadAudio(List<AudioStream> streams, boolean preferHigh) {
        String bestUrl = null;
        int bestScore = Integer.MIN_VALUE;
        for (AudioStream s : streams) {
            String url = s.getUrl();
            if (url == null || url.isEmpty() || url.contains(".m3u8")) continue;
            String suffix = s.getFormat() != null ? s.getFormat().getSuffix() : "";
            String mime = s.getFormat() != null && s.getFormat().getMimeType() != null
                    ? s.getFormat().getMimeType().toLowerCase(java.util.Locale.US) : "";
            boolean mp4Family = "m4a".equals(suffix) || "mp4".equals(suffix)
                    || "aac".equals(suffix) || mime.contains("mp4") || mime.contains("aac");
            if (!mp4Family) continue;
            int score = s.getAverageBitrate();
            if (score > bestScore) {
                bestScore = score;
                bestUrl = url;
            }
        }
        return bestUrl;
    }

    /**
     * Clears every cached URL for this video id — all qualities plus the
     * download entry — so the next resolve extracts a fresh one.
     *
     * v3.20.7: this used to remove the key {@code videoId}, which was never
     * stored (entries are {@code videoId@quality} / {@code dl:videoId}), so it
     * silently did NOTHING. That defeated both callers: the 403 self-healing
     * data source re-resolved and got the same dead URL back, and the player's
     * post-error retry did the same — the song could not play again for the rest
     * of the session, yet worked after restarting the app.
     */
    public static void invalidate(String videoId) {
        if (videoId == null || videoId.isEmpty()) return;
        String prefix = videoId + "@";
        String dlKey = "dl:" + videoId;
        synchronized (CACHE) {
            java.util.Iterator<String> it = CACHE.keySet().iterator();
            while (it.hasNext()) {
                String k = it.next();
                if (k.startsWith(prefix) || k.equals(dlKey)) {
                    it.remove();
                    CACHE_AT.remove(k);
                }
            }
        }
    }

    /** True when a usable (non-stale) stream URL for this video id is cached. */
    public static boolean isCached(String videoId) {
        if (videoId == null || videoId.isEmpty()) return false;
        synchronized (CACHE) {
            String key = playbackKey(videoId);
            String url = CACHE.get(key);
            return url != null && !isStale(key, url);
        }
    }

    /**
     * Native YouTube Music search via NewPipe (no backend needed).
     * Returns a JSON array matching the web app's track shape:
     * [{videoId, title, artist, album, duration, durationSec, thumbnail}]
     */
    public static String searchSongs(String query) throws IOException {
        if (query == null || query.trim().isEmpty()) return "[]";
        ensureInitialized();
        try {
            YoutubeService yt = (YoutubeService) ServiceList.YouTube;
            SearchQueryHandler qh = yt.getSearchQHFactory()
                    .fromQuery(query, java.util.Collections.singletonList(
                            YoutubeSearchQueryHandlerFactory.MUSIC_SONGS), "");
            SearchInfo info = SearchInfo.getInfo(yt, qh);

            StringBuilder sb = new StringBuilder("[");
            int count = 0;
            for (InfoItem item : info.getRelatedItems()) {
                if (!(item instanceof StreamInfoItem)) continue;
                StreamInfoItem s = (StreamInfoItem) item;
                if (s.getStreamType() != StreamType.VIDEO_STREAM) continue;
                String videoId = extractVideoId(s.getUrl());
                if (videoId == null) continue;
                if (count > 0) sb.append(',');
                sb.append('{')
                  .append("\"videoId\":\"").append(jsEscape(videoId)).append('\"')
                  .append(",\"title\":\"").append(jsEscape(s.getName())).append('\"')
                  .append(",\"artist\":\"").append(jsEscape(s.getUploaderName())).append('\"')
                  .append(",\"album\":\"").append(jsEscape(s.getName())).append('\"')
                  .append(",\"duration\":\"").append(formatDuration(s.getDuration())).append('\"')
                  .append(",\"durationSec\":").append(s.getDuration())
                  .append(",\"thumbnail\":\"https://i.ytimg.com/vi/")
                  .append(jsEscape(videoId)).append("/hqdefault.jpg\"")
                  .append('}');
                count++;
                if (count >= 20) break;
            }
            sb.append(']');
            Log.d(TAG, "Native search '" + query + "' → " + count + " results");
            return sb.toString();
        } catch (IOException e) {
            throw e;
        } catch (Exception e) {
            Log.w(TAG, "Native search failed: " + e);
            throw new IOException("Search failed: " + e.getMessage(), e);
        }
    }

    /** Extracts the 11-char video id from a youtube.com watch URL. */
    private static String extractVideoId(String url) {
        if (url == null) return null;
        java.util.regex.Matcher m = java.util.regex.Pattern
                .compile("[?&]v=([A-Za-z0-9_-]{11})").matcher(url);
        return m.find() ? m.group(1) : null;
    }

    /** Extracts the list= id from any YouTube URL shape. */
    private static String extractListId(String url) {
        if (url == null) return null;
        java.util.regex.Matcher m = java.util.regex.Pattern
                .compile("[?&]list=([A-Za-z0-9_-]+)").matcher(url);
        return m.find() ? m.group(1) : null;
    }

    /** v3.17: NewPipe ≥0.24 returns List<Image>; pick the biggest URL. */
    private static String firstThumb(java.util.List<org.schabi.newpipe.extractor.Image> imgs) {
        if (imgs == null || imgs.isEmpty()) return "";
        org.schabi.newpipe.extractor.Image best = imgs.get(0);
        for (org.schabi.newpipe.extractor.Image im : imgs) {
            if (im.getHeight() >= best.getHeight()) best = im;
        }
        return best.getUrl() != null ? best.getUrl() : "";
    }

    /**
     * v3.17: resolve a PUBLIC YouTube playlist URL via NewPipe (no OAuth).
     * Returns JSON: {name, creator, thumbnail, count, tracks:[trackShape]}.
     * Mixes/radio (RD/UL) and private lists (WL/LL/FL) are rejected.
     */
    public static String resolvePlaylist(String url) throws IOException {
        if (url == null || url.trim().isEmpty()) throw new IOException("Paste a playlist link first");
        ensureInitialized();
        String listId = extractListId(url.trim());
        if (listId == null || listId.length() < 10)
            throw new IOException("That link doesn't contain a playlist id");
        if (listId.startsWith("RD") || listId.startsWith("UL")
                || listId.startsWith("WL") || listId.startsWith("LL")
                || listId.startsWith("FL"))
            throw new IOException("Radio mixes and private lists can't be imported — use a public playlist link");
        // v3.17.1 PRIMARY: YouTube Music InnerTube browse API (pure JSON, no
        // HTML scraping). The NewPipe HTML extractor NPEs because the playlist
        // web page no longer embeds ytInitialData for cookieless clients —
        // while InnerTube endpoints (which search already uses) return JSON
        // regardless of consent pages.
        try {
            String viaTube = resolvePlaylistInnerTube(listId);
            if (viaTube != null) return viaTube;
        } catch (Exception e) {
            Log.w(TAG, "InnerTube playlist resolve failed: " + e);
        }
        // v3.17.1 FALLBACK: NewPipe extractor (upstream may fix the scrape).
        return resolvePlaylistNewPipe(listId);
    }

    /**
     * v3.20.4: the CURRENT week's official chart playlists.
     *
     * YouTube Music rotates the chart playlist ids ("Top Weekly Videos Tamil",
     * "Top 100 Music Videos India", …) every week, so any list id baked into
     * the app goes stale immediately. This reads the charts landing page
     * (browseId FEmusic_charts) and returns the live ids.
     *
     * Returns JSON: [{title, listId, thumb}, …] — public playlists only
     * (albums and artist channels are skipped).
     */
    public static String fetchChartPlaylists() throws IOException {
        ensureInitialized();
        OkHttpClient client = new OkHttpClient.Builder()
                .connectTimeout(12, TimeUnit.SECONDS)
                .readTimeout(20, TimeUnit.SECONDS)
                .build();
        // Built as a raw JSON string: org.json's chainable put() declares a
        // checked JSONException, and this payload is static anyway.
        String payloadJson = "{\"browseId\":\"FEmusic_charts\",\"context\":{\"client\":{"
                + "\"clientName\":\"WEB_REMIX\",\"clientVersion\":\"1.20240101.01.00\","
                + "\"hl\":\"en\",\"gl\":\"IN\"}}}";
        okhttp3.Request req = new okhttp3.Request.Builder()
                .url("https://music.youtube.com/youtubei/v1/browse?key="
                        + "AIzaSyC9XL3ZjWddXya6X74dJoCTL-WEYFDNX30" + "&prettyPrint=false")
                .header("Content-Type", "application/json")
                .header("User-Agent", USER_AGENT)
                .header("Accept-Language", "en-US,en;q=0.9")
                .header("Cookie", "CONSENT=YES+cb.20240101-01-p0.en+FX+700; SOCS=CAI")
                .header("Origin", "https://music.youtube.com")
                .post(RequestBody.create(null,
                        payloadJson.getBytes(java.nio.charset.StandardCharsets.UTF_8)))
                .build();
        okhttp3.Response resp = client.newCall(req).execute();
        String body = resp.body() != null ? resp.body().string() : "";
        if (resp.code() != 200) throw new IOException("HTTP " + resp.code());
        org.json.JSONObject root;
        try {
            root = new org.json.JSONObject(body);
        } catch (Exception e) {
            throw new IOException("charts response not JSON: " + e.getMessage(), e);
        }

        java.util.List<String[]> rows = new java.util.ArrayList<>();
        java.util.Set<String> seen = new java.util.HashSet<>();
        collectChartRows(root, rows, seen);
        StringBuilder sb = new StringBuilder("[");
        for (int i = 0; i < rows.size(); i++) {
            String[] r = rows.get(i);
            if (i > 0) sb.append(',');
            sb.append("{\"title\":\"").append(jsEscape(r[0]))
              .append("\",\"listId\":\"").append(jsEscape(r[1]))
              .append("\",\"thumb\":\"").append(jsEscape(r[2])).append("\"}");
        }
        return sb.append(']').toString();
    }

    /**
     * Walks the charts response for playlist rows (browseId "VLPL…"), keeping
     * the title, the bare list id and the best thumbnail. Albums ("VLOLAK…")
     * and artist channels ("UC…") are ignored — they are not charts.
     */
    private static void collectChartRows(Object node, java.util.List<String[]> out,
                                         java.util.Set<String> seen) {
        if (node == null) return;
        if (node instanceof org.json.JSONArray) {
            org.json.JSONArray arr = (org.json.JSONArray) node;
            for (int i = 0; i < arr.length(); i++) collectChartRows(arr.opt(i), out, seen);
            return;
        }
        if (!(node instanceof org.json.JSONObject)) return;
        org.json.JSONObject o = (org.json.JSONObject) node;

        org.json.JSONObject two = o.optJSONObject("musicTwoRowItemRenderer");
        org.json.JSONObject list = o.optJSONObject("musicResponsiveListItemRenderer");
        String browseId = null;
        String title = "";
        String thumb = "";
        if (two != null) {
            browseId = pathBrowseId(two.optJSONObject("navigationEndpoint"));
            title = runsText(two.optJSONObject("title"));
            org.json.JSONObject tr = two.optJSONObject("thumbnailRenderer");
            org.json.JSONObject mt = tr == null ? null : tr.optJSONObject("musicThumbnailRenderer");
            org.json.JSONObject th = mt == null ? null : mt.optJSONObject("thumbnail");
            thumb = bestThumb(th == null ? null : th.optJSONArray("thumbnails"));
        } else if (list != null) {
            browseId = pathBrowseId(list.optJSONObject("navigationEndpoint"));
            org.json.JSONArray cols = list.optJSONArray("flexColumns");
            if (cols != null && cols.length() > 0) {
                org.json.JSONObject c0 = cols.optJSONObject(0);
                org.json.JSONObject txt = c0 == null ? null : c0.optJSONObject("musicResponsiveListItemFlexColumnRenderer");
                title = runsText(txt == null ? null : txt.optJSONObject("text"));
            }
        }

        if (browseId != null && browseId.startsWith("VLPL") && title != null && !title.isEmpty()) {
            String listId = browseId.substring(2);
            if (seen.add(listId)) out.add(new String[]{title, listId, thumb});
        }

        java.util.Iterator<String> keys = o.keys();
        while (keys.hasNext()) collectChartRows(o.opt(keys.next()), out, seen);
    }

    private static String pathBrowseId(org.json.JSONObject endpoint) {
        if (endpoint == null) return null;
        org.json.JSONObject browse = endpoint.optJSONObject("browseEndpoint");
        return browse == null ? null : browse.optString("browseId", null);
    }

    /** Largest thumbnail URL in an InnerTube thumbnails array. */
    private static String bestThumb(org.json.JSONArray thumbs) {
        if (thumbs == null || thumbs.length() == 0) return "";
        String url = "";
        int bestW = -1;
        for (int i = 0; i < thumbs.length(); i++) {
            org.json.JSONObject t = thumbs.optJSONObject(i);
            if (t == null) continue;
            int w = t.optInt("width", 0);
            String u = t.optString("url", "");
            if (u != null && !u.isEmpty() && w >= bestW) { bestW = w; url = u; }
        }
        return url;
    }

    /** InnerTube (YouTube Music web client) playlist fetch — JSON in/out. */
    private static String resolvePlaylistInnerTube(String listId) throws IOException {
        try {
            OkHttpClient client = new OkHttpClient.Builder()
                    .connectTimeout(12, TimeUnit.SECONDS)
                    .readTimeout(20, TimeUnit.SECONDS)
                    .build();
            org.json.JSONObject payload = new org.json.JSONObject()
                    .put("browseId", "VL" + listId)
                    .put("context", new org.json.JSONObject()
                            .put("client", new org.json.JSONObject()
                                    .put("clientName", "WEB_REMIX")
                                    .put("clientVersion", "1.20240101.01.00")
                                    .put("hl", "en")));
            okhttp3.Request req = new okhttp3.Request.Builder()
                    .url("https://music.youtube.com/youtubei/v1/browse?key="
                            + "AIzaSyC9XL3ZjWddXya6X74dJoCTL-WEYFDNX30" + "&prettyPrint=false")
                    .header("Content-Type", "application/json")
                    .header("User-Agent", USER_AGENT)
                    .header("Accept-Language", "en-US,en;q=0.9")
                    .header("Cookie", "CONSENT=YES+cb.20240101-01-p0.en+FX+700; SOCS=CAI")
                    .post(RequestBody.create(null,
                            payload.toString().getBytes(java.nio.charset.StandardCharsets.UTF_8)))
                    .build();
            okhttp3.Response resp = client.newCall(req).execute();
            String body = resp.body() != null ? resp.body().string() : "";
            if (resp.code() != 200) throw new IOException("HTTP " + resp.code());
            org.json.JSONObject root = new org.json.JSONObject(body);

            // v3.17.2: verified against the live API — rows are
            // musicResponsiveListItemRenderer under
            // contents.twoColumnBrowseResultsRenderer.secondaryContents
            //   .sectionListRenderer.contents[0].musicPlaylistShelfRenderer
            org.json.JSONObject contents = root.optJSONObject("contents");
            org.json.JSONObject two = contents == null ? null : contents.optJSONObject("twoColumnBrowseResultsRenderer");
            org.json.JSONObject secondary = two == null ? null : two.optJSONObject("secondaryContents");
            org.json.JSONObject sectionList = secondary == null ? null : secondary.optJSONObject("sectionListRenderer");
            org.json.JSONArray sections = sectionList == null ? null : sectionList.optJSONArray("contents");
            org.json.JSONArray items = null;
            if (sections != null && sections.length() > 0) {
                org.json.JSONObject s0 = sections.optJSONObject(0);
                org.json.JSONObject shelf = s0 == null ? null : s0.optJSONObject("musicPlaylistShelfRenderer");
                items = shelf == null ? null : shelf.optJSONArray("contents");
            }

            // Playlist title: microformat (always present) → detail header → generic.
            String name = "";
            org.json.JSONObject micro = root.optJSONObject("microformat");
            micro = micro == null ? null : micro.optJSONObject("microformatDataRenderer");
            if (micro != null) name = micro.optString("title", "");
            if (name == null || name.isEmpty()) {
                org.json.JSONObject header = root.optJSONObject("header");
                org.json.JSONObject detail = header == null ? null : header.optJSONObject("musicDetailHeaderRenderer");
                if (detail != null) name = runsText(detail.optJSONObject("title"));
            }
            if (name == null || name.isEmpty()) name = "YouTube Playlist";
            String creator = "";
            org.json.JSONObject header = root.optJSONObject("header");
            org.json.JSONObject detail = header == null ? null : header.optJSONObject("musicDetailHeaderRenderer");
            if (detail != null) creator = runsText(detail.optJSONObject("ownerText"));
            StringBuilder sb = new StringBuilder("{");
            sb.append("\"name\":\"").append(jsEscape(name)).append('"');
            sb.append(",\"creator\":\"").append(jsEscape(creator)).append('"');
            sb.append(",\"thumbnail\":\"\"");
            sb.append(",\"tracks\":[");
            int count = 0;
            java.util.Set<String> seen = new java.util.HashSet<>();
            if (items != null) {
                for (int i = 0; i < items.length(); i++) {
                    org.json.JSONObject row = items.optJSONObject(i);
                    if (row == null) continue;
                    org.json.JSONObject li = row.optJSONObject("musicResponsiveListItemRenderer");
                    if (li == null) continue;
                    org.json.JSONArray cols = li.optJSONArray("flexColumns");
                    if (cols == null || cols.length() == 0) continue;
                    // Column 0: title + videoId
                    org.json.JSONObject c0 = cols.optJSONObject(0);
                    c0 = c0 == null ? null : c0.optJSONObject("musicResponsiveListItemFlexColumnRenderer");
                    org.json.JSONObject t0 = c0 == null ? null : c0.optJSONObject("text");
                    org.json.JSONArray runs0 = t0 == null ? null : t0.optJSONArray("runs");
                    org.json.JSONObject r0 = runs0 == null ? null : runs0.optJSONObject(0);
                    if (r0 == null) continue; // unavailable row
                    String title = r0.optString("text", "");
                    String videoId = "";
                    org.json.JSONObject nav = r0.optJSONObject("navigationEndpoint");
                    org.json.JSONObject watch = nav == null ? null : nav.optJSONObject("watchEndpoint");
                    if (watch != null) videoId = watch.optString("videoId", "");
                    if (videoId.isEmpty() || !seen.add(videoId)) continue;
                    // Column 1: artist
                    String artist = "";
                    if (cols.length() > 1) {
                        org.json.JSONObject c1 = cols.optJSONObject(1);
                        c1 = c1 == null ? null : c1.optJSONObject("musicResponsiveListItemFlexColumnRenderer");
                        org.json.JSONObject t1 = c1 == null ? null : c1.optJSONObject("text");
                        artist = runsText(t1);
                    }
                    // Fixed column: duration "m:ss"
                    long dur = 0;
                    org.json.JSONArray fixed = li.optJSONArray("fixedColumns");
                    if (fixed != null && fixed.length() > 0) {
                        org.json.JSONObject fc = fixed.optJSONObject(0);
                        fc = fc == null ? null : fc.optJSONObject("musicResponsiveListItemFixedColumnRenderer");
                        org.json.JSONObject ft = fc == null ? null : fc.optJSONObject("text");
                        org.json.JSONArray fruns = ft == null ? null : ft.optJSONArray("runs");
                        org.json.JSONObject fr = fruns == null ? null : fruns.optJSONObject(0);
                        String durStr = fr == null ? "" : fr.optString("text", "");
                        dur = parseDuration(durStr);
                    }
                    if (count > 0) sb.append(',');
                    sb.append('{')
                      .append("\"videoId\":\"").append(jsEscape(videoId)).append('\"')
                      .append(",\"title\":\"").append(jsEscape(title)).append('\"')
                      .append(",\"artist\":\"").append(jsEscape(artist != null ? artist : "")).append('\"')
                      .append(",\"album\":\"").append(jsEscape(name)).append('\"')
                      .append(",\"duration\":\"").append(formatDuration(dur)).append('\"')
                      .append(",\"durationSec\":").append(dur)
                      .append(",\"thumbnail\":\"https://i.ytimg.com/vi/")
                      .append(jsEscape(videoId)).append("/hqdefault.jpg\"")
                      .append('}');
                    count++;
                    if (count >= 100) break;
                }
            }
            sb.append("],\"count\":").append(count).append('}');
            if (count == 0) throw new IOException("no tracks in response");
            Log.d(TAG, "Playlist resolved (InnerTube) '" + listId + "' → " + count + " tracks");
            return sb.toString();
        } catch (IOException e) {
            throw e;
        } catch (Exception e) {
            throw new IOException(e.getMessage(), e);
        }
    }

    /** Parses "m:ss" / "h:mm:ss" → seconds (0 when unparseable). */
    private static long parseDuration(String s) {
        if (s == null || s.isEmpty()) return 0;
        try {
            String[] parts = s.split(":");
            long sec = 0;
            for (String p : parts) sec = sec * 60 + Long.parseLong(p.trim());
            return sec;
        } catch (Exception e) {
            return 0;
        }
    }

    /** Joins InnerTube runs[].text fields; null-safe, simpleText fallback. */
    private static String runsText(org.json.JSONObject holder) {
        if (holder == null) return "";
        org.json.JSONArray runs = holder.optJSONArray("runs");
        if (runs == null || runs.length() == 0) {
            return holder.optString("simpleText", "");
        }
        StringBuilder sb = new StringBuilder();
        for (int i = 0; i < runs.length(); i++) {
            org.json.JSONObject o = runs.optJSONObject(i);
            if (o != null) sb.append(o.optString("text", ""));
        }
        return sb.toString();
    }

    /** Finds the playlist video list across known browse-response shapes. */
    private static org.json.JSONArray playlistItems(org.json.JSONObject root) {
        try {
            org.json.JSONObject contents = root.optJSONObject("contents");
            if (contents == null) return null;
            org.json.JSONObject single = contents.optJSONObject("singleColumnBrowseResultsRenderer");
            if (single != null) {
                org.json.JSONArray tabs = single.optJSONArray("tabs");
                if (tabs != null && tabs.length() > 0) {
                    org.json.JSONObject tab = tabs.optJSONObject(0);
                    tab = tab == null ? null : tab.optJSONObject("tabRenderer");
                    org.json.JSONObject content = tab == null ? null : tab.optJSONObject("content");
                    org.json.JSONObject section = content == null ? null : content.optJSONObject("sectionListRenderer");
                    org.json.JSONArray secs = section == null ? null : section.optJSONArray("contents");
                    if (secs != null && secs.length() > 0) {
                        org.json.JSONObject s0 = secs.optJSONObject(0);
                        org.json.JSONObject shelf = s0 == null ? null : s0.optJSONObject("musicPlaylistShelfRenderer");
                        return shelf == null ? null : shelf.optJSONArray("contents");
                    }
                }
            }
            // WEB client shape: twoColumnBrowseResultsRenderer → … → playlistVideoListRenderer
            org.json.JSONObject two = contents.optJSONObject("twoColumnBrowseResultsRenderer");
            if (two != null) {
                org.json.JSONArray tabs = two.optJSONArray("tabs");
                if (tabs != null) {
                    for (int i = 0; i < tabs.length(); i++) {
                        org.json.JSONObject tab = tabs.optJSONObject(i);
                        tab = tab == null ? null : tab.optJSONObject("tabRenderer");
                        org.json.JSONObject content = tab == null ? null : tab.optJSONObject("content");
                        org.json.JSONObject section = content == null ? null : content.optJSONObject("sectionListRenderer");
                        org.json.JSONArray secs = section == null ? null : section.optJSONArray("contents");
                        if (secs == null) continue;
                        for (int j = 0; j < secs.length(); j++) {
                            org.json.JSONObject so = secs.optJSONObject(j);
                            org.json.JSONObject shelf = so == null ? null : so.optJSONObject("playlistVideoListRenderer");
                            if (shelf != null) return shelf.optJSONArray("contents");
                        }
                    }
                }
            }
        } catch (Exception ignored) {}
        return null;
    }

    /** NewPipe-extractor fallback path for playlist resolution. */
    private static String resolvePlaylistNewPipe(String listId) throws IOException {
        try {
            String clean = "https://www.youtube.com/playlist?list=" + listId;
            ListLinkHandler lh = ServiceList.YouTube.getPlaylistLHFactory().fromUrl(clean);
            PlaylistExtractor extractor = ServiceList.YouTube.getPlaylistExtractor(lh);
            PlaylistInfo info = PlaylistInfo.getInfo(extractor);

            StringBuilder sb = new StringBuilder("{");
            sb.append("\"name\":\"").append(jsEscape(info.getName())).append('"');
            sb.append(",\"creator\":\"").append(jsEscape(info.getUploaderName())).append('"');
            String thumb = firstThumb(info.getThumbnails());
            sb.append(",\"thumbnail\":\"").append(jsEscape(thumb)).append('"');
            sb.append(",\"tracks\":[");
            int count = 0;
            java.util.Set<String> seen = new java.util.HashSet<>();
            for (InfoItem item : info.getRelatedItems()) {
                if (!(item instanceof StreamInfoItem)) continue;
                StreamInfoItem s = (StreamInfoItem) item;
                if (s.getStreamType() != StreamType.VIDEO_STREAM) continue;
                String videoId = extractVideoId(s.getUrl());
                if (videoId == null || !seen.add(videoId)) continue; // dedupe
                if (count > 0) sb.append(',');
                sb.append('{')
                  .append("\"videoId\":\"").append(jsEscape(videoId)).append('"')
                  .append(",\"title\":\"").append(jsEscape(s.getName())).append('"')
                  .append(",\"artist\":\"").append(jsEscape(s.getUploaderName())).append('"')
                  .append(",\"album\":\"").append(jsEscape(info.getName())).append('"')
                  .append(",\"duration\":\"").append(formatDuration(s.getDuration())).append('"')
                  .append(",\"durationSec\":").append(s.getDuration())
                  .append(",\"thumbnail\":\"https://i.ytimg.com/vi/")
                  .append(jsEscape(videoId)).append("/hqdefault.jpg\"")
                  .append('}');
                count++;
                if (count >= 100) break;
            }
            sb.append("],\"count\":").append(count).append('}');
            Log.d(TAG, "Playlist resolved (NewPipe) '" + listId + "' → " + count + " tracks");
            return sb.toString();
        } catch (Exception e) {
            Log.w(TAG, "Playlist resolve failed: " + e);
            throw new IOException("Playlist not found, private, or unreachable", e);
        }
    }

    /**
     * v3.17: typed YouTube Music search — songs (default), playlists, artists.
     * Items carry a "kind" field so the WebView can render each correctly.
     */
    public static String searchAny(String query, String type) throws IOException {
        if (query == null || query.trim().isEmpty()) return "[]";
        ensureInitialized();
        boolean wantPlaylists = "playlists".equals(type);
        boolean wantArtists = "artists".equals(type);
        try {
            YoutubeService yt = (YoutubeService) ServiceList.YouTube;
            String filter = wantPlaylists ? YoutubeSearchQueryHandlerFactory.MUSIC_PLAYLISTS
                    : wantArtists ? YoutubeSearchQueryHandlerFactory.MUSIC_ARTISTS
                    : YoutubeSearchQueryHandlerFactory.MUSIC_SONGS;
            SearchQueryHandler qh = yt.getSearchQHFactory()
                    .fromQuery(query, java.util.Collections.singletonList(filter), "");
            SearchInfo info = SearchInfo.getInfo(yt, qh);

            StringBuilder sb = new StringBuilder("[");
            int count = 0;
            for (InfoItem item : info.getRelatedItems()) {
                if (wantArtists && item instanceof ChannelInfoItem) {
                    ChannelInfoItem c = (ChannelInfoItem) item;
                    if (count > 0) sb.append(',');
                    sb.append('{')
                      .append("\"kind\":\"artist\"")
                      .append(",\"name\":\"").append(jsEscape(c.getName())).append('"')
                      .append(",\"subs\":").append(c.getSubscriberCount())
                      .append(",\"thumbnail\":\"").append(jsEscape(firstThumb(c.getThumbnails()))).append('"')
                      .append('}');
                    count++;
                } else if (wantPlaylists && item instanceof PlaylistInfoItem) {
                    PlaylistInfoItem p = (PlaylistInfoItem) item;
                    String listId = extractListId(p.getUrl());
                    if (listId == null) continue;
                    if (count > 0) sb.append(',');
                    sb.append('{')
                      .append("\"kind\":\"playlist\"")
                      .append(",\"playlistId\":\"").append(jsEscape(listId)).append('"')
                      .append(",\"name\":\"").append(jsEscape(p.getName())).append('"')
                      .append(",\"creator\":\"").append(jsEscape(p.getUploaderName())).append('"')
                      .append(",\"thumbnail\":\"").append(jsEscape(firstThumb(p.getThumbnails()))).append('"')
                      .append('}');
                    count++;
                } else if (!wantArtists && !wantPlaylists && item instanceof StreamInfoItem) {
                    StreamInfoItem s = (StreamInfoItem) item;
                    if (s.getStreamType() != StreamType.VIDEO_STREAM) continue;
                    String videoId = extractVideoId(s.getUrl());
                    if (videoId == null) continue;
                    if (count > 0) sb.append(',');
                    sb.append('{')
                      .append("\"kind\":\"song\"")
                      .append(",\"videoId\":\"").append(jsEscape(videoId)).append('"')
                      .append(",\"title\":\"").append(jsEscape(s.getName())).append('"')
                      .append(",\"artist\":\"").append(jsEscape(s.getUploaderName())).append('"')
                      .append(",\"duration\":\"").append(formatDuration(s.getDuration())).append('"')
                      .append(",\"durationSec\":").append(s.getDuration())
                      .append(",\"thumbnail\":\"https://i.ytimg.com/vi/")
                      .append(jsEscape(videoId)).append("/hqdefault.jpg\"")
                      .append('}');
                    count++;
                }
                if (count >= 20) break;
            }
            sb.append(']');
            Log.d(TAG, "Native search(" + type + ") '" + query + "' → " + count + " results");
            return sb.toString();
        } catch (IOException e) {
            throw e;
        } catch (Exception e) {
            Log.w(TAG, "Native typed search failed: " + e);
            throw new IOException("Search failed: " + e.getMessage(), e);
        }
    }

    private static String formatDuration(long seconds) {
        if (seconds <= 0) return "0:00";
        long m = seconds / 60;
        long s = seconds % 60;
        return m + ":" + String.format(java.util.Locale.US, "%02d", s);
    }

    private static String jsEscape(String s) {
        if (s == null) return "";
        return s.replace("\\", "\\\\").replace("\"", "\\\"")
                .replace("\n", " ").replace("\r", " ").replace("\t", " ");
    }

    /**
     * Prefers higher bitrate; prefers opus/m4a (progressive) over HLS manifests.
     * With preferHigh, bitrate dominates even more (for offline downloads).
     */
    private static AudioStream pickBestAudio(List<AudioStream> streams, boolean preferHigh, String quality) {
        // v3.12.4: the user's setting must produce a DIFFERENT stream:
        //   saver    → the LOWEST bitrate stream (data saver)
        //   standard → closest to ~128 kbps
        //   high     → the HIGHEST bitrate stream available
        // v3.20.6: "saver" is the name the UI sends; "low" is the legacy alias.
        String q = normalizeQuality(quality);
        if (preferHigh) q = "high"; // downloads keep their aggressive path

        AudioStream best = null;
        int bestScore = Integer.MIN_VALUE;
        for (AudioStream s : streams) {
            String url = s.getUrl();
            if (url == null || url.isEmpty()) continue;
            boolean isManifest = url.contains(".m3u8");
            int bitrate = s.getAverageBitrate();
            int score;
            switch (q) {
                case "saver":
                case "low":
                    score = -bitrate;                       // smallest wins
                    break;
                case "high":
                    score = bitrate;                        // largest wins
                    break;
                default:                                    // standard ~128
                    score = 256 - Math.abs(bitrate - 128);
                    break;
            }
            if (isManifest) score -= (preferHigh ? 64 : 96); // prefer plain progressive streams
            String suffix = s.getFormat() != null ? s.getFormat().getSuffix() : "";
            if ("opus".equals(suffix) || "webm".equals(suffix)) score += 4;
            if (score > bestScore) {
                bestScore = score;
                best = s;
            }
        }
        return best;
    }

    private static void ensureInitialized() throws IOException {
        synchronized (INIT_LOCK) {
            if (initialized) return;
            NewPipe.init(new OkHttpDownloader());
            initialized = true;
            Log.d(TAG, "NewPipe initialized");
        }
    }

    /** JSONObject.put declares a checked JSONException — swallow it here. */
    private static void put(org.json.JSONObject obj, String key, Object value) {
        try { obj.put(key, value); } catch (Exception ignored) { }
    }

    /** JSONArray.put never throws in this API level, but keep it symmetrical. */
    private static void put(org.json.JSONArray arr, Object value) {
        arr.put(value);
    }

    // ---------------- v3.21: artist & album pages ----------------

    /** InnerTube client block shared by the artist/album browse calls. */
    private static final String TUBE_CONTEXT =
            "\"context\":{\"client\":{\"clientName\":\"WEB_REMIX\","
                    + "\"clientVersion\":\"1.20240101.01.00\",\"hl\":\"en\",\"gl\":\"IN\"}}";

    /** POSTs a JSON body to a music.youtube.com InnerTube endpoint. */
    private static org.json.JSONObject innerTube(String endpoint, String payloadJson) throws IOException {
        OkHttpClient client = new OkHttpClient.Builder()
                .connectTimeout(12, TimeUnit.SECONDS)
                .readTimeout(20, TimeUnit.SECONDS)
                .build();
        okhttp3.Request req = new okhttp3.Request.Builder()
                .url("https://music.youtube.com/youtubei/v1/" + endpoint + "?key="
                        + "AIzaSyC9XL3ZjWddXya6X74dJoCTL-WEYFDNX30" + "&prettyPrint=false")
                .header("Content-Type", "application/json")
                .header("User-Agent", USER_AGENT)
                .header("Accept-Language", "en-US,en;q=0.9")
                .header("Cookie", "CONSENT=YES+cb.20240101-01-p0.en+FX+700; SOCS=CAI")
                .header("Origin", "https://music.youtube.com")
                .post(RequestBody.create(null,
                        payloadJson.getBytes(java.nio.charset.StandardCharsets.UTF_8)))
                .build();
        okhttp3.Response resp = client.newCall(req).execute();
        String body = resp.body() != null ? resp.body().string() : "";
        if (resp.code() != 200) throw new IOException("HTTP " + resp.code());
        try {
            return new org.json.JSONObject(body);
        } catch (Exception e) {
            throw new IOException("response was not JSON", e);
        }
    }

    /** Depth-first visitor over every object node of an InnerTube response. */
    private interface JsonVisitor { void visit(org.json.JSONObject node); }

    private static void walkJson(Object node, JsonVisitor visitor) {
        if (node == null) return;
        if (node instanceof org.json.JSONArray) {
            org.json.JSONArray arr = (org.json.JSONArray) node;
            for (int i = 0; i < arr.length(); i++) walkJson(arr.opt(i), visitor);
            return;
        }
        if (!(node instanceof org.json.JSONObject)) return;
        org.json.JSONObject obj = (org.json.JSONObject) node;
        visitor.visit(obj);
        java.util.Iterator<String> keys = obj.keys();
        while (keys.hasNext()) walkJson(obj.opt(keys.next()), visitor);
    }

    /** Text of flexColumns[index] in a musicResponsiveListItemRenderer row. */
    private static String flexText(org.json.JSONArray cols, int index) {
        if (cols == null || index >= cols.length()) return "";
        org.json.JSONObject col = cols.optJSONObject(index);
        col = col == null ? null : col.optJSONObject("musicResponsiveListItemFlexColumnRenderer");
        return runsText(col == null ? null : col.optJSONObject("text"));
    }

    /** "m:ss" duration held in the row's fixedColumns (0 when absent). */
    private static long fixedDurationSec(org.json.JSONObject row) {
        org.json.JSONArray fixed = row.optJSONArray("fixedColumns");
        if (fixed == null) return 0;
        for (int i = 0; i < fixed.length(); i++) {
            org.json.JSONObject col = fixed.optJSONObject(i);
            col = col == null ? null : col.optJSONObject("musicResponsiveListItemFixedColumnRenderer");
            long sec = parseDuration(runsText(col == null ? null : col.optJSONObject("text")));
            if (sec > 0) return sec;
        }
        return 0;
    }

    /**
     * Track rows from an artist/album browse response (document order, de-duped).
     * Both page types use musicResponsiveListItemRenderer rows with
     * playlistItemData.videoId + flexColumns, so one collector serves both.
     */
    private static org.json.JSONArray collectShelfTracks(org.json.JSONObject root, int limit) {
        final org.json.JSONArray out = new org.json.JSONArray();
        final java.util.Set<String> seen = new java.util.HashSet<>();
        walkJson(root, node -> {
            if (out.length() >= limit) return;
            org.json.JSONObject row = node.optJSONObject("musicResponsiveListItemRenderer");
            if (row == null) return;
            org.json.JSONObject itemData = row.optJSONObject("playlistItemData");
            String videoId = itemData == null ? "" : itemData.optString("videoId", "");
            if (videoId.isEmpty() || !seen.add(videoId)) return;
            org.json.JSONArray cols = row.optJSONArray("flexColumns");
            String title = flexText(cols, 0);
            if (title.isEmpty()) return;
            long dur = fixedDurationSec(row);
            org.json.JSONObject track = new org.json.JSONObject();
            put(track, "videoId", videoId);
            put(track, "title", title);
            put(track, "artist", flexText(cols, 1));
            put(track, "album", "");
            put(track, "duration", dur > 0 ? formatDuration(dur) : "3:30");
            put(track, "durationSec", dur > 0 ? dur : 180);
            // Artist "Top songs" rows carry no duration; say so instead of
            // letting the UI present the 3:30 placeholder as a real length.
            put(track, "durationKnown", dur > 0);
            put(track, "thumbnail", "https://i.ytimg.com/vi/" + videoId + "/hqdefault.jpg");
            put(out, track);
        });
        return out;
    }

    /** Album/single cards from the artist page's horizontal carousels. */
    private static org.json.JSONArray collectShelfAlbums(org.json.JSONObject root, int limit) {
        final org.json.JSONArray out = new org.json.JSONArray();
        final java.util.Set<String> seen = new java.util.HashSet<>();
        walkJson(root, node -> {
            if (out.length() >= limit) return;
            org.json.JSONObject shelf = node.optJSONObject("musicCarouselShelfRenderer");
            if (shelf == null) return;
            org.json.JSONObject header = shelf.optJSONObject("header");
            header = header == null ? null : header.optJSONObject("musicCarouselShelfBasicHeaderRenderer");
            String heading = runsText(header == null ? null : header.optJSONObject("title"));
            String lower = heading.toLowerCase(java.util.Locale.ROOT);
            if (!lower.contains("album") && !lower.contains("single")
                    && !lower.contains("ep")) return;
            org.json.JSONArray contents = shelf.optJSONArray("contents");
            if (contents == null) return;
            for (int i = 0; i < contents.length() && out.length() < limit; i++) {
                org.json.JSONObject item = contents.optJSONObject(i);
                item = item == null ? null : item.optJSONObject("musicTwoRowItemRenderer");
                if (item == null) continue;
                String albumId = pathBrowseId(item.optJSONObject("navigationEndpoint"));
                if (albumId == null || !albumId.startsWith("MPRE")) continue;
                if (!seen.add(albumId)) continue;
                org.json.JSONObject thumbRenderer = item.optJSONObject("thumbnailRenderer");
                thumbRenderer = thumbRenderer == null ? null
                        : thumbRenderer.optJSONObject("musicThumbnailRenderer");
                org.json.JSONObject thumb = thumbRenderer == null ? null
                        : thumbRenderer.optJSONObject("thumbnail");
                org.json.JSONObject album = new org.json.JSONObject();
                put(album, "albumId", albumId);
                put(album, "title", runsText(item.optJSONObject("title")));
                put(album, "year", runsText(item.optJSONObject("subtitle")));
                put(album, "thumbnail", bestThumb(thumb == null ? null
                        : thumb.optJSONArray("thumbnails")));
                put(out, album);
            }
        });
        return out;
    }

    /**
     * v3.21: artist page — header, top songs and albums/singles.
     * Returns JSON {name, artistId, thumbnail, songs[], albums[]}.
     */
    public static String fetchArtist(String name) throws IOException {
        if (name == null || name.trim().isEmpty()) throw new IOException("Empty artist name");
        ensureInitialized();
        String searchPayload = "{\"query\":\"" + jsEscape(name.trim())
                + "\",\"params\":\"EgWKAQIgAWoKEAUQCRADEAQQCg%3D%3D\"," + TUBE_CONTEXT + "}";
        org.json.JSONObject searchRoot = innerTube("search", searchPayload);

        final String[] artistId = {""};
        final String[] matchedName = {""};
        walkJson(searchRoot, node -> {
            if (!artistId[0].isEmpty()) return;
            org.json.JSONObject row = node.optJSONObject("musicResponsiveListItemRenderer");
            if (row == null) return;
            String id = pathBrowseId(row.optJSONObject("navigationEndpoint"));
            if (id == null || !id.startsWith("UC")) return;
            artistId[0] = id;
            matchedName[0] = flexText(row.optJSONArray("flexColumns"), 0);
        });
        if (artistId[0].isEmpty()) throw new IOException("No artist found for " + name);

        org.json.JSONObject root = innerTube("browse",
                "{\"browseId\":\"" + jsEscape(artistId[0]) + "\"," + TUBE_CONTEXT + "}");

        final String[] headerName = {matchedName[0].isEmpty() ? name.trim() : matchedName[0]};
        final String[] thumbnail = {""};
        final boolean[] headerSeen = {false};
        walkJson(root, node -> {
            if (headerSeen[0]) return;
            org.json.JSONObject header = node.optJSONObject("musicImmersiveHeaderRenderer");
            if (header == null) return;
            headerSeen[0] = true;
            String title = runsText(header.optJSONObject("title"));
            if (!title.isEmpty()) headerName[0] = title;
            org.json.JSONObject tr = header.optJSONObject("thumbnail");
            tr = tr == null ? null : tr.optJSONObject("musicThumbnailRenderer");
            org.json.JSONObject th = tr == null ? null : tr.optJSONObject("thumbnail");
            String url = bestThumb(th == null ? null : th.optJSONArray("thumbnails"));
            if (!url.isEmpty()) thumbnail[0] = url;
        });

        org.json.JSONArray songs = collectShelfTracks(root, 25);
        org.json.JSONArray albums = collectShelfAlbums(root, 12);
        if (thumbnail[0].isEmpty() && songs.length() > 0) {
            thumbnail[0] = songs.optJSONObject(0).optString("thumbnail", "");
        }

        org.json.JSONObject out = new org.json.JSONObject();
        put(out, "name", headerName[0]);
        put(out, "artistId", artistId[0]);
        put(out, "thumbnail", thumbnail[0]);
        put(out, "songs", songs);
        put(out, "albums", albums);
        Log.d(TAG, "Artist '" + headerName[0] + "' → " + songs.length()
                + " songs, " + albums.length() + " albums");
        return out.toString();
    }

    /**
     * v3.21: album/EP track list. Returns JSON
     * {albumId, name, artist, year, thumbnail, tracks[]}.
     */
    public static String fetchAlbum(String albumId) throws IOException {
        if (albumId == null || !albumId.startsWith("MPRE"))
            throw new IOException("Not an album id");
        ensureInitialized();
        org.json.JSONObject root = innerTube("browse",
                "{\"browseId\":\"" + jsEscape(albumId) + "\"," + TUBE_CONTEXT + "}");

        final String[] name = {""};
        final String[] year = {""};
        final String[] artist = {""};
        final String[] thumbnail = {""};
        final boolean[] headerSeen = {false};
        walkJson(root, node -> {
            if (headerSeen[0]) return;
            org.json.JSONObject header = node.optJSONObject("musicResponsiveHeaderRenderer");
            if (header == null) header = node.optJSONObject("musicDetailHeaderRenderer");
            if (header == null) return;
            headerSeen[0] = true;
            name[0] = runsText(header.optJSONObject("title"));
            org.json.JSONObject subtitle = header.optJSONObject("subtitle");
            String subText = runsText(subtitle);
            java.util.regex.Matcher m = java.util.regex.Pattern
                    .compile("(19|20)\\d{2}").matcher(subText);
            if (m.find()) year[0] = m.group();
            org.json.JSONObject strapline = header.optJSONObject("straplineTextOne");
            org.json.JSONArray runs = strapline == null ? null : strapline.optJSONArray("runs");
            if (runs != null) {
                for (int i = 0; i < runs.length(); i++) {
                    org.json.JSONObject run = runs.optJSONObject(i);
                    String text = run == null ? "" : run.optString("text", "");
                    if (!text.isEmpty()) { artist[0] = text; break; }
                }
            }
            org.json.JSONObject tr = header.optJSONObject("thumbnail");
            tr = tr == null ? null : tr.optJSONObject("musicThumbnailRenderer");
            org.json.JSONObject th = tr == null ? null : tr.optJSONObject("thumbnail");
            thumbnail[0] = bestThumb(th == null ? null : th.optJSONArray("thumbnails"));
        });

        org.json.JSONArray tracks = collectShelfTracks(root, 60);
        if (name[0].isEmpty()) name[0] = "Album";
        for (int i = 0; i < tracks.length(); i++) {
            org.json.JSONObject t = tracks.optJSONObject(i);
            if (t != null) put(t, "album", name[0]);
        }
        if (thumbnail[0].isEmpty() && tracks.length() > 0) {
            thumbnail[0] = tracks.optJSONObject(0).optString("thumbnail", "");
        }

        org.json.JSONObject out = new org.json.JSONObject();
        put(out, "albumId", albumId);
        put(out, "name", name[0]);
        put(out, "artist", artist[0]);
        put(out, "year", year[0]);
        put(out, "thumbnail", thumbnail[0]);
        put(out, "tracks", tracks);
        Log.d(TAG, "Album '" + name[0] + "' → " + tracks.length() + " tracks");
        return out.toString();
    }

    private static final String YT_URL_BASE = "https://www.youtube.com/watch?v=";

    /** Minimal Downloader backed by OkHttp; no captcha widget support (falls back to iframe). */
    private static final class OkHttpDownloader extends Downloader {
        private final OkHttpClient client = new OkHttpClient.Builder()
                .connectTimeout(12, TimeUnit.SECONDS)
                .readTimeout(20, TimeUnit.SECONDS)
                .followRedirects(true)
                .build();

        @Override
        public Response execute(Request request) throws IOException, ReCaptchaException {
            okhttp3.Request.Builder rb = new okhttp3.Request.Builder()
                    .url(request.url())
                    .header("User-Agent", USER_AGENT)
                    .header("Accept-Language", "en-US,en;q=0.9");
            // v3.17.1: YouTube serves a EU-consent interstitial to cookieless
            // clients; the playlist page then has no ytInitialData and the
            // extractor NPEs (search pages tolerate it, playlist pages don't).
            // Send the standard consent cookies unless the extractor set its own.
            boolean hasCookie = false;
            Map<String, List<String>> preHeaders = request.headers();
            if (preHeaders != null) {
                for (Map.Entry<String, List<String>> entry : preHeaders.entrySet()) {
                    if (entry.getKey() != null && entry.getKey().equalsIgnoreCase("Cookie")
                            && entry.getValue() != null && !entry.getValue().isEmpty()) {
                        hasCookie = true;
                        break;
                    }
                }
            }
            if (!hasCookie) {
                rb.header("Cookie", "CONSENT=YES+cb.20240101-01-p0.en+FX+700; SOCS=CAI");
            }
            Map<String, List<String>> headers = request.headers();
            if (headers != null) {
                for (Map.Entry<String, List<String>> entry : headers.entrySet()) {
                    if (entry.getValue() == null) continue;
                    for (String value : entry.getValue()) {
                        rb.header(entry.getKey(), value);
                    }
                }
            }
            byte[] body = request.dataToSend();
            if (body != null && body.length > 0) {
                rb.post(RequestBody.create(null, body));
            }

            okhttp3.Response resp = client.newCall(rb.build()).execute();
            ResponseBody rb2 = resp.body();
            String responseBody = rb2 != null ? rb2.string() : "";

            int code = resp.code();
            if (code == 429 || code == 403) {
                throw new ReCaptchaException("reCaptcha Challenge", request.url());
            }
            return new Response(code, resp.message(), resp.headers().toMultimap(), responseBody,
                    request.url());
        }
    }
}
