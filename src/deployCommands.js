require('dotenv').config();
const { REST, Routes } = require('discord.js');
const reply = require('./src/commands/reply');

const commands = [reply.data.toJSON()];

const rest = new REST({ version: '10' }).setToken(process.env.DISCORD_TOKEN);

(async () => {
    try {
        console.log('Refreshing Slash Commands...');
        await rest.put(
            Routes.applicationGuildCommands(process.env.CLIENT_ID, process.env.GUILD_ID),
            { body: commands },
        );
        console.log('Successfully registered /reply');
    } catch (error) {
        console.error(error);
    }
})();