const { ChannelType, PermissionsBitField, EmbedBuilder } = require('discord.js');

class ModMailManager {
    constructor(client) {
        this.client = client;
        this.categoryId = process.env.MODMAIL_CATEGORY_ID;
        this.guildId = process.env.GUILD_ID;
    }

    async handleDM(message) {
        const guild = this.client.guilds.cache.get(this.guildId);
        if (!guild) {
            return console.error("Reze got lost trying to find the Guild. ID?");
        }
        const category = guild.channels.cache.get(this.categoryId);
        if (!category) {
            return console.error("Reze got lost trying to find the category. ID?");
        }
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