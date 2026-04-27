const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const { useQueue } = require('discord-player');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('nowplaying')
    .setDescription('ดูเพลงที่กำลังเล่นอยู่'),

  async execute(interaction) {
    const queue = useQueue(interaction.guildId);

    if (!queue?.currentTrack) {
      return interaction.reply({ content: '❌ ไม่มีเพลงกำลังเล่นอยู่ค่ะ', flags: 64 });
    }

    const track = queue.currentTrack;
    const progress = queue.node.createProgressBar();

    const embed = new EmbedBuilder()
      .setColor(0x9b59b6)
      .setTitle('🎵 กำลังเล่นอยู่ค่ะ')
      .setDescription(`**[${track.title}](${track.url})**\n\n${progress}`)
      .addFields(
        { name: '👤 ศิลปิน', value: track.author, inline: true },
        { name: '⏱️ ความยาว', value: track.duration, inline: true },
        { name: '🔊 Volume', value: `${queue.node.volume}%`, inline: true },
      )
      .setThumbnail(track.thumbnail);

    await interaction.reply({ embeds: [embed] });
  },
};
