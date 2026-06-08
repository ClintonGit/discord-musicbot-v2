const { SlashCommandBuilder } = require('discord.js');
const { useQueue } = require('discord-player');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('resume')
    .setDescription('เล่นเพลงต่อ'),

  async execute(interaction) {
    const queue = useQueue(interaction.guildId);

    if (!queue) {
      return interaction.reply({ content: '❌ ไม่มี queue อยู่', flags: 64 });
    }

    if (!queue.node.isPaused()) {
      return interaction.reply({ content: '▶️ เพลงกำลังเล่นอยู่แล้ว', flags: 64 });
    }

    queue.node.resume();
    await interaction.reply('▶️ เล่นต่อแล้ว');
  },
};
