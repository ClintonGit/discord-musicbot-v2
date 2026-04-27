const express = require('express');
const { createServer } = require('http');
const { Server } = require('socket.io');
const session = require('express-session');
const path = require('path');
const { setIo } = require('./state');

const authRouter = require('./routes/auth');
const apiRouter = require('./routes/api');

function startWebServer(player, client) {
  const app = express();
  const httpServer = createServer(app);
  const io = new Server(httpServer);
  setIo(io);

  app.use(express.json());
  app.use(express.urlencoded({ extended: true }));
  app.use(session({
    secret: process.env.SESSION_SECRET || 'change_me_in_production',
    resave: false,
    saveUninitialized: false,
    cookie: { secure: process.env.NODE_ENV === 'production', maxAge: 7 * 24 * 60 * 60 * 1000 },
  }));

  app.use(express.static(path.join(__dirname, '..', 'public')));

  app.use('/auth', authRouter);
  app.use('/api', apiRouter);

  // Redirect to login if not authenticated
  app.get('/', (req, res) => {
    if (!req.session?.user) return res.redirect('/auth/login');
    res.sendFile(path.join(__dirname, '..', 'public', 'index.html'));
  });

  // Attach player events → Socket.io broadcasts
  player.events.on('playerStart', (queue, track) => {
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
    io.to(queue.guild.id).emit('queue:update', { currentTrack: null, tracks: [], isPlaying: false });
  });

  player.events.on('disconnect', (queue) => {
    io.to(queue.guild.id).emit('queue:update', { currentTrack: null, tracks: [], isPlaying: false });
  });

  io.on('connection', socket => {
    socket.on('join:guild', guildId => {
      socket.join(guildId);
    });
  });

  const PORT = process.env.DASHBOARD_PORT || 3000;
  httpServer.listen(PORT, () => {
    console.log(`🌐 Dashboard: http://localhost:${PORT}`);
  });

  return { app, io };
}

function buildQueuePayload(queue) {
  return {
    currentTrack: queue.currentTrack
      ? { title: queue.currentTrack.title, url: queue.currentTrack.url, duration: queue.currentTrack.duration, thumbnail: queue.currentTrack.thumbnail, author: queue.currentTrack.author }
      : null,
    tracks: queue.tracks.toArray().map((t, i) => ({
      index: i, title: t.title, url: t.url, duration: t.duration, thumbnail: t.thumbnail, author: t.author,
    })),
    isPlaying: queue.isPlaying(),
    volume: queue.node.volume,
  };
}

module.exports = { startWebServer };
