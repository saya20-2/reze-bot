const { escapeMarkdown } = require('discord.js');
const { candidatesFor } = require('./trackMeta');
const lrclib = require('./providers/lrclib');
const vocaloidlyrics = require('./providers/vocaloidlyrics');

const PROVIDERS = new Map([lrclib, vocaloidlyrics].map(p => [p.id, p]));
const DEFAULT_ORDER = 'lrclib,vocaloidlyrics';
const HIT_TTL_MS = 6 * 60 * 60 * 1000;
const MISS_TTL_MS = 10 * 60 * 1000;
const MAX_CACHE = 300;

// Order comes from LYRICS_PROVIDERS, e.g. "lrclib,vocaloidlyrics". Providers that are not configured are skipped.
function providerOrder() {
    return (process.env.LYRICS_PROVIDERS || DEFAULT_ORDER)
        .split(',')
        .map(id => PROVIDERS.get(id.trim().toLowerCase()))
        .filter(provider => provider && provider.isConfigured());
}

const cache = new Map();
const inflight = new Map();

function remember(key, value, ttl) {
    cache.set(key, { value, expires: Date.now() + ttl });
    while (cache.size > MAX_CACHE) cache.delete(cache.keys().next().value);
}

async function lookup(info, romanized) {
    const candidates = candidatesFor(info);
    const durationS = info.isStream || !info.length ? null : Math.round(info.length / 1000);
    let providers = providerOrder();

    if (romanized) {
        providers = [...providers.filter(p => p.id === 'vocaloidlyrics'), ...providers.filter(p => p.id !== 'vocaloidlyrics')];
    }

    let romajiMissing = false;
    for (const provider of providers) {
        let result;
        try {
            result = await provider.fetch(candidates, { durationS, romanized });
        } catch (error) {
            console.warn(`[Lyrics] ${provider.name} failed for "${info.title}": ${error.message}`);
            continue;
        }
        if (!result) continue;
        if (romanized && !result.romanized) romajiMissing = true;
        return { ...result, romajiRequestedButMissing: romanized && !result.romanized, romajiMissing };
    }
    return null;
}

async function getLyrics(info, { romanized = false } = {}) {
    const key = `${info.identifier || info.uri || info.title}|${romanized ? 'r' : 'o'}`;
    const hit = cache.get(key);
    if (hit && hit.expires > Date.now()) return hit.value;
    if (inflight.has(key)) return inflight.get(key);

    const promise = lookup(info, romanized)
        .then(value => { remember(key, value, value ? HIT_TTL_MS : MISS_TTL_MS); return value; })
        .finally(() => inflight.delete(key));
    inflight.set(key, promise);
    return promise;
}

function escapeLyrics(text) {
    return escapeMarkdown(text, { heading: true, bulletedList: true, numberedList: true, maskedLink: true })
        .replace(/^(\s*)(>|-#)/gm, '$1\\$2');
}

// Embed descriptions hold 4096 characters; split on line boundaries and prefer stanza breaks
function paginate(text, max = 3900) {
    const pages = [];
    let current = '';
    for (const stanza of text.split(/\n{2,}/)) {
        const block = stanza.trim();
        if (!block) continue;
        if (block.length > max) {
            if (current) { pages.push(current); current = ''; }
            let chunk = '';
            for (const rawLine of block.split('\n')) {
                const pieces = rawLine.length > max ? rawLine.match(new RegExp(`[^]{1,${max}}`, 'g')) : [rawLine];
                for (const line of pieces) {
                    if (chunk && (chunk + '\n' + line).length > max) { pages.push(chunk); chunk = line; }
                    else chunk = chunk ? `${chunk}\n${line}` : line;
                }
            }
            current = chunk;
            continue;
        }
        if (current && (current + '\n\n' + block).length > max) { pages.push(current); current = block; }
        else current = current ? `${current}\n\n${block}` : block;
    }
    if (current) pages.push(current);
    return pages;
}

module.exports = { getLyrics, paginate, escapeLyrics, providerOrder };