const path = require('path');
const mode = process.env.NODE_ENV || 'development'
const isProd = mode === 'prod' || mode === 'production';
const envFile = isProd ? '.env.prod' : '.env.poc';
const envPath = path.join(__dirname, '..', envFile);
require('dotenv').config({ path: envPath });
const MyBot = require('./Bot');
const bot = new MyBot();

console.log("Token check:", process.env.DISCORD_TOKEN ? "Found!" : "Missing!");
console.log(`DEBUG: Logging in with token ending in: ...${process.env.DISCORD_TOKEN.slice(-5)}`);
bot.login(process.env.DISCORD_TOKEN);

process.on('unhandledRejection', error => {
    console.error('Unhandled promise rejection:', error);
});

process.on('uncaughtException', error => {
    console.error('Uncaught exception:', error);
});
