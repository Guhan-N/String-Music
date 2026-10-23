/**
 * Music Metadata Scraper & Lyrics Service
 * Zero API keys required - Uses YouTube Music Web Remix API and LRCLIB
 */

const YTM_URL = 'https://www.youtube.com/youtubei/v1/search';
const YTM_HEADERS = {
  'Content-Type': 'application/json',
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
  'X-YouTube-Client-Name': '67',
  'X-YouTube-Client-Version': '1.20240101.01.00',
  'Origin': 'https://music.youtube.com',
  'Referer': 'https://music.youtube.com/'
};

/**
 * Clean and upgrade thumbnail resolution
 */
function upgradeThumbnail(url, videoId) {
  if (!url && videoId) return `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`;
  if (!url) return 'https://images.unsplash.com/photo-1511671782779-c97d3d27a1d4?w=600&auto=format&fit=crop&q=80';
  
  if (url.includes('googleusercontent.com') || url.includes('ggpht.com')) {
    return url.replace(/=w\d+-h\d+[^&]*/, '=w544-h544-l90-rj');
  }
  if (url.includes('i.ytimg.com/vi/')) {
    return url.split('?')[0].replace(/hqdefault|mqdefault|default/, 'hqdefault');
  }
  return url;
}

/**
 * Convert time string "mm:ss" or "hh:mm:ss" to seconds
 */
function parseDurationSec(durationStr) {
  if (!durationStr || typeof durationStr !== 'string') return 180;
  const parts = durationStr.trim().split(':').map(p => parseInt(p, 10));
  if (parts.length === 2 && !isNaN(parts[0]) && !isNaN(parts[1])) {
    return parts[0] * 60 + parts[1];
  } else if (parts.length === 3 && !isNaN(parts[0]) && !isNaN(parts[1]) && !isNaN(parts[2])) {
    return parts[0] * 3600 + parts[1] * 60 + parts[2];
  }
  return 180;
}

/**
 * High-performance In-Memory TTL Cache
 */
const memoryCache = new Map();

function getCached(key) {
  const item = memoryCache.get(key);
  if (!item) return null;
  if (Date.now() > item.expiry) {
    memoryCache.delete(key);
    return null;
  }
  return item.value;
}

function setCached(key, value, ttlMs = 15 * 60 * 1000) {
  if (memoryCache.size > 2000) {
    const firstKey = memoryCache.keys().next().value;
    memoryCache.delete(firstKey);
  }
  memoryCache.set(key, { value, expiry: Date.now() + ttlMs });
}

/**
 * Search YouTube Music (WEB_REMIX)
 */
async function searchSongs(query, filter = null) {
  if (!query || !query.trim()) return [];
  const cacheKey = `search:${filter || 'all'}:${query.trim().toLowerCase()}`;
  const cached = getCached(cacheKey);
  if (cached) return cached;

  try {
    const postBody = {
      context: {
        client: {
          clientName: 'WEB_REMIX',
          clientVersion: '1.20240101.01.00',
          hl: 'en',
          gl: 'US'
        }
      },
      query: query.trim()
    };

    if (filter === 'songs') {
      // Use YouTube music song filter only if needed
      postBody.params = 'EgWKAQIIAWoKEAUQCRADEAQQCg%3D%3D';
    }

    const response = await fetch(YTM_URL, {
      method: 'POST',
      headers: YTM_HEADERS,
      body: JSON.stringify(postBody)
    });

    if (!response.ok) {
      throw new Error(`YouTube API returned status ${response.status}`);
    }

    const data = await response.json();
    let results = [];
    const seenIds = new Set();

    const sections = data.contents?.tabbedSearchResultsRenderer?.tabs?.[0]?.tabRenderer?.content?.sectionListRenderer?.contents || [];

    for (const sec of sections) {
      // 1. Check musicCardShelfRenderer (Top result card)
      if (sec.musicCardShelfRenderer) {
        const card = sec.musicCardShelfRenderer;
        const vid = card.title?.runs?.[0]?.navigationEndpoint?.watchEndpoint?.videoId ||
                    card.buttons?.[0]?.buttonRenderer?.command?.watchEndpoint?.videoId ||
                    card.onTap?.watchEndpoint?.videoId;
        const title = card.title?.runs?.[0]?.text;
        const subRuns = card.subtitle?.runs || [];

        let artist = 'Artist';
        let album = 'Single';
        let duration = '3:30';

        subRuns.forEach(r => {
          if (r.navigationEndpoint?.browseEndpoint) artist = r.text;
          if (/^\d{1,2}:\d{2}$/.test(r.text?.trim())) duration = r.text.trim();
        });

        const thumb = card.thumbnail?.musicThumbnailRenderer?.thumbnail?.thumbnails?.slice(-1)[0]?.url;

        if (vid && title && !seenIds.has(vid)) {
          seenIds.add(vid);
          results.push({
            videoId: vid,
            title: title.replace(/&amp;/g, '&'),
            artist: artist.replace(/&amp;/g, '&'),
            album: album.replace(/&amp;/g, '&'),
            duration,
            durationSec: parseDurationSec(duration),
            thumbnail: upgradeThumbnail(thumb, vid)
          });
        }
      }

      // 2. Check itemSectionRenderer and musicShelfRenderer
      const items = sec.itemSectionRenderer?.contents || sec.musicShelfRenderer?.contents || [];
      for (const item of items) {
        const r = item.musicResponsiveListItemRenderer;
        if (!r) continue;

        const vid = r.overlay?.musicItemThumbnailOverlayRenderer?.content?.musicPlayButtonRenderer?.playNavigationEndpoint?.watchEndpoint?.videoId ||
                    r.navigationEndpoint?.watchEndpoint?.videoId ||
                    r.flexColumns?.[0]?.musicResponsiveListItemFlexColumnRenderer?.text?.runs?.[0]?.navigationEndpoint?.watchEndpoint?.videoId ||
                    r.playlistItemData?.videoId;

        if (!vid || seenIds.has(vid)) continue;

        const title = r.flexColumns?.[0]?.musicResponsiveListItemFlexColumnRenderer?.text?.runs?.[0]?.text || 'Track';
        const col1Runs = r.flexColumns?.[1]?.musicResponsiveListItemFlexColumnRenderer?.text?.runs || [];
        
        let artist = '';
        let album = '';
        let duration = '';

        for (const run of col1Runs) {
          const txt = run.text?.trim();
          if (!txt || txt === '•' || txt === '&' || txt === ',') continue;
          if (/^\d{1,2}:\d{2}$/.test(txt)) {
            duration = txt;
          } else if (run.navigationEndpoint?.browseEndpoint?.browseEndpointContextSupportedConfigs?.browseEndpointContextMusicConfig?.pageType === 'MUSIC_PAGE_TYPE_ARTIST') {
            artist = txt;
          } else if (run.navigationEndpoint?.browseEndpoint?.browseEndpointContextSupportedConfigs?.browseEndpointContextMusicConfig?.pageType === 'MUSIC_PAGE_TYPE_ALBUM') {
            album = txt;
          } else if (!artist && txt !== 'Song' && txt !== 'Video') {
            artist = txt;
          } else if (artist && !album && txt !== 'Song' && txt !== 'Video' && !txt.includes('plays') && !txt.includes('views')) {
            album = txt;
          }
        }

        if (!artist) artist = 'Artist';
        if (!album) album = title;
        if (!duration) duration = '3:20';

        const thumb = r.thumbnail?.musicThumbnailRenderer?.thumbnail?.thumbnails?.slice(-1)[0]?.url;

        seenIds.add(vid);
        results.push({
          videoId: vid,
          title: title.replace(/&amp;/g, '&'),
          artist: artist.replace(/&amp;/g, '&'),
          album: album.replace(/&amp;/g, '&'),
          duration,
          durationSec: parseDurationSec(duration),
          thumbnail: upgradeThumbnail(thumb, vid)
        });
      }
    }

    // If results is empty and filter was specified, retry without filter
    if (results.length === 0 && filter) {
      return await searchSongs(query, null);
    }

    if (results.length > 0) {
      setCached(cacheKey, results, 15 * 60 * 1000); // 15 mins cache
    }
    return results;
  } catch (err) {
    console.error('Error searching YouTube Music:', err.message);
    return [];
  }
}

/**
 * Autocomplete suggestions
 */
async function getSuggestions(query) {
  if (!query || query.trim().length === 0) return [];
  const cacheKey = `sugg:${query.trim().toLowerCase()}`;
  const cached = getCached(cacheKey);
  if (cached) return cached;

  try {
    const url = `https://suggestqueries-clients6.youtube.com/complete/search?client=youtube&ds=yt&q=${encodeURIComponent(query.trim())}`;
    const res = await fetch(url);
    const text = await res.text();
    const match = text.match(/\[.*\]/s);
    if (match) {
      const parsed = JSON.parse(match[0]);
      if (Array.isArray(parsed[1])) {
        const suggestions = parsed[1].map(item => item[0]).filter(Boolean).slice(0, 8);
        setCached(cacheKey, suggestions, 30 * 60 * 1000);
        return suggestions;
      }
    }
    return [];
  } catch (err) {
    console.error('Error fetching suggestions:', err.message);
    return [];
  }
}

/**
 * Curated trending charts by genre
 */
const GENRE_QUERIES = {
  'global': 'Top 50 Global Songs',
  'chill': 'Lofi Beats Chill Vibe',
  'pop': 'Top Pop Hits Trending',
  'hiphop': 'Hip Hop Hits Rap',
  'rock': 'Rock Classics Hits',
  'indie': 'Indie Alternative Chill Hits',
  // Language categories (drives the one-time category picker)
  'tamil': 'Tamil Latest Hit Songs',
  'english': 'English Top Hits Songs',
  'hindi': 'Hindi Latest Hit Songs',
  'marathi': 'Marathi Latest Hit Songs',
  'telugu': 'Telugu Latest Hit Songs',
  'malayalam': 'Malayalam Latest Hit Songs',
  'kannada': 'Kannada Latest Hit Songs',
  'punjabi': 'Punjabi Latest Hit Songs'
};

async function getTrending(genre = 'global') {
  if (genre.toLowerCase() === 'sweetener') {
    return [
      { videoId: '2bJKg73Q_S4', title: '!!!!!!!', artist: 'Billie Eilish', album: 'Sweetener', duration: '0:14', durationSec: 14, thumbnail: 'icons/sweetener_cover.png' },
      { videoId: 'DyDfgMOUjCI', title: 'bad guy', artist: 'Billie Eilish', album: 'Sweetener', duration: '3:14', durationSec: 194, thumbnail: 'icons/sweetener_cover.png' },
      { videoId: 'LZyybvVx-js', title: 'xanny', artist: 'Billie Eilish', album: 'Sweetener', duration: '4:03', durationSec: 243, thumbnail: 'icons/sweetener_cover.png' },
      { videoId: 'Ah0Ys50CqO8', title: 'you should see me in a crown', artist: 'Billie Eilish', album: 'Sweetener', duration: '3:01', durationSec: 181, thumbnail: 'icons/sweetener_cover.png' },
      { videoId: '-PZsSWwc9xA', title: 'all the good girls to to hell', artist: 'Billie Eilish', album: 'Sweetener', duration: '2:49', durationSec: 169, thumbnail: 'icons/sweetener_cover.png' },
      { videoId: 'yaJx0Gj_lcY', title: 'wish you were gay', artist: 'Billie Eilish', album: 'Sweetener', duration: '3:42', durationSec: 222, thumbnail: 'icons/sweetener_cover.png' },
      { videoId: 'V1Pl8CzNzCw', title: '!!!!', artist: 'Billie Eilish', album: 'Sweetener', duration: '3:20', durationSec: 200, thumbnail: 'icons/sweetener_cover.png' },
      { videoId: 'pbMwTqkKSps', title: "when the party's over", artist: 'Billie Eilish', album: 'Sweetener', duration: '3:16', durationSec: 196, thumbnail: 'icons/sweetener_cover.png' }
    ];
  }

  const cacheKey = `trending:${genre.toLowerCase()}`;
  const cached = getCached(cacheKey);
  if (cached) return cached;

  const query = GENRE_QUERIES[genre.toLowerCase()] || GENRE_QUERIES['global'];
  const tracks = await searchSongs(query, null);
  if (tracks && tracks.length > 0) {
    setCached(cacheKey, tracks, 30 * 60 * 1000); // 30 mins cache
  }
  return tracks;
}

/**
 * Parse .lrc synchronized string into array of { time: seconds, text: string }
 */
function parseLrc(lrcText) {
  if (!lrcText) return [];
  const lines = lrcText.split('\n');
  const result = [];
  const timeRegex = /\[(\d{2}):(\d{2})\.(\d{2,3})\](.*)/;

  for (const line of lines) {
    const match = line.match(timeRegex);
    if (match) {
      const minutes = parseInt(match[1], 10);
      const seconds = parseInt(match[2], 10);
      const ms = parseFloat('0.' + match[3]);
      const totalSeconds = minutes * 60 + seconds + ms;
      const text = match[4].trim();
      result.push({
        time: Math.round(totalSeconds * 100) / 100,
        text
      });
    }
  }

  return result.sort((a, b) => a.time - b.time);
}

/**
 * Fetch Synchronized Lyrics from LRCLIB
 */
async function getLyrics(title, artist, duration = 0) {
  if (!title) return { syncedLyrics: null, plainLyrics: null, isSynced: false, parsedLyrics: [] };

  const cleanTitle = title
    .replace(/\(.*?\)/g, '')
    .replace(/\[.*?\]/g, '')
    .replace(/ft\.?.*|feat\.?.*/i, '')
    .trim();

  const cleanArtist = (artist || '').replace(/\(.*?\)/g, '').trim();
  const cacheKey = `lyrics:${cleanTitle.toLowerCase()}:${cleanArtist.toLowerCase()}`;
  const cached = getCached(cacheKey);
  if (cached) return cached;

  try {
    // 1. Try exact match first
    let queryParams = `track_name=${encodeURIComponent(cleanTitle)}&artist_name=${encodeURIComponent(cleanArtist)}`;
    if (duration > 0) {
      queryParams += `&duration=${Math.round(duration)}`;
    }

    let res = await fetch(`https://lrclib.net/api/get?${queryParams}`, {
      headers: { 'User-Agent': 'SimpMusicEcosystem/1.0.0 (https://github.com/simpmusic)' }
    });

    if (res.ok) {
      const data = await res.json();
      if (data.syncedLyrics || data.plainLyrics) {
        const result = {
          id: data.id,
          title: data.trackName,
          artist: data.artistName,
          syncedLyrics: data.syncedLyrics,
          plainLyrics: data.plainLyrics,
          isSynced: !!data.syncedLyrics,
          parsedLyrics: data.syncedLyrics ? parseLrc(data.syncedLyrics) : []
        };
        setCached(cacheKey, result, 2 * 60 * 60 * 1000); // 2 hours cache
        return result;
      }
    }

    // 2. Fallback to LRCLIB Search endpoint
    const searchUrl = `https://lrclib.net/api/search?q=${encodeURIComponent(cleanTitle + ' ' + cleanArtist)}`;
    res = await fetch(searchUrl, {
      headers: { 'User-Agent': 'SimpMusicEcosystem/1.0.0 (https://github.com/simpmusic)' }
    });

    if (res.ok) {
      const searchResults = await res.json();
      if (Array.isArray(searchResults) && searchResults.length > 0) {
        const withSynced = searchResults.find(item => item.syncedLyrics);
        const item = withSynced || searchResults[0];

        const result = {
          id: item.id,
          title: item.trackName,
          artist: item.artistName,
          syncedLyrics: item.syncedLyrics,
          plainLyrics: item.plainLyrics,
          isSynced: !!item.syncedLyrics,
          parsedLyrics: item.syncedLyrics ? parseLrc(item.syncedLyrics) : []
        };
        setCached(cacheKey, result, 2 * 60 * 60 * 1000); // 2 hours cache
        return result;
      }
    }

    return {
      syncedLyrics: null,
      plainLyrics: `Instrumental or no synchronized lyrics found for "${cleanTitle}".`,
      isSynced: false,
      parsedLyrics: []
    };
  } catch (err) {
    console.error('Error fetching lyrics from LRCLIB:', err.message);
    return {
      syncedLyrics: null,
      plainLyrics: 'Lyrics temporarily unavailable.',
      isSynced: false,
      parsedLyrics: []
    };
  }
}

// ---------------------------------------------------------------------------
// v3.21: ARTIST + ALBUM pages
//
// YouTube Music serves both as browse responses: an artist page has an
// immersive header, a "Top songs" shelf and horizontal carousels (Albums,
// Singles & EPs, …); an album page has a detail header and one shelf of rows.
// Rows in both are musicResponsiveListItemRenderer with
// playlistItemData.videoId + flexColumns, so one collector covers them.
// ---------------------------------------------------------------------------
const YTM_BROWSE_URL = 'https://www.youtube.com/youtubei/v1/browse';
const YTM_CLIENT = {
  clientName: 'WEB_REMIX',
  clientVersion: '1.20240101.01.00',
  hl: 'en',
  gl: 'IN'
};
/** Search filter that restricts results to artists. */
const ARTIST_SEARCH_PARAMS = 'EgWKAQIgAWoKEAUQCRADEAQQCg%3D%3D';

async function ytmPost(url, body) {
  const response = await fetch(`${url}?key=AIzaSyC9XL3ZjWddXya6X74dJoCTL-WEYFDNX30&prettyPrint=false`, {
    method: 'POST',
    headers: YTM_HEADERS,
    body: JSON.stringify({ ...body, context: { client: YTM_CLIENT } })
  });
  if (!response.ok) throw new Error(`YouTube API returned status ${response.status}`);
  return response.json();
}

/** Reads an InnerTube text node: runs[].text with a simpleText fallback. */
function textOf(node) {
  if (!node) return '';
  if (Array.isArray(node.runs)) return node.runs.map(r => r.text || '').join('');
  if (typeof node.simpleText === 'string') return node.simpleText;
  return '';
}

/** Depth-first visit of every object node in an InnerTube response. */
function walkJson(node, fn) {
  if (!node) return;
  if (Array.isArray(node)) { node.forEach(n => walkJson(n, fn)); return; }
  if (typeof node !== 'object') return;
  fn(node);
  Object.keys(node).forEach(k => walkJson(node[k], fn));
}

/** "3:24" / "1:02:11" → seconds (0 when unparseable). */
function durationToSec(text) {
  if (!text || !/^\d+:\d{2}(:\d{2})?$/.test(text.trim())) return 0;
  return text.trim().split(':').reduce((acc, p) => acc * 60 + parseInt(p, 10), 0);
}

/** Largest thumbnail in an InnerTube thumbnails array. */
function largestThumb(thumbs) {
  if (!Array.isArray(thumbs) || !thumbs.length) return '';
  let best = '';
  let bestW = -1;
  thumbs.forEach(t => {
    if (t && t.url && (t.width || 0) >= bestW) { bestW = t.width || 0; best = t.url; }
  });
  return upgradeThumbnail(best);
}

/**
 * Pulls every playable row out of an artist/album browse response.
 * Keeps document order and de-dupes by videoId.
 */
function collectBrowseTracks(root, limit = 40) {
  const tracks = [];
  const seen = new Set();
  walkJson(root, node => {
    const row = node.musicResponsiveListItemRenderer;
    if (!row || tracks.length >= limit) return;
    const videoId = row.playlistItemData?.videoId;
    if (!videoId || seen.has(videoId)) return;
    const cols = row.flexColumns || [];
    const title = textOf(cols[0]?.musicResponsiveListItemFlexColumnRenderer?.text);
    if (!title) return;
    const artist = textOf(cols[1]?.musicResponsiveListItemFlexColumnRenderer?.text);
    let durationSec = 0;
    const fixed = row.fixedColumns || [];
    for (const f of fixed) {
      const t = textOf(f?.musicResponsiveListItemFixedColumnRenderer?.text);
      const sec = durationToSec(t);
      if (sec) { durationSec = sec; break; }
    }
    seen.add(videoId);
    tracks.push({
      videoId,
      title,
      artist: artist || '',
      album: '',
      duration: durationSec ? `${Math.floor(durationSec / 60)}:${String(durationSec % 60).padStart(2, '0')}` : '3:30',
      durationSec: durationSec || 180,
      durationKnown: !!durationSec,
      thumbnail: `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`
    });
  });
  return tracks;
}

/** Album/single cards from the artist page's horizontal carousels. */
function collectBrowseAlbums(root, limit = 12) {
  const albums = [];
  const seen = new Set();
  walkJson(root, node => {
    const shelf = node.musicCarouselShelfRenderer;
    if (!shelf || albums.length >= limit) return;
    const heading = textOf(shelf.header?.musicCarouselShelfBasicHeaderRenderer?.title);
    if (!/album|single|ep/i.test(heading)) return;
    (shelf.contents || []).forEach(item => {
      const card = item?.musicTwoRowItemRenderer;
      if (!card) return;
      const albumId = card.navigationEndpoint?.browseEndpoint?.browseId || '';
      const title = textOf(card.title);
      if (!albumId.startsWith('MPRE') || !title || seen.has(albumId)) return;
      seen.add(albumId);
      albums.push({
        albumId,
        title,
        year: textOf(card.subtitle),
        thumbnail: largestThumb(card.thumbnailRenderer?.musicThumbnailRenderer?.thumbnail?.thumbnails)
      });
    });
  });
  return albums;
}

/** First artist channel id for a name (artist-filtered search). */
async function resolveArtistId(name) {
  const data = await ytmPost(YTM_URL, { query: name.trim(), params: ARTIST_SEARCH_PARAMS });
  let artistId = '';
  let matchedName = '';
  walkJson(data, node => {
    if (artistId) return;
    const row = node.musicResponsiveListItemRenderer;
    const id = row?.navigationEndpoint?.browseEndpoint?.browseId;
    if (row && id && id.startsWith('UC')) {
      artistId = id;
      matchedName = textOf(row.flexColumns?.[0]?.musicResponsiveListItemFlexColumnRenderer?.text);
    }
  });
  return { artistId, matchedName };
}

/**
 * Artist page: header + top songs + albums/singles.
 * Resolves to { name, thumbnail, artistId, songs[], albums[] }.
 */
async function getArtist(name) {
  if (!name || !name.trim()) return { name: '', songs: [], albums: [] };
  const cacheKey = `artist:${name.trim().toLowerCase()}`;
  const cached = getCached(cacheKey);
  if (cached) return cached;

  const { artistId, matchedName } = await resolveArtistId(name);
  if (!artistId) throw new Error('No artist found for that name');

  const root = await ytmPost(YTM_BROWSE_URL, { browseId: artistId });
  let headerName = matchedName || name.trim();
  let thumbnail = '';
  let headerSeen = false;
  walkJson(root, node => {
    const header = node.musicImmersiveHeaderRenderer;
    if (!header || headerSeen) return;
    headerSeen = true;
    headerName = textOf(header.title) || headerName;
    thumbnail = largestThumb(header.thumbnail?.musicThumbnailRenderer?.thumbnail?.thumbnails) || thumbnail;
  });

  const songs = collectBrowseTracks(root, 25);
  const albums = collectBrowseAlbums(root, 12);
  const result = {
    name: headerName,
    artistId,
    thumbnail: thumbnail || (songs[0]?.thumbnail || ''),
    songs,
    albums
  };
  if (songs.length) setCached(cacheKey, result, 30 * 60 * 1000);
  return result;
}

/** Album page: { name, artist, year, thumbnail, tracks[] }. */
async function getAlbum(albumId) {
  if (!albumId || !/^MPRE/.test(albumId)) throw new Error('Not an album id');
  const cacheKey = `album:${albumId}`;
  const cached = getCached(cacheKey);
  if (cached) return cached;

  const root = await ytmPost(YTM_BROWSE_URL, { browseId: albumId });
  let name = '';
  let year = '';
  let thumbnail = '';
  let artist = '';
  let headerSeen = false;
  walkJson(root, node => {
    // Albums/EPs use musicResponsiveHeaderRenderer; playlists use the detail one.
    const detail = node.musicResponsiveHeaderRenderer || node.musicDetailHeaderRenderer;
    if (!detail || headerSeen) return;
    headerSeen = true;
    name = textOf(detail.title);
    const subtitle = textOf(detail.subtitle);
    const yearMatch = subtitle.match(/\b(19|20)\d{2}\b/);
    if (yearMatch) year = yearMatch[0];
    const byline = (detail.straplineTextOne?.runs || []).find(r => r.navigationEndpoint?.browseEndpoint);
    artist = (byline && byline.text) || textOf(detail.straplineTextOne) || '';
    thumbnail = largestThumb(detail.thumbnail?.musicThumbnailRenderer?.thumbnail?.thumbnails)
      || largestThumb(detail.thumbnail?.croppedSquareThumbnailRenderer?.thumbnail?.thumbnails);
  });

  const tracks = collectBrowseTracks(root, 60);
  const result = {
    albumId,
    name: name || 'Album',
    artist,
    year,
    thumbnail: thumbnail || (tracks[0]?.thumbnail || ''),
    tracks: tracks.map(t => ({ ...t, album: name || 'Album' }))
  };
  if (tracks.length) setCached(cacheKey, result, 30 * 60 * 1000);
  return result;
}

module.exports = {
  searchSongs,
  getSuggestions,
  getTrending,
  getLyrics,
  parseLrc,
  getArtist,
  getAlbum
};
