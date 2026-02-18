const { Client, GatewayIntentBits, Partials } = require('discord.js');
const ModMailManager = require('./managers/ModMail');

class MyBot extends Client {
    constructor() {
        super({
            intents: [
                GatewayIntentBits.Guilds,
                GatewayIntentBits.GuildMessages,
                GatewayIntentBits.MessageContent,
                GatewayIntentBits.DirectMessages,
                GatewayIntentBits.GuildVoiceStates
            ],
            partials: [Partials.Channel]
        });

        this.modmail = new ModMailManager(this);
        this.setupEvents();
    }

    setupEvents() {
        this.once('ready', () => console.log(`🚀 ${this.user.tag} is online!`));

        this.on('messageCreate', (message) => {
            if (message.author.bot) return;
            
            // Handle DMs via the ModMail manager
            if (!message.guild) {
                this.modmail.handleIncomingDM(message);
            }
        });
        
        // Interaction listener for Slash Commands
        this.on('interactionCreate', async (interaction) => {
            if (!interaction.isChatInputCommand()) return;
            // logic for executing slash commands goes here
        });
    }
}

module.exports = MyBot;