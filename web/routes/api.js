const { Router } = require('express');
const { useQueue, QueryType } = require('discord-player');
const rateLimit = require('express-rate-limit');
const prisma = require('../db');
const { getPlayer, getClient } = require('../state');

const router = Router();

// 30 req / 10s per IP
const limiter = rateLimit({
  windowMs: 10_000,
  max: 30,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many requests' },
});
router.use(limiter);

const requireAuth = (req, res, next) => {
  if (!req.session?.user) return res.status(401).json({ error: 'Unauthorized' });
  next();
};

const requireGuildMember = (req, res, next) => {
  const { id } = req.params;
  const member = req.session.user.guilds.find(g => g.id === id);
  if (!member) return res.status(403).json({ error: 'Forbidden' });
  next();
};

// GET /api/me
router.get('/me', requireAuth, (req, res) => {
  const { id, username, avatar } = req.session.user;
  res.json({ id, username, avatar });
});

// GET /api/guilds
router.get('/guilds', requireAuth, (req, res) => {
  const client = getClient();
  const userGuilds = req.session.user.guilds;
  const botGuilds = [...client.guilds.cache.values()].map(g => g.id);
  const shared = userGuilds.filter(g => botGuilds.includes(g.id));
  res.json(shared);
});

// GET /api/guilds/:id/queue
router.get('/guilds/:id/queue', requireAuth, requireGuildMember, async (req, res) => {
  const { id } = req.params;
  const queue = useQueue(id);

  if (!queue) return res.json({ currentTrack: null, tracks: [] });

  res.json({
    currentTrack: queue.currentTrack
      ? { title: queue.currentTrack.title, url: queue.currentTrack.url, duration: queue.currentTrack.duration, thumbnail: queue.currentTrack.thumbnail, author: queue.currentTrack.author }
      : null,
    tracks: queue.tracks.toArray().map((t, i) => ({
      index: i, title: t.title, url: t.url, duration: t.duration, thumbnail: t.thumbnail, author: t.author,
    })),
    isPlaying: queue.isPlaying(),
    isPaused: queue.node.isPaused(),
    volume: queue.node.volume,
  });
});

// POST /api/guilds/:id/queue — add track
// position: 'end' (default) | 'next' (insert at front) | 'now' (clear queue + play immediately)
router.post('/guilds/:id/queue', requireAuth, requireGuildMember, async (req, res) => {
  const { id } = req.params;
  const { query, position = 'end' } = req.body;
  if (!query) return res.status(400).json({ error: 'query required' });

  const client = getClient();
  const guild = client.guilds.cache.get(id);
  if (!guild) return res.status(404).json({ error: 'Guild not found' });

  const voiceState = guild.voiceStates.cache.get(req.session.user.id);
  const voiceChannel = voiceState?.channel;
  if (!voiceChannel) return res.status(400).json({ error: 'Join a voice channel first' });

  try {
    const player = getPlayer();
    const nodeOptions = {
      metadata: { channel: null },
      volume: 80,
      leaveOnEmpty: true,
      leaveOnEmptyCooldown: 5000,
      leaveOnEnd: true,
      leaveOnEndCooldown: 30000,
    };

    // Spotify playlist / album / artist — search then bulk-add
    const isSpotifyMulti = /spotify\.com\/(playlist|album|artist)\//.test(query);
    if (isSpotifyMulti) {
      const results = await player.search(query, { requestedBy: null, searchEngine: QueryType.AUTO });
      if (!results.hasTracks()) return res.status(404).json({ error: 'Playlist not found' });

      let queue = player.nodes.get(guild.id);
      if (!queue) queue = player.nodes.create(guild, nodeOptions);
      if (!queue.connection) await queue.connect(voiceChannel);

      queue.addTrack(results.tracks);
      if (!queue.isPlaying()) await queue.node.play();

      return res.json({
        playlist: true,
        name: results.playlist?.title ?? 'Spotify Playlist',
        count: results.tracks.length,
      });
    }

    // Play now — clear upcoming queue, add track at front, skip current
    if (position === 'now') {
      const results = await player.search(query, { requestedBy: null, searchEngine: QueryType.AUTO });
      if (!results.hasTracks()) return res.status(404).json({ error: 'Track not found' });

      let queue = player.nodes.get(guild.id);
      if (!queue) queue = player.nodes.create(guild, nodeOptions);
      if (!queue.connection) await queue.connect(voiceChannel);

      const track = results.tracks[0];
      queue.tracks.store.splice(0);
      queue.addTrack(track);
      if (queue.isPlaying()) queue.node.skip();
      else await queue.node.play();

      return res.json({ title: track.title, url: track.url, duration: track.duration, thumbnail: track.thumbnail, author: track.author });
    }

    // Play next — insert at front of upcoming queue
    if (position === 'next') {
      const results = await player.search(query, { requestedBy: null, searchEngine: QueryType.AUTO });
      if (!results.hasTracks()) return res.status(404).json({ error: 'Track not found' });

      let queue = player.nodes.get(guild.id);
      if (!queue) queue = player.nodes.create(guild, nodeOptions);
      if (!queue.connection) await queue.connect(voiceChannel);

      const track = results.tracks[0];
      queue.insertTrack(track, 0);
      if (!queue.isPlaying()) await queue.node.play();

      return res.json({ title: track.title, url: track.url, duration: track.duration, thumbnail: track.thumbnail, author: track.author });
    }

    // Default 'end' — player.play() adds to end of queue
    const { track } = await player.play(voiceChannel, query, { nodeOptions });
    res.json({ title: track.title, url: track.url, duration: track.duration, thumbnail: track.thumbnail, author: track.author });
  } catch (err) {
    console.error('Play error:', err.message);
    res.status(500).json({ error: 'Cannot add track, please try again' });
  }
});

// POST /api/guilds/:id/queue/:index/jump — jump to track, preserve preceding tracks
router.post('/guilds/:id/queue/:index/jump', requireAuth, requireGuildMember, async (req, res) => {
  const { id, index } = req.params;
  const queue = useQueue(id);
  if (!queue) return res.status(404).json({ error: 'No active queue' });

  const idx = parseInt(index);
  if (isNaN(idx) || idx < 0 || idx >= queue.tracks.size) {
    return res.status(400).json({ error: 'Invalid index' });
  }

  const tracks = queue.tracks.toArray();
  const jumped = tracks[idx];
  // jumped track first, tracks before it go after (stay accessible), tracks after remain at end
  const newOrder = [jumped, ...tracks.slice(0, idx), ...tracks.slice(idx + 1)];
  queue.tracks.store.splice(0, queue.tracks.store.length, ...newOrder);
  queue.node.skip();

  res.json({ ok: true });
});

// PUT /api/guilds/:id/queue/reorder
router.put('/guilds/:id/queue/reorder', requireAuth, requireGuildMember, async (req, res) => {
  const { id } = req.params;
  const { newOrder } = req.body;

  const queue = useQueue(id);
  if (!queue) return res.status(404).json({ error: 'No active queue' });

  const tracks = queue.tracks.toArray();
  if (!newOrder || newOrder.length !== tracks.length) {
    return res.status(400).json({ error: 'Invalid order' });
  }

  const reordered = newOrder.map(i => tracks[i]);
  // Atomic splice — avoids direct length mutation
  queue.tracks.store.splice(0, queue.tracks.store.length, ...reordered);

  res.json({ ok: true });
});

// DELETE /api/guilds/:id/queue/:index
router.delete('/guilds/:id/queue/:index', requireAuth, requireGuildMember, async (req, res) => {
  const { id, index } = req.params;
  const queue = useQueue(id);
  if (!queue) return res.status(404).json({ error: 'No active queue' });

  const idx = parseInt(index);
  if (isNaN(idx) || idx < 0 || idx >= queue.tracks.size) {
    return res.status(400).json({ error: 'Invalid index' });
  }

  queue.removeTrack(idx);
  res.json({ ok: true });
});

// POST /api/guilds/:id/controls/:action
router.post('/guilds/:id/controls/:action', requireAuth, requireGuildMember, async (req, res) => {
  const { id, action } = req.params;
  const queue = useQueue(id);

  if (!queue) return res.status(404).json({ error: 'No active queue' });

  try {
    switch (action) {
      case 'skip':        queue.node.skip(); break;
      case 'pause':       queue.node.pause(); break;
      case 'resume':      queue.node.resume(); break;
      case 'stop':        queue.delete(); break;
      case 'clearqueue':  queue.tracks.store.splice(0); break;
      case 'prev':
        if (typeof queue.history?.back === 'function') await queue.history.back();
        break;
      case 'volume': {
        const vol = parseInt(req.body.level ?? 80);
        queue.node.setVolume(Math.min(100, Math.max(0, vol)));
        break;
      }
      case 'seek': {
        const pos = parseInt(req.body.position ?? 0);
        if (!isNaN(pos) && pos >= 0) await queue.node.seek(pos);
        break;
      }
      default: return res.status(400).json({ error: 'Unknown action' });
    }
  } catch (err) {
    console.error(`Control error [${action}]:`, err.message);
    return res.status(500).json({ error: 'Action failed' });
  }

  res.json({ ok: true });
});

// GET /api/guilds/:id/channels — list text channels bot can message in
router.get('/guilds/:id/channels', requireAuth, requireGuildMember, (req, res) => {
  const client = getClient();
  const guild = client.guilds.cache.get(req.params.id);
  if (!guild) return res.status(404).json({ error: 'Guild not found' });

  const { ChannelType } = require('discord.js');
  const channels = [...guild.channels.cache.values()]
    .filter(c => c.type === ChannelType.GuildText && c.permissionsFor(guild.members.me)?.has('SendMessages'))
    .sort((a, b) => a.position - b.position)
    .map(c => ({ id: c.id, name: c.name }));
  res.json(channels);
});

// GET /api/guilds/:id/config
router.get('/guilds/:id/config', requireAuth, requireGuildMember, async (req, res) => {
  try {
    const guild = await prisma.guild.findUnique({ where: { id: req.params.id } });
    res.json({ notifyChannelId: guild?.notifyChannelId ?? null });
  } catch (err) {
    res.json({ notifyChannelId: null });
  }
});

// PUT /api/guilds/:id/config
router.put('/guilds/:id/config', requireAuth, requireGuildMember, async (req, res) => {
  const { notifyChannelId } = req.body;
  try {
    // Verify channel exists and bot can post there
    const client = getClient();
    const guild = client.guilds.cache.get(req.params.id);
    if (!guild) return res.status(404).json({ error: 'Guild not found' });

    if (notifyChannelId) {
      const { ChannelType } = require('discord.js');
      const ch = guild.channels.cache.get(notifyChannelId);
      if (!ch || ch.type !== ChannelType.GuildText) {
        return res.status(400).json({ error: 'ช่องไม่ถูกต้อง' });
      }
    }

    await prisma.guild.upsert({
      where: { id: req.params.id },
      update: { notifyChannelId: notifyChannelId || null },
      create: { id: req.params.id, name: guild?.name ?? req.params.id, notifyChannelId: notifyChannelId || null },
    });
    res.json({ ok: true });
  } catch (err) {
    console.error('Config save error:', err.message);
    res.status(500).json({ error: 'บันทึกไม่ได้' });
  }
});

// GET /api/guilds/:id/suggest — yt-dlp search for related tracks
router.get('/guilds/:id/suggest', requireAuth, requireGuildMember, async (req, res) => {
  const { q } = req.query;
  if (!q) return res.json([]);
  try {
    const ytdlExec = require('youtube-dl-exec');
    const result = await ytdlExec(`ytsearch8:${q}`, {
      dumpSingleJson: true,
      noWarnings: true,
      flatPlaylist: true,
    });
    const entries = result.entries ?? [result];

    // Keep only music-like results: 1–20 min, skip Shorts
    const isMusic = e =>
      e.duration >= 60 && e.duration <= 1200 &&
      !/\/shorts\//i.test(e.url || '');

    const filtered = entries.filter(isMusic);
    // Fall back to unfiltered if too few music results
    const pool = filtered.length >= 3 ? filtered : entries;

    res.json(pool.slice(0, 5).map(e => {
      const videoId = e.id || (e.url || '').match(/[?&]v=([A-Za-z0-9_-]{11})/)?.[1];
      return {
        title: e.title,
        url: e.url || `https://www.youtube.com/watch?v=${e.id}`,
        duration: e.duration ? formatDur(e.duration) : '—',
        thumbnail: videoId ? `https://i.ytimg.com/vi/${videoId}/mqdefault.jpg` : (e.thumbnail || ''),
        author: e.uploader || e.channel || '',
      };
    }));
  } catch (err) {
    console.error('Suggest error:', err.message);
    res.json([]);
  }
});

function formatDur(s) {
  if (!s) return '—';
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), sec = Math.floor(s % 60);
  return h > 0 ? `${h}:${String(m).padStart(2,'0')}:${String(sec).padStart(2,'0')}` : `${m}:${String(sec).padStart(2,'0')}`;
}

// GET /api/proxy-image — proxy ytimg with CORS headers for canvas color extraction
router.get('/proxy-image', async (req, res) => {
  const { url } = req.query;
  if (!url) return res.status(400).end();
  if (!/^https:\/\/i\.ytimg\.com\//.test(url)) return res.status(403).end();
  try {
    const https = require('https');
    const request = https.get(url, (imgRes) => {
      res.setHeader('Access-Control-Allow-Origin', '*');
      res.setHeader('Content-Type', imgRes.headers['content-type'] || 'image/jpeg');
      res.setHeader('Cache-Control', 'public, max-age=3600');
      imgRes.pipe(res);
    });
    request.on('error', () => res.status(500).end());
  } catch {
    res.status(500).end();
  }
});

// GET /api/guilds/:id/history
router.get('/guilds/:id/history', requireAuth, requireGuildMember, async (req, res) => {
  const { id } = req.params;
  try {
    const history = await prisma.playHistory.findMany({
      where: { guildId: id },
      orderBy: { playedAt: 'desc' },
      take: 20,
    });
    res.json(history);
  } catch (err) {
    console.error('History fetch error:', err.message);
    res.json([]);
  }
});

module.exports = router;
