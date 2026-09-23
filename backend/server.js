/**
 * SimpMusic Ecosystem Backend Server
 * Express Server with YouTube Music Scraper & LRCLIB Lyrics API
 */

const express = require('express');
const cors = require('cors');
const path = require('path');
const { searchSongs, getSuggestions, getTrending, getLyrics } = require('./scraper');

const app = express();
const PORT = process.env.PORT || 3000;

// Enable CORS for web, extensions, and mobile
app.use(cors({
  origin: '*',
  methods: ['GET', 'POST', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization']
}));

app.use(express.json());

// Cache control headers for fast repeat loads
app.use('/api', (req, res, next) => {
  if (req.method === 'GET' && req.path !== '/health') {
    res.setHeader('Cache-Control', 'public, max-age=300, stale-while-revalidate=600');
  }
  next();
});

// Serve static frontend files from web directory with client-side caching
const webPath = path.join(__dirname, '..', 'web');
app.use(express.static(webPath, {
  maxAge: '2h',
  etag: true
}));

// API: Health Check
app.get('/api/health', (req, res) => {
  res.json({
    status: 'ok',
    version: '1.0.0',
    service: 'SimpMusic Ecosystem API',
    timestamp: new Date().toISOString()
  });
});

// API: Search
app.get('/api/search', async (req, res) => {
  const query = req.query.q || '';
  if (!query.trim()) {
    return res.json([]);
  }
  try {
    const results = await searchSongs(query);
    res.json(results);
  } catch (err) {
    console.error('Search error:', err);
    res.status(500).json({ error: 'Search failed', details: err.message });
  }
});

// API: Suggestions
app.get('/api/suggestions', async (req, res) => {
  const query = req.query.q || '';
  try {
    const suggestions = await getSuggestions(query);
    res.json(suggestions);
  } catch (err) {
    console.error('Suggestions error:', err);
    res.json([]);
  }
});

// API: Trending
app.get('/api/trending', async (req, res) => {
  const genre = req.query.genre || 'global';
  try {
    const tracks = await getTrending(genre);
    res.json(tracks);
  } catch (err) {
    console.error('Trending error:', err);
    res.status(500).json({ error: 'Trending fetch failed', details: err.message });
  }
});

// API: Lyrics (LRCLIB synced lyrics)
app.get('/api/lyrics', async (req, res) => {
  const { title, artist, duration } = req.query;
  if (!title) {
    return res.status(400).json({ error: 'title query parameter is required' });
  }
  try {
    const lyricsData = await getLyrics(title, artist, parseFloat(duration) || 0);
    res.json(lyricsData);
  } catch (err) {
    console.error('Lyrics error:', err);
    res.status(500).json({ error: 'Lyrics fetch failed', details: err.message });
  }
});

// Fallback for SPA routing
app.get('*', (req, res) => {
  if (req.path.startsWith('/api/')) {
    return res.status(404).json({ error: 'Not found' });
  }
  res.sendFile(path.join(webPath, 'index.html'));
});

// Start Server
app.listen(PORT, '0.0.0.0', () => {
  console.log(`====================================================`);
  console.log(`🎵 SimpMusic Ecosystem Server running!`);
  console.log(`📡 Local Web App: http://localhost:${PORT}`);
  console.log(`🔗 API Endpoints:`);
  console.log(`   - Search:      http://localhost:${PORT}/api/search?q=:query`);
  console.log(`   - Suggestions: http://localhost:${PORT}/api/suggestions?q=:query`);
  console.log(`   - Trending:    http://localhost:${PORT}/api/trending?genre=:genre`);
  console.log(`   - Lyrics:      http://localhost:${PORT}/api/lyrics?title=:title&artist=:artist`);
  console.log(`====================================================`);
});
