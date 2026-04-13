const { Client, GatewayIntentBits, Partials, Collection, ActivityType } = require('discord.js');
const fs = require('node:fs');
const path = require('node:path');
const ModMailManager = require('./managers/modMail');
const callResponseCooldown = new Map();

class MyBot extends Client {
    constructor() {
        super({
            intents: [
                GatewayIntentBits.Guilds,
                GatewayIntentBits.DirectMessages,
                GatewayIntentBits.GuildMessages,
                GatewayIntentBits.MessageContent,
                GatewayIntentBits.GuildPresences,
                GatewayIntentBits.GuildMembers
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
    this.on('ready', (c) => {
        const setBotStatus = () => {
            c.user.setActivity({
                name: process.env.NODE_ENV === 'production' ? 'Message me to get in touch with the Madocord team!' : 'with POC fuses',
                type: ActivityType.Listening
        });
    };

    setBotStatus(); 
    
    setInterval(setBotStatus, 3600000); 
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

    this.on('messageCreate', async (message) => {
        if (message.author.bot) return;
        const callResponse = {
            'school': 'I never went to school either...',
            'bomb': 'boom 💣',
            'pull the pin': 'boom 💣',
            'bomb devil': {
                content: 'boo!',
                files: ['./assets/reze-chainsaw-man-reze.gif']
            }
        }; 
        const content = message.content.toLowerCase().trim();
        for (const [trigger, response] of Object.entries(callResponse)) {
            if (content === trigger) {
                const now = Date.now();
                const cooldownLength = 5000;
                
                if (callResponseCooldown.has(trigger)) {
                    const expirationTime = callResponseCooldown.get(trigger) + cooldownLength;
                    if (now < expirationTime) {
                        return;
                    }
                }
                const payload = typeof response === 'string' ? { content: response } : response;
                await message.reply(payload);

                callResponseCooldown.set(message.author.id, now);
                return;
            }
        }

        if (message.guild === null) {
            this.modmail.handleDM(message);
        }
    });
}
}

module.exports = MyBot;