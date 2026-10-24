const tesseract = require("node-tesseract-ocr");
const fs = require('fs/promises');
const path = require('path');
const os = require('os');
const sharp = require('sharp');

class AutoModManager {
    constructor(client) {
        this.client = client;
        this.userMessageCounts = new Map();
        this.userLinkTracker = new Map(); 

        this.config = {
            accountAgeDaysThreshold: 3,     
            joinTimeMinutesThreshold: 15,   
            spamKeywords: ['mrbeast', 'giveaway', 'claim', 'iphone', 'click the link', '$', 'nitro', 'activate', 'bonus', 'withdrawal', 'free', 'page'],
            linkSpamChannelThreshold: 3,   
            linkSpamWindowMs: 5 * 60 * 1000 
        };
    }

    async handleMessage(message) {
        if (!message.guild || message.author.bot) return;

        const userId = message.author.id;
        const channelId = message.channel.id;
        const now = Date.now();
        const member = message.member;
        const accountAgeDays = (now - message.author.createdTimestamp) / (1000 * 60 * 60 * 24);
        const joinTimeMinutes = member ? (now - member.joinedTimestamp) / (1000 * 60) : 0;
        const isNewOrRecent = accountAgeDays < this.config.accountAgeDaysThreshold || joinTimeMinutes < this.config.joinTimeMinutesThreshold;
        const reasons = [];

        const lowerContent = message.content.toLowerCase();
        const textKeywordHit = this.config.spamKeywords.some(kw => lowerContent.includes(kw));
        if (textKeywordHit) {
            reasons.push('Spam Keyword in Text');
        }
        const linkMatches = message.content.match(/(https?:\/\/[^\s]+)/gi);
        const hasLink = linkMatches && linkMatches.length > 0;
        const hasKeywordInLink = hasLink && linkMatches.some(link => 
            this.config.spamKeywords.some(kw => link.toLowerCase().includes(kw))
        );

        if (hasKeywordInLink) {
            reasons.push('Spam Keyword in Link');
        }
        
        const hasMassMention = message.mentions.everyone || message.mentionEveryone;
        if (hasMassMention) {
            reasons.push('Mass Mention (@everyone/@here)');
        }

        let ocrKeywordHit = false;
        if (isNewOrRecent && message.attachments.size > 0) {
            for (const [, attachment] of message.attachments) {
                if (this.isImage(attachment.contentType)) {
                    const ocrText = await this.runOCR(attachment.url);
                    
                    console.log(`[AutoMod OCR Trace] User: ${message.author.tag} (${userId})`);
                    console.log(`[AutoMod OCR Trace] Image URL: ${attachment.url}`);
                    console.log(`[AutoMod OCR Trace] Raw Extracted Text:\n--- START ---\n${ocrText || '[NO TEXT DETECTED]'}\n--- END ---`);

                    if (ocrText) {
                        const lowerOcr = ocrText.toLowerCase();
                        const ocrHit = this.config.spamKeywords.some(kw => lowerOcr.includes(kw));
                        if (ocrHit) {
                            ocrKeywordHit = true;
                            reasons.push('OCR Keyword Match');
                        }
                    }
                }
            }
        }

        // Has any spam criteria been met in this specific message?
        const hasSpamCriteria = textKeywordHit || hasKeywordInLink || hasMassMention || ocrKeywordHit;

        if (isNewOrRecent && hasSpamCriteria) {
            if (accountAgeDays < this.config.accountAgeDaysThreshold) {
                reasons.unshift(`New Account (${accountAgeDays.toFixed(1)} days old)`);
            } else {
                reasons.unshift(`Recent Join (${joinTimeMinutes.toFixed(1)} mins ago)`);
            }
            await this.executeBan(message, reasons);
            return;
        }

        if (hasLink) {
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
                    const crossPostReasons = [`Cross-posted identical link across ${linkData.channels.size} channels within 5 mins`];
                    await this.executeBan(message, crossPostReasons);
                    this.userLinkTracker.delete(userId);
                    break;
                }
            }
        }
    }

    async runOCR(imageUrl) {
        let tempFilePath = null;
        const config = {
            lang: "eng",
            oem: 1, 
            psm: 3  
        };

        try {
            const response = await fetch(imageUrl);
            const buffer = Buffer.from(await response.arrayBuffer());
            const processedBuffer = await sharp(buffer)
                .grayscale()
                .normalize()
                .threshold(160)
                .toBuffer();

            tempFilePath = path.join(os.tmpdir(), `automod_${Date.now()}.png`);
            await fs.writeFile(tempFilePath, processedBuffer);

            const text = await tesseract.recognize(tempFilePath, config);
            return text;
        } catch (error) {
            console.error('[AutoMod] Native OCR Error:', error);
            return null;
        } finally {
            if (tempFilePath) {
                await fs.unlink(tempFilePath).catch(() => {});
            }
        }
    }

    isImage(contentType) {
        return contentType && contentType.startsWith('image/');
    }

    async executeBan(message, reasons) {
        try {
            const username = message.author.tag;
            await message.member.ban({
                deleteMessageSeconds: 60 * 60 * 24, 
                reason: `AutoMod Ban: ${reasons.join(', ')}`
            });
            console.log(`[AutoMod] Banned ${username} (${message.author.id}) for: ${reasons.join(', ')}`);
            
            await this.announceBan(message.guild, username);
        } catch (error) {
            console.error('Failed to auto-ban user:', error);
        }
    }

    async announceBan(guild, username) {
        try {
            const channelId = process.env.AUTOMOD_LOG_CHANNEL_ID;
            if (!channelId) return;

            const alertChannel = guild.channels.cache.get(channelId) || await guild.channels.fetch(channelId).catch(() => null);
            if (alertChannel && alertChannel.isTextBased()) {
                await alertChannel.send(`pulled the pin on **${username}** for automated spam!`);
            }
        } catch (error) {
            console.error('[AutoMod] Failed to send general ban announcement:', error);
        }
    }
}

module.exports = AutoModManager;