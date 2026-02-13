const { ChannelType, PermissionsBitField, EmbedBuilder } = require('discord.js');

class ModMailManager {
    constructor(client, config) {
        this.client = client;
        this.categoryId = config.categoryId;
        this.guildId = config.guildId;
    }

    async handleDM(message) {
        const guild = this.client.guilds.cache.get(this.guildId);
        const category = guild.channels.cache.get(this.categoryId);
        const ticketName = `ticket-${message.author.username.toLowerCase()}`;

        // Find or Create Channel
        let channel = guild.channels.cache.find(c => c.name === ticketName);
        if (!channel) {
            channel = await guild.channels.create({
                name: ticketName,
                type: ChannelType.GuildText,
                parent: this.categoryId,
                topic: `UserID:${message.author.id}`,
                permissionOverwrites: [
                    { id: guild.id, deny: [PermissionsBitField.Flags.ViewChannel] }
                ]
            });
            
            const startEmbed = new EmbedBuilder()
                .setTitle('New ModMail Ticket')
                .setColor('#00ff00')
                .setDescription(`User: ${message.author.tag}\nID: ${message.author.id}`);
            await channel.send({ embeds: [startEmbed] });
        }

        // Forward the message
        await channel.send(`**${message.author.username}:** ${message.content}`);
    }
}

module.exports = ModMailManager;