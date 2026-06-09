const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');

// [ytdlp-stream] Use Python yt-dlp binary for reliable YouTube streaming
const YTDLP_BIN = process.env.YOUTUBE_DL_PATH || '/usr/local/bin/yt-dlp';
const COOKIES_PATH = path.join(__dirname, '..', 'cookies.txt');
const HAS_COOKIES = fs.existsSync(COOKIES_PATH);

function ytdlpStream(url) {
  const args = [url, '-f', 'bestaudio[ext=webm]/bestaudio[ext=opus]/bestaudio', '--no-playlist', '-o', '-', '-q'];
  if (HAS_COOKIES) args.push('--cookies', COOKIES_PATH);
  const proc = spawn(YTDLP_BIN, args);
  proc.stderr.on('data', d => { const m = d.toString().trim(); if (m) console.error('[ytdlp]', m); });
  return proc.stdout;
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName('play')
    .setDescription('เล่นเพลงจาก YouTube / Spotify / SoundCloud')
    .addStringOption(option =>
      option.setName('query')
        .setDescription('ชื่อเพลงหรือ URL')
        .setRequired(true)
    ),

  async execute(interaction, player) {
    const voiceChannel = interaction.member?.voice?.channel;
    if (!voiceChannel) {
      return interaction.reply({ content: '❌ เข้า voice channel ก่อนนะ', flags: 64 });
    }

    const query = interaction.options.getString('query');
    await interaction.deferReply();

    const { track } = await player.play(voiceChannel, query, {
      nodeOptions: {
        metadata: {
          channel: interaction.channel,
        },
        volume: 80,
        leaveOnEmpty: true,
        leaveOnEmptyCooldown: 5000,
        leaveOnEnd: true,
        leaveOnEndCooldown: 30000,
        // [ytdlp-stream] Intercept YouTube streams — use yt-dlp to avoid datacenter IP blocks
        onBeforeCreateStream: async (track, _method, _queue) => {
          const isYT = track.url && (track.url.includes('youtube.com') || track.url.includes('youtu.be'));
          if (!isYT) return null;
          try {
            return ytdlpStream(track.url);
          } catch (err) {
            console.error('[ytdlp stream]', err.message);
            return null;
          }
        },
      },
    });

    const embed = new EmbedBuilder()
      .setColor(0x9b59b6)
      .setTitle('🎵 เพิ่ม Queue แล้ว')
      .setDescription(`**[${track.title}](${track.url})**`)
      .addFields(
        { name: '👤 ศิลปิน', value: track.author, inline: true },
        { name: '⏱️ ความยาว', value: track.duration, inline: true },
      )
      .setThumbnail(track.thumbnail)
      .setFooter({ text: `ขอโดย ${interaction.user.displayName}` });

    await interaction.followUp({ embeds: [embed] });
  },
};
