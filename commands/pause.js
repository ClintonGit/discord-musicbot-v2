const { SlashCommandBuilder } = require('discord.js');
const { useQueue } = require('discord-player');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('pause')
    .setDescription('หยุดเพลงชั่วคราว'),

  async execute(interaction) {
    const queue = useQueue(interaction.guildId);

    if (!queue?.isPlaying()) {
      return interaction.reply({ content: '❌ ไม่มีเพลงกำลังเล่นอยู่', flags: 64 });
    }

    queue.node.pause();
    await interaction.reply('⏸️ หยุดชั่วคราวแล้ว พิมพ์ /resume เพื่อเล่นต่อ');
  },
};
