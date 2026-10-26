const LavalinkManager = require('./managers/lavalinkManager');
const { Client, GatewayIntentBits, Partials, Collection, ActivityType, MessageFlags } = require('discord.js');
const fs = require('node:fs');
const path = require('node:path');
const ModMailManager = require('./managers/modMail');
const AutoModManager = require('./managers/autoMod');
const callResponseCooldown = new Map();

class MyBot extends Client {
    constructor() {
        super({
            intents: [
                GatewayIntentBits.Guilds,
                GatewayIntentBits.DirectMessages,
                GatewayIntentBits.GuildMessages,
                GatewayIntentBits.MessageContent,
                GatewayIntentBits.GuildVoiceStates,
                GatewayIntentBits.GuildPresences,
                GatewayIntentBits.GuildMembers
            ],
            partials: [Partials.Channel]
        });

        this.commands = new Collection();
        this.modmail = new ModMailManager(this);
        this.modMailManager = this.modmail;
        this.lavalinkManager = new LavalinkManager(this);
        this.autoMod = new AutoModManager(this);
        
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
    this.on('ready', async (c) => {
        if (this.modMailManager) {
            await this.modMailManager.rehydrateTickets();
        } else {
            console.error("ModMailManager not found on Bot instance!");
        }

        const setBotStatus = () => {
            c.user.setActivity({
                name: process.env.NODE_ENV === 'production' 
                    ? 'Message me to get in touch with the Madocord team!' 
                    : 'with POC fuses',
                type: ActivityType.Listening
            });
        };

    setBotStatus(); 
    
    setInterval(setBotStatus, 3600000); 

    let lastTick = Date.now();
    setInterval(() => {
        const now = Date.now();
        const lag = now - lastTick - 1000;
        lastTick = now;
        if (lag > 500) console.warn(`[Loop] Event loop was blocked for ~${lag}ms`);
    }, 1000).unref();
});

    this.on('interactionCreate', async (interaction) => {
        if (!interaction.isChatInputCommand()) return;

        const command = this.commands.get(interaction.commandName);
        if (!command) return;

        const age = Date.now() - interaction.createdTimestamp;
        if (age > 1500 || age < 0) {
            console.warn(`[Interaction] /${interaction.commandName} reached the handler ${age}ms after Discord created it (3000ms to acknowledge)`);
        }

        try {
            await command.execute(interaction);
        } catch (error) {
            if (error.code === 10062) {
                console.error(`[Interaction] /${interaction.commandName} expired before it could be acknowledged (handler age ${age}ms)`);
                return;
            }
            console.error("Command Error:", error);
            if (!interaction.replied && !interaction.deferred) {
                await interaction.reply({ content: 'Command had an error, check syntax', flags: MessageFlags.Ephemeral }).catch(() => {});
            }
        }
    });

    this.on('messageCreate', async (message) => {
        await this.autoMod.handleMessage(message);
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

                callResponseCooldown.set(trigger, now);
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