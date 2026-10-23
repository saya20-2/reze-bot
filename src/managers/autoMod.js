const Tesseract = require('tesseract.js');

class AutoModManager {
    constructor(client) {
        this.client = client;
        this.userMessageCounts = new Map();

        this.config = {
            accountAgeDaysThreshold: 3,     
            joinTimeMinutesThreshold: 15,   
            spamKeywords: ['mrbeast', 'giveaway', 'claim', 'iphone', 'click the link', '$10,000', 'nitro'],
            banScoreThreshold: 4,           
        };
    }

    async handleMessage(message) {
        if (!message.guild || message.author.bot) return;

        const userId = message.author.id;
        const currentCount = (this.userMessageCounts.get(userId) || 0) + 1;
        this.userMessageCounts.set(userId, currentCount);

        let score = 0;
        const reasons = [];

        const member = message.member;
        const accountAgeDays = (Date.now() - message.author.createdTimestamp) / (1000 * 60 * 60 * 24);
        const joinTimeMinutes = member ? (Date.now() - member.joinedTimestamp) / (1000 * 60) : 0;

        if (accountAgeDays < this.config.accountAgeDaysThreshold) {
            score += 2;
            reasons.push(`New Account (${accountAgeDays.toFixed(1)} days old)`);
        }

        if (joinTimeMinutes < this.config.joinTimeMinutesThreshold) {
            score += 2;
            reasons.push(`Recent Join (${joinTimeMinutes.toFixed(1)} mins ago)`);
        }

        if (currentCount <= 3) {
            score += 1;
        }

        const hasLink = /(https?:\/\/[^\s]+)/g.test(message.content);
        if (hasLink) {
            score += 1;
            reasons.push('Contains Link');
        }

        if (message.mentions.everyone || message.mentionEveryone) {
            score += 2;
            reasons.push('Mass Mention (@everyone/@here)');
        }

        const lowerContent = message.content.toLowerCase();
        const textKeywordHit = this.config.spamKeywords.some(kw => lowerContent.includes(kw));
        if (textKeywordHit) {
            score += 2;
            reasons.push('Spam Keyword in Text');
        }

        if (score >= 2 && message.attachments.size > 0) {
            for (const [, attachment] of message.attachments) {
                if (this.isImage(attachment.contentType)) {
                    const ocrText = await this.runOCR(attachment.url);
                    if (ocrText) {
                        const lowerOcr = ocrText.toLowerCase();
                        const ocrKeywordHit = this.config.spamKeywords.some(kw => lowerOcr.includes(kw));
                        if (ocrKeywordHit) {
                            score += 3;
                            reasons.push(`OCR Keyword Match: "${ocrText.trim().substring(0, 50)}..."`);
                        }
                    }
                }
            }
        }

        if (score >= this.config.banScoreThreshold) {
            await this.executeBan(message, reasons);
        }
    }

    
    async runOCR(imageUrl) {
        try {
            const { data: { text } } = await Tesseract.recognize(imageUrl, 'eng');
            return text;
        } catch (error) {
            console.error('OCR Error:', error);
            return null;
        }
    }

    isImage(contentType) {
        return contentType && contentType.startsWith('image/');
    }

    
    async executeBan(message, reasons) {
        try {
            await message.member.ban({
                deleteMessageSeconds: 60 * 60 * 24, 
                reason: `AutoMod High-Confidence Ban: ${reasons.join(', ')}`
            });
            console.log(`[AutoMod] Banned ${message.author.tag} (${message.author.id}) for: ${reasons.join(', ')}`);
        } catch (error) {
            console.error('Failed to auto-ban user:', error);
        }
    }
}

module.exports = AutoModManager;