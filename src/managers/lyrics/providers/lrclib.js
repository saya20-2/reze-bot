const { titleMatches } = require('../trackMeta');

const BASE_URL = 'https://lrclib.net/api';
const DURATION_TOLERANCE_S = 6;
const TIMEOUT_MS = 8000;

function headers() {
    return { 'User-Agent': process.env.LYRICS_USER_AGENT || 'reze-discord-bot/1.0', Accept: 'application/json' };
}

async function search(params) {
    const res = await fetch(`${BASE_URL}/search?${new URLSearchParams(params)}`, {
        headers: headers(),
        signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!res.ok) throw new Error(`LRCLIB responded ${res.status}`);
    const data = await res.json();
    return Array.isArray(data) ? data : [];
}

// ensuring no missmatched lyrics are fetched
function pick(results, candidate, durationS) {
    const usable = results.filter(r => !r.instrumental && r.plainLyrics && titleMatches(r.trackName, candidate.title));
    const timed = usable
        .map(r => ({ r, diff: durationS ? Math.abs((r.duration || 0) - durationS) : 0 }))
        .filter(x => !durationS || x.diff <= DURATION_TOLERANCE_S)
        .sort((a, b) => (Boolean(b.r.syncedLyrics) - Boolean(a.r.syncedLyrics)) || a.diff - b.diff);
    return timed[0]?.r ?? null;
}

module.exports = {
    id: 'lrclib',
    name: 'LRCLIB',
    isConfigured: () => true,
    async fetch(candidates, { durationS }) {
        for (const candidate of candidates) {
            const queries = [];
            if (candidate.artist) queries.push({ track_name: candidate.title, artist_name: candidate.artist });
            queries.push({ track_name: candidate.title });
            for (const params of queries) {
                const hit = pick(await search(params), candidate, durationS);
                if (hit) {
                    return {
                        provider: 'LRCLIB',
                        text: hit.plainLyrics.trim(),
                        romanized: false,
                        synced: hit.syncedLyrics || null,
                        url: `https://lrclib.net/search/${encodeURIComponent(hit.trackName)}`,
                    };
                }
            }
        }
        return null;
    },
};