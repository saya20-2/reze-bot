const { Shoukaku, Connectors } = require('shoukaku');
const DISCONNECT_TIMEOUT_MS = 30 * 60 * 1000;

class MusicQueue {
    constructor(guildId) {
        this.guildId = guildId;
        this.tracks = [];
        this.current = null;
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
    }
}

class LavalinkManager {
    constructor(client) {
        this.client = client;
        this.queues = new Map(); 
        this.idleTimers = new Map(); 
        this.aloneTimers = new Map(); 
        this.disconnectTimeoutMs = DISCONNECT_TIMEOUT_MS;

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
        this.shoukaku.on('reconnecting', (name, _left, interval) => console.warn(`[Lavalink] Node ${name} lost, retrying in ${interval}s...`));
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
            const info = event.track?.info;
            if ((event.reason === 'finished' || event.reason === 'loadFailed') && info && !info.isStream
                && info.length - player.position > 15000) {
                console.warn(`[Lavalink] Track ended early (${event.reason}) at ~${Math.round(player.position / 1000)}s of ${Math.round(info.length / 1000)}s: ${info.title}`);
            }
            if (event.reason !== 'finished' && event.reason !== 'loadFailed') return;
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

    async playNext(guildId) {
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
        this.clearIdle(guildId);
        try {
            await player.playTrack({ track: { encoded: next.encoded } });
        } catch (error) {
            queue.current = null;
            this.scheduleIdle(guildId);
            throw error;
        }
        return next;
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