// Run with: node --test test/
// NOTE: the wiki HTML below is a hand-made stand-in for the Vocaloid Lyrics Wiki markup (the site blocks automated
// fetches from where this was written), so it proves the parser logic, not the live page layout. Use
// scripts/probe-lyrics.js to check the real site.
const test = require('node:test');
const assert = require('node:assert/strict');
const { candidatesFor, titleMatches } = require('../src/managers/lyrics/trackMeta');
const { parseLyricsHtml } = require('../src/managers/lyrics/providers/vocaloidlyrics');
const { paginate, escapeLyrics } = require('../src/managers/lyrics');

test('candidatesFor cleans typical YouTube jpop titles', () => {
    const titles = info => candidatesFor(info).map(c => c.title);
    assert.deepEqual(titles({ title: '【初音ミク】モニタリング / Monitoring【オリジナル曲】', author: 'Someone' }).slice(0, 2), ['モニタリング', 'Monitoring']);
    assert.deepEqual(titles({ title: 'YOASOBI - Idol (Official Music Video)', author: 'YOASOBI' }), ['Idol']);
    assert.deepEqual(titles({ title: 'Lemon', author: 'Kenshi Yonezu - Topic' }), ['Lemon']);
    assert.equal(candidatesFor({ title: 'Lemon', author: 'Kenshi Yonezu - Topic' })[0].artist, 'Kenshi Yonezu');
    assert.ok(titles({ title: '米津玄師 「Lemon」 MV', author: 'x' }).includes('Lemon'));
});

test('titleMatches is lenient about punctuation and wiki-style "JP (EN)" titles', () => {
    assert.ok(titleMatches('モニタリング (Monitoring)', 'Monitoring'));
    assert.ok(titleMatches('Idol', 'IDOL'));
    assert.ok(!titleMatches('Lemon', 'Melon Soda'));
});

const TABLE = `
<table class="lyrics"><tr><th>Japanese</th><th>Romaji</th><th>English</th></tr>
<tr><td>一行目<br>二行目</td><td>ichigyoume<br>nigyoume</td><td>line one<br>line two</td></tr>
<tr><td>三行目</td><td>sangyoume</td><td>line three</td></tr></table>`;

test('parseLyricsHtml picks the original and romaji columns, never the translation', () => {
    const parsed = parseLyricsHtml(TABLE);
    assert.equal(parsed.original, '一行目\n二行目\n\n三行目');
    assert.equal(parsed.romaji, 'ichigyoume\nnigyoume\n\nsangyoume');
});

test('parseLyricsHtml copes with a headerless two-column table and with original-only pages', () => {
    const headerless = '<table><tr><td>歌詞</td><td>kashi</td></tr></table>';
    assert.deepEqual(parseLyricsHtml(headerless), { original: '歌詞', romaji: 'kashi' });
    const single = '<table><tr><th>Japanese</th></tr><tr><td>だけ</td></tr></table>';
    assert.deepEqual(parseLyricsHtml(single), { original: 'だけ', romaji: null });
    assert.equal(parseLyricsHtml('<p>no table</p>'), null);
});

test('paginate keeps stanzas together and respects the limit', () => {
    const stanza = Array.from({ length: 10 }, (_, i) => `line number ${i} of the stanza`).join('\n');
    const text = Array.from({ length: 40 }, () => stanza).join('\n\n');
    const pages = paginate(text, 3900);
    assert.ok(pages.length > 1);
    assert.ok(pages.every(page => page.length <= 3900));
    assert.equal(pages.join('\n\n'), text);
    const long = paginate('x'.repeat(5000), 3900); // one unbroken line is cut instead of producing an empty or oversized page
    assert.equal(long.length, 2);
    assert.ok(long.every(page => page.length > 0 && page.length <= 3900));
});

test('escapeLyrics neutralises formatting at line starts and inline', () => {
    const out = escapeLyrics('# a\n- b\n1. c\n> d\n-# e\n*f* ||g||');
    assert.equal(out, '\\# a\n\\- b\n1\\. c\n\\> d\n\\-# e\n\\*f\\* \\|\\|g\\|\\|');
});