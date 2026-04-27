const { Router } = require('express');
const { useQueue } = require('discord-player');
const prisma = require('../db');
const { getPlayer, getClient } = require('../state');

const router = Router();

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

// GET /api/guilds — guilds ที่ user อยู่ AND bot อยู่
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
router.post('/guilds/:id/queue', requireAuth, requireGuildMember, async (req, res) => {
  const { id } = req.params;
  const { query } = req.body;
  if (!query) return res.status(400).json({ error: 'query required' });

  const client = getClient();
  const guild = client.guilds.cache.get(id);
  if (!guild) return res.status(404).json({ error: 'Guild not found' });

  const voiceChannel = guild.members.cache.find(
    m => m.user.id === req.session.user.id && m.voice.channel
  )?.voice.channel;

  if (!voiceChannel) {
    return res.status(400).json({ error: 'เข้า voice channel ก่อนนะคะ' });
  }

  try {
    const player = getPlayer();
    const { track } = await player.play(voiceChannel, query, {
      nodeOptions: {
        metadata: { channel: null },
        volume: 80,
        leaveOnEmpty: true,
        leaveOnEmptyCooldown: 5000,
        leaveOnEnd: true,
        leaveOnEndCooldown: 30000,
      },
    });

    res.json({
      title: track.title, url: track.url, duration: track.duration,
      thumbnail: track.thumbnail, author: track.author,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// PUT /api/guilds/:id/queue/reorder — drag-drop reorder [{ from, to }]
router.put('/guilds/:id/queue/reorder', requireAuth, requireGuildMember, async (req, res) => {
  const { id } = req.params;
  const { newOrder } = req.body; // array of original indices in new order

  const queue = useQueue(id);
  if (!queue) return res.status(404).json({ error: 'No active queue' });

  const tracks = queue.tracks.toArray();
  if (!newOrder || newOrder.length !== tracks.length) {
    return res.status(400).json({ error: 'Invalid order' });
  }

  // Clear and re-insert in new order
  const reordered = newOrder.map(i => tracks[i]);
  queue.tracks.store.length = 0;
  reordered.forEach(t => queue.tracks.store.push(t));

  res.json({ ok: true });
});

// DELETE /api/guilds/:id/queue/:index — remove track at index
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

  switch (action) {
    case 'skip':   queue.node.skip(); break;
    case 'pause':  queue.node.pause(); break;
    case 'resume': queue.node.resume(); break;
    case 'stop':   queue.delete(); break;
    case 'volume': {
      const vol = parseInt(req.body.level ?? 80);
      queue.node.setVolume(Math.min(100, Math.max(0, vol)));
      break;
    }
    default: return res.status(400).json({ error: 'Unknown action' });
  }

  res.json({ ok: true });
});

// GET /api/guilds/:id/history
router.get('/guilds/:id/history', requireAuth, requireGuildMember, async (req, res) => {
  const { id } = req.params;
  const history = await prisma.playHistory.findMany({
    where: { guildId: id },
    orderBy: { playedAt: 'desc' },
    take: 20,
  });
  res.json(history);
});

module.exports = router;
