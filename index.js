require('dotenv').config();
const { Client, GatewayIntentBits, Collection } = require('discord.js');
const { Player } = require('discord-player');
const { DefaultExtractors } = require('@discord-player/extractor');
const fs = require('fs');
const path = require('path');

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildVoiceStates,
    GatewayIntentBits.GuildMessages,
  ],
});

const player = new Player(client);

(async () => {
  await player.extractors.loadMulti(DefaultExtractors);
  console.log('🎵 Extractors โหลดแล้วค่ะ');
})();

client.commands = new Collection();

const commandsPath = path.join(__dirname, 'commands');
const commandFiles = fs.readdirSync(commandsPath).filter(f => f.endsWith('.js'));

for (const file of commandFiles) {
  const command = require(path.join(commandsPath, file));
  client.commands.set(command.data.name, command);
}

client.on('interactionCreate', async interaction => {
  if (!interaction.isChatInputCommand()) return;

  const command = client.commands.get(interaction.commandName);
  if (!command) return;

  try {
    await command.execute(interaction, player);
  } catch (error) {
    console.error(error);
    const reply = { content: '❌ เกิดข้อผิดพลาดค่ะ ลองใหม่อีกทีนะคะ', flags: 64 };
    if (interaction.replied || interaction.deferred) {
      await interaction.followUp(reply);
    } else {
      await interaction.reply(reply);
    }
  }
});

player.events.on('playerStart', (queue, track) => {
  queue.metadata.channel?.send(`▶️ กำลังเล่น **${track.title}** โดย ${track.author} ค่ะ`);
});

player.events.on('emptyQueue', queue => {
  queue.metadata.channel?.send('✅ Queue หมดแล้วค่ะ บอส~');
});

player.events.on('error', (queue, error) => {
  console.error('Player error:', error);
});

client.once('ready', () => {
  console.log(`✅ ${client.user.tag} พร้อมแล้วค่ะ บอส!`);
});

client.login(process.env.DISCORD_TOKEN);
