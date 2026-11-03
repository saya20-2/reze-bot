const MAX_CANDIDATES = 4;

function normalize(text) {
    return String(text || '')
        .normalize('NFKC')
        .toLowerCase()
        .replace(/[^\p{L}\p{N}]+/gu, '');
}

function titleMatches(a, b) {
    const x = normalize(a);
    const y = normalize(b);
    if (!x || !y) return false;
    return x.includes(y) || y.includes(x);
}

function cleanArtist(author) {
    return String(author || '')
        .replace(/\s*-\s*topic$/i, '')
        .replace(/vevo$/i, '')
        .replace(/\s*(official|channel|公式)\s*$/i, '')
        .trim();
}

function stripBrackets(text) {
    return text.replace(/[【\[（(「『][^】\]）)」』]*[】\]）)」』]/g, ' ');
}

function cornerBracketContents(text) {
    const found = [];
    for (const match of text.matchAll(/[「『]([^」』]+)[」』]/g)) found.push(match[1].trim());
    return found;
}

function stripTrailingCredits(text) {
    return text
        .replace(/\s+(feat\.?|ft\.?|prod\.?|covered by)\s.*$/i, '')
        .replace(/\s*[-–—|｜／/]\s*(official|mv|pv|lyric|lyrics|music video|audio)\b.*$/i, '')
        .replace(/\s+/g, ' ')
        .trim();
}

function candidatesFor(info) {
    const rawTitle = String(info?.title || '');
    const artist = cleanArtist(info?.author);
    const out = [];
    const add = title => {
        const t = String(title || '').trim();
        if (t && !out.some(c => normalize(c.title) === normalize(t))) out.push({ title: t, artist });
    };

    const outside = stripTrailingCredits(stripBrackets(rawTitle));
    const parts = outside.split(/\s+[-–—|｜／/]\s+|\s*[｜／]\s*/).map(p => p.trim()).filter(Boolean);

    if (parts.length === 2 && artist && titleMatches(parts[0], artist)) {
        add(parts[1]);
    } else if (parts.length > 1) {
        for (const part of parts) add(part);
    } else {
        add(outside);
    }

    for (const inner of cornerBracketContents(rawTitle)) add(inner);
    if (out.length === 0) add(rawTitle);
    return out.slice(0, MAX_CANDIDATES);
}

module.exports = { candidatesFor, cleanArtist, normalize, titleMatches };