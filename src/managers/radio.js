const ytdlp = require('./Ytdlp');

const MIN_LENGTH_MS = 30 * 1000;
const MAX_LENGTH_MS = (Number(process.env.RADIO_MAX_MINUTES) || 12) * 60 * 1000;
const FALLBACK_RESOLVE_PARALLEL = 4;

function videoIdFrom(uri) {
    try {
        const url = new URL(uri);
        if (url.hostname === 'youtu.be') return url.pathname.slice(1) || null;
        return url.searchParams.get('v');
    } catch {
        return null;
    }
}

function isYoutubeUrl(query) {
    return /^https?:\/\/((www|m|music)\.)?(youtube\.com|youtu\.be)\//i.test(query);
}

// "Song (Official Video)", "Song [Lyrics]" and "Song 【MV】" should count as the same song
function titleKey(title) {
    return String(title || '')
        .toLowerCase()
        .replace(/[(\[{【「『（][^)\]}】」』）]*[)\]}】」』）]/g, ' ')
        .replace(/[^\p{L}\p{N}]+/gu, ' ')
        .trim();
}

async function mapLimit(items, limit, fn) {
    const results = new Array(items.length);
    let next = 0;
    const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
        while (next < items.length) {
            const index = next++;
            results[index] = await fn(items[index]).catch(() => null);
        }
    });
    await Promise.all(workers);
    return results;
}

// Find the song a radio should start from: a YouTube link or the top search result for a name
async function findSeed(node, query) {
    let target;
    if (/^https?:\/\//i.test(query)) {
        if (!isYoutubeUrl(query)) return { error: 'Radio only works with YouTube songs.' };
        const id = videoIdFrom(query);
        if (!id) return { error: 'That link is a playlist or channel, give me a single song.' };
        target = `https://www.youtube.com/watch?v=${id}`;
    } else {
        target = `ytsearch:${query}`;
    }

    const res = await node.rest.resolve(target);
    const track = res?.loadType === 'search' ? res.data?.[0] : res?.loadType === 'track' ? res.data : null;
    if (!track?.info || track.info.sourceName !== 'youtube' || !track.info.identifier) {
        return { error: 'Reze couldn’t find that song to start a radio from.' };
    }
    return { track };
}

// YouTube's own radio for the song: the mix playlist RD<videoId>
async function loadMix(node, seed, limit) {
    const id = seed.info.identifier;
    let tracks = [];

    try {
        const res = await node.rest.resolve(`https://www.youtube.com/watch?v=${id}&list=RD${id}`);
        if (res?.loadType === 'playlist') tracks = res.data.tracks || [];
    } catch (error) {
        console.warn(`[Radio] Lavalink could not load the mix: ${error.message}`);
    }

    if (tracks.length >= 2) return tracks;

    // Fallback: ask yt-dlp for the mix, then resolve each video through Lavalink
    try {
        const entries = await ytdlp.getMixEntries(id, Math.ceil(limit * 1.6));
        const resolved = await mapLimit(entries.filter(entry => entry.id !== id), FALLBACK_RESOLVE_PARALLEL, async entry => {
            const res = await node.rest.resolve(`https://www.youtube.com/watch?v=${entry.id}`);
            return res?.loadType === 'track' ? res.data : null;
        });
        tracks = resolved.filter(Boolean);
        if (tracks.length > 0) console.log(`[Radio] Loaded ${tracks.length} songs through the yt-dlp fallback`);
    } catch (error) {
        console.warn(`[Radio] yt-dlp fallback failed: ${error.message}`);
    }
    return tracks;
}

// Keep real, distinct songs: no repeats of the seed or anything already queued, no live streams,
// nothing absurdly short or long (mixes are full of hour-long compilations)
function curate(tracks, { seed, alreadyQueued = [], limit }) {
    const seenIds = new Set([seed.info.identifier, ...alreadyQueued.map(track => track.info.identifier)]);
    const seenTitles = new Set([titleKey(seed.info.title), ...alreadyQueued.map(track => titleKey(track.info.title))]);
    const picked = [];

    for (const track of tracks) {
        if (picked.length >= limit) break;
        const info = track?.info;
        if (!info || info.sourceName !== 'youtube') continue;
        if (info.isStream) continue;
        if (info.length < MIN_LENGTH_MS || info.length > MAX_LENGTH_MS) continue;
        if (seenIds.has(info.identifier)) continue;

        const key = titleKey(info.title);
        if (key && seenTitles.has(key)) continue;

        seenIds.add(info.identifier);
        if (key) seenTitles.add(key);
        picked.push(track);
    }
    return picked;
}

module.exports = { findSeed, loadMix, curate, titleKey, videoIdFrom };