const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const { useQueue } = require('discord-player');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('queue')
    .setDescription('ดู queue เพลงทั้งหมด'),

  async execute(interaction) {
    const queue = useQueue(interaction.guildId);

    if (!queue || queue.tracks.size === 0) {
      return interaction.reply({ content: '📋 Queue ว่างเปล่าอยู่ค่ะ', flags: 64 });
    }

    const current = queue.currentTrack;
    const tracks = queue.tracks.toArray().slice(0, 10);

    const description = [
      current ? `▶️ **กำลังเล่น:** ${current.title} — ${current.duration}` : '',
      '',
      ...tracks.map((t, i) => `\`${i + 1}.\` **${t.title}** — ${t.duration}`),
    ].join('\n');

    const embed = new EmbedBuilder()
      .setColor(0x9b59b6)
      .setTitle('📋 Queue เพลง')
      .setDescription(description.trim())
      .setFooter({ text: `ทั้งหมด ${queue.tracks.size} เพลงใน queue` });

    await interaction.reply({ embeds: [embed] });
  },
};
