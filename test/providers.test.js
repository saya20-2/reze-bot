// Provider chain tests with a mocked fetch. The wiki responses are stand-ins shaped like MediaWiki's API output.
const test = require('node:test');
const assert = require('node:assert/strict');

const realFetch = global.fetch;
const calls = [];
function mockFetch(routes) {
    global.fetch = async url => {
        const u = String(url);
        calls.push(u);
        for (const [needle, body] of routes) {
            if (u.includes(needle)) return { ok: true, status: 200, json: async () => body };
        }
        return { ok: true, status: 200, json: async () => [] };
    };
}
test.afterEach(() => { global.fetch = realFetch; calls.length = 0; delete process.env.LYRICS_PROVIDERS; });

const info = { identifier: 'abc', title: 'モニタリング / Monitoring', author: 'Someone', length: 215000, isStream: false };
const WIKI_TABLE = '<table><tr><th>Japanese</th><th>Romaji</th></tr><tr><td>監視</td><td>kanshi</td></tr></table>';
const wikiRoutes = [
    ['list=search', { query: { search: [{ title: 'モニタリング (Monitoring)' }] } }],
    ['action=parse', { parse: { text: WIKI_TABLE } }],
];

function fresh() {
    for (const key of Object.keys(require.cache)) if (key.includes('/managers/lyrics')) delete require.cache[key];
    return require('../src/managers/lyrics');
}

test('LRCLIB answers when it has a close duration match, and rejects wrong-length hits', async () => {
    mockFetch([['lrclib.net', [
        { trackName: 'Monitoring', artistName: 'x', duration: 300, plainLyrics: 'wrong length', syncedLyrics: null },
        { trackName: 'Monitoring', artistName: 'x', duration: 216, plainLyrics: 'right one', syncedLyrics: '[00:01.00] right one' },
    ]]]);
    const result = await fresh().getLyrics(info);
    assert.equal(result.provider, 'LRCLIB');
    assert.equal(result.text, 'right one');
    assert.ok(result.synced);
});

test('falls back to the wiki when LRCLIB has nothing', async () => {
    mockFetch([...wikiRoutes]);
    const result = await fresh().getLyrics(info);
    assert.equal(result.provider, 'Vocaloid Lyrics Wiki');
    assert.equal(result.text, '監視');
    assert.equal(result.romanized, false);
});

test('romanized requests ask the wiki first and use its romaji column', async () => {
    mockFetch([['lrclib.net', [{ trackName: 'Monitoring', duration: 215, plainLyrics: '監視', syncedLyrics: null }]], ...wikiRoutes]);
    const result = await fresh().getLyrics(info, { romanized: true });
    assert.equal(result.provider, 'Vocaloid Lyrics Wiki');
    assert.equal(result.text, 'kanshi');
    assert.equal(result.romanized, true);
    assert.ok(!calls.some(url => url.includes('lrclib.net')), 'LRCLIB is not even queried when the wiki has romaji');
});

test('romanized falls back to the original script when no source has romaji', async () => {
    mockFetch([['lrclib.net', [{ trackName: 'Monitoring', duration: 215, plainLyrics: '監視', syncedLyrics: null }]]]);
    const result = await fresh().getLyrics(info, { romanized: true });
    assert.equal(result.provider, 'LRCLIB');
    assert.equal(result.romanized, false);
    assert.equal(result.romajiRequestedButMissing, true);
});

test('results are cached per song and a failing provider does not break the chain', async () => {
    let n = 0;
    global.fetch = async url => {
        n++;
        if (String(url).includes('lrclib.net')) throw new Error('boom');
        const body = String(url).includes('list=search') ? { query: { search: [{ title: 'Monitoring' }] } } : { parse: { text: WIKI_TABLE } };
        return { ok: true, status: 200, json: async () => body };
    };
    const lyrics = fresh();
    assert.equal((await lyrics.getLyrics(info)).provider, 'Vocaloid Lyrics Wiki');
    const before = n;
    await lyrics.getLyrics(info);
    assert.equal(n, before, 'second lookup is served from the cache');
});