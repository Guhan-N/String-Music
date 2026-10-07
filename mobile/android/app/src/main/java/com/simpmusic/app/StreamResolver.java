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

    /** videoId → resolved stream URL. */
    private static final Map<String, String> CACHE = new LinkedHashMap<>();
    private static final int CACHE_MAX = 24;

    /** v3.12.4: videoId → chosen average bitrate (kbps) for the UI badge. */
    private static final Map<String, Integer> BITRATES = new LinkedHashMap<>();

    /**
     * v3.12.2: user-selected audio quality ("low" | "standard" | "high").
     * Changing it invalidates the cache so the next resolve re-picks streams.
     */
    private static volatile String quality = "standard";

    private StreamResolver() {}

    public static void setQuality(String q) {
        String nq = (q == null) ? "standard" : q;
        if ("low".equals(nq) || "high".equals(nq)) nq = nq;
        else nq = "standard";
        if (!nq.equals(quality)) {
            quality = nq;
            synchronized (CACHE) { CACHE.clear(); }
            Log.d(TAG, "Audio quality set to " + nq + " (cache cleared)");
        }
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
        String cacheKey = videoId + "@" + quality;
        synchronized (CACHE) {
            String cached = CACHE.get(cacheKey);
            if (cached != null) return cached;
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
                if (CACHE.size() >= CACHE_MAX) {
                    // Drop the oldest entry (insertion order)
                    String oldest = CACHE.keySet().iterator().next();
                    CACHE.remove(oldest);
                    String oldestBr = BITRATES.keySet().iterator().next();
                    BITRATES.remove(oldestBr);
                }
                CACHE.put(cacheKey, best.getUrl());
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
            if (cached != null) return cached;
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
            if (best == null) throw new IOException("No usable audio stream found");

            synchronized (CACHE) {
                if (CACHE.size() >= CACHE_MAX) {
                    String oldest = CACHE.keySet().iterator().next();
                    CACHE.remove(oldest);
                }
                CACHE.put(cacheKey, best);
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

    /** Clears cached URLs (e.g. when extraction errors suggest stale URLs). */
    public static void invalidate(String videoId) {
        synchronized (CACHE) {
            CACHE.remove(videoId);
        }
    }

    /** True when a stream URL for this video id is already cached. */
    public static boolean isCached(String videoId) {
        if (videoId == null || videoId.isEmpty()) return false;
        synchronized (CACHE) {
            return CACHE.containsKey(videoId);
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
        //   low      → the LOWEST bitrate stream (data saver)
        //   standard → closest to ~128 kbps
        //   high     → the HIGHEST bitrate stream available
        String q = quality != null ? quality : "standard";
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
