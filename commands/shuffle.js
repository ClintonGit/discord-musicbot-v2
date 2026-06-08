const { SlashCommandBuilder } = require('discord.js');
const { useQueue } = require('discord-player');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('shuffle')
    .setDescription('สุ่มเพลงใน queue'),

  async execute(interaction) {
    const queue = useQueue(interaction.guildId);

    if (!queue || queue.tracks.size < 2) {
      return interaction.reply({ content: '❌ ต้องมีเพลงใน queue อย่างน้อย 2 เพลง', flags: 64 });
    }

    queue.tracks.shuffle();
    await interaction.reply(`🔀 สุ่ม queue แล้ว มีเพลงทั้งหมด ${queue.tracks.size} เพลง`);
  },
};
