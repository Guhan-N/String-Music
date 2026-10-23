/**
 * SimpMusic Client-Side Music Catalog & Standalone Cloud Engine
 * Guarantees live online search and offline streaming across Mobile and Web
 */

const CLIENT_CATALOG = {
  sweetener: [
    { videoId: '2bJKg73Q_S4', title: '!!!!!!!', artist: 'Billie Eilish', album: 'WHEN WE ALL FALL ASLEEP', duration: '0:14', durationSec: 14, thumbnail: 'icons/sweetener_cover.png' },
    { videoId: 'DyDfgMOUjCI', title: 'bad guy', artist: 'Billie Eilish', album: 'WHEN WE ALL FALL ASLEEP', duration: '3:14', durationSec: 194, thumbnail: 'icons/sweetener_cover.png' },
    { videoId: 'LZyybvVx-js', title: 'xanny', artist: 'Billie Eilish', album: 'WHEN WE ALL FALL ASLEEP', duration: '4:03', durationSec: 243, thumbnail: 'icons/sweetener_cover.png' },
    { videoId: 'Ah0Ys50CqO8', title: 'you should see me in a crown', artist: 'Billie Eilish', album: 'WHEN WE ALL FALL ASLEEP', duration: '3:01', durationSec: 181, thumbnail: 'icons/sweetener_cover.png' },
    { videoId: '-PZsSWwc9xA', title: 'all the good girls go to hell', artist: 'Billie Eilish', album: 'WHEN WE ALL FALL ASLEEP', duration: '2:49', durationSec: 169, thumbnail: 'icons/sweetener_cover.png' },
    { videoId: 'yaJx0Gj_lcY', title: 'wish you were gay', artist: 'Billie Eilish', album: 'WHEN WE ALL FALL ASLEEP', duration: '3:42', durationSec: 222, thumbnail: 'icons/sweetener_cover.png' },
    { videoId: 'V1Pl8CzNzCw', title: 'lovely (with Khalid)', artist: 'Billie Eilish', album: '13 Reasons Why', duration: '3:20', durationSec: 200, thumbnail: 'icons/sweetener_cover.png' },
    { videoId: 'pbMwTqkKSps', title: "when the party's over", artist: 'Billie Eilish', album: 'WHEN WE ALL FALL ASLEEP', duration: '3:16', durationSec: 196, thumbnail: 'icons/sweetener_cover.png' }
  ],
  global: [
    { videoId: '4NRXx6U8ABQ', title: 'Blinding Lights', artist: 'The Weeknd', album: 'After Hours', duration: '3:20', durationSec: 200, thumbnail: 'https://i.ytimg.com/vi/4NRXx6U8ABQ/hqdefault.jpg' },
    { videoId: 'JGwWNGJdvx8', title: 'Shape of You', artist: 'Ed Sheeran', album: '÷ (Divide)', duration: '3:53', durationSec: 233, thumbnail: 'https://i.ytimg.com/vi/JGwWNGJdvx8/hqdefault.jpg' },
    { videoId: 'TUVcZfQe-Kw', title: 'Levitating', artist: 'Dua Lipa', album: 'Future Nostalgia', duration: '3:23', durationSec: 203, thumbnail: 'https://i.ytimg.com/vi/TUVcZfQe-Kw/hqdefault.jpg' },
    { videoId: '7wtfhZwyrcc', title: 'Sunflower', artist: 'Post Malone & Swae Lee', album: 'Spider-Man', duration: '2:38', durationSec: 158, thumbnail: 'https://i.ytimg.com/vi/7wtfhZwyrcc/hqdefault.jpg' },
    { videoId: '7NOSDKb0HlU', title: 'Golden Hour', artist: 'JVKE', album: 'this is what ____ feels like', duration: '3:29', durationSec: 209, thumbnail: 'https://i.ytimg.com/vi/7NOSDKb0HlU/hqdefault.jpg' },
    { videoId: 'fJ9rUzIMcZQ', title: 'Bohemian Rhapsody', artist: 'Queen', album: 'A Night at the Opera', duration: '5:55', durationSec: 355, thumbnail: 'https://i.ytimg.com/vi/fJ9rUzIMcZQ/hqdefault.jpg' },
    { videoId: 'hT_nvWreIhg', title: 'Counting Stars', artist: 'OneRepublic', album: 'Native', duration: '4:17', durationSec: 257, thumbnail: 'https://i.ytimg.com/vi/hT_nvWreIhg/hqdefault.jpg' },
    { videoId: 'OPf0YbXqDm0', title: 'Uptown Funk', artist: 'Mark Ronson ft. Bruno Mars', album: 'Uptown Special', duration: '4:30', durationSec: 270, thumbnail: 'https://i.ytimg.com/vi/OPf0YbXqDm0/hqdefault.jpg' },
    { videoId: 'kJQP7kiw5Fk', title: 'Despacito', artist: 'Luis Fonsi ft. Daddy Yankee', album: 'VIDA', duration: '3:48', durationSec: 228, thumbnail: 'https://i.ytimg.com/vi/kJQP7kiw5Fk/hqdefault.jpg' },
    { videoId: '3JZ_D3ELwOQ', title: 'Radioactive', artist: 'Imagine Dragons', album: 'Night Visions', duration: '3:07', durationSec: 187, thumbnail: 'https://i.ytimg.com/vi/3JZ_D3ELwOQ/hqdefault.jpg' },
    { videoId: '09R8_2nJtjg', title: 'Sugar', artist: 'Maroon 5', album: 'V', duration: '3:55', durationSec: 235, thumbnail: 'https://i.ytimg.com/vi/09R8_2nJtjg/hqdefault.jpg' },
    { videoId: 'CevxZvSJLk8', title: 'Roar', artist: 'Katy Perry', album: 'PRISM', duration: '3:42', durationSec: 222, thumbnail: 'https://i.ytimg.com/vi/CevxZvSJLk8/hqdefault.jpg' },
    { videoId: 'fKopy74weus', title: 'Thunder', artist: 'Imagine Dragons', album: 'Evolve', duration: '3:07', durationSec: 187, thumbnail: 'https://i.ytimg.com/vi/fKopy74weus/hqdefault.jpg' },
    { videoId: '60ItHLz5WEA', title: 'Faded', artist: 'Alan Walker', album: 'Different World', duration: '3:32', durationSec: 212, thumbnail: 'https://i.ytimg.com/vi/60ItHLz5WEA/hqdefault.jpg' },
    { videoId: '1k8craCGpgs', title: 'Alone', artist: 'Alan Walker', album: 'Different World', duration: '2:41', durationSec: 161, thumbnail: 'https://i.ytimg.com/vi/1k8craCGpgs/hqdefault.jpg' },
    { videoId: 'gdZLi9oWNZg', title: 'Dynamite', artist: 'BTS', album: 'BE', duration: '3:19', durationSec: 199, thumbnail: 'https://i.ytimg.com/vi/gdZLi9oWNZg/hqdefault.jpg' },
    { videoId: 'WMweEpGlu_U', title: 'Butter', artist: 'BTS', album: 'Butter', duration: '2:44', durationSec: 164, thumbnail: 'https://i.ytimg.com/vi/WMweEpGlu_U/hqdefault.jpg' },
    { videoId: '2Vv-BfVoq4g', title: 'Perfect', artist: 'Ed Sheeran', album: '÷ (Divide)', duration: '4:23', durationSec: 263, thumbnail: 'https://i.ytimg.com/vi/2Vv-BfVoq4g/hqdefault.jpg' },
    { videoId: 'gNi_6U5Pm_o', title: 'Do I Wanna Know?', artist: 'Arctic Monkeys', album: 'AM', duration: '4:32', durationSec: 272, thumbnail: 'https://i.ytimg.com/vi/gNi_6U5Pm_o/hqdefault.jpg' },
    { videoId: 'v2AC41dglnM', title: 'Thunderstruck', artist: 'AC/DC', album: 'The Razors Edge', duration: '4:52', durationSec: 292, thumbnail: 'https://i.ytimg.com/vi/v2AC41dglnM/hqdefault.jpg' }
  ],
  chill: [
    { videoId: 'jfKfPfyJRdk', title: 'lofi hip hop radio - beats to relax/study to', artist: 'Lofi Girl', album: 'ChilledCow', duration: 'Live', durationSec: 3600, thumbnail: 'https://i.ytimg.com/vi/jfKfPfyJRdk/hqdefault.jpg' },
    { videoId: 'DyDfgMOUjCI', title: 'lovely (with Khalid)', artist: 'Billie Eilish & Khalid', album: '13 Reasons Why', duration: '3:20', durationSec: 200, thumbnail: 'https://i.ytimg.com/vi/DyDfgMOUjCI/hqdefault.jpg' },
    { videoId: 'h5El4VfZL54', title: 'Sweater Weather', artist: 'The Neighbourhood', album: 'I Love You.', duration: '4:00', durationSec: 240, thumbnail: 'https://i.ytimg.com/vi/h5El4VfZL54/hqdefault.jpg' },
    { videoId: '7NOSDKb0HlU', title: 'Golden Hour (Lofi Chill)', artist: 'JVKE', album: 'Chill Vibes', duration: '3:29', durationSec: 209, thumbnail: 'https://i.ytimg.com/vi/7NOSDKb0HlU/hqdefault.jpg' },
    { videoId: '5qap5aO4i9A', title: 'Lofi Sleep Chill Beats', artist: 'Lofi Records', album: 'Midnight Chill', duration: '3:15', durationSec: 195, thumbnail: 'https://i.ytimg.com/vi/5qap5aO4i9A/hqdefault.jpg' },
    { videoId: 'I_2D8zP54DE', title: 'Take Me To Church', artist: 'Hozier', album: 'Hozier', duration: '4:01', durationSec: 241, thumbnail: 'https://i.ytimg.com/vi/I_2D8zP54DE/hqdefault.jpg' },
    { videoId: 'bpOSxM0rNPM', title: '505', artist: 'Arctic Monkeys', album: 'Favourite Worst Nightmare', duration: '4:13', durationSec: 253, thumbnail: 'https://i.ytimg.com/vi/bpOSxM0rNPM/hqdefault.jpg' }
  ],
  pop: [
    { videoId: 'e-ORhEE9VVg', title: 'Blank Space', artist: 'Taylor Swift', album: '1989', duration: '3:51', durationSec: 231, thumbnail: 'https://i.ytimg.com/vi/e-ORhEE9VVg/hqdefault.jpg' },
    { videoId: 'nfWlot6h_JM', title: 'Shake It Off', artist: 'Taylor Swift', album: '1989', duration: '3:39', durationSec: 219, thumbnail: 'https://i.ytimg.com/vi/nfWlot6h_JM/hqdefault.jpg' },
    { videoId: 'b1kbLwvqugk', title: 'Anti-Hero', artist: 'Taylor Swift', album: 'Midnights', duration: '3:20', durationSec: 200, thumbnail: 'https://i.ytimg.com/vi/b1kbLwvqugk/hqdefault.jpg' },
    { videoId: 'TUVcZfQe-Kw', title: 'Levitating', artist: 'Dua Lipa', album: 'Future Nostalgia', duration: '3:23', durationSec: 203, thumbnail: 'https://i.ytimg.com/vi/TUVcZfQe-Kw/hqdefault.jpg' },
    { videoId: 'CevxZvSJLk8', title: 'Roar', artist: 'Katy Perry', album: 'Prism', duration: '3:42', durationSec: 222, thumbnail: 'https://i.ytimg.com/vi/CevxZvSJLk8/hqdefault.jpg' },
    { videoId: 'fRh_vgS2dFE', title: 'Sorry', artist: 'Justin Bieber', album: 'Purpose', duration: '3:20', durationSec: 200, thumbnail: 'https://i.ytimg.com/vi/fRh_vgS2dFE/hqdefault.jpg' },
    { videoId: '09R8_2nJtjg', title: 'Sugar', artist: 'Maroon 5', album: 'V', duration: '3:55', durationSec: 235, thumbnail: 'https://i.ytimg.com/vi/09R8_2nJtjg/hqdefault.jpg' },
    { videoId: 'pB-5XG-DbAA', title: 'Espresso', artist: 'Sabrina Carpenter', album: 'Short n Sweet', duration: '2:55', durationSec: 175, thumbnail: 'https://i.ytimg.com/vi/pB-5XG-DbAA/hqdefault.jpg' },
    { videoId: 'H5v3kku4y6Q', title: 'As It Was', artist: 'Harry Styles', album: "Harry's House", duration: '2:47', durationSec: 167, thumbnail: 'https://i.ytimg.com/vi/H5v3kku4y6Q/hqdefault.jpg' }
  ],
  hiphop: [
    { videoId: '_Yhyp-_hX2s', title: 'Lose Yourself', artist: 'Eminem', album: '8 Mile Soundtrack', duration: '5:26', durationSec: 326, thumbnail: 'https://i.ytimg.com/vi/_Yhyp-_hX2s/hqdefault.jpg' },
    { videoId: 'YVkUvmDQ3HY', title: 'Without Me', artist: 'Eminem', album: 'The Eminem Show', duration: '4:50', durationSec: 290, thumbnail: 'https://i.ytimg.com/vi/YVkUvmDQ3HY/hqdefault.jpg' },
    { videoId: 'tvTRZJ-4EyI', title: 'HUMBLE.', artist: 'Kendrick Lamar', album: 'DAMN.', duration: '2:57', durationSec: 177, thumbnail: 'https://i.ytimg.com/vi/tvTRZJ-4EyI/hqdefault.jpg' },
    { videoId: '7wtfhZwyrcc', title: 'Sunflower', artist: 'Post Malone & Swae Lee', album: 'Spider-Man', duration: '2:38', durationSec: 158, thumbnail: 'https://i.ytimg.com/vi/7wtfhZwyrcc/hqdefault.jpg' },
    { videoId: 'uxpDa-c-4Mc', title: 'Hotline Bling', artist: 'Drake', album: 'Views', duration: '4:27', durationSec: 267, thumbnail: 'https://i.ytimg.com/vi/uxpDa-c-4Mc/hqdefault.jpg' },
    { videoId: '34Na4j8AVgA', title: 'Starboy', artist: 'The Weeknd ft. Daft Punk', album: 'Starboy', duration: '3:50', durationSec: 230, thumbnail: 'https://i.ytimg.com/vi/34Na4j8AVgA/hqdefault.jpg' },
    { videoId: 'JGwWNGJdvx8', title: "God's Plan", artist: 'Drake', album: 'Scorpion', duration: '3:18', durationSec: 198, thumbnail: 'https://i.ytimg.com/vi/JGwWNGJdvx8/hqdefault.jpg' }
  ],
  rock: [
    { videoId: '1w7OgIMMRc4', title: "Sweet Child O' Mine", artist: "Guns N' Roses", album: 'Appetite for Destruction', duration: '5:56', durationSec: 356, thumbnail: 'https://i.ytimg.com/vi/1w7OgIMMRc4/hqdefault.jpg' },
    { videoId: 'v2AC41dglnM', title: 'Thunderstruck', artist: 'AC/DC', album: 'The Razors Edge', duration: '4:52', durationSec: 292, thumbnail: 'https://i.ytimg.com/vi/v2AC41dglnM/hqdefault.jpg' },
    { videoId: 'kXYiU_JCYtU', title: 'Numb', artist: 'Linkin Park', album: 'Meteora', duration: '3:07', durationSec: 187, thumbnail: 'https://i.ytimg.com/vi/kXYiU_JCYtU/hqdefault.jpg' },
    { videoId: 'fJ9rUzIMcZQ', title: 'Bohemian Rhapsody', artist: 'Queen', album: 'A Night at the Opera', duration: '5:55', durationSec: 355, thumbnail: 'https://i.ytimg.com/vi/fJ9rUzIMcZQ/hqdefault.jpg' },
    { videoId: 'hTWKbfoikeg', title: 'Smells Like Teen Spirit', artist: 'Nirvana', album: 'Nevermind', duration: '5:01', durationSec: 301, thumbnail: 'https://i.ytimg.com/vi/hTWKbfoikeg/hqdefault.jpg' },
    { videoId: 'eVTXPUF4Oz4', title: 'In the End', artist: 'Linkin Park', album: 'Hybrid Theory', duration: '3:36', durationSec: 216, thumbnail: 'https://i.ytimg.com/vi/eVTXPUF4Oz4/hqdefault.jpg' }
  ],
  indie: [
    { videoId: 'bpOSxM0rNPM', title: '505', artist: 'Arctic Monkeys', album: 'Favourite Worst Nightmare', duration: '4:13', durationSec: 253, thumbnail: 'https://i.ytimg.com/vi/bpOSxM0rNPM/hqdefault.jpg' },
    { videoId: 'gNi_6U5Pm_o', title: 'Do I Wanna Know?', artist: 'Arctic Monkeys', album: 'AM', duration: '4:32', durationSec: 272, thumbnail: 'https://i.ytimg.com/vi/gNi_6U5Pm_o/hqdefault.jpg' },
    { videoId: 'I_2D8zP54DE', title: 'Take Me To Church', artist: 'Hozier', album: 'Hozier', duration: '4:01', durationSec: 241, thumbnail: 'https://i.ytimg.com/vi/I_2D8zP54DE/hqdefault.jpg' },
    { videoId: 'h5El4VfZL54', title: 'Sweater Weather', artist: 'The Neighbourhood', album: 'I Love You.', duration: '4:00', durationSec: 240, thumbnail: 'https://i.ytimg.com/vi/h5El4VfZL54/hqdefault.jpg' }
  ]
};

// Client Fallback functions
window.getClientTrending = function(genre = 'global') {
  const g = genre.toLowerCase();
  return CLIENT_CATALOG[g] || CLIENT_CATALOG['global'];
};

// Fast Online & Offline Search Provider for Standalone Mobile & Web
window.clientSearch = async function(query) {
  if (!query || !query.trim()) return [];
  const cleanQ = query.trim();
  const q = cleanQ.toLowerCase();

  // 1. Direct YouTube Video URL or ID detection
  const ytMatch = cleanQ.match(/(?:youtu\.be\/|youtube\.com\/(?:embed\/|v\/|watch\?v=|watch\?.+&v=))([\w-]{11})/i);
  if (ytMatch && ytMatch[1]) {
    const vid = ytMatch[1];
    return [{
      videoId: vid,
      title: `YouTube Video (${vid})`,
      artist: 'Direct Stream',
      album: 'YouTube Music',
      duration: '3:30',
      durationSec: 210,
      thumbnail: `https://i.ytimg.com/vi/${vid}/hqdefault.jpg`
    }];
  }

  // 2. High-Speed Concurrent Online Invidious/Piped API Search
  const searchEndpoints = [
    `https://pipedapi.kavin.rocks/search?q=${encodeURIComponent(cleanQ)}&filter=music_songs`,
    `https://api.piped.privacydev.net/search?q=${encodeURIComponent(cleanQ)}&filter=music_songs`,
    `https://inv.tux.pizza/api/v1/search?q=${encodeURIComponent(cleanQ)}&type=video`,
    `https://invidious.jing.rocks/api/v1/search?q=${encodeURIComponent(cleanQ)}&type=video`,
    `https://yewtu.be/api/v1/search?q=${encodeURIComponent(cleanQ)}&type=video`,
    `https://invidious.drgns.space/api/v1/search?q=${encodeURIComponent(cleanQ)}&type=video`,
    `https://yt.artemislena.eu/api/v1/search?q=${encodeURIComponent(cleanQ)}&type=video`
  ];

  const fetchInstance = async (url) => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 2000);
    try {
      const res = await fetch(url, { signal: controller.signal });
      clearTimeout(timer);
      if (!res.ok) throw new Error('HTTP ' + res.status);
      const data = await res.json();
      const items = Array.isArray(data) ? data : (data.items || []);
      if (!Array.isArray(items) || items.length === 0) throw new Error('No items');
      
      const mapped = items
        .filter(item => item.videoId || item.id || (item.url && item.url.includes('v=')))
        .slice(0, 15)
        .map(item => {
          let vid = item.videoId || item.id;
          if (!vid && item.url) {
            const m = item.url.match(/v=([\w-]{11})/);
            if (m) vid = m[1];
            else vid = item.url.replace('/watch?v=', '');
          }
          const lengthSec = item.duration || item.lengthSeconds || 200;
          const mins = Math.floor(lengthSec / 60);
          const secs = lengthSec % 60;
          return {
            videoId: vid,
            title: item.title || cleanQ,
            artist: item.uploaderName || item.author || 'YouTube Music',
            album: 'Online Stream',
            duration: `${mins}:${secs < 10 ? '0' : ''}${secs}`,
            durationSec: typeof lengthSec === 'number' ? lengthSec : 200,
            thumbnail: item.thumbnail || (item.videoThumbnails && item.videoThumbnails[0]?.url) || `https://i.ytimg.com/vi/${vid}/hqdefault.jpg`
          };
        });
      if (mapped.length > 0) return mapped;
      throw new Error('No mapped items');
    } catch (err) {
      clearTimeout(timer);
      throw err;
    }
  };

  try {
    const onlineResults = await Promise.any(searchEndpoints.map(url => fetchInstance(url)));
    if (onlineResults && onlineResults.length > 0) {
      return onlineResults;
    }
  } catch (e) {
    // Fallback to local catalog
  }

  // 3. Fallback to Local Catalog with Multi-word / Fuzzy Matching
  const allTracks = [];
  const seen = new Set();

  Object.values(CLIENT_CATALOG).forEach(list => {
    list.forEach(t => {
      if (!seen.has(t.videoId)) {
        seen.add(t.videoId);
        allTracks.push(t);
      }
    });
  });

  const queryTerms = q.split(/\s+/).filter(Boolean);

  const matched = allTracks.filter(t => {
    const title = t.title.toLowerCase();
    const artist = t.artist.toLowerCase();
    const album = (t.album || '').toLowerCase();
    const full = `${title} ${artist} ${album}`;
    return queryTerms.every(term => full.includes(term));
  });

  if (matched.length > 0) return matched;

  const partialMatched = allTracks.filter(t => {
    const title = t.title.toLowerCase();
    const artist = t.artist.toLowerCase();
    const full = `${title} ${artist}`;
    return queryTerms.some(term => full.includes(term));
  });

  if (partialMatched.length > 0) return partialMatched;

  // 4. Return top global tracks
  return allTracks.slice(0, 10);
};

window.getClientSuggestions = function(query) {
  if (!query) return [];
  const q = query.toLowerCase();
  const suggestions = new Set();

  Object.values(CLIENT_CATALOG).forEach(list => {
    list.forEach(t => {
      if (t.title.toLowerCase().includes(q)) suggestions.add(t.title);
      if (t.artist.toLowerCase().includes(q)) suggestions.add(t.artist);
    });
  });

  return Array.from(suggestions).slice(0, 6);
};
