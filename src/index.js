const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '../.env') });

const MyBot = require('./Bot');
const bot = new MyBot();

console.log("Token check:", process.env.DISCORD_TOKEN ? "Found!" : "Missing!");
bot.login(process.env.DISCORD_TOKEN);

process.on('unhandledRejection', error => {
    console.error('Unhandled promise rejection:', error);
});

process.on('uncaughtException', error => {
    console.error('Uncaught exception:', error);
});