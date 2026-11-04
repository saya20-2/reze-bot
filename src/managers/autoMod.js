const { execFile } = require('child_process');
const { promisify } = require('util');
const fs = require('fs/promises');
const path = require('path');
const os = require('os');
const crypto = require('crypto');
const sharp = require('sharp');
const { PermissionFlagsBits } = require('discord.js');

const EXCLUDED_ASPECT_RATIOS = [16 / 9];
const ASPECT_RATIO_TOLERANCE = 0.01;
const OCR_TIMEOUT_MS = 30000;
const MAX_IMAGE_BYTES = 10 * 1024 * 1024;
const MAX_PIXELS = 25_000_000;
const OCR_SIZE = 3000;
const MIN_USEFUL_TEXT_LENGTH = 20;
const MAX_LOG_CHARS = 1800;
const VERBOSE = process.env.AUTOMOD_DEBUG === 'true';
const execFileAsync = promisify(execFile);
const OCR_CONFIDENCE = { specific: 40, generic: 65 };

class AutoModManager {
    constructor(client) {
        this.client = client;
        this.userLinkTracker = new Map();
        this.ocrQueue = [];
        this.activeOcr = 0;
        this.pendingOcr = 0;
        this.userOcrTracker = new Map();

        this.config = {
            accountAgeDaysThreshold: 3,
            joinTimeMinutesThreshold: 15,
            keywordThreshold: 5,
            ocrSpamInstanceThreshold: 3,
            ocrSpamWindowMs: 10 * 60 * 1000,

            specificKeywords: [
                'mrbeast',
                'giving away',
                'promo code',
                'crypto casino',
                'claim your reward',
                'click the link',
                'usdt',
                'nitro'
            ],

            genericKeywords: ['claim', 'withdraw'],
            keywordAliases: { mrbeast: ['mbeast'] },

            darkImage: {
                sampleSize: 96,
                darkPixelLevel: 70,
                minDarkFraction: 0.55,
                maxMeanLuminance: 90
            },

            ocrConcurrency: Math.max(
                1,
                Math.min(
                    4,
                    Number.parseInt(
                        process.env.AUTOMOD_OCR_CONCURRENCY || '2',
                        10
                    ) || 2
                )
            ),

            maxPendingOcrJobs: 8,

            exemptRoleIds: (process.env.AUTOMOD_EXEMPT_ROLE_IDS || '')
                .split(',')
                .map(id => id.trim())
                .filter(Boolean),

            linkSpamChannelThreshold: 3,
            linkSpamWindowMs: 5 * 60 * 1000,
            tesseractBinary: process.env.TESSERACT_BINARY || 'tesseract'
        };
    }

    async hasExcludedAspectRatio(buffer) {
        try {
            const metadata = await sharp(buffer, {
                failOn: 'none',
                limitInputPixels: MAX_PIXELS
            }).rotate().metadata();

            if (!metadata.width || !metadata.height) return false;

            const ratio = metadata.width / metadata.height;

            return EXCLUDED_ASPECT_RATIOS.some(target =>
                Math.abs(ratio - target) <= target * ASPECT_RATIO_TOLERANCE
            );
        } catch (error) {
            console.error('[AutoMod] Aspect ratio detection error:', error);
            return false;
        }
    }

    async sendLog(guild, content, options = {}) {
        try {
            const channelId = process.env.AUTOMOD_LOG_CHANNEL_ID;
            if (!channelId) return;

            const channel = guild.channels.cache.get(channelId) ||
                await guild.channels.fetch(channelId).catch(() => null);

            if (!channel || !channel.isTextBased()) return;

            let text = String(content || '').replace(/```/g, "'''");

            if (text.length > MAX_LOG_CHARS) {
                text = `${text.slice(0, MAX_LOG_CHARS)}\n[truncated]`;
            }

            const spoiler = `||\`\`\`\n${text}\n\`\`\`||`;

            const payload = {
                content: options.summary
                    ? `${options.summary}\n${spoiler}`
                    : spoiler,
                allowedMentions: { parse: [] }
            };

            if (options.imageUrl) {
                const elapsed = Number.isFinite(options.elapsedMs)
                    ? `${(options.elapsedMs / 1000).toFixed(2)} seconds`
                    : 'unknown';

                payload.embeds = [{
                    title: 'Open original image',
                    url: options.imageUrl,
                    description: `OCR completed ${elapsed} after the message was sent.`,
                    image: { url: options.imageUrl }
                }];
            }

            await channel.send(payload);
        } catch (error) {
            console.error('[AutoMod Log Error] Failed to send log message:', error);
        }
    }

    trackOcrSpam(userId) {
        const now = Date.now();
        const windowMs = this.config.ocrSpamWindowMs;

        const instances = (this.userOcrTracker.get(userId) || [])
            .filter(timestamp => now - timestamp <= windowMs);

        instances.push(now);

        if (instances.length >= this.config.ocrSpamInstanceThreshold) {
            this.userOcrTracker.delete(userId);

            return {
                qualifies: true,
                count: instances.length
            };
        }

        this.userOcrTracker.set(userId, instances);

        return {
            qualifies: false,
            count: instances.length
        };
    }

    findKeywordsFromTsv(tsv) {
        const found = new Map();
        if (!tsv) return found;

        const lines = new Map();
        const rows = tsv.split(/\r?\n/);

        for (let i = 1; i < rows.length; i++) {
            const columns = rows[i].split('\t');
            if (columns.length < 12) continue;

            const level = Number(columns[0]);
            const confidence = Number(columns[10]);
            const rawWord = columns.slice(11).join('\t').trim();

            if (
                level !== 5 ||
                !rawWord ||
                !Number.isFinite(confidence) ||
                confidence < 0
            ) continue;

            const lineKey = columns.slice(1, 5).join(':');

            if (!lines.has(lineKey)) {
                lines.set(lineKey, []);
            }

            lines.get(lineKey).push({
                word: rawWord.toLowerCase().replace(/[^a-z0-9]/g, ''),
                confidence
            });
        }

        const matchesVariant = (
            variant,
            minimumConfidence,
            lineWords,
            allowCompact
        ) => {
            const target = variant.toLowerCase().replace(/[^a-z0-9]/g, '');
            if (!target) return false;

            for (let start = 0; start < lineWords.length; start++) {
                let combined = '';

                for (
                    let end = start;
                    end < Math.min(lineWords.length, start + 4);
                    end++
                ) {
                    const token = lineWords[end];

                    if (
                        !token.word ||
                        token.confidence < minimumConfidence
                    ) break;

                    combined += token.word;

                    if (allowCompact) {
                        if (combined.includes(target)) return true;
                    } else if (
                        new RegExp(`^${target}(?:s|ed|al|n|ing)?$`)
                            .test(combined)
                    ) {
                        return true;
                    }

                    if (combined.length > target.length + 8) break;
                }
            }

            return false;
        };

        for (const [keyword, weight] of [
            ...this.config.specificKeywords.map(keyword => [keyword, 2]),
            ...this.config.genericKeywords.map(keyword => [keyword, 1])
        ]) {
            const minimumConfidence = weight === 2
                ? OCR_CONFIDENCE.specific
                : OCR_CONFIDENCE.generic;

            const variants = [
                keyword,
                ...(this.config.keywordAliases[keyword] || [])
            ];

            const hit = [...lines.values()].some(lineWords =>
                variants.some(variant =>
                    matchesVariant(
                        variant,
                        minimumConfidence,
                        lineWords,
                        weight === 2
                    )
                )
            );

            if (hit) found.set(keyword, weight);
        }

        return found;
    }

    async handleMessage(message) {
        if (!message.guild || message.author.bot) return;
        if (this.isExempt(message.member)) return;

        const userId = message.author.id;
        const channelId = message.channel.id;
        const now = Date.now();
        let ocrElapsedMs = null;
        const member = message.member;

        const accountAgeDays =
            (now - message.author.createdTimestamp) /
            (1000 * 60 * 60 * 24);

        const joinTimeMinutes = member
            ? (now - member.joinedTimestamp) / (1000 * 60)
            : 0;

        const isNewOrRecent =
            accountAgeDays < this.config.accountAgeDaysThreshold ||
            joinTimeMinutes < this.config.joinTimeMinutesThreshold;

        const matched = new Map();
        const sources = new Set();

        const addMatches = (found, source) => {
            for (const [keyword, weight] of found) {
                matched.set(keyword, weight);
            }

            if (found.size > 0) sources.add(source);
        };

        const linkMatches = message.content.match(/(https?:\/\/[^\s]+)/gi);
        const hasLink = linkMatches && linkMatches.length > 0;
        const hasMassMention =
            message.mentions.everyone || message.mentionEveryone;

        const evaluate = (extra = new Map()) => {
            const all = new Map([...matched, ...extra]);

            const hasSpecificKeyword = [...all.keys()].some(keyword =>
                this.config.specificKeywords.includes(keyword)
            );

            return hasSpecificKeyword &&
                all.size >= this.config.keywordThreshold;
        };

        if (message.attachments.size > 0 && message.member) {
            for (const [, attachment] of message.attachments) {
                if (!this.isImage(attachment.contentType)) continue;
                if (attachment.size > MAX_IMAGE_BYTES) continue;
                if (evaluate()) break;

                let buffer;

                try {
                    buffer = await this.downloadImage(attachment.url);
                } catch (error) {
                    console.error(
                        '[AutoMod] Image download error:',
                        error.message
                    );
                    continue;
                }

                if (await this.hasExcludedAspectRatio(buffer)) {
                    if (VERBOSE) {
                        console.log(
                            `[AutoMod] Skipped image from ${message.author.tag}: excluded 16:9 aspect ratio`
                        );
                    }
                    continue;
                }

                const imageStats = await this.analyzeImage(buffer)
                    .catch(() => null);

                const darkScreenshot = imageStats
                    ? this.looksLikeDarkScreenshot(imageStats)
                    : false;

                if (!darkScreenshot) {
                    if (VERBOSE && imageStats) {
                        console.log(
                            `[AutoMod] Skipped image from ${message.author.tag}: not a dark screenshot (mean ${imageStats.mean.toFixed(0)}, dark ${imageStats.darkFraction.toFixed(2)})`
                        );
                    }
                    continue;
                }

                const ocrResult = await this.runOCR(buffer, evaluate);
                const found = ocrResult?.keywords || new Map();

                ocrElapsedMs = Math.max(
                    0,
                    Date.now() - (message.createdTimestamp || now)
                );

                addMatches(found, 'image');

                if (found.size > 0) {
                    console.log(
                        `[AutoMod OCR] ${message.author.tag}: ${[...found.keys()].join(', ')}`
                    );
                }
            }
        }

        const allKeywords = [...matched.keys()];

        const hasSpecificKeyword = allKeywords.some(keyword =>
            this.config.specificKeywords.includes(keyword)
        );

        const qualifyingOcrDetection =
            sources.has('image') &&
            hasSpecificKeyword &&
            allKeywords.length >= this.config.keywordThreshold;

        if (qualifyingOcrDetection) {
            const tracking = this.trackOcrSpam(userId);

            const logMessage = [
                '[AutoMod] Qualifying OCR spam detection',
                `User: ${message.author.tag} (${userId})`,
                `Matched keywords: ${allKeywords.join(', ')}`,
                `Matches: ${allKeywords.length}/${this.config.keywordThreshold}`,
                `Qualifying instances: ${tracking.count}/${this.config.ocrSpamInstanceThreshold}`,
                `OCR elapsed: ${ocrElapsedMs !== null
                    ? `${(ocrElapsedMs / 1000).toFixed(2)} seconds`
                    : 'N/A'}`
            ].join('\n');

            console.log(logMessage);
            await this.sendLog(message.guild, logMessage);

            if (tracking.qualifies) {
                await this.executeBan(message, [
                    `Repeated OCR spam (${tracking.count} qualifying instances)`,
                    `Keywords: ${allKeywords.join(', ')}`
                ]);

                this.userOcrTracker.delete(userId);
                return;
            }
        }

        if (isNewOrRecent && hasMassMention) {
            await this.executeBan(message, [
                'Mass Mention (@everyone/@here)'
            ]);
            return;
        }

        if (hasLink) {
            if (!this.userLinkTracker.has(userId)) {
                this.userLinkTracker.set(userId, new Map());
            }

            const userLinks = this.userLinkTracker.get(userId);

            for (const [link, data] of userLinks) {
                if (now - data.firstSeen > this.config.linkSpamWindowMs) {
                    userLinks.delete(link);
                }
            }

            for (const link of linkMatches) {
                const normalizedLink = link.toLowerCase().trim();

                if (!userLinks.has(normalizedLink)) {
                    userLinks.set(normalizedLink, {
                        channels: new Set(),
                        firstSeen: now
                    });
                }

                const linkData = userLinks.get(normalizedLink);

                if (
                    now - linkData.firstSeen >
                    this.config.linkSpamWindowMs
                ) {
                    linkData.channels = new Set();
                    linkData.firstSeen = now;
                }

                linkData.channels.add(channelId);

                if (
                    linkData.channels.size >=
                    this.config.linkSpamChannelThreshold
                ) {
                    const crossPostReasons = [
                        `Cross-posted identical link across ${linkData.channels.size} channels within 5 mins`
                    ];

                    await this.executeBan(message, crossPostReasons);
                    this.userLinkTracker.delete(userId);
                    break;
                }
            }
        }
    }

    runOCR(buffer, evaluate) {
        if (this.pendingOcr >= this.config.maxPendingOcrJobs) {
            console.warn(
                '[AutoMod] OCR backlog is full, skipping this image'
            );
            return Promise.resolve(null);
        }

        this.pendingOcr++;

        return new Promise(resolve => {
            this.ocrQueue.push(async () => {
                try {
                    resolve(await this.ocrImage(buffer, evaluate));
                } catch (error) {
                    console.error('[AutoMod] Native OCR Error:', error);
                    resolve(null);
                } finally {
                    this.pendingOcr--;
                }
            });

            this.processOcrQueue();
        });
    }

    processOcrQueue() {
        while (
            this.activeOcr < this.config.ocrConcurrency &&
            this.ocrQueue.length > 0
        ) {
            const job = this.ocrQueue.shift();
            this.activeOcr++;

            Promise.resolve()
                .then(job)
                .catch(error => {
                    console.error(
                        '[AutoMod] Unexpected OCR queue error:',
                        error
                    );
                })
                .finally(() => {
                    this.activeOcr--;
                    this.processOcrQueue();
                });
        }
    }

    async analyzeImage(buffer) {
        const { sampleSize, darkPixelLevel } = this.config.darkImage;

        const { data } = await sharp(buffer, {
            failOn: 'none',
            limitInputPixels: MAX_PIXELS
        })
            .rotate()
            .flatten({ background: '#ffffff' })
            .resize(sampleSize, sampleSize, { fit: 'inside' })
            .grayscale()
            .raw()
            .toBuffer({ resolveWithObject: true });

        let sum = 0;
        let dark = 0;

        for (const value of data) {
            sum += value;
            if (value < darkPixelLevel) dark++;
        }

        return {
            mean: sum / data.length,
            darkFraction: dark / data.length
        };
    }

    looksLikeDarkScreenshot(stats) {
        const { minDarkFraction, maxMeanLuminance } = this.config.darkImage;

        return stats.darkFraction >= minDarkFraction &&
            stats.mean <= maxMeanLuminance;
    }

    async downloadImage(imageUrl) {
        const response = await fetch(imageUrl, {
            signal: AbortSignal.timeout(15000)
        });

        if (!response.ok) {
            throw new Error(`Image download failed (${response.status})`);
        }

        const contentLength = Number(
            response.headers.get('content-length') || 0
        );

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

    async ocrImage(buffer, evaluate) {
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
            {
                name: 'top-left',
                left: 0,
                top: 0,
                width: halfWidth,
                height: halfHeight
            },
            {
                name: 'top-right',
                left: x2,
                top: 0,
                width: halfWidth,
                height: halfHeight
            },
            {
                name: 'bottom-left',
                left: 0,
                top: y2,
                width: halfWidth,
                height: halfHeight
            },
            {
                name: 'bottom-right',
                left: x2,
                top: y2,
                width: halfWidth,
                height: halfHeight
            }
        ];

        const results = [];
        const detectedKeywords = new Map();

        const recordResult = (tsv, region, psm) => {
            if (!tsv) return;

            const recognizedText = tsv.split(/\r?\n/)
                .slice(1)
                .map(row => {
                    const columns = row.split('\t');

                    return columns.length >= 12 &&
                        Number(columns[0]) === 5
                        ? columns.slice(11).join('\t').trim()
                        : '';
                })
                .filter(Boolean)
                .join(' ');

            if (recognizedText) results.push(recognizedText);

            const found = this.findKeywordsFromTsv(tsv);

            for (const [keyword, weight] of found) {
                detectedKeywords.set(keyword, weight);
            }

            if (found.size > 0 || VERBOSE) {
                console.log(
                    `[AutoMod OCR] ${region}, PSM ${psm}: ${[...found.keys()].join(', ') || 'no keywords'}`
                );
            }
        };

        const isConclusive = () => evaluate(detectedKeywords);
        const result = () => ({
            text: results.join('\n'),
            keywords: detectedKeywords
        });

        let ocrFailed = false;
        const safeRecognize = async (buf, psm, name) => {
            if (ocrFailed) return null;
            try {
                return await this.recognize(buf, psm);
            } catch (error) {
                ocrFailed = true;
                console.warn(`[AutoMod OCR] ${name} PSM ${psm} failed: ${error.message}`);
                return null;
            }
        };

        // Pass 1: whole image, sparse text mode.
        recordResult(await safeRecognize(prepared, 11, 'full'), 'full', 11);

        if (isConclusive()) return result();

        // Pass 2: overlapping quadrants.
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

            recordResult(
                await safeRecognize(crop, 6, region.name),
                region.name,
                6
            );

            if (isConclusive()) return result();
        }

        // Pass 3: thresholded whole image if little text was recognized.
        if (
            results.join('').trim().length <
            MIN_USEFUL_TEXT_LENGTH
        ) {
            const thresholded = await sharp(prepared)
                .threshold(160)
                .png()
                .toBuffer();

            recordResult(
                await safeRecognize(thresholded, 6, 'full-thresolded'),
                'full-thresholded',
                6
            );
        }

        return result();
    }

    async recognize(buffer, psm) {
        const tempFilePath = path.join(
            os.tmpdir(),
            `automod_${crypto.randomUUID()}.png`
        );

        try {
            await fs.writeFile(tempFilePath, buffer);

            const { stdout } = await execFileAsync(
                this.config.tesseractBinary,
                [
                    tempFilePath,
                    'stdout',
                    '-l',
                    'eng',
                    '--oem',
                    '1',
                    '--psm',
                    String(psm),
                    'tsv'
                ],
                {
                    timeout: OCR_TIMEOUT_MS,
                    maxBuffer: 10 * 1024 * 1024,
                    encoding: 'utf8',
                    env: {...process.env, OMP_THREAD_LIMIT: '1'}
                }
            );

            return stdout;
        } catch (error) {
            if (error.code === 'ETIMEDOUT' || error.killed) {
                throw new Error(
                    `OCR timed out after ${OCR_TIMEOUT_MS}ms`
                );
            }

            throw error;
        } finally {
            await fs.unlink(tempFilePath).catch(() => {});
        }
    }

    isExempt(member) {
        if (!member) return false;

        const exemptPermissions = [
            PermissionFlagsBits.Administrator,
            PermissionFlagsBits.ManageMessages,
            PermissionFlagsBits.ModerateMembers,
            PermissionFlagsBits.BanMembers
        ];

        if (
            exemptPermissions.some(permission =>
                member.permissions?.has(permission)
            )
        ) {
            return true;
        }

        return this.config.exemptRoleIds.length > 0 &&
            !!member.roles?.cache?.some(role =>
                this.config.exemptRoleIds.includes(role.id)
            );
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

            const banLog =
                `[AutoMod] Banned ${username} (${message.author.id}) for: ${reasons.join(', ')}`;

            console.log(banLog);
            await this.sendLog(message.guild, banLog);

            const generalChatId = process.env.GENERAL_CHAT_ID;

            if (generalChatId) {
                const generalChannel =
                    message.guild.channels.cache.get(generalChatId) ||
                    await message.guild.channels.fetch(generalChatId)
                        .catch(() => null);

                if (
                    generalChannel &&
                    generalChannel.isTextBased()
                ) {
                    await generalChannel.send(
                        `pulled the pin on **${username}** for automated spam!`
                    );
                }
            }
        } catch (error) {
            console.error('Failed to auto-ban user:', error);
        }
    }
}

module.exports = AutoModManager;