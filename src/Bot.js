const { Client, GatewayIntentBits, Partials, Collection } = require('discord.js');
const ModMailManager = require('./managers/ModMail');

class DiscordBot {
    constructor() {
        this.client = new Client({
            intents: [
                GatewayIntentBits.Guilds,
                GatewayIntentBits.DirectMessages,
                GatewayIntentBits.GuildMessages,
                GatewayIntentBits.MessageContent
            ],
            partials: [Partials.Channel]
        });

        this.modmail = new ModMailManager(this.client, {
            categoryId: process.env.MODMAIL_CATEGORY_ID,
            guildId: process.env.GUILD_ID
        });

        this.setupEvents();
    }

    setupEvents() {
        this.client.on('ready', () => {
            console.log(`Logged in as ${this.client.user.tag}`);
            // Here you would register Slash Commands
        });

        this.client.on('messageCreate', (msg) => {
            if (msg.author.bot) return;
            if (!msg.guild) this.modmail.handleDM(msg);
        });

        // Slash Command Listener
        this.client.on('interactionCreate', async (interaction) => {
            if (!interaction.isChatInputCommand()) return;
            // Command execution logic goes here
        });
    }

    start(token) {
        this.client.login(token);
    }
}

module.exports = DiscordBot;