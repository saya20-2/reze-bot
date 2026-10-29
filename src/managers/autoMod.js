const tesseract = require("node-tesseract-ocr");
const fs = require('fs/promises');
const path = require('path');
const os = require('os');
const crypto = require('crypto');
const sharp = require('sharp');

const OCR_TIMEOUT_MS = 30000;
const MAX_IMAGE_BYTES = 10 * 1024 * 1024;
const MAX_PIXELS = 25_000_000;
const OCR_SIZE = 3000;
const MIN_USEFUL_TEXT_LENGTH = 20;
const MAX_LOG_CHARS = 1800;

class AutoModManager {
    constructor(client) {
        this.client = client;
        this.userMessageCounts = new Map();
        this.userLinkTracker = new Map();
        this.ocrChain = Promise.resolve();

        this.config = {
            accountAgeDaysThreshold: 3,
            joinTimeMinutesThreshold: 15,
            banScoreThreshold: 3,
            specificKeywords: ['mrbeast', 'giveaway', 'giving away', 'promo code', 'crypto casino', 'claim your reward', 'click the link', 'usdt', 'nitro'],
            genericKeywords: ['bonus', 'activate', 'claim', 'free', 'withdraw'],
            keywordAliases: { mrbeast: ['mbeast'] },
            linkSpamChannelThreshold: 3,
            linkSpamWindowMs: 5 * 60 * 1000,
            tesseractBinary: process.env.TESSERACT_BINARY || 'tesseract'
        };
    }

    async sendLog(guild, content) {
        try {
            const channelId = process.env.AUTOMOD_LOG_CHANNEL_ID;
            if (!channelId) return;

            const channel = guild.channels.cache.get(channelId) || await guild.channels.fetch(channelId).catch(() => null);
            if (channel && channel.isTextBased()) {
                // Discord rejects messages over 2000 characters, and raw OCR text easily exceeds that
                let text = content.replace(/```/g, "'''");
                if (text.length > MAX_LOG_CHARS) text = `${text.slice(0, MAX_LOG_CHARS)}\n[truncated]`;

                const lines = text.split('\n');
                let output = `\`\`\`\n${text}\n\`\`\``;

                // Collapse in spoiler tags if it exceeds 10 lines to prevent clutter
                if (lines.length > 10) {
                    output = `|| \`\`\`\n${text}\n\`\`\` ||`;
                }

                await channel.send(output);
            }
        } catch (error) {
            console.error('[AutoMod Log Error] Failed to send log message:', error);
        }
    }

    findKeywords(text) {
        const found = new Map();
        if (!text) return found;

        const lower = text.toLowerCase();
        const compact = lower.replace(/[^a-z0-9]/g, '');

        const check = (keyword, weight, allowCompact) => {
            const variants = [keyword, ...(this.config.keywordAliases[keyword] || [])];
            const hit = variants.some(variant => {
                const letters = variant.replace(/[^a-z0-9]/g, '');
                if (allowCompact && letters.length >= 6) return compact.includes(letters);
                const words = variant.replace(/[^a-z0-9 ]/g, '');
                return new RegExp(`\\b${words}(?:s|ed|al|n|ing)?\\b`).test(lower);
            });
            if (hit) found.set(keyword, weight);
        };

        this.config.specificKeywords.forEach(keyword => check(keyword, 2, true));
        this.config.genericKeywords.forEach(keyword => check(keyword, 1, false));
        return found;
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

        const matched = new Map();
        const sources = new Set();
        const addMatches = (found, source) => {
            for (const [keyword, weight] of found) matched.set(keyword, weight);
            if (found.size > 0) sources.add(source);
        };

        addMatches(this.findKeywords(message.content), 'text');

        const linkMatches = message.content.match(/(https?:\/\/[^\s]+)/gi);
        const hasLink = linkMatches && linkMatches.length > 0;
        if (hasLink) {
            for (const link of linkMatches) addMatches(this.findKeywords(link), 'link');
        }

        const hasMassMention = message.mentions.everyone || message.mentionEveryone;

        const score = () => [...matched.values()].reduce((sum, weight) => sum + weight, 0);

        if (isNewOrRecent && message.attachments.size > 0) {
            for (const [, attachment] of message.attachments) {
                if (!this.isImage(attachment.contentType)) continue;
                if (attachment.size > MAX_IMAGE_BYTES) continue;
                if (score() >= this.config.banScoreThreshold) break;

                const ocrText = await this.runOCR(attachment.url, () => score());

                const traceLog = [
                    `[AutoMod OCR Trace] User: ${message.author.tag} (${userId})`,
                    `[AutoMod OCR Trace] Image URL: ${attachment.url}`,
                    `[AutoMod OCR Trace] Raw Extracted Text:`,
                    `--- START ---`,
                    `${ocrText || '[NO TEXT DETECTED]'}`,
                    `--- END ---`
                ].join('\n');

                console.log(traceLog);
                await this.sendLog(message.guild, traceLog);

                addMatches(this.findKeywords(ocrText), 'image');
            }
        }

        const hasSpamCriteria = score() >= this.config.banScoreThreshold || hasMassMention;

        if (isNewOrRecent && hasSpamCriteria) {
            const reasons = [];
            if (accountAgeDays < this.config.accountAgeDaysThreshold) {
                reasons.push(`New Account (${accountAgeDays.toFixed(1)} days old)`);
            } else {
                reasons.push(`Recent Join (${joinTimeMinutes.toFixed(1)} mins ago)`);
            }
            if (matched.size > 0) {
                reasons.push(`Spam Keywords [${[...matched.keys()].join(', ')}] in ${[...sources].join('/')}, score ${score()}`);
            }
            if (hasMassMention) reasons.push('Mass Mention (@everyone/@here)');
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

    runOCR(imageUrl, currentScore) {
        const job = this.ocrChain.then(() => this.ocrImage(imageUrl, currentScore));
        this.ocrChain = job.catch(() => {});
        return job.catch(error => {
            console.error('[AutoMod] Native OCR Error:', error);
            return null;
        });
    }

    async downloadImage(imageUrl) {
        const response = await fetch(imageUrl, { signal: AbortSignal.timeout(15000) });

        if (!response.ok) {
            throw new Error(`Image download failed (${response.status})`);
        }

        const contentLength = Number(response.headers.get('content-length') || 0);
        if (contentLength > MAX_IMAGE_BYTES) {
            throw new Error('Image exceeds maximum allowed size');
        }

        const chunks = [];
        let totalBytes = 0;

        for await (const chunk of response.body) {
            totalBytes += chunk.length;
            if (totalBytes > MAX_IMAGE_BYTES) {
                throw new Error('Image exceeds maximum allowed size');
            }
            chunks.push(chunk);
        }

        return Buffer.concat(chunks);
    }

    async ocrImage(imageUrl, currentScore) {
        const buffer = await this.downloadImage(imageUrl);

        const source = sharp(buffer, {
            failOn: 'none',
            limitInputPixels: MAX_PIXELS
        }).rotate();

        const metadata = await source.metadata();

        if (!metadata.width || !metadata.height) {
            throw new Error('Invalid image dimensions');
        }

        if (
            metadata.width > 8192 ||
            metadata.height > 8192 ||
            metadata.width * metadata.height > MAX_PIXELS
        ) {
            throw new Error('Image dimensions exceed processing limits');
        }

        const prepared = await source.clone()
            .flatten({ background: '#ffffff' })
            .resize({
                width: OCR_SIZE,
                height: OCR_SIZE,
                fit: 'inside',
                withoutEnlargement: false,
                kernel: 'lanczos3'
            })
            .grayscale()
            .normalize()
            .png()
            .toBuffer();

        const image = sharp(prepared);
        const dimensions = await image.metadata();

        const width = dimensions.width;
        const height = dimensions.height;

        const halfWidth = Math.ceil(width * 0.55);
        const halfHeight = Math.ceil(height * 0.55);
        const x2 = width - halfWidth;
        const y2 = height - halfHeight;

        const regions = [
            { name: 'top-left', left: 0, top: 0, width: halfWidth, height: halfHeight },
            { name: 'top-right', left: x2, top: 0, width: halfWidth, height: halfHeight },
            { name: 'bottom-left', left: 0, top: y2, width: halfWidth, height: halfHeight },
            { name: 'bottom-right', left: x2, top: y2, width: halfWidth, height: halfHeight }
        ];

        const results = [];
        const detectedKeywords = new Map();

        const recordResult = (text, region, psm) => {
            if (!text) return;

            results.push(text);

            const found = this.findKeywords(text);
            for (const [keyword, weight] of found) {
                detectedKeywords.set(keyword, weight);
            }

            console.log(`[AutoMod OCR] ${region}, PSM ${psm}: ${[...found.keys()].join(', ') || 'no keywords'}`);
        };

        const isConclusive = () => {
            const detected = [...detectedKeywords.values()].reduce((sum, weight) => sum + weight, 0);
            return currentScore() + detected >= this.config.banScoreThreshold;
        };

        // Pass 1: the whole image, sparse text mode (screenshots, memes, text scattered around)
        recordResult(await this.recognize(prepared, 11), 'full', 11);
        if (isConclusive()) return results.join('\n');

        // Pass 2: overlapping quadrants as blocks of text, stopping as soon as it is conclusive
        for (const region of regions) {
            const crop = await image.clone()
                .extract({
                    left: region.left,
                    top: region.top,
                    width: region.width,
                    height: region.height
                })
                .png()
                .toBuffer();

            recordResult(await this.recognize(crop, 6), region.name, 6);
            if (isConclusive()) return results.join('\n');
        }

        // Last resort: if almost nothing was read, try a hard black/white version of the whole image
        if (results.join('').trim().length < MIN_USEFUL_TEXT_LENGTH) {
            const thresholded = await sharp(prepared)
                .threshold(160)
                .png()
                .toBuffer();

            recordResult(await this.recognize(thresholded, 6), 'full-thresholded', 6);
        }

        return results.join('\n');
    }

    async recognize(buffer, psm) {
        const tempFilePath = path.join(os.tmpdir(), `automod_${crypto.randomUUID()}.png`);
        try {
            await fs.writeFile(tempFilePath, buffer);
            const config = { lang: 'eng', oem: 1, psm, binary: this.config.tesseractBinary };
            return await Promise.race([
                tesseract.recognize(tempFilePath, config),
                new Promise((_, reject) => setTimeout(() => reject(new Error('OCR timed out')), OCR_TIMEOUT_MS).unref())
            ]);
        } finally {
            await fs.unlink(tempFilePath).catch(() => {});
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

            const banLog = `[AutoMod] Banned ${username} (${message.author.id}) for: ${reasons.join(', ')}`;
            console.log(banLog);
            await this.sendLog(message.guild, banLog);

            const generalChatId = process.env.GENERAL_CHAT_ID;
            if (generalChatId) {
                const generalChannel = message.guild.channels.cache.get(generalChatId) || await message.guild.channels.fetch(generalChatId).catch(() => null);
                if (generalChannel && generalChannel.isTextBased()) {
                    await generalChannel.send(`pulled the pin on **${username}** for automated spam!`);
                }
            }
        } catch (error) {
            console.error('Failed to auto-ban user:', error);
        }
    }
}

module.exports = AutoModManager;