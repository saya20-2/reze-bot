const { Client, GatewayIntentBits, Partials, Collection } = require('discord.js');
const fs = require('node:fs');
const path = require('node:path');
const ModMailManager = require('./managers/modMail');

class MyBot extends Client {
    constructor() {
        super({
            intents: [
                GatewayIntentBits.Guilds,
                GatewayIntentBits.DirectMessages,
                GatewayIntentBits.GuildMessages,
                GatewayIntentBits.MessageContent,
            ],
            partials: [Partials.Channel]
        });

        this.commands = new Collection();
        this.modmail = new ModMailManager(this);
        
        this.loadCommands();
        this.setupEvents();
    }

    loadCommands() {
        const commandsPath = path.join(__dirname, 'commands');
        const commandFiles = fs.readdirSync(commandsPath).filter(file => file.endsWith('.js'));
        for (const file of commandFiles) {
            const command = require(path.join(commandsPath, file));
            this.commands.set(command.data.name, command);
        }
    }

    setupEvents() {
    this.once('ready', () => {
        console.log(`Registered ${this.commands.size} commands. Reze is online!`);
    });

    this.on('interactionCreate', async (interaction) => {
        if (!interaction.isChatInputCommand()) return;

        const command = this.commands.get(interaction.commandName);
        if (!command) return;

        try {
            await command.execute(interaction);
        } catch (error) {
            console.error("Command Error:", error);
            if (!interaction.replied && !interaction.deferred) {
                await interaction.reply({ content: 'Command had an error, check syntax', ephemeral: true });
            }
        }
    });

    this.on('messageCreate', (message) => {
        if (message.author.bot) return;

        if (message.guild === null) {
            this.modmail.handleIncomingDM(message);
        }
    });
}
}

module.exports = MyBot;