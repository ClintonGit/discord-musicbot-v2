const { SlashCommandBuilder } = require('discord.js');
const { useQueue } = require('discord-player');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('skip')
    .setDescription('ข้ามเพลงปัจจุบัน'),

  async execute(interaction) {
    const queue = useQueue(interaction.guildId);

    if (!queue?.isPlaying()) {
      return interaction.reply({ content: '❌ ไม่มีเพลงกำลังเล่นอยู่', flags: 64 });
    }

    const track = queue.currentTrack;
    queue.node.skip();
    await interaction.reply(`⏭️ ข้าม **${track.title}** แล้ว`);
  },
};
