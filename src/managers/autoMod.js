const Tesseract = require('tesseract.js');

class AutoModManager {
    constructor(client) {
        this.client = client;
        this.userLinkTracker = new Map();

        this.config = {
            linkSpamChannelThreshold: 3,   
            linkSpamWindowMs: 5 * 60 * 1000 
        };
    }

    async handleMessage(message) {
        if (!message.guild || message.author.bot) return;
        const linkMatches = message.content.match(/(https?:\/\/[^\s]+)/gi);
        if (!linkMatches || linkMatches.length === 0) return;

        const userId = message.author.id;
        const channelId = message.channel.id;
        const now = Date.now();

        if (!this.userLinkTracker.has(userId)) {
            this.userLinkTracker.set(userId, new Map());
        }

        const userLinks = this.userLinkTracker.get(userId);

        for (const link of linkMatches) {
            const normalizedLink = link.toLowerCase().trim();

            if (!userLinks.has(normalizedLink)) {
                userLinks.set(normalizedLink, {
                    channels: new Set(),
                    firstSeen: now
                });
            }

            const linkData = userLinks.get(normalizedLink);

            if (now - linkData.firstSeen > this.config.linkSpamWindowMs) {
                linkData.channels = new Set();
                linkData.firstSeen = now;
            }

            linkData.channels.add(channelId);

            if (linkData.channels.size >= this.config.linkSpamChannelThreshold) {
                const reasons = [
                    `Cross-posted link in ${linkData.channels.size} channels within ${this.config.linkSpamWindowMs / 60000} minutes`
                ];
                await this.executeBan(message, reasons);
                this.userLinkTracker.delete(userId); 
                break;
            }
        }
    }

    async executeBan(message, reasons) {
        try {
            const username = message.author.tag;

            await message.member.ban({
                deleteMessageSeconds: 60 * 60 * 24, 
                reason: `AutoMod Cross-Post Link Ban: ${reasons.join(', ')}`
            });

            console.log(`[AutoMod] Banned ${username} (${message.author.id}) for: ${reasons.join(', ')}`);

            await this.announceBan(message.guild, username);
        } catch (error) {
            console.error('Failed to auto-ban user:', error);
        }
    }

    async announceBan(guild, username) {
        try {
            const channelId = process.env.GENERAL_CHAT_ID;
            if (!channelId) {
                console.warn('genchat id not defined in .env')
                return;
            }

            const alertChannel = guild.channels.cache.get(channelId) || await guild.channels.fetch(channelId).catch(() => null);

            if (alertChannel && alertChannel.isTextBased()) {
                await alertChannel.send(`boom! reze just found ${username} to be a spammer!`);
            } else {
                console.error(`[AutoMod] Could not find or send message to channel ID: ${channelId}`);
            }
        } catch (error) {
            console.error('Failed to send general ban announcement:', error);
        }
    }
}

module.exports = AutoModManager;