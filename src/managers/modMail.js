const { ChannelType, PermissionsBitField, EmbedBuilder } = require('discord.js');

class ModMailManager {
    constructor(client) {
        this.client = client;
        this.locks = new Set(); //current process ID storage
        this.categoryId = process.env.MODMAIL_CATEGORY_ID;
        this.guildId = process.env.GUILD_ID;
        this.userHistory = new Map();
        this.cooldowns = new Map();
    }

async initiateStaffTicket(targetUser, staffMember, reason) {
    const guild = await this.client.guilds.fetch(this.guildId);
    const existingChannel = guild.channels.cache.find(c => c.topic === `UserID:${targetUser.id}`);
    const userId = targetUser.id;
    
    if (existingChannel) throw new Error("A ticket channel for this user already exists.");
    const channel = await guild.channels.create({
        name: `ticket-${targetUser.username}`,
        type: ChannelType.GuildText,
        parent: this.categoryId,
        topic: `UserID:${targetUser.id}`,
        reason: `ModMail initiated by ${staffMember.tag}`
    });

    // messaging user
    try {
        await targetUser.send(`**Message from ${guild.name} Staff:**\n${reason}\n\n*Please reply directly to Reze to speak with the Madocord team!*`);
    } catch (e) {
        await channel.send(`**Warning:** Reze failed to DM the user (DMs off).`);
    }
    await channel.send(`**Ticket Initiated by Staff**\n**Staff:** ${staffMember}\n**User:** ${targetUser} (${targetUser.id})\n**Reason:** ${reason}\n${'─'.repeat(20)}`);

    return channel;
}

async handleDM(message) {
    const userId = message.author.id;
    const now = Date.now();

    if (this.cooldowns.has(userId)) {
        const expiry = this.cooldowns.get(userId);
        if (now < expiry) {
            return; 
        } else {
            this.cooldowns.delete(userId);
        }
    }

    if (!this.userHistory.has(userId)) this.userHistory.set(userId, []);
    const timestamps = this.userHistory.get(userId);
    timestamps.push(now);

    const recentMessages = timestamps.filter(time => now - time < 5000);
    this.userHistory.set(userId, recentMessages);

    if (recentMessages.length > 5) {
        this.cooldowns.set(userId, now + (10 * 60 * 1000));
        return message.reply("Slow down there, bucko. 10-minute cooldown or Reze is gonna pull the pin on you..");
    }

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
    
    if (message.attachments.size > 0) {
    const attachmentUrls = message.attachments.map(a => a.url);
    await channel.send({ content: "**Attachments:**", files: attachmentUrls });
}

    try {
        await message.reply({
            content: "Reply forwarded!",
            allowedMentions: {repliedUser: false}
        });
    } catch (err) {
        console.error("reply to user failed", err)
    }
}
}

module.exports = ModMailManager;