const { Shoukaku, Connectors } = require('shoukaku');
const ytdlp = require('./Ytdlp');
const { formatNextLine } = require('./downloadProgress');
const lyrics = require('./lyrics');
const { EmbedBuilder } = require('discord.js');
const DISCONNECT_TIMEOUT_MS = 30 * 60 * 1000;
const EARLY_END_MS = 15000;
const MAX_RESUME_ATTEMPTS = 2;
const MIN_RESUME_PROGRESS_MS = 5000;
const EMOTE_DOWNLOADING = 'Mad_oka';
const EMOTE_DONE = 'MadoVibing_MM';
const NOW_PLAYING_EDIT_INTERVAL_MS = 2000;
const MAX_LYRICS_MESSAGES = 3;

function newLyricsState() {
    return { enabled: false, romanized: false, pending: false, token: 0, channelId: null, messageIds: [] };
}

class MusicQueue {
    constructor(guildId) {
        this.guildId = guildId;
        this.tracks = [];
        this.current = null;
        this.retry = null; 
        this.playable = null; 
        this.textChannelId = null;
        this.nowPlaying = null; 
        this.lyrics = newLyricsState();
    }

    add(track) {
        this.tracks.push(track);
    }

    addMultiple(tracks) {
        this.tracks.push(...tracks);
    }

    shuffle() {
        for (let i = this.tracks.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [this.tracks[i], this.tracks[j]] = [this.tracks[j], this.tracks[i]];
        }
    }

    clearUpcoming() {
        this.tracks = [];
    }

    clear() {
        this.tracks = [];
        this.current = null;
        this.retry = null;
        this.playable = null;
        this.nowPlaying = null;
        this.lyrics = newLyricsState();
    }
}

class LavalinkManager {
    constructor(client) {
        this.client = client;
        this.queues = new Map(); 
        this.idleTimers = new Map(); 
        this.aloneTimers = new Map(); 
        this.disconnectTimeoutMs = DISCONNECT_TIMEOUT_MS;
        this.failedTracks = new Map(); 

        const Nodes = [{
            name: process.env.LAVALINK_NAME || 'MainNode',
            url: process.env.LAVALINK_URL || 'localhost:2333',
            auth: process.env.LAVALINK_PASSWORD
        }];

        const ShoukakuOptions = {
            moveOnDisconnect: false,
            resume: true,
            resumeTimeout: 60,
            resumeByLibrary: true,
            reconnectTries: Infinity,
            reconnectInterval: 5,
        };

        this.shoukaku = new Shoukaku(new Connectors.DiscordJS(client), Nodes, ShoukakuOptions);
        this.initEvents();
    }

    initEvents() {
        this.shoukaku.on('error', (name, error) => console.error(`[Lavalink] Node ${name} Error:`, error));
        this.shoukaku.on('ready', (name, resumed, resumedByLibrary) => console.log(`[Lavalink] Node ${name} is ready! (resumed: ${resumed}, players restored by library: ${resumedByLibrary})`));
        this.shoukaku.on('reconnecting', (name, _triesLeft, interval) => console.warn(`[Lavalink] Node ${name} lost, retrying in ${interval}s...`));
        this.shoukaku.on('close', (name, code, reason) => console.warn(`[Lavalink] Node ${name} closed: ${reason || 'No reason'} (Code: ${code})`));

        this.client.on('voiceStateUpdate', (_oldState, newState) => this.handleVoiceStateUpdate(newState));
    }

    getQueue(guildId) {
        if (!this.queues.has(guildId)) {
            this.queues.set(guildId, new MusicQueue(guildId));
        }
        return this.queues.get(guildId);
    }

    setupPlayer(player) {
        const guildId = player.guildId;
        this.scheduleIdle(guildId);
        player.on('start', () => this.clearIdle(guildId));
        player.on('end', async (event) => {
            const queue = this.getQueue(guildId);
            const current = queue.current;
            const isCurrent = current && (event.track?.encoded === queue.playable || event.track?.encoded === current.encoded);
            const info = (isCurrent ? current : event.track)?.info;
            const finishedOrFailed = event.reason === 'finished' || event.reason === 'loadFailed';
            const endedEarly = finishedOrFailed && info && !info.isStream
                && info.length - player.position > EARLY_END_MS;

            if (endedEarly) {
                console.warn(`[Lavalink] Track ended early (${event.reason}) at ~${Math.round(player.position / 1000)}s of ${Math.round(info.length / 1000)}s: ${info.title}`);
                if (await this.resumeTrack(guildId, player, event.track)) return;
            }
            if (!finishedOrFailed) return;
            if (event.reason === 'loadFailed') this.reportFailure(guildId, info?.title);
            try {
                await this.playNext(guildId);
            } catch (error) {
                console.error('[Lavalink] Failed to play next track:', error);
            }
        });

        player.on('stuck', (event) => {
            console.warn(`[Lavalink] Track stuck (no audio for ${event.thresholdMs}ms): ${event.track?.info?.title}`);
        });

        player.on('closed', (event) => {
            console.warn(`[Lavalink] Discord voice websocket closed: code ${event.code}, byRemote ${event.byRemote}, reason "${event.reason}"`);
        });

        player.on('exception', (error) => {
            console.error('[Lavalink Player Exception]:', error);
        });
    }

    async playNext(guildId, options = {}) {
        const queue = this.getQueue(guildId);
        const player = this.shoukaku.players.get(guildId);
        if (!player) return null;

        const next = queue.tracks.shift();
        if (!next) {
            queue.current = null;
            this.detachNowPlaying(guildId);
            this.scheduleIdle(guildId);
            return null;
        }

        if (options.silent) this.detachNowPlaying(guildId);

        queue.current = next;
        queue.retry = null;
        queue.playable = null;
        this.clearIdle(guildId);
        this.deleteLyricsMessages(guildId);
        try {
            const encoded = await this.getPlayableEncoded(player, next, options.onProgress);
            queue.playable = encoded;
            await player.playTrack({ track: { encoded } });
        } catch (error) {
            queue.current = null;
            queue.playable = null;
            this.scheduleIdle(guildId);
            throw error;
        }

        // Songs that start on their own keep editing the same "Now playing" message
        if (!options.silent && queue.nowPlaying) {
            const np = queue.nowPlaying;
            np.base = `Now playing: **[${next.info.title}](${next.info.uri})**`;
            np.line = null;
            np.stage = null;
            this.sendNowPlayingEdit(guildId, np);
            this.refreshLyrics(guildId);
        }

        this.refreshPrefetch(guildId);
        return next;
    }

    emoteFor(guildId, name) {
        const wanted = name.toLowerCase();
        const matches = emoji => emoji.name?.toLowerCase() === wanted;
        const emoji = this.client.guilds?.cache.get(guildId)?.emojis?.cache.find(matches) ?? this.client.emojis?.cache.find(matches);
        return emoji ? emoji.toString() : '';
    }

    setNowPlaying(guildId, message, base) {
        if (!message?.id) return;
        const queue = this.getQueue(guildId);
        queue.nowPlaying = {
            channelId: message.channelId,
            messageId: message.id,
            base,
            line: null,
            stage: null,
            lastContent: base,
            lastEdit: 0,
            pending: Promise.resolve(),
        };
        this.refreshPrefetch(guildId);
        this.refreshLyrics(guildId);
    }

    detachNowPlaying(guildId) {
        const queue = this.getQueue(guildId);
        const np = queue.nowPlaying;
        if (!np) return;
        queue.nowPlaying = null;
        if (np.line) {
            np.line = null;
            this.sendNowPlayingEdit(guildId, np);
        }
    }

    sendNowPlayingEdit(guildId, np) {
        np.pending = np.pending.then(async () => {
            const content = np.base + (np.line ? `\n${np.line}` : '');
            if (content === np.lastContent) return;
            np.lastContent = content;
            np.lastEdit = Date.now();
            try {
                const channel = await this.client.channels.fetch(np.channelId);
                await channel.messages.edit(np.messageId, { content });
            } catch (error) {
                if (error.code === 10008 || error.code === 10003) {
                    const queue = this.getQueue(guildId);
                    if (queue.nowPlaying === np) queue.nowPlaying = null;
                } else {
                    console.warn(`[Lavalink] Could not edit the now-playing message: ${error.message}`);
                }
            }
        }).catch(() => {});
    }

    updateNextLine(guildId, np, line, stage) {
        np.line = line;
        const stageChanged = np.stage !== stage;
        np.stage = stage;
        if (!stageChanged && Date.now() - np.lastEdit < NOW_PLAYING_EDIT_INTERVAL_MS) return;
        this.sendNowPlayingEdit(guildId, np);
    }

    // Download the first upcoming song ahead of time and show its progress under "Now playing"
    refreshPrefetch(guildId) {
        const queue = this.getQueue(guildId);
        const np = queue.nowPlaying;
        const upcoming = queue.tracks[0];
        if (queue.lyrics.enabled && upcoming && !upcoming.info.isStream) {
            lyrics.getLyrics(upcoming.info, { romanized: queue.lyrics.romanized }).catch(() => {});
        }
        const downloadable = upcoming && upcoming.info.sourceName === 'youtube' && !upcoming.info.isStream;

        const clearLine = () => {
            if (np && queue.nowPlaying === np && queue.tracks[0] === upcoming && np.line) {
                np.line = null;
                np.stage = null;
                this.sendNowPlayingEdit(guildId, np);
            }
        };

        if (!downloadable) {
            if (np && np.line) {
                np.line = null;
                np.stage = null;
                this.sendNowPlayingEdit(guildId, np);
            }
            return;
        }

        const onProgress = np && (progress => {
            if (queue.nowPlaying !== np || queue.tracks[0] !== upcoming) return;
            const emote = this.emoteFor(guildId, progress.stage === 'done' ? EMOTE_DONE : EMOTE_DOWNLOADING);
            this.updateNextLine(guildId, np, formatNextLine(progress, upcoming.info.title, emote), progress.stage);
        });

        ytdlp.getAudioFile(upcoming.info.uri, upcoming.info.identifier, onProgress)
            .then(file => { if (!file) clearLine(); })
            .catch(() => clearLine());
    }

    async getPlayableEncoded(player, track, onProgress) {
        if (track.info.sourceName !== 'youtube' || track.info.isStream) return track.encoded;

        try {
            const file = await ytdlp.getAudioFile(track.info.uri, track.info.identifier, onProgress && (progress => onProgress({ ...progress, title: track.info.title })));
            if (file) {
                const res = await player.node.rest.resolve(file);
                if (res?.loadType === 'track') {
                    console.log(`[Lavalink] Playing "${track.info.title}" via yt-dlp`);
                    return res.data.encoded;
                }
                console.warn(`[yt-dlp] Lavalink could not load ${file} (${res?.loadType}). Is sources.local enabled in Lavalink and the folder readable by it? Using the YouTube plugin instead`);
            }
        } catch (error) {
            console.warn(`[yt-dlp] ${track.info.title}: ${error.message}, using the YouTube plugin instead`);
        }
        if (onProgress) onProgress({ stage: 'fallback', title: track.info.title });
        console.log(`[Lavalink] Playing "${track.info.title}" via the YouTube plugin`);
        return track.encoded;
    }

    // ---- Lyrics ----------------------------------------------------------------------------------------------
    // Lyrics live in their own message(s) right below the "Now playing" message: message content always renders
    // above link previews, so lyrics inside that message could never sit under the video embed.

    // Reads the optional `lyrics` / `romanized` options of /play, /search and /radio. Returns nothing; if lyrics
    // should show up for a song that is already playing, flushLyrics() posts them once the command has replied.
    applyLyricsOptions(interaction) {
        const enabled = interaction.options.getBoolean('lyrics');
        const romanized = interaction.options.getBoolean('romanized');
        this.setLyricsPreferences(interaction.guildId, {
            enabled: enabled ?? undefined,
            romanized: romanized ?? undefined,
        });
    }

    setLyricsPreferences(guildId, { enabled, romanized }) {
        const queue = this.getQueue(guildId);
        const state = queue.lyrics;
        const wasEnabled = state.enabled;
        const wasRomanized = state.romanized;
        if (typeof romanized === 'boolean') state.romanized = romanized;
        if (typeof enabled === 'boolean') state.enabled = enabled;

        if (!state.enabled) {
            if (wasEnabled) {
                state.token++;
                this.deleteLyricsMessages(guildId);
            }
            return;
        }
        // Nothing is playing yet when a command starts a fresh queue: setNowPlaying() covers that case
        if (queue.current && (!wasEnabled || state.romanized !== wasRomanized)) state.pending = true;
    }

    flushLyrics(guildId) {
        if (this.getQueue(guildId).lyrics.pending) return this.refreshLyrics(guildId);
    }

    async deleteLyricsMessages(guildId) {
        const state = this.getQueue(guildId).lyrics;
        const ids = state.messageIds.splice(0);
        if (ids.length === 0 || !state.channelId) return;
        try {
            const channel = await this.client.channels.fetch(state.channelId);
            await Promise.all(ids.map(id => channel.messages.delete(id).catch(() => {})));
        } catch {
            // channel gone or no access, nothing left to clean up
        }
    }

    async refreshLyrics(guildId) {
        const queue = this.getQueue(guildId);
        const state = queue.lyrics;
        state.pending = false;
        const token = ++state.token;
        await this.deleteLyricsMessages(guildId);

        const track = queue.current;
        if (!state.enabled || !track || track.info.isStream || !queue.textChannelId) return;
        const stale = () => state.token !== token || queue.current !== track;

        let result = null;
        try {
            result = await lyrics.getLyrics(track.info, { romanized: state.romanized });
        } catch (error) {
            console.warn(`[Lyrics] Lookup failed for "${track.info.title}": ${error.message}`);
        }
        if (stale()) return;

        const channel = await this.client.channels.fetch(queue.textChannelId).catch(() => null);
        if (!channel?.send) return;

        const sent = [];
        for (const payload of this.buildLyricsPayloads(track, result, state.romanized)) {
            if (stale()) break;
            try {
                sent.push((await channel.send({ ...payload, allowedMentions: { parse: [] } })).id);
            } catch (error) {
                console.warn(`[Lyrics] Could not post lyrics: ${error.message}`);
                break;
            }
        }

        if (stale()) {
            await Promise.all(sent.map(id => channel.messages.delete(id).catch(() => {})));
            return;
        }
        state.channelId = channel.id;
        state.messageIds.push(...sent);
    }

    buildLyricsPayloads(track, result, romanizedRequested) {
        const title = track.info.title;
        if (!result) return [{ content: `Reze couldn’t find lyrics for **${title}** :(` }];

        const allPages = lyrics.paginate(lyrics.escapeLyrics(result.text));
        const pages = allPages.slice(0, MAX_LYRICS_MESSAGES);
        const notes = [`Source: ${result.provider}`];
        if (result.romanized) notes.push('romanized');
        else if (romanizedRequested) notes.push('no romanized version found, showing the original');
        if (allPages.length > pages.length) notes.push('truncated, full lyrics at the source');

        return pages.map((page, index) => {
            const embed = new EmbedBuilder().setDescription(page);
            if (index === 0) {
                embed.setTitle(`Lyrics: ${title}`.slice(0, 256));
                if (result.url) embed.setURL(result.url);
            }
            if (index === pages.length - 1) embed.setFooter({ text: notes.join(' • ') });
            return { embeds: [embed] };
        });
    }

    async resumeTrack(guildId, player, track) {
        const queue = this.getQueue(guildId);
        const encoded = queue.playable ?? queue.current?.encoded;
        if (!queue.current || !encoded || encoded !== track.encoded) return false;
        if (player.position < MIN_RESUME_PROGRESS_MS) return false;

        const state = queue.retry?.encoded === encoded
            ? queue.retry
            : { encoded, count: 0, position: 0 };
        if (state.count >= MAX_RESUME_ATTEMPTS) return false;
        if (state.count > 0 && player.position - state.position < MIN_RESUME_PROGRESS_MS) return false;

        state.count++;
        state.position = player.position;
        queue.retry = state;

        try {
            await player.playTrack({ track: { encoded }, position: Math.floor(player.position) });
            console.log(`[Lavalink] Resuming "${queue.current.info.title}" from ~${Math.round(player.position / 1000)}s (attempt ${state.count}/${MAX_RESUME_ATTEMPTS})`);
            return true;
        } catch (error) {
            console.error('[Lavalink] Failed to resume track:', error);
            return false;
        }
    }

    reportFailure(guildId, title) {
        const channelId = this.getQueue(guildId).textChannelId;
        if (!channelId || !title) return;

        let batch = this.failedTracks.get(guildId);
        if (!batch) {
            batch = { titles: [], timer: null };
            this.failedTracks.set(guildId, batch);
        }
        batch.titles.push(title);
        if (batch.timer) return;

        batch.timer = setTimeout(() => {
            this.failedTracks.delete(guildId);
            const channel = this.client.channels.cache.get(channelId);
            if (!channel?.send) return;
            const shown = batch.titles.slice(0, 5).map(t => `**${t}**`).join(', ');
            const more = batch.titles.length > 5 ? ` and ${batch.titles.length - 5} more` : '';
            channel.send(`Video ${shown}${more} was too long for Reze :(`)
                .catch(() => {});
        }, 3000);
    }

    async destroyPlayer(guildId) {
        this.clearIdle(guildId);
        this.clearAlone(guildId);
        this.detachNowPlaying(guildId);
        this.getQueue(guildId).clear();

        if (this.shoukaku.players.has(guildId) || this.shoukaku.connections.has(guildId)) {
            try {
                await this.shoukaku.leaveVoiceChannel(guildId);
            } catch (error) {
                console.error('[Lavalink] Failed to leave voice channel:', error);
            }
        }
    }

    scheduleIdle(guildId) {
        if (this.idleTimers.has(guildId)) return;
        const timer = setTimeout(() => {
            this.idleTimers.delete(guildId);
            if (this.getQueue(guildId).current) return;
            console.log(`[Lavalink] Leaving guild ${guildId} after inactivity.`);
            this.destroyPlayer(guildId);
        }, this.disconnectTimeoutMs);
        this.idleTimers.set(guildId, timer);
    }

    clearIdle(guildId) {
        clearTimeout(this.idleTimers.get(guildId));
        this.idleTimers.delete(guildId);
    }

    scheduleAlone(guildId) {
        if (this.aloneTimers.has(guildId)) return;
        const timer = setTimeout(() => {
            this.aloneTimers.delete(guildId);
            if (!this.isAloneInVoice(guildId)) return;
            console.log(`[Lavalink] Leaving guild ${guildId}, alone in the voice channel.`);
            this.destroyPlayer(guildId);
        }, this.disconnectTimeoutMs);
        this.aloneTimers.set(guildId, timer);
    }

    clearAlone(guildId) {
        clearTimeout(this.aloneTimers.get(guildId));
        this.aloneTimers.delete(guildId);
    }

    isAloneInVoice(guildId) {
        const guild = this.client.guilds.cache.get(guildId);
        const channelId = guild?.members.me?.voice?.channelId;
        if (!channelId) return false;
        const channel = guild.channels.cache.get(channelId);
        if (!channel) return false;
        return channel.members.filter(member => !member.user.bot).size === 0;
    }

    handleVoiceStateUpdate(newState) {
        const guildId = newState.guild.id;
        if (!this.shoukaku.players.has(guildId)) return;
        if (newState.id === this.client.user.id && !newState.channelId) {
            this.destroyPlayer(guildId);
            return;
        }

        if (this.isAloneInVoice(guildId)) {
            this.scheduleAlone(guildId);
        } else {
            this.clearAlone(guildId);
        }
    }
}

module.exports = LavalinkManager;