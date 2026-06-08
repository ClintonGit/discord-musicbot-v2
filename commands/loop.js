const { SlashCommandBuilder } = require('discord.js');
const { useQueue, QueueRepeatMode } = require('discord-player');

const MODES = {
  off: { mode: QueueRepeatMode.OFF, label: '❌ ปิด loop' },
  track: { mode: QueueRepeatMode.TRACK, label: '🔂 loop เพลงนี้' },
  queue: { mode: QueueRepeatMode.QUEUE, label: '🔁 loop ทั้ง queue' },
  autoplay: { mode: QueueRepeatMode.AUTOPLAY, label: '♾️ autoplay' },
};

module.exports = {
  data: new SlashCommandBuilder()
    .setName('loop')
    .setDescription('ตั้งค่า loop mode')
    .addStringOption(option =>
      option.setName('mode')
        .setDescription('เลือก mode')
        .setRequired(true)
        .addChoices(
          { name: 'ปิด', value: 'off' },
          { name: 'Loop เพลงนี้', value: 'track' },
          { name: 'Loop ทั้ง Queue', value: 'queue' },
          { name: 'Autoplay', value: 'autoplay' },
        )
    ),

  async execute(interaction) {
    const queue = useQueue(interaction.guildId);

    if (!queue?.isPlaying()) {
      return interaction.reply({ content: '❌ ไม่มีเพลงกำลังเล่นอยู่', flags: 64 });
    }

    const key = interaction.options.getString('mode');
    const { mode, label } = MODES[key];
    queue.setRepeatMode(mode);
    await interaction.reply(`${label} แล้ว`);
  },
};
