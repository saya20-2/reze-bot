const { getLyrics } = require('../src/managers/lyrics');
const { candidatesFor } = require('../src/managers/lyrics/trackMeta');  // Quick live check of the lyrics sources from the machine the bot runs on: node scripts/probe-lyrics.js "モニタリング" "Monitoring" [--romaji] [--length 220]

(async () => {
    const args = process.argv.slice(2);
    const romanized = args.includes('--romaji');
    const lengthIdx = args.indexOf('--length');
    const length = lengthIdx !== -1 ? Number(args[lengthIdx + 1]) * 1000 : 0;
    const [title, author = ''] = args.filter((a, i) => !a.startsWith('--') && args[i - 1] !== '--length');

    const info = { title, author, length, identifier: `probe-${title}`, isStream: false };
    console.log('Candidates:', candidatesFor(info));
    const result = await getLyrics(info, { romanized });
    if (!result) return console.log('No lyrics found.');
    console.log(`Source: ${result.provider} (romanized: ${result.romanized}, synced: ${Boolean(result.synced)})`);
    console.log(result.text.slice(0, 600) + (result.text.length > 600 ? '\n...' : ''));
})().catch(error => { console.error(error); process.exit(1); });