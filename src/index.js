require('dotenv').config();
const MyBot = require('./Bot');

const bot = new MyBot();
bot.login(process.env.DISCORD_TOKEN);