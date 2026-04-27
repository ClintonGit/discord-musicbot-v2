const { SlashCommandBuilder } = require('discord.js');
const { useQueue } = require('discord-player');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('volume')
    .setDescription('ปรับระดับเสียง')
    .addIntegerOption(option =>
      option.setName('level')
        .setDescription('ระดับเสียง 0–100')
        .setMinValue(0)
        .setMaxValue(100)
        .setRequired(true)
    ),

  async execute(interaction) {
    const queue = useQueue(interaction.guildId);

    if (!queue?.isPlaying()) {
      return interaction.reply({ content: '❌ ไม่มีเพลงกำลังเล่นอยู่ค่ะ', flags: 64 });
    }

    const level = interaction.options.getInteger('level');
    queue.node.setVolume(level);
    await interaction.reply(`🔊 ปรับเสียงเป็น **${level}%** แล้วค่ะ`);
  },
};
