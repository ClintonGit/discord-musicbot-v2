const { SlashCommandBuilder } = require('discord.js');
const { useQueue } = require('discord-player');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('leave')
    .setDescription('ออกจาก voice channel'),

  async execute(interaction) {
    const queue = useQueue(interaction.guildId);

    if (queue) queue.delete();

    await interaction.reply('👋 ออกจาก voice channel แล้วค่ะ บอส~');
  },
};
