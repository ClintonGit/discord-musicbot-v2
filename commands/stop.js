const { SlashCommandBuilder } = require('discord.js');
const { useQueue } = require('discord-player');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('stop')
    .setDescription('หยุดเล่นเพลงและล้าง queue'),

  async execute(interaction) {
    const queue = useQueue(interaction.guildId);

    if (!queue) {
      return interaction.reply({ content: '❌ ไม่มีเพลงกำลังเล่นอยู่ค่ะ', flags: 64 });
    }

    queue.delete();
    await interaction.reply('⏹️ หยุดเล่นและล้าง queue แล้วค่ะ บอส~');
  },
};
