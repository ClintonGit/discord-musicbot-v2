const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('play')
    .setDescription('เล่นเพลงจาก YouTube / Spotify / SoundCloud')
    .addStringOption(option =>
      option.setName('query')
        .setDescription('ชื่อเพลงหรือ URL')
        .setRequired(true)
    ),

  async execute(interaction, player) {
    const voiceChannel = interaction.member?.voice?.channel;
    if (!voiceChannel) {
      return interaction.reply({ content: '❌ เข้า voice channel ก่อนนะคะ บอส!', flags: 64 });
    }

    const query = interaction.options.getString('query');
    await interaction.deferReply();

    const { track } = await player.play(voiceChannel, query, {
      nodeOptions: {
        metadata: {
          channel: interaction.channel,
        },
        volume: 80,
        leaveOnEmpty: true,
        leaveOnEmptyCooldown: 5000,
        leaveOnEnd: true,
        leaveOnEndCooldown: 30000,
      },
    });

    const embed = new EmbedBuilder()
      .setColor(0x9b59b6)
      .setTitle('🎵 เพิ่ม Queue แล้วค่ะ')
      .setDescription(`**[${track.title}](${track.url})**`)
      .addFields(
        { name: '👤 ศิลปิน', value: track.author, inline: true },
        { name: '⏱️ ความยาว', value: track.duration, inline: true },
      )
      .setThumbnail(track.thumbnail)
      .setFooter({ text: `ขอโดย ${interaction.user.displayName}` });

    await interaction.followUp({ embeds: [embed] });
  },
};
