const express = require('express');
const { createServer } = require('http');
const { Server } = require('socket.io');
const session = require('express-session');
const pgSession = require('connect-pg-simple')(session);
const path = require('path');
const { useQueue } = require('discord-player');
const { setIo } = require('./state');

const authRouter = require('./routes/auth');
const apiRouter = require('./routes/api');
const playlistRouter = require('./routes/playlists');

function startWebServer(player, client) {
  // Require a real session secret
  if (!process.env.SESSION_SECRET || process.env.SESSION_SECRET === 'change_me_in_production') {
    throw new Error('SESSION_SECRET must be set to a secure random value in .env');
  }

  const app = express();
  const httpServer = createServer(app);
  const io = new Server(httpServer);
  setIo(io);

  app.set('trust proxy', 1);
  app.use(express.json());
  app.use(express.urlencoded({ extended: true }));
  app.use(session({
    store: new pgSession({
      conString: process.env.DATABASE_URL,
      tableName: 'web_sessions',
      createTableIfMissing: true,
    }),
    secret: process.env.SESSION_SECRET,
    resave: false,
    saveUninitialized: false,
    rolling: true,
    cookie: {
      httpOnly: true,
      sameSite: 'lax',
      secure: false,
      maxAge: 30 * 24 * 60 * 60 * 1000,
    },
  }));

  app.use(express.static(path.join(__dirname, '..', 'public')));

  app.use('/auth', authRouter);
  app.use('/api', apiRouter);
  app.use('/api/guilds/:id/playlists', playlistRouter);

  app.get('/', (req, res) => {
    if (!req.session?.user) return res.redirect('/auth/login');
    res.sendFile(path.join(__dirname, '..', 'public', 'index.html'));
  });

  // Track guilds with active playback
  const activeGuilds = new Set();

  // Attach player events → Socket.io broadcasts
  player.events.on('playerStart', (queue, track) => {
    activeGuilds.add(queue.guild.id);
    io.to(queue.guild.id).emit('queue:update', buildQueuePayload(queue));
    io.to(queue.guild.id).emit('track:start', {
      title: track.title, url: track.url, duration: track.duration,
      thumbnail: track.thumbnail, author: track.author,
    });
  });

  player.events.on('audioTrackAdd', (queue) => {
    io.to(queue.guild.id).emit('queue:update', buildQueuePayload(queue));
  });

  player.events.on('playerSkip', (queue) => {
    io.to(queue.guild.id).emit('queue:update', buildQueuePayload(queue));
  });

  player.events.on('emptyQueue', (queue) => {
    activeGuilds.delete(queue.guild.id);
    io.to(queue.guild.id).emit('queue:update', { currentTrack: null, tracks: [], isPlaying: false });
    io.to(queue.guild.id).emit('progress:tick', { current: '0:00', total: '0:00', progress: 0 });
  });

  player.events.on('disconnect', (queue) => {
    activeGuilds.delete(queue.guild.id);
    io.to(queue.guild.id).emit('queue:update', { currentTrack: null, tracks: [], isPlaying: false });
    io.to(queue.guild.id).emit('progress:tick', { current: '0:00', total: '0:00', progress: 0 });
  });

  // Progress tick — self-healing: removes stale guild entries automatically
  const progressInterval = setInterval(() => {
    activeGuilds.forEach(guildId => {
      try {
        const queue = useQueue(guildId);
        if (!queue || !queue.isPlaying()) {
          activeGuilds.delete(guildId);
          return;
        }
        if (queue.node.isPaused()) return;
        const ts = queue.node.getTimestamp();
        if (ts) {
          io.to(guildId).emit('progress:tick', {
            current: ts.current.label,
            total: ts.total.label,
            progress: ts.progress,
          });
        }
      } catch (_) {
        activeGuilds.delete(guildId);
      }
    });
  }, 1000);

  io.on('connection', socket => {
    socket.on('join:guild', guildId => {
      socket.join(guildId);
      // Backfill current state immediately so client doesn't miss events
      const queue = useQueue(guildId);
      if (queue) {
        socket.emit('queue:update', buildQueuePayload(queue));
        if (queue.isPlaying()) {
          try {
            const ts = queue.node.getTimestamp();
            if (ts) {
              socket.emit('progress:tick', {
                current: ts.current.label,
                total: ts.total.label,
                progress: ts.progress,
              });
            }
          } catch (_) {}
        }
      }
    });
  });

  const PORT = process.env.DASHBOARD_PORT || 3000;
  httpServer.listen(PORT, () => {
    console.log(`🌐 Dashboard: http://localhost:${PORT}`);
  });

  // Graceful shutdown
  process.once('SIGTERM', () => clearInterval(progressInterval));
  process.once('SIGINT', () => clearInterval(progressInterval));

  return { app, io };
}

function buildQueuePayload(queue) {
  const tracks = queue.tracks.toArray();
  return {
    currentTrack: queue.currentTrack
      ? { title: queue.currentTrack.title, url: queue.currentTrack.url, duration: queue.currentTrack.duration, thumbnail: queue.currentTrack.thumbnail, author: queue.currentTrack.author }
      : null,
    tracks: tracks.map((t, i) => ({
      index: i, title: t.title, url: t.url, duration: t.duration, thumbnail: t.thumbnail, author: t.author,
    })),
    isPlaying: queue.isPlaying(),
    isPaused: queue.node.isPaused(),
    volume: queue.node.volume,
  };
}

module.exports = { startWebServer };
