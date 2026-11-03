// Exercises the lyrics posting flow of LavalinkManager against a fake Discord channel (no network, no Lavalink)
const test = require('node:test');
const assert = require('node:assert/strict');
const lyricsModule = require('../src/managers/lyrics');
const LavalinkManager = require('../src/managers/lavalinkManager');

function setup() {
    const posted = [];
    const deleted = [];
    let nextId = 1;
    const channel = {
        id: 'chan',
        send: async payload => { const m = { id: String(nextId++), payload }; posted.push(m); return m; },
        messages: { delete: async id => { deleted.push(id); } },
    };
    const manager = Object.create(LavalinkManager.prototype);
    manager.queues = new Map();
    manager.client = { channels: { fetch: async () => channel } };
    const queue = manager.getQueue('guild');
    queue.textChannelId = 'chan';
    const track = (id, title = id) => ({ info: { identifier: id, title, author: 'a', length: 200000, isStream: false, uri: `https://y/${id}` } });
    return { manager, queue, posted, deleted, track };
}

const stub = fn => { lyricsModule.getLyrics = fn; };
const tick = () => new Promise(resolve => setImmediate(resolve));

test('enabling mid-song posts the current lyrics once the command has replied', async () => {
    const { manager, queue, posted, track } = setup();
    stub(async () => ({ provider: 'LRCLIB', text: 'line a\nline b', romanized: false, url: 'https://lrclib.net/x' }));
    queue.current = track('t1', 'Song One');

    manager.setLyricsPreferences('guild', { enabled: true });
    assert.equal(posted.length, 0, 'nothing is posted before flushLyrics, so it cannot land above the command reply');
    await manager.flushLyrics('guild');

    assert.equal(posted.length, 1);
    const embed = posted[0].payload.embeds[0].toJSON();
    assert.equal(embed.title, 'Lyrics: Song One');
    assert.equal(embed.description, 'line a\nline b');
    assert.equal(embed.footer.text, 'Source: LRCLIB');
    assert.deepEqual(posted[0].payload.allowedMentions, { parse: [] });
    assert.deepEqual(queue.lyrics.messageIds, ['1']);
});

test('a new song removes the old lyrics and posts the new ones; disabling removes them', async () => {
    const { manager, queue, posted, deleted, track } = setup();
    stub(async info => ({ provider: 'LRCLIB', text: `lyrics of ${info.identifier}`, romanized: false }));
    queue.current = track('t1');
    manager.setLyricsPreferences('guild', { enabled: true });
    await manager.flushLyrics('guild');

    queue.current = track('t2');
    await manager.refreshLyrics('guild');
    assert.deepEqual(deleted, ['1']);
    assert.equal(posted.length, 2);
    assert.match(posted[1].payload.embeds[0].toJSON().description, /t2/);

    manager.setLyricsPreferences('guild', { enabled: false });
    await tick();
    assert.deepEqual(deleted, ['1', '2']);
    assert.deepEqual(queue.lyrics.messageIds, []);
});

test('a slow lookup for a song that was skipped never posts', async () => {
    const { manager, queue, posted, track } = setup();
    let release;
    stub(() => new Promise(resolve => { release = () => resolve({ provider: 'LRCLIB', text: 'late', romanized: false }); }));
    queue.lyrics.enabled = true;
    const first = track('t1');
    queue.current = first;
    const pending = manager.refreshLyrics('guild');
    await tick();
    queue.current = track('t2'); // skipped while the lookup was running
    release();
    await pending;
    assert.equal(posted.length, 0);
});

test('missing lyrics and missing romaji are reported instead of silently skipped', async () => {
    const { manager, queue, posted, track } = setup();
    queue.lyrics.enabled = true;
    queue.current = track('t1', 'Obscure Song');

    stub(async () => null);
    await manager.refreshLyrics('guild');
    assert.match(posted[0].payload.content, /couldn’t find lyrics for \*\*Obscure Song\*\*/);

    stub(async () => ({ provider: 'LRCLIB', text: '歌詞', romanized: false }));
    queue.lyrics.romanized = true;
    await manager.refreshLyrics('guild');
    assert.match(posted[1].payload.embeds[0].toJSON().footer.text, /no romanized version found/);
});

test('markdown in lyrics is escaped and very long lyrics are capped at three messages', async () => {
    const { manager, queue, posted, track } = setup();
    queue.lyrics.enabled = true;
    queue.current = track('t1');
    const stanza = Array.from({ length: 30 }, (_, i) => `*la* line ${i} of a very long song`).join('\n');
    stub(async () => ({ provider: 'Vocaloid Lyrics Wiki', text: Array.from({ length: 80 }, () => stanza).join('\n\n'), romanized: true }));
    await manager.refreshLyrics('guild');
    assert.equal(posted.length, 3);
    assert.ok(posted[0].payload.embeds[0].toJSON().description.includes('\\*la\\*'));
    assert.match(posted[2].payload.embeds[0].toJSON().footer.text, /romanized • truncated/);
});