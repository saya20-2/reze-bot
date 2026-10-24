const tesseract = require("node-tesseract-ocr");
const fs = require('fs/promises');
const path = require('path');
const os = require('os');
const sharp = require('sharp');

class AutoModManager {
    constructor(client) {
        this.client = client;
        this.userMessageCounts = new Map();
        this.lastOcrTimestamp = new Map();

        this.config = {
            accountAgeDaysThreshold: 3,     
            joinTimeMinutesThreshold: 15,   
            spamKeywords: ['mrbeast', 'giveaway', 'claim', 'iphone', 'click the link', '$', 'nitro', 'activate', 'bonus', 'withdrawal', 'free', 'page'],
            banScoreThreshold: 4,         
            ocrCooldownMs: 30000  
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
        const timeSinceJoined = member ? Date.now() - member.joinedTimestamp : 0;
        const hasCustomRoles = member ? member.roles.cache.filter(r => r.id !== message.guild.id).size > 0 : false;
        const isFreshJoin = timeSinceJoined <= (5 * 60 * 1000) && !hasCustomRoles;

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

        const linkMatches = message.content.match(/(https?:\/\/[^\s]+)/gi);
        const hasLink = linkMatches && linkMatches.length > 0;

        const hasKeywordInLink = hasLink && linkMatches.some(link => 
            this.config.spamKeywords.some(kw => link.toLowerCase().includes(kw))
        );

        if (isFreshJoin && hasLink && hasKeywordInLink) {
            const reason = `New user posted link containing spam keyword within ${(timeSinceJoined / 60000).toFixed(1)} mins of joining`;
            await this.executeBan(message, [reason]);
            return;
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

        const now = Date.now();
        const lastOcrTime = this.lastOcrTimestamp.get(userId) || 0;

        if (score >= 2 && message.attachments.size > 0 && (now - lastOcrTime > this.config.ocrCooldownMs)) {
        this.lastOcrTimestamp.set(userId, now);

        for (const [, attachment] of message.attachments) {
            if (this.isImage(attachment.contentType)) {
                const ocrText = await this.runOCR(attachment.url);
                
                // checking if this shot even works
                console.log(`[AutoMod OCR Trace] User: ${message.author.tag} (${userId})`);
                console.log(`[AutoMod OCR Trace] Image URL: ${attachment.url}`);
                console.log(`[AutoMod OCR Trace] Raw Extracted Text:\n--- START ---\n${ocrText || '[NO TEXT DETECTED]'}\n--- END ---`);

                if (ocrText) {
                    const lowerOcr = ocrText.toLowerCase();
                    const ocrKeywordHit = this.config.spamKeywords.some(kw => lowerOcr.includes(kw));
                    if (ocrKeywordHit) {
                        score += 3;
                        reasons.push(`OCR Keyword Match`);
                        console.log(`[AutoMod OCR Trace] Match Found! Added +3 score.`);
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
        let tempFilePath = null;
        const config = {
            lang: "eng",
            oem: 1, // Neural net OCR engine mode
            psm: 3  // Fully automatic page segmentation
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