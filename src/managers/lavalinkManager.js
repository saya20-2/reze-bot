const { Shoukaku, Connectors } = require('shoukaku');

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

    clear() {
        this.tracks = [];
        this.current = null;
    }
}

class LavalinkManager {
    constructor(client) {
        this.client = client;
        this.queues = new Map(); // guildId -> MusicQueue

        const Nodes = [{
            name: process.env.LAVALINK_NAME || 'MainNode',
            url: process.env.LAVALINK_URL || 'localhost:2333',
            auth: process.env.LAVALINK_PASSWORD
        }];

        const ShoukakuOptions = {
            moveOnDisconnect: false,
            resumeKey: 'RezeMusic',
            resumeTimeout: 30,
            reconnectTries: 5,
            reconnectInterval: 5000,
        };

        this.shoukaku = new Shoukaku(new Connectors.DiscordJS(client), Nodes, ShoukakuOptions);
        this.initEvents();
    }

    initEvents() {
        this.shoukaku.on('error', (name, error) => console.error(`[Lavalink] Node ${name} Error:`, error));
        this.shoukaku.on('ready', (name) => console.log(`[Lavalink] Node ${name} is ready!`));
        this.shoukaku.on('close', (name, code, reason) => console.warn(`[Lavalink] Node ${name} closed: ${reason || 'No reason'} (Code: ${code})`));
    }

    getQueue(guildId) {
        if (!this.queues.has(guildId)) {
            this.queues.set(guildId, new MusicQueue(guildId));
        }
        return this.queues.get(guildId);
    }
}

module.exports = LavalinkManager;