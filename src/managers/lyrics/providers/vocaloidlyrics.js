const cheerio = require('cheerio');
const { titleMatches } = require('../trackMeta');

const WIKI = 'https://vocaloidlyrics.miraheze.org';
const API = `${WIKI}/w/api.php`;
const TIMEOUT_MS = 8000;

const ROMAJI_HEADER = /romaji|romani[sz]ed|romani[sz]ation|rōmaji/i;
const ORIGINAL_HEADER = /japanese|original|kanji|kana|日本語|原文/i;

function headers() {
    // Miraheze asks API clients for a descriptive User-Agent with a way to reach you
    return { 'User-Agent': process.env.LYRICS_USER_AGENT || 'reze-discord-bot/1.0', Accept: 'application/json' };
}

async function api(params) {
    const res = await fetch(`${API}?${new URLSearchParams({ format: 'json', formatversion: '2', ...params })}`, {
        headers: headers(),
        signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!res.ok) throw new Error(`Vocaloid Lyrics Wiki responded ${res.status}`);
    return res.json();
}

function cellText($, cell) {
    const clone = $(cell).clone();
    clone.find('br').replaceWith('\n');
    clone.find('p, div, li').each((_, el) => { $(el).append('\n'); });
    clone.find('sup, .reference, style, script').remove();
    return clone.text()
        .replace(/\r/g, '')
        .split('\n')
        .map(line => line.replace(/\s+/g, ' ').trim())
        .join('\n')
        .replace(/\n{3,}/g, '\n\n')
        .trim();
}

const looksLatin = text => {
    const letters = text.match(/\p{L}/gu) || [];
    return letters.length > 0 && letters.filter(ch => /[A-Za-zĀ-ſ]/.test(ch)).length / letters.length > 0.8;
};

function parseLyricsHtml(html) {
    const $ = cheerio.load(html);

    for (const table of $('table').toArray()) {
        const rows = $(table).find('tr').toArray();
        if (rows.length === 0) continue;

        const headerCells = $(rows[0]).children('th, td').toArray().map(cell => cellText($, cell));
        let romajiCol = headerCells.findIndex(text => ROMAJI_HEADER.test(text));
        let originalCol = headerCells.findIndex(text => ORIGINAL_HEADER.test(text));
        const hasHeader = romajiCol !== -1 || originalCol !== -1;
        const dataRows = hasHeader ? rows.slice(1) : rows;

        const columns = [];
        for (const row of dataRows) {
            $(row).children('td, th').each((index, cell) => {
                (columns[index] ||= []).push(cellText($, cell));
            });
        }
        const joined = columns.map(col => (col || []).filter(Boolean).join('\n\n').trim());
        if (joined.every(col => !col)) continue;

        if (!hasHeader) {
            originalCol = 0;
            romajiCol = joined.length > 1 && looksLatin(joined[1]) ? 1 : -1;
        } else if (originalCol === -1) {
            originalCol = joined.findIndex((_, i) => i !== romajiCol && joined[i]);
        }

        return {
            original: originalCol >= 0 ? joined[originalCol] || null : null,
            romaji: romajiCol >= 0 ? joined[romajiCol] || null : null,
        };
    }
    return null;
}

async function findPage(candidates) {
    for (const candidate of candidates) {
        const data = await api({
            action: 'query', list: 'search', srsearch: candidate.title, srnamespace: '0', srlimit: '5', srprop: '',
        });
        const hits = data?.query?.search || [];
        const match = hits.find(hit => candidates.some(c => titleMatches(hit.title, c.title)));
        if (match) return match.title;
    }
    return null;
}

module.exports = {
    id: 'vocaloidlyrics',
    name: 'Vocaloid Lyrics Wiki',
    isConfigured: () => true,
    parseLyricsHtml,
    async fetch(candidates, { romanized }) {
        const page = await findPage(candidates);
        if (!page) return null;

        const data = await api({
            action: 'parse', page, prop: 'text', redirects: '1', disableeditsection: '1', disablelimitreport: '1',
        });
        const html = data?.parse?.text;
        if (!html) return null;

        const lyrics = parseLyricsHtml(html);
        if (!lyrics) return null;

        const useRomaji = romanized && lyrics.romaji;
        const text = useRomaji ? lyrics.romaji : (lyrics.original || lyrics.romaji);
        if (!text) return null;

        return {
            provider: 'Vocaloid Lyrics Wiki',
            text,
            romanized: Boolean(useRomaji),
            hasRomaji: Boolean(lyrics.romaji),
            synced: null,
            url: `${WIKI}/wiki/${encodeURIComponent(page.replace(/ /g, '_'))}`,
        };
    },
};