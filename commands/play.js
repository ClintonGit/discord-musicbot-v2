const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const { raw: ytdlpRaw } = require('youtube-dl-exec');
const fs = require('fs');
const path = require('path');

const COOKIES_PATH = path.join(__dirname, '..', 'cookies.txt');
const HAS_COOKIES = fs.existsSync(COOKIES_PATH);

// [ytdlp-stream] Bypass YouTube bot detection by streaming via yt-dlp instead of youtubei
function ytdlpStream(url) {
  const opts = {
    output: '-',
    format: 'bestaudio[ext=webm]/bestaudio[ext=opus]/bestaudio',
    noPlaylist: true,
    quiet: true,
  };
  if (HAS_COOKIES) opts.cookies = COOKIES_PATH;
  const proc = ytdlpRaw(url, opts);
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
