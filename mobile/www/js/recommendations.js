/**
 * SimpMusic Recommendation Engine (v3.5) — content-based, rule-weighted.
 *
 * Modular pipeline (each stage swappable for ML / collaborative filtering later):
 *   RecommendationEngine
 *   |- BehaviorTracker       - records plays/30s/completions/skips/replays/likes...
 *   |- UserProfileBuilder    - weighted genre/artist/language/mood/tempo prefs
 *   |- CandidateGenerator    - catalog + recents + likes + playlists (deduped)
 *   |- SimilarityCalculator  - genre/artist/language/mood/history 0-1 scores
 *   |- RankingEngine         - weighted normalized score
 *   |- DiversityFilter       - no repeats, skip avoidance, artist caps, mix
 *   '- RecommendationCache   - invalidated on new behavior, TTL-capped
 *
 * Storage (localStorage keys are DB-shaped so a backend can mirror them):
 *   simpmusic_rec_events  - behavior event log (capped)
 *   simpmusic_rec_prefs   - cached user preference profile
 *   simpmusic_rec_recs    - cached recommendation sections
 *   simpmusic_dislikes    - explicit dislikes ("Not for me")
 */
(function () {
  'use strict';

  // ================= Configuration =================
  var DEFAULTS = {
    maxSections: 9,
    sectionSize: 8,
    weights: {
      completed: 2, played: 1, replay: 3, like: 5, addToPlaylist: 4,
      skipQuick: -4, dislike: -6
    },
    autoPlayDecay: 0.5,
    scoreWeights: {
      genre: 0.25, artist: 0.20, language: 0.15, mood: 0.15,
      history: 0.15, popularity: 0.05, freshness: 0.05
    },
    recencyHalfLifeDays: 10,
    maxPerArtist: 2,
    historyWeightDays: 30,
    cacheTtlMs: 15 * 60 * 1000,
    coldStartMinEvents: 8,
    diversity: { personalized: 0.7, similar: 0.2, discovery: 0.1 },
    // v3.19.8: YouTube hybrid pipeline (see YouTubeFeeder below).
    ytFeeder: { enabled: true, maxSeeds: 3, cacheTtlHours: 12 }
  };
  var CONFIG = JSON.parse(JSON.stringify(DEFAULTS));

  var KEYS = {
    events: 'simpmusic_rec_events',
    prefs: 'simpmusic_rec_prefs',
    recs: 'simpmusic_rec_recs',
    dislikes: 'simpmusic_dislikes'
  };

  var listeners = {};

  // ================= Small utils =================
  function loadJSON(key, fallback) {
    try {
      var raw = localStorage.getItem(key);
      if (!raw) return fallback;
      var v = JSON.parse(raw);
      return v == null ? fallback : v;
    } catch (e) { return fallback; }
  }
  function saveJSON(key, val) {
    try { localStorage.setItem(key, JSON.stringify(val)); } catch (e) {}
  }
  function now() { return Date.now(); }
  function emit(name, data) {
    (listeners[name] || []).forEach(function (cb) {
      try { cb(data); } catch (e) {}
    });
  }
  function norm(s) { return String(s == null ? '' : s).trim().toLowerCase(); }
  function normList(s) {
    if (Array.isArray(s)) return s.map(norm).filter(Boolean);
    return norm(s) ? [norm(s)] : [];
  }
  function clamp01(v) { return Math.max(0, Math.min(1, v)); }

  // ================= BehaviorTracker =================
  var MAX_EVENTS = 400;

  var BehaviorTracker = {
    all: function () { return loadJSON(KEYS.events, []); },
    record: function (type, track, opts) {
      opts = opts || {};
      if (!track || !track.videoId) return;
      var events = loadJSON(KEYS.events, []);
      events.push({
        t: type, id: track.videoId, ts: now(),
        dur: Math.max(0, Math.round(opts.listenSec || 0)),
        auto: !!opts.auto, src: opts.source || null
      });
      while (events.length > MAX_EVENTS) events.shift();
      saveJSON(KEYS.events, events);
      emit('event', { type: type, track: track });
      RecommendationCache.invalidate();
    },
    isRepeatAutoPlay: function (track) {
      var events = loadJSON(KEYS.events, []);
      var last = events[events.length - 1];
      return !!(last && last.t === 'play' && last.id === track.videoId &&
                (now() - last.ts) < 5 * 60 * 1000);
    },
    clear: function () {
      saveJSON(KEYS.events, []);
      saveJSON(KEYS.prefs, null);
      saveJSON(KEYS.recs, null);
    }
  };

  // ================= Song profile normalization =================
  function songProfile(t) {
    return {
      id: t.videoId,
      title: t.title || '',
      artist: norm(t.artist),
      album: norm(t.album),
      genres: normList(t.genres || t.genre),
      language: norm(t.language || t.lang),
      moods: normList(t.moods || t.mood),
      bpm: Number(t.bpm || t.tempo) || null,
      popularity: Number(t.popularity) >= 0 ? Number(t.popularity) : null,
      releaseDate: t.releaseDate || t.releasedAt || null,
      features: t.audioFeatures || null
    };
  }

  // ================= UserProfileBuilder =================
  var UserProfileBuilder = {
    build: function (catalogIndex) {
      var cached = loadJSON(KEYS.prefs, null);
      var events = BehaviorTracker.all();
      if (cached && cached._eventCount === events.length) return cached;

      var likes = loadJSON('simpmusic_likes', []) || [];
      var dislikes = loadJSON(KEYS.dislikes, []) || [];
      var W = CONFIG.weights;

      function bump(bucket, key, amount) {
        if (!key) return;
        bucket[key] = (bucket[key] || 0) + amount;
      }
      function credit(sp, w) {
        if (!sp || !w) return;
        bump(scores.artist, sp.artist, w);
        sp.genres.forEach(function (g) { bump(scores.genre, g, w); });
        sp.moods.forEach(function (m) { bump(scores.mood, m, w); });
        bump(scores.language, sp.language, w);
        if (sp.bpm) {
          bump(scores.tempo, 'bpmSum', w * sp.bpm);
          bump(scores.tempo, 'bpmWeight', w);
        }
      }

      var perSong = {};
      var scores = { genre: {}, artist: {}, language: {}, mood: {}, tempo: {} };

      events.forEach(function (ev) {
        var sp = catalogIndex.byId[ev.id];
        if (!sp) return;
        var w = 0;
        switch (ev.t) {
          case 'complete': w = W.completed; break;
          case 'play30':   w = W.played; break;
          case 'replay':   w = W.replay; break;
          case 'like':     w = W.like; break;
          case 'playlist': w = W.addToPlaylist; break;
          case 'skip':     w = W.skipQuick; break;
          case 'dislike':  w = W.dislike; break;
          default: return;
        }
        if (ev.auto && w > 0) w *= CONFIG.autoPlayDecay;
        var ageDays = (now() - ev.ts) / 86400000;
        w *= Math.pow(0.5, ageDays / CONFIG.recencyHalfLifeDays);

        var p = perSong[ev.id] || (perSong[ev.id] = {
          weight: 0, plays: 0, completions: 0, replays: 0, lastTs: 0
        });
        if (ev.t === 'play') p.plays++;
        if (ev.t === 'complete') p.completions++;
        if (ev.t === 'replay') p.replays++;
        if (ev.ts > p.lastTs) p.lastTs = ev.ts;
        p.weight += w;
        credit(sp, w);
      });

      likes.forEach(function (l) { credit(catalogIndex.byId[l.videoId], W.like); });
      dislikes.forEach(function (d) { credit(catalogIndex.byId[d.videoId], W.dislike); });

      var totalBpmWeight = scores.tempo.bpmWeight || 0;
      var prefs = {
        _eventCount: events.length,
        _builtAt: now(),
        songs: perSong,
        topGenres: ranked(scores.genre),
        topArtists: ranked(scores.artist),
        topLanguages: ranked(scores.language),
        topMoods: ranked(scores.mood),
        avgTempo: totalBpmWeight ? Math.round(scores.tempo.bpmSum / totalBpmWeight) : null,
        replayed: Object.keys(perSong)
          .filter(function (id) { return perSong[id].replays > 0; })
          .sort(function (a, b) { return perSong[b].replays - perSong[a].replays; }),
        recent: events.filter(function (e) { return e.t === 'play'; })
          .slice(-20).reverse().map(function (e) { return e.id; }),
        liked: (function () {
          var ids = {};
          likes.forEach(function (l) { ids[l.videoId] = true; });
          events.forEach(function (ev) { if (ev.t === 'like') ids[ev.id] = true; });
          return Object.keys(ids);
        })(),
        disliked: dislikes.map(function (d) { return d.videoId; }),
        interactions: events.length + likes.length + dislikes.length
      };
      saveJSON(KEYS.prefs, prefs);
      return prefs;
    }
  };

  function ranked(obj) {
    return Object.keys(obj)
      .map(function (k) { return { key: k, weight: obj[k] }; })
      .sort(function (a, b) { return b.weight - a.weight; });
  }

  // ================= CandidateGenerator =================
  var CandidateGenerator = {
    generate: function () {
      var seen = {}, out = [];
      function push(list) {
        (list || []).forEach(function (t) {
          if (t && t.videoId && !seen[t.videoId]) {
            seen[t.videoId] = true;
            out.push(t);
          }
        });
      }
      Object.keys(window.CLIENT_CATALOG || {}).forEach(function (k) {
        push(window.CLIENT_CATALOG[k]);
      });
      push(loadJSON('simpmusic_recent_songs', []));
      push(loadJSON('simpmusic_likes', []));
      (loadJSON('simpmusic_playlists', []) || []).forEach(function (pl) {
        push(pl.tracks);
      });
      // v3.19.8: fold previously fetched YouTube candidates into the local
      // catalog, so plays/likes/skips on them keep feeding the profile.
      var yt = loadJSON('simpmusic_rec_yt', null);
      if (yt && Array.isArray(yt.tracks)) push(yt.tracks);
      return out;
    }
  };

  // ================= YouTubeFeeder (v3.19.8) =================
  // The "YouTube recommendation pipeline" stage. YouTube's server-side ML
  // (embedding models over billions of interactions) can't be replicated in-
  // app, but its OUTPUT can be consumed legitimately: for each of the user's
  // top seeds (liked / replayed / most-played tracks) we ask YouTube itself
  // for similar music — "<artist> songs" + "<artist> playlist" searches —
  // rank the results with the LOCAL per-user profile, and merge them into
  // the engine as new Home sections. No login, no ToS risk.
  var KEY_YT = 'simpmusic_rec_yt';

  function ytSearch(query) {
    return new Promise(function (resolve) {
      var done = false;
      var finish = function (list) { if (!done) { done = true; resolve(list || []); } };
      setTimeout(finish, 6000); // hard 6s cap per query
      try {
        var cap = window.Capacitor;
        var plug = cap && cap.Plugins ? cap.Plugins.PlaybackKeeper : null;
        if (plug && typeof plug.search === 'function') {
          plug.search({ query: query }).then(function (res) {
            var list = res && res.results ? JSON.parse(res.results) : null;
            finish(Array.isArray(list) ? list : []);
          }).catch(function () { finish([]); });
        } else if (typeof window.apiSearch === 'function') {
          Promise.resolve(window.apiSearch(query)).then(function (list) {
            finish(Array.isArray(list) ? list : []);
          }).catch(function () { finish([]); });
        } else finish([]);
      } catch (e) { finish([]); }
    });
  }

  function ytPickSeeds(prefs) {
    var seeds = [];
    var seen = {};
    (prefs.replayed || []).slice(0, 2).forEach(function (id) { seeds.push(id); seen[id] = true; });
    (prefs.liked || []).slice(0, 2).forEach(function (id) {
      if (!seen[id]) { seeds.push(id); seen[id] = true; }
    });
    return seeds.slice(0, CONFIG.ytFeeder.maxSeeds);
  }

  // Rank raw YouTube results with the LOCAL per-user profile — the
  // personalization half of the pipeline (the seeds WERE the user's taste).
  function ytRankTracks(list, prefs) {
    return list
      .filter(function (t) { return t && t.videoId && t.title; })
      .map(function (t) {
        var sp = songProfile(t);
        var score = 0.5
          + 0.25 * SimilarityCalculator.artistMatch(sp, prefs)
          + 0.20 * SimilarityCalculator.languageMatch(sp, prefs)
          + 0.05 * SimilarityCalculator.genreMatch(sp, prefs);
        return { track: t, sp: sp, score: score };
      })
      .sort(function (a, b) { return b.score - a.score; });
  }

  var YouTubeFeeder = {
    // Previously fetched candidates (also folded into the catalog by
    // CandidateGenerator, so their plays/likes keep feeding the profile).
    tracks: function () {
      var c = loadJSON(KEY_YT, null);
      return c && Array.isArray(c.tracks) ? c.tracks : [];
    },
    // Async enrichment: fetch fresh YouTube candidates per user seed, rank
    // them with the local profile, persist, then re-render Home sections.
    refresh: function () {
      if (!CONFIG.ytFeeder.enabled) return Promise.resolve(null);
      var cached = loadJSON(KEY_YT, null);
      if (cached && (now() - cached.at) < CONFIG.ytFeeder.cacheTtlHours * 3600000) {
        return Promise.resolve(cached.tracks);
      }
      var idx = catalogIndex();
      var prefs = UserProfileBuilder.build(idx);
      if (prefs.interactions < CONFIG.coldStartMinEvents) return Promise.resolve(null);
      var seedIds = ytPickSeeds(prefs);
      if (!seedIds.length) return Promise.resolve(null);
      var queries = [];
      seedIds.forEach(function (id) {
        var sp = idx.byId[id];
        var base = sp ? (sp.artist || sp.title) : '';
        if (!base) return;
        queries.push(base + ' songs');
        queries.push(base + ' playlist');
      });
      if (!queries.length) return Promise.resolve(null);
      return Promise.all(queries.map(ytSearch)).then(function (batches) {
        var seen = {};
        var raw = [];
        batches.forEach(function (b) {
          b.forEach(function (t) {
            if (t && t.videoId && !seen[t.videoId]) { seen[t.videoId] = true; raw.push(t); }
          });
        });
        var ranked = ytRankTracks(raw, prefs)
          .filter(function (c) { return !prefs.songs[c.track.videoId]; })
          .slice(0, 16);
        if (!ranked.length) return null;
        var tracks = ranked.map(function (c) {
          return {
            videoId: c.track.videoId,
            title: c.track.title || 'Song',
            artist: c.track.artist || '',
            thumbnail: c.track.thumbnail || ('https://i.ytimg.com/vi/' + c.track.videoId + '/hqdefault.jpg'),
            durationSec: Number(c.track.durationSec) || 0
          };
        });
        saveJSON(KEY_YT, { at: now(), seeds: seedIds, tracks: tracks });
        RecommendationCache.invalidate();
        emit('updated', RecommendationEngine.getSections());
        return tracks;
      }).catch(function () { return null; });
    }
  };

  // ================= SimilarityCalculator =================
  var SimilarityCalculator = {
    genreMatch: function (sp, prefs) {
      if (!sp.genres.length || !prefs.topGenres.length) return 0.5;
      var max = prefs.topGenres[0].weight || 1;
      var best = 0;
      sp.genres.forEach(function (g) {
        prefs.topGenres.forEach(function (pg, i) {
          if (pg.key === g) best = Math.max(best, (pg.weight / max) * (i < 3 ? 1 : 0.7));
        });
      });
      return clamp01(best);
    },
    artistMatch: function (sp, prefs) {
      if (!sp.artist || !prefs.topArtists.length) return 0.5;
      var max = prefs.topArtists[0].weight || 1;
      for (var i = 0; i < prefs.topArtists.length; i++) {
        if (prefs.topArtists[i].key === sp.artist) {
          return clamp01((prefs.topArtists[i].weight / max) * (i < 3 ? 1 : 0.7));
        }
      }
      return 0;
    },
    languageMatch: function (sp, prefs) {
      if (!sp.language || !prefs.topLanguages.length) return 0.5;
      var max = prefs.topLanguages[0].weight || 1;
      for (var i = 0; i < prefs.topLanguages.length; i++) {
        if (prefs.topLanguages[i].key === sp.language) {
          return clamp01(prefs.topLanguages[i].weight / max);
        }
      }
      return 0;
    },
    moodMatch: function (sp, prefs) {
      if (!sp.moods.length || !prefs.topMoods.length) return 0.5;
      var max = prefs.topMoods[0].weight || 0.001;
      var best = 0;
      sp.moods.forEach(function (m) {
        prefs.topMoods.forEach(function (pm) {
          if (pm.key === m) best = Math.max(best, pm.weight / max);
        });
      });
      return clamp01(best);
    },
    historySimilarity: function (sp, catalogIndex, prefs) {
      var ids = Object.keys(prefs.songs).filter(function (id) {
        return prefs.songs[id].weight > 0 &&
               (now() - prefs.songs[id].lastTs) < CONFIG.historyWeightDays * 86400000;
      });
      if (!ids.length) return 0.5;
      var vecA = featureSet(sp);
      var best = 0;
      ids.slice(0, 30).forEach(function (id) {
        var other = catalogIndex.byId[id];
        if (!other) return;
        var v = jaccard(vecA, featureSet(other));
        if (v > best) best = v;
      });
      return clamp01(best);
    },
    popularity: function (sp) {
      if (sp.popularity == null) return 0.5;
      return clamp01(sp.popularity / 100);
    },
    freshness: function (sp) {
      if (!sp.releaseDate) return 0.5;
      var days = (now() - new Date(sp.releaseDate).getTime()) / 86400000;
      if (isNaN(days)) return 0.5;
      return clamp01(1 - days / 730);
    }
  };

  function featureSet(sp) {
    var fs = ['a:' + sp.artist];
    sp.genres.forEach(function (g) { fs.push('g:' + g); });
    sp.moods.forEach(function (m) { fs.push('m:' + m); });
    if (sp.language) fs.push('l:' + sp.language);
    return fs;
  }
  function jaccard(a, b) {
    if (!a.length || !b.length) return 0.5;
    var inter = 0;
    a.forEach(function (x) { if (b.indexOf(x) >= 0) inter++; });
    var uni = a.length + b.length - inter;
    return uni ? inter / uni : 0;
  }

  // ================= RankingEngine =================
  var RankingEngine = {
    score: function (sp, catalogIndex, prefs) {
      var sw = CONFIG.scoreWeights;
      var parts = {
        genre:      SimilarityCalculator.genreMatch(sp, prefs),
        artist:     SimilarityCalculator.artistMatch(sp, prefs),
        language:   SimilarityCalculator.languageMatch(sp, prefs),
        mood:       SimilarityCalculator.moodMatch(sp, prefs),
        history:    SimilarityCalculator.historySimilarity(sp, catalogIndex, prefs),
        popularity: SimilarityCalculator.popularity(sp),
        freshness:  SimilarityCalculator.freshness(sp)
      };
      var total = 0;
      Object.keys(sw).forEach(function (k) { total += parts[k] * sw[k]; });
      return { total: clamp01(total), parts: parts };
    },
    rank: function (candidates, catalogIndex, prefs) {
      return candidates
        .filter(function (t) { return !!catalogIndex.byId[t.videoId]; })
        .map(function (t) {
          var sp = catalogIndex.byId[t.videoId];
          var s = RankingEngine.score(sp, catalogIndex, prefs);
          return { track: t, sp: sp, score: s.total, parts: s.parts };
        })
        .sort(function (a, b) { return b.score - a.score; });
    }
  };

  // ================= DiversityFilter =================
  var DiversityFilter = {
    apply: function (rankedList, prefs, opts) {
      opts = opts || {};
      var size = opts.size || CONFIG.sectionSize;
      var excluded = opts.excluded || {};
      var skip = recentlySkipped();
      var picked = [], seenArtist = {}, seenSong = {};
      for (var i = 0; i < rankedList.length && picked.length < size; i++) {
        var c = rankedList[i];
        var id = c.track.videoId;
        if (excluded[id]) continue;
        if (prefs.disliked.indexOf(id) >= 0) continue;
        if (skip.indexOf(id) >= 0) continue;
        if (seenSong[id]) continue;
        var a = c.sp.artist || '';
        if ((seenArtist[a] || 0) >= CONFIG.maxPerArtist) continue;
        picked.push(c);
        seenArtist[a] = (seenArtist[a] || 0) + 1;
        seenSong[id] = true;
      }
      return picked;
    }
  };

  var _skipCache = null, _skipCacheAt = 0, _skipCacheSig = '';
  function skipLogSig() {
    var ev = BehaviorTracker.all();
    return ev.length + ':' + (ev.length ? ev[ev.length - 1].ts : 0);
  }
  function recentlySkipped() {
    var sig = skipLogSig();
    if (_skipCache && _skipCacheSig === sig && now() - _skipCacheAt < 30000) return _skipCache;
    var cutoff = now() - 24 * 3600 * 1000;
    var skipAt = {};
    BehaviorTracker.all().forEach(function (ev) {
      if (ev.t === 'skip' && ev.ts >= cutoff) {
        if (!skipAt[ev.id] || ev.ts > skipAt[ev.id]) skipAt[ev.id] = ev.ts;
      }
    });
    // Only a play/complete AFTER the skip un-blocks the song (a play always
    // precedes its own skip, so timestamps must be compared).
    BehaviorTracker.all().forEach(function (ev) {
      if ((ev.t === 'play' || ev.t === 'complete') && skipAt[ev.id] &&
          ev.ts > skipAt[ev.id]) {
        delete skipAt[ev.id];
      }
    });
    _skipCache = Object.keys(skipAt);
    _skipCacheSig = sig;
    _skipCacheAt = now();
    return _skipCache;
  }

  // ================= RecommendationCache =================
  var RecommendationCache = {
    get: function () {
      var c = loadJSON(KEYS.recs, null);
      if (!c) return null;
      if (now() - c.at > CONFIG.cacheTtlMs) return null;
      return c;
    },
    set: function (sections) { saveJSON(KEYS.recs, { at: now(), sections: sections }); },
    invalidate: function () { saveJSON(KEYS.recs, null); }
  };

  // ================= Catalog index (60s memo) =================
  var _catalogIndex = null, _catalogAt = 0;
  function catalogIndex(force) {
    if (!force && _catalogIndex && now() - _catalogAt < 60000) return _catalogIndex;
    var candidates = CandidateGenerator.generate();
    var byId = {};
    candidates.forEach(function (t) { byId[t.videoId] = songProfile(t); });
    _catalogIndex = { all: candidates, byId: byId };
    _catalogAt = now();
    return _catalogIndex;
  }

  // ================= helpers =================
  function section(title, tracks, kind) { return { title: title, kind: kind, tracks: tracks }; }
  function tOf(c) { return c.track || c; }
  function findTrack(idx, id) {
    for (var i = 0; i < idx.all.length; i++) if (idx.all[i].videoId === id) return idx.all[i];
    return null;
  }
  function similarTo(seedSp, idx, prefs, excluded) {
    var excl = Object.assign({}, excluded || {});
    excl[seedSp.id] = true;
    var rankedList = RankingEngine.rank(idx.all, idx, prefs).map(function (c) {
      var overlap = jaccard(featureSet(c.sp), featureSet(seedSp));
      return { track: c.track, sp: c.sp, score: c.score * 0.4 + overlap * 0.6, parts: c.parts };
    }).sort(function (a, b) { return b.score - a.score; });
    return DiversityFilter.apply(rankedList, prefs, {
      size: CONFIG.sectionSize, excluded: excl
    });
  }
  function deepMerge(base, over) {
    var out = JSON.parse(JSON.stringify(base));
    Object.keys(over || {}).forEach(function (k) {
      if (out[k] && typeof out[k] === 'object' && !Array.isArray(out[k]) &&
          over[k] && typeof over[k] === 'object' && !Array.isArray(over[k])) {
        out[k] = deepMerge(out[k], over[k]);
      } else out[k] = over[k];
    });
    return out;
  }

  // ================= RecommendationEngine (facade) =================
  var RecommendationEngine = {
    getSections: function (opts) {
      opts = opts || {};
      if (!opts.force) {
        var cached = RecommendationCache.get();
        if (cached) return cached.sections;
      }
      return RecommendationEngine.generate(opts);
    },
    generate: function (opts) {
      opts = opts || {};
      var idx = catalogIndex(!!opts.force);
      var prefs = UserProfileBuilder.build(idx);
      var sections = prefs.interactions < CONFIG.coldStartMinEvents
        ? coldStartSections(idx, prefs)
        : personalizedSections(idx, prefs);
      RecommendationCache.set(sections);
      emit('updated', sections);
      return sections;
    },
    similarTo: function (track, n) {
      var idx = catalogIndex();
      var prefs = UserProfileBuilder.build(idx);
      var seed = idx.byId[track.videoId] || songProfile(track);
      return similarTo(seed, idx, prefs, {}).slice(0, n || 6).map(tOf);
    },
    configure: function (overrides) {
      // Merge onto the CURRENT config so successive configure() calls compose
      // instead of resetting earlier overrides to defaults.
      CONFIG = deepMerge(CONFIG, overrides || {});
      RecommendationCache.invalidate();
    },
    refresh: function () { return RecommendationEngine.generate({ force: true }); },
    dislike: function (track) {
      if (!track || !track.videoId) return;
      var d = loadJSON(KEYS.dislikes, []) || [];
      if (!d.some(function (x) { return x.videoId === track.videoId; })) {
        d.push({ videoId: track.videoId, title: track.title || '', artist: track.artist || '' });
        saveJSON(KEYS.dislikes, d);
        BehaviorTracker.record('dislike', track);
      }
    },
    clearData: function () {
      BehaviorTracker.clear();
      saveJSON(KEYS.dislikes, []);
    },
    on: function (name, cb) { (listeners[name] = listeners[name] || []).push(cb); },
    config: function () { return CONFIG; }
  };

  // ================= Section builders =================
  function personalizedSections(idx, prefs) {
    var sections = [];
    var rankedList = RankingEngine.rank(idx.all, idx, prefs);
    var div = CONFIG.diversity;
    var size = CONFIG.sectionSize;
    var nDiscover = Math.max(1, Math.round(size * div.discovery));

    var mainRanked = DiversityFilter.apply(rankedList, prefs, { size: size });
    sections.push(section('Recommended For You', mainRanked.map(tOf), 'foryou'));

    var used = {};
    mainRanked.forEach(function (c) { used[c.track.videoId] = true; });

    var listeningRanked = DiversityFilter.apply(rankedList, prefs, { size: size, excluded: used });
    var used2 = Object.assign({}, used);
    listeningRanked.forEach(function (c) { used2[c.track.videoId] = true; });
    sections.push(section('Based On Your Listening', listeningRanked.map(tOf), 'listening'));

    var seedTrack = null;
    for (var i = 0; i < prefs.liked.length && !seedTrack; i++) {
      seedTrack = findTrack(idx, prefs.liked[i]);
    }
    if (seedTrack) {
      var sim = similarTo(idx.byId[seedTrack.videoId], idx, prefs, used2);
      if (sim.length) {
        sections.push(section('Because You Liked ' + seedTrack.title, sim.map(tOf), 'seed'));
        sim.forEach(function (c) { used2[c.track.videoId] = true; });
      }
    }

    if (prefs.topArtists.length) {
      var artist = prefs.topArtists[0].key;
      var more = idx.all.filter(function (tr) {
        return norm(tr.artist) === artist && !used2[tr.videoId] && !prefs.songs[tr.videoId];
      }).slice(0, size);
      if (more.length) sections.push(section('More From ' + artist, more, 'artist'));
    }

    var discovery = DiversityFilter.apply(rankedList.slice().reverse(), prefs, {
      size: nDiscover, excluded: used2
    });
    if (discovery.length) {
      sections.push(section('Discover New Music', discovery.map(tOf), 'discovery'));
      discovery.forEach(function (c) { used2[c.track.videoId] = true; });
    }

    var rp = prefs.recent.map(function (id) { return findTrack(idx, id); })
      .filter(Boolean).slice(0, size);
    if (rp.length) sections.push(section('Recently Played', rp, 'recent'));

    var anchor = findTrack(idx, prefs.recent[0]);
    if (anchor && idx.byId[anchor.videoId] &&
        (!seedTrack || anchor.videoId !== seedTrack.videoId)) {
      var sim2 = similarTo(idx.byId[anchor.videoId], idx, prefs, used2);
      if (sim2.length) sections.push(section('Similar Songs', sim2.map(tOf), 'similar'));
    }

    // v3.19.8: YouTube pipeline rows — candidates fetched FROM YouTube for
    // this user's seeds, re-ranked by the live local profile. Two flavors:
    // profile-close first, then the remainder as an explore row.
    var ytAll = YouTubeFeeder.tracks().filter(function (t) {
      return !used2[t.videoId] && prefs.disliked.indexOf(t.videoId) < 0;
    });
    if (ytAll.length) {
      var ytRanked = ytRankTracks(ytAll, prefs);
      var ytClose = ytRanked.slice(0, CONFIG.sectionSize);
      if (ytClose.length) {
        sections.push(section('Trending Now', ytClose.map(tOf), 'yt-close'));
        ytClose.forEach(function (c) { used2[c.track.videoId] = true; });
      }
      var ytExplore = ytRanked.filter(function (c) { return !used2[c.track.videoId]; })
        .slice(0, CONFIG.sectionSize);
      if (ytExplore.length) sections.push(section('Fresh Discoveries', ytExplore.map(tOf), 'yt-explore'));
    }

    return sections.filter(function (s) { return s.tracks.length > 0; })
      .slice(0, CONFIG.maxSections);
  }

  function coldStartSections(idx, prefs) {
    var sections = [];
    var cats = loadJSON('simpmusic_categories', []) || [];
    var langs = cats.length
      ? cats
      : prefs.topLanguages.slice(0, 2).map(function (x) { return x.key; });

    var pool = idx.all.filter(function (tr) {
      var sp = idx.byId[tr.videoId];
      return !sp.language || langs.length === 0 || langs.indexOf(sp.language) >= 0;
    });
    var base = (pool.length >= 6 ? pool : idx.all).slice(0, 40);

    var seenA = {};
    var trending = base.filter(function (tr) {
      if (prefs.disliked.indexOf(tr.videoId) >= 0) return false; // honor "Not for me" even cold
      var a = norm(tr.artist);
      if ((seenA[a] || 0) >= 2) return false;
      seenA[a] = (seenA[a] || 0) + 1;
      return true;
    }).slice(0, CONFIG.sectionSize);
    if (trending.length) sections.push(section('Trending For You', trending, 'cold-trending'));

    var discover = DiversityFilter.apply(
      base.slice().reverse().map(function (tr) {
        return { track: tr, sp: idx.byId[tr.videoId], score: 0, parts: {} };
      }),
      prefs, { size: 4 });
    if (discover.length) sections.push(section('Discover New Music', discover.map(tOf), 'discovery'));

    var genresDone = {};
    base.forEach(function (tr) {
      idx.byId[tr.videoId].genres.forEach(function (g) {
        if (genresDone[g]) return;
        genresDone[g] = true;
        var batch = base.filter(function (x) {
          return idx.byId[x.videoId].genres.indexOf(g) >= 0;
        }).slice(0, CONFIG.sectionSize);
        if (batch.length) sections.push(section('Best of ' + g, batch, 'cold-genre'));
      });
    });

    return sections.filter(function (s) { return s.tracks.length > 0; })
      .slice(0, CONFIG.maxSections);
  }

  // ================= Auto-tracking hooks =================
  function bindAutoTracking() {
    var p = window.player;
    if (!p || !p.on) return;
    var state = { id: null, startedAt: 0, lastPos: 0, maxPos: 0, play30Done: false };

    function snap() {
      return {
        id: p.currentTrack ? p.currentTrack.videoId : null,
        pos: p.currentTime || 0,
        dur: p.duration || 0,
        playing: !!p.isPlaying
      };
    }
    function finalizePrev() {
      var s = state;
      if (!s.id) return;
      var dur = p.duration || 0;
      var track = (p.currentTrack && p.currentTrack.videoId === s.id)
        ? p.currentTrack : findRecentTrack(s.id);
      if (dur > 0 && s.maxPos >= dur * 0.9) {
        BehaviorTracker.record('complete', track);
      } else if (dur > 0 && s.maxPos > 0 && s.maxPos < dur * 0.35 &&
                 (now() - s.startedAt) > 5000) {
        BehaviorTracker.record('skip', track, { listenSec: Math.round(s.maxPos) });
      }
    }

    setInterval(function () {
      try {
        var cur = snap();
        var s = state;
        if (cur.id && cur.id !== s.id) {
          finalizePrev();
          s.id = cur.id;
          s.startedAt = now();
          s.lastPos = 0; s.maxPos = 0; s.play30Done = false;
          BehaviorTracker.record('play', p.currentTrack, {
            auto: BehaviorTracker.isRepeatAutoPlay(p.currentTrack)
          });
        }
        if (cur.id === s.id && cur.playing) {
          var delta = cur.pos - s.lastPos;
          if (delta > 0 && delta < 5) s.maxPos = Math.max(s.maxPos, cur.pos);
          s.lastPos = cur.pos;
          if (!s.play30Done && s.maxPos > 30) {
            s.play30Done = true;
            BehaviorTracker.record('play30', p.currentTrack, { listenSec: 30 });
          }
        }
      } catch (e) { /* tracking must never break playback */ }
    }, 1000);

    p.on('ended', function () {
      try {
        finalizePrev();
        var cur = p.currentTrack;
        if (cur) BehaviorTracker.record('replay', cur, { auto: true });
        state.id = null;
      } catch (e) {}
    });
  }

  function findRecentTrack(videoId) {
    var rec = loadJSON('simpmusic_recent_songs', []) || [];
    return rec.filter(function (t) { return t.videoId === videoId; })[0] ||
           { videoId: videoId };
  }

  function bindLikeTracking() {
    var last = (loadJSON('simpmusic_likes', []) || [])
      .map(function (l) { return l.videoId; }).join(',');
    setInterval(function () {
      try {
        var likes = loadJSON('simpmusic_likes', []) || [];
        var cur = likes.map(function (l) { return l.videoId; }).join(',');
        if (cur === last) return;
        var prevSet = {};
        last.split(',').forEach(function (id) { if (id) prevSet[id] = true; });
        likes.forEach(function (l) {
          if (!prevSet[l.videoId]) BehaviorTracker.record('like', l);
        });
        last = cur;
      } catch (e) {}
    }, 2000);
  }

  function bindPlaylistTracking() {
    var prevPls = loadJSON('simpmusic_playlists', []) || [];
    setInterval(function () {
      try {
        var pls = loadJSON('simpmusic_playlists', []) || [];
        var changed = pls.length !== prevPls.length || !pls.every(function (pl, i) {
          var p = prevPls[i];
          return p && p.id === pl.id &&
                 (p.tracks || []).length === (pl.tracks || []).length;
        });
        if (!changed) return;
        pls.forEach(function (pl) {
          var prev = prevPls.filter(function (x) { return x.id === pl.id; })[0];
          var prevIds = {};
          ((prev && prev.tracks) || []).forEach(function (t) { prevIds[t.videoId] = true; });
          (pl.tracks || []).forEach(function (t) {
            if (!prevIds[t.videoId]) {
              BehaviorTracker.record('playlist', t, { source: pl.name });
            }
          });
        });
        prevPls = pls;
      } catch (e) {}
    }, 3000);
  }

  // ================= Home UI rendering =================
  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  function recoCard(t) {
    var thumb = t.thumbnail || ('https://i.ytimg.com/vi/' + t.videoId + '/hqdefault.jpg');
    return '<div class="reco-card" data-video="' + esc(t.videoId) + '"'
      + ' data-title="' + esc(t.title) + '"'
      + ' data-artist="' + esc(t.artist || '') + '"'
      + ' data-thumb="' + esc(t.thumbnail || '') + '"'
      + ' data-durationsec="' + Math.round(t.durationSec || 0) + '">'
      + '<div class="reco-card-thumb-wrap">'
      + '<img class="reco-card-img" loading="lazy" src="' + esc(thumb) + '" alt="" />'
      + '<div class="reco-card-play"><svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z"/></svg></div>'
      + '</div>'
      + '<div class="reco-card-name">' + esc(t.title) + '</div>'
      + '<div class="reco-card-sub">' + esc(t.artist || '') + '</div>'
      + '<button class="song-menu-btn" title="More" data-video="' + esc(t.videoId) + '"'
      + ' data-title="' + esc(t.title) + '" data-artist="' + esc(t.artist || '') + '"'
      + ' data-thumb="' + esc(t.thumbnail || '') + '" data-durationsec="' + Math.round(t.durationSec || 0) + '">'
      + '<svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><circle cx="12" cy="5" r="2"/><circle cx="12" cy="12" r="2"/><circle cx="12" cy="19" r="2"/></svg>'
      + '</button></div>';
  }

  function renderSections(sections) {
    var mobileMount = document.getElementById('mobileRecoRows');
    var desktopMount = document.getElementById('desktopRecoRows');
    function sectionsHtml(list) {
      return list && list.length ? list.map(function (s) {
        return '<div class="reco-section" data-kind="' + esc(s.kind) + '">'
          + '<div class="reco-section-title">' + esc(s.title) + '</div>'
          + '<div class="reco-row">' + s.tracks.map(recoCard).join('') + '</div>'
          + '</div>';
      }).join('') : '';
    }
    // v3.18.4: mobile Home already has its own "JUMP BACK IN / Recent Songs"
    // section (app.js renderMobileRecentSongs) — the engine's 'recent'
    // section duplicated it right below, so skip it on the mobile mount.
    var mobileSections = (sections || []).filter(function (s) { return s.kind !== 'recent'; });
    var mobileHtml = sectionsHtml(mobileSections);
    var desktopHtml = sectionsHtml(sections);

    if (mobileMount) {
      mobileMount.innerHTML = mobileHtml;
      if (mobileMount.parentElement) {
        mobileMount.parentElement.style.display = mobileHtml ? '' : 'none';
      }
    }
    if (desktopMount) desktopMount.innerHTML = desktopHtml;

    [[mobileMount, mobileHtml], [desktopMount, desktopHtml]].forEach(function (pair) {
      var mount = pair[0], html = pair[1];
      if (!mount || !html) return;
      mount.querySelectorAll('.reco-card').forEach(function (card) {
        card.addEventListener('click', function (e) {
          if (e.target.closest('.song-menu-btn')) return;
          var track = {
            videoId: card.dataset.video,
            title: card.dataset.title || 'Song',
            artist: card.dataset.artist || '',
            thumbnail: card.dataset.thumb || '',
            durationSec: Number(card.dataset.durationsec) || 0
          };
          if (window.player && window.player.playTrack) {
            window.player.playTrack(track, [track]);
          }
          var dock = document.getElementById('mobileMiniDock');
          if (dock) dock.style.display = 'flex';
          if (window.showToast) window.showToast('Playing ' + track.title);
        });
      });
    });
  }

  function refreshUi() {
    var sections = RecommendationEngine.getSections();
    renderSections(sections);
    return sections;
  }

  // ================= Exports + boot =================
  window.SimpMusicReco = RecommendationEngine;
  window.SimpMusicReco.BehaviorTracker = BehaviorTracker;
  window.SimpMusicReco.YouTubeFeeder = YouTubeFeeder;
  window.SimpMusicReco.render = refreshUi;

  function boot() {
    bindAutoTracking();
    bindLikeTracking();
    bindPlaylistTracking();
    refreshUi();
    // v3.19.8: async YouTube pipeline — local sections paint first, the
    // "From YouTube" rows merge in when the fetch + rank round-trip lands.
    setTimeout(function () { YouTubeFeeder.refresh(); }, 3000);
    RecommendationEngine.on('updated', renderSections);
    var homeBtn = document.getElementById('mobileNavHomeBtn');
    if (homeBtn) homeBtn.addEventListener('click', function () {
      setTimeout(refreshUi, 50);
    });
    setupOfflineBanner();
  }

  // ================= Offline banner (v3.7) =================
  // Persistent "offline — playing downloads" banner + one-time relink of
  // pre-v3.5.2 files via native search (so old downloads can play offline).
  function setupOfflineBanner() {
    var banner = document.getElementById('offlineBanner');
    if (!banner) return;
    function offline() {
      return (navigator.connection && navigator.connection.type === 'none')
        || navigator.onLine === false;
    }
    function render() {
      banner.style.display = offline() ? 'flex' : 'none';
    }
    window.addEventListener('online', render);
    window.addEventListener('offline', render);
    render();

    // Auto-relink legacy downloads once per install: resolve their videoIds
    // via native search while online and store them in the id map.
    try {
      if (localStorage.getItem('simpmusic_dl_relinked') === '1') return;
      if (offline()) return;
      var cap = window.Capacitor;
      if (!cap || !cap.isPluginAvailable || !cap.isPluginAvailable('SimpMusicDownload')) return;
      cap.Plugins.SimpMusicDownload.list().then(function (res) {
        var files = (res && res.files) || [];
        if (!files.length) { localStorage.setItem('simpmusic_dl_relinked', '1'); return; }
        var map = {};
        try { map = JSON.parse(localStorage.getItem('simpmusic_dl_ids') || '{}'); } catch (e) {}
        var todo = files.filter(function (f) {
          return f.fileName && !map[f.fileName]
            && !(f.videoId);
        });
        if (!todo.length) { localStorage.setItem('simpmusic_dl_relinked', '1'); return; }
        var chain = Promise.resolve();
        todo.slice(0, 10).forEach(function (f) {
          chain = chain.then(function () {
            return cap.Plugins.PlaybackKeeper.search({ query: f.title || '' })
              .then(function (r2) {
                var arr = [];
                try { arr = JSON.parse(r2.results || '[]'); } catch (e) {}
                var norm = (f.title || '').toLowerCase();
                var hit = arr.filter(function (x) { return (x.title || '').toLowerCase() === norm; })[0] || arr[0];
                if (hit && hit.videoId) {
                  map[f.fileName] = hit.videoId;
                  try { localStorage.setItem('simpmusic_dl_ids', JSON.stringify(map)); } catch (e) {}
                }
              }).catch(function () {});
          });
        });
        chain.then(function () { localStorage.setItem('simpmusic_dl_relinked', '1'); });
      }).catch(function () {});
    } catch (e) {}
  }
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
})();
