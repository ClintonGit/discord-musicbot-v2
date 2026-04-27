const { Router } = require('express');
const { useQueue } = require('discord-player');
const prisma = require('../db');
const { getPlayer, getClient } = require('../state');

const router = Router({ mergeParams: true });

const requireAuth = (req, res, next) => {
  if (!req.session?.user) return res.status(401).json({ error: 'Unauthorized' });
  next();
};

const requireGuildMember = (req, res, next) => {
  const member = req.session.user.guilds.find(g => g.id === req.params.id);
  if (!member) return res.status(403).json({ error: 'Forbidden' });
  next();
};

// GET /api/guilds/:id/playlists
router.get('/', requireAuth, requireGuildMember, async (req, res) => {
  const { id } = req.params;
  try {
    const playlists = await prisma.playlist.findMany({
      where: { guildId: id },
      orderBy: { createdAt: 'desc' },
      include: { tracks: { orderBy: { position: 'asc' } } },
    });
    res.json(playlists);
  } catch (err) {
    console.error('Playlist fetch error:', err.message);
    res.json([]);
  }
});

// POST /api/guilds/:id/playlists — create from current queue or track list
router.post('/', requireAuth, requireGuildMember, async (req, res) => {
  const { id } = req.params;
  const { name, tracks } = req.body;

  if (!name?.trim()) return res.status(400).json({ error: 'ต้องใส่ชื่อ playlist ' });
  if (!Array.isArray(tracks) || !tracks.length) {
    return res.status(400).json({ error: 'ต้องมีเพลงอย่างน้อย 1 เพลง' });
  }

  try {
    // Ensure guild exists in DB
    const client = getClient();
    const guild = client.guilds.cache.get(id);
    if (guild) {
      await prisma.guild.upsert({
        where: { id },
        update: { name: guild.name, iconUrl: guild.iconURL() },
        create: { id, name: guild.name, iconUrl: guild.iconURL() },
      });
    }

    const playlist = await prisma.playlist.create({
      data: {
        guildId: id,
        name: name.trim(),
        createdBy: req.session.user.id,
        tracks: {
          create: tracks.slice(0, 200).map((t, i) => ({
            position: i,
            title: t.title ?? 'Unknown',
            url: t.url ?? '',
            duration: t.duration ?? '0:00',
            thumbnail: t.thumbnail ?? '',
            author: t.author ?? 'Unknown',
          })),
        },
      },
      include: { tracks: { orderBy: { position: 'asc' } } },
    });
    res.json(playlist);
  } catch (err) {
    console.error('Playlist create error:', err.message);
    res.status(500).json({ error: 'สร้าง playlist ไม่ได้' });
  }
});

// POST /api/guilds/:id/playlists/:pid/play — load playlist into queue
router.post('/:pid/play', requireAuth, requireGuildMember, async (req, res) => {
  const { id, pid } = req.params;

  const playlist = await prisma.playlist.findFirst({
    where: { id: pid, guildId: id },
    include: { tracks: { orderBy: { position: 'asc' } } },
  });

  if (!playlist) return res.status(404).json({ error: 'ไม่พบ playlist ' });
  if (!playlist.tracks.length) return res.status(400).json({ error: 'Playlist ว่างอยู่' });

  const client = getClient();
  const guild = client.guilds.cache.get(id);
  if (!guild) return res.status(404).json({ error: 'Guild not found' });

  const voiceState = guild.voiceStates.cache.get(req.session.user.id);
  const voiceChannel = voiceState?.channel;
  if (!voiceChannel) return res.status(400).json({ error: 'เข้า voice channel ก่อน' });

  try {
    const player = getPlayer();
    const { Track } = require('discord-player');

    // Get or create queue
    let queue = player.nodes.get(guild.id);
    if (!queue) {
      queue = player.nodes.create(guild, {
        metadata: { channel: null },
        volume: 80,
        leaveOnEmpty: true,
        leaveOnEmptyCooldown: 5000,
        leaveOnEnd: true,
        leaveOnEndCooldown: 30000,
      });
    }

    if (!queue.connection) await queue.connect(voiceChannel);

    // Build Track objects from saved playlist
    for (const t of playlist.tracks) {
      const track = new Track(player, {
        title: t.title,
        url: t.url,
        duration: t.duration,
        thumbnail: t.thumbnail,
        author: t.author,
        requestedBy: null,
        source: 'arbitrary',
      });
      queue.addTrack(track);
    }

    if (!queue.isPlaying()) await queue.node.play();

    res.json({ ok: true, count: playlist.tracks.length, name: playlist.name });
  } catch (err) {
    console.error('Playlist play error:', err.message);
    res.status(500).json({ error: 'โหลด playlist ไม่ได้ ลองใหม่อีกที' });
  }
});

// DELETE /api/guilds/:id/playlists/:pid
router.delete('/:pid', requireAuth, requireGuildMember, async (req, res) => {
  const { id, pid } = req.params;
  try {
    const playlist = await prisma.playlist.findFirst({ where: { id: pid, guildId: id } });
    if (!playlist) return res.status(404).json({ error: 'ไม่พบ playlist ' });

    await prisma.playlist.delete({ where: { id: pid } });
    res.json({ ok: true });
  } catch (err) {
    console.error('Playlist delete error:', err.message);
    res.status(500).json({ error: 'ลบ playlist ไม่ได้' });
  }
});

module.exports = router;
