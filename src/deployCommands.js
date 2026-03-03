const {REST, Routes} = require('discord.js');
const path = require('path');
const fs = require('fs');
const mode = process.env.NODE_ENV || 'development';
const isProd = mode === 'prod' || mode === 'production';
const envFile = isProd ? '.env.prod' : '.env.poc';
const envPath = path.resolve(process.cwd(), envFile);
require('dotenv').config({ path: envPath });
console.log("Token check:", process.env.DISCORD_TOKEN ? "Token exists!" : "Token is UNDEFINED");

console.log(`Deploying to: ${isProd ? 'PRODUCTION' : 'POC'}`);
if (!process.env.DISCORD_TOKEN) {
    console.error(`Token is UNDEFINED in ${envPath}`);
    process.exit(1);
}
const commands = [];
const commandsPath = path.join(__dirname, 'commands');
const commandFiles = fs.readdirSync(commandsPath).filter(file => file.endsWith('.js'));

for (const file of commandFiles) {
    const command = require(path.join(commandsPath, file));
    commands.push(command.data.toJSON());
}

const rest = new REST({ version: '10' }).setToken(process.env.DISCORD_TOKEN);

(async () => {
    try {
        console.log(`Started refreshing ${commands.length} slash commands.`);
        await rest.put(
            Routes.applicationGuildCommands(process.env.CLIENT_ID, process.env.GUILD_ID),
            { body: commands },
        );
        console.log('Successfully reloaded slash commands.');
    } catch (error) {
        console.error(error);
    }
})();