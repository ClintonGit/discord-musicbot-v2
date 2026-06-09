require('dotenv').config();

// Suppress verbose youtubei.js debug warnings (non-fatal noise)
const _warn = console.warn;
console.warn = (...a) => {
  if (typeof a[0] === 'string' && a[0].startsWith('[YOUTUBEJS]')) return;
  _warn.apply(console, a);
};

const { Client, GatewayIntentBits, Collection, ChannelType, ActivityType, ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder } = require('discord.js');
const { Player, useQueue } = require('discord-player');
const { DefaultExtractors, SpotifyExtractor } = require('@discord-player/extractor');
const { YoutubeiExtractor } = require('discord-player-youtubei');
const fs = require('fs');
const path = require('path');
const { setPlayer, setClient } = require('./web/state');
const { startWebServer } = require('./web/server');
const prisma = require('./web/db');

// Track the now-playing message per guild so we can edit it instead of spamming new ones
const nowPlayingMessages = new Map();

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildVoiceStates,
    GatewayIntentBits.GuildMessages,
  ],
});

const player = new Player(client);
setPlayer(player);
setClient(client);


(async () => {
  const cookiesFile = path.join(__dirname, 'cookies.txt');
  let youtubeCookie = '';
  if (fs.existsSync(cookiesFile)) {
    const lines = fs.readFileSync(cookiesFile, 'utf8').split('\n');
    youtubeCookie = lines
      .filter(l => !l.startsWith('#') && l.trim())
      .map(l => l.split('\t'))
      .filter(p => p.length >= 7 && p[0].includes('youtube.com'))
      .map(p => `${p[5]}=${p[6]}`)
      .join('; ');
  }

  await player.extractors.register(YoutubeiExtractor, {
    cookie: youtubeCookie || undefined,
    // [youtube-potoken] po_token helps bypass YouTube bot detection where available
    generateWithPoToken: true,
  });
  console.log(`🍪 YoutubeiExtractor: cookie=${!!youtubeCookie} poToken=true`);

  // Spotify (ต้องการ CLIENT_ID + SECRET)
  if (process.env.SPOTIFY_CLIENT_ID && process.env.SPOTIFY_CLIENT_SECRET) {
    await player.extractors.register(SpotifyExtractor, {
      clientId: process.env.SPOTIFY_CLIENT_ID,
      clientSecret: process.env.SPOTIFY_CLIENT_SECRET,
    });
    console.log('🟢 Spotify extractor โหลดแล้ว');
  } else {
    console.warn('⚠️  SPOTIFY_CLIENT_ID/SECRET ไม่ได้ตั้งค่า — Spotify ลิงก์จะไม่ทำงาน');
  }

  // SoundCloud + อื่นๆ (ไม่ต้อง token)
  await player.extractors.loadMulti(DefaultExtractors);
  console.log('🎵 Extractors โหลดแล้ว');
})();

client.commands = new Collection();
const commandsPath = path.join(__dirname, 'commands');
const commandFiles = fs.readdirSync(commandsPath).filter(f => f.endsWith('.js'));
for (const file of commandFiles) {
  const command = require(path.join(commandsPath, file));
  client.commands.set(command.data.name, command);
}

client.on('interactionCreate', async interaction => {
  // Button interactions from now-playing messages
  if (interaction.isButton()) {
    const queue = useQueue(interaction.guildId);
    if (!queue) return interaction.reply({ content: '❌ ไม่มีเพลงกำลังเล่น', flags: 64 });
    try {
      if (interaction.customId === 'btn_pause') {
        if (queue.node.isPaused()) {
          queue.node.resume();
          await interaction.reply({ content: '▶️ เล่นต่อแล้ว', flags: 64 });
        } else {
          queue.node.pause();
          await interaction.reply({ content: '⏸ หยุดชั่วคราวแล้ว', flags: 64 });
        }
      } else if (interaction.customId === 'btn_skip') {
        queue.node.skip();
        await interaction.reply({ content: '⏭ ข้ามแล้ว', flags: 64 });
      } else if (interaction.customId === 'btn_prev') {
        if (typeof queue.history?.back === 'function') await queue.history.back();
        await interaction.reply({ content: '⏮ ย้อนกลับแล้ว', flags: 64 });
      } else if (interaction.customId === 'btn_stop') {
        queue.delete();
        await interaction.reply({ content: '⏹ หยุดเล่นแล้ว', flags: 64 });
      }
    } catch (err) {
      console.error('[button]', err.message);
      if (!interaction.replied) await interaction.reply({ content: '❌ เกิดข้อผิดพลาด', flags: 64 });
    }
    return;
  }

  if (!interaction.isChatInputCommand()) return;
  const command = client.commands.get(interaction.commandName);
  if (!command) return;
  try {
    await command.execute(interaction, player);
  } catch (error) {
    console.error(error);
    const reply = { content: '❌ เกิดข้อผิดพลาด ลองใหม่อีกที', flags: 64 };
    if (interaction.replied || interaction.deferred) {
      await interaction.followUp(reply);
    } else {
      await interaction.reply(reply);
    }
  }
});

player.events.on('playerStart', async (queue, track) => {
  // Update bot presence
  try {
    client.user.setActivity({ name: `${track.title}`, type: ActivityType.Listening });
  } catch (_) {}

  // Resolve notify channel: DB config → slash-command channel → first writable text channel
  let notifyChannel = queue.metadata?.channel ?? null;
  try {
    const guildRow = await prisma.guild.findUnique({ where: { id: queue.guild.id } });
    if (guildRow?.notifyChannelId) {
      notifyChannel = queue.guild.channels.cache.get(guildRow.notifyChannelId) ?? notifyChannel;
    }
  } catch (_) {}
  if (!notifyChannel) {
    notifyChannel = queue.guild.channels.cache.find(
      c => c.type === ChannelType.GuildText &&
           c.permissionsFor(queue.guild.members.me)?.has('SendMessages')
    );
  }
  const embed = new EmbedBuilder()
    .setColor(0x3B82F6)
    .setAuthor({ name: '▶  กำลังเล่น', iconURL: client.user.displayAvatarURL() })
    .setTitle(track.title)
    .setURL(track.url || null)
    .setDescription(`**${track.author || 'Unknown'}**  ·  \`${track.duration || '—'}\``)
    .setImage(track.thumbnail || null)
    .setFooter({ text: 'MusicBot', iconURL: client.user.displayAvatarURL() });

  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId('btn_prev').setLabel('⏮').setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId('btn_pause').setLabel('⏸ Pause').setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId('btn_skip').setLabel('⏭ Next').setStyle(ButtonStyle.Primary),
    new ButtonBuilder().setCustomId('btn_stop').setLabel('⏹').setStyle(ButtonStyle.Danger),
    new ButtonBuilder().setURL(process.env.REDIRECT_URI?.replace('/auth/callback', '') || 'https://music.commsk.dev').setLabel('Dashboard').setStyle(ButtonStyle.Link),
  );

  const msgPayload = { content: '', embeds: [embed], components: [row] };
  const existingMsg = nowPlayingMessages.get(queue.guild.id);
  if (existingMsg) {
    try {
      await existingMsg.edit(msgPayload);
    } catch {
      // Message was deleted or too old — send a new one
      nowPlayingMessages.delete(queue.guild.id);
      const msg = await notifyChannel?.send(msgPayload);
      if (msg) nowPlayingMessages.set(queue.guild.id, msg);
    }
  } else if (notifyChannel) {
    const msg = await notifyChannel.send(msgPayload);
    if (msg) nowPlayingMessages.set(queue.guild.id, msg);
  }

  // บันทึกลง DB
  try {
    const guild = queue.guild;
    await prisma.guild.upsert({
      where: { id: guild.id },
      update: { name: guild.name, iconUrl: guild.iconURL() },
      create: { id: guild.id, name: guild.name, iconUrl: guild.iconURL() },
    });
    await prisma.playHistory.create({
      data: {
        guildId: guild.id,
        title: track.title,
        url: track.url,
        duration: track.duration,
        author: track.author,
      },
    });
  } catch (err) {
    console.error('DB error (playerStart):', err.message);
  }
});

player.events.on('emptyQueue', queue => {
  console.log(`[emptyQueue] guild=${queue.guild.id}`);
  nowPlayingMessages.delete(queue.guild.id);
  try { client.user.setActivity(null); } catch (_) {}
});

player.events.on('playerError', (queue, error, track) => {
  console.error(`[playerError] track="${track?.title}" error=${error?.message ?? error}`);
  console.error(`[playerError] stack=${error?.stack ?? 'no stack'}`);
});

player.events.on('playerSkip', (queue, track, reason, payload) => {
  console.log(`[playerSkip] skipped="${track?.title}" reason=${reason} payload=${payload}`);
});

player.events.on('debug', (queue, msg) => {
  // Log only non-verbose debug messages
  if (msg && (msg.includes('error') || msg.includes('Error') || msg.includes('stream') || msg.includes('extract') || msg.includes('fail'))) {
    console.log(`[debug] ${msg}`);
  }
});

player.events.on('disconnect', queue => {
  console.log(`[disconnect] guild=${queue.guild.id}`);
});

player.events.on('error', (queue, error) => {
  console.error(`[error] guild=${queue?.guild?.id} error=${error?.message ?? error}`);
});

client.once('clientReady', () => {
  console.log(`✅ ${client.user.tag} พร้อมแล้ว`);
  startWebServer(player, client);
});

client.login(process.env.DISCORD_TOKEN);
