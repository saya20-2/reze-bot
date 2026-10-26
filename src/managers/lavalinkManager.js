const { Shoukaku, Connectors } = require('shoukaku');
const ytdlp = require('./Ytdlp');
const DISCONNECT_TIMEOUT_MS = 30 * 60 * 1000;
const EARLY_END_MS = 15000;
const MAX_RESUME_ATTEMPTS = 2;
const MIN_RESUME_PROGRESS_MS = 5000;

class MusicQueue {
    constructor(guildId) {
        this.guildId = guildId;
        this.tracks = [];
        this.current = null;
        this.retry = null; 
        this.playable = null; 
        this.textChannelId = null; 
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
            this.scheduleIdle(guildId);
            return null;
        }

        queue.current = next;
        queue.retry = null;
        queue.playable = null;
        this.clearIdle(guildId);
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

        const upcoming = queue.tracks[0];
        if (upcoming?.info.sourceName === 'youtube' && !upcoming.info.isStream) ytdlp.prefetch(upcoming.info.uri, upcoming.info.identifier);
        return next;
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
            channel.send(`Couldn't play ${shown}${more}, skipping. YouTube refused or cut the stream (very long videos often fail).`)
                .catch(() => {});
        }, 3000);
    }

    async destroyPlayer(guildId) {
        this.clearIdle(guildId);
        this.clearAlone(guildId);
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