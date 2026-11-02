const fs = require('fs');
const path = require('path');

const emptyCounts = () => ({ certain: 0, unsure: 0, borderline: 0 });

function emptyData() {
    return {
        since: new Date().toISOString(),
        totals: emptyCounts(),
        byAccount: { new: emptyCounts(), established: emptyCounts() },
        standalone: {},
        appearances: {},
        combos: { certain: {}, borderline: {} },
        pairs: {},
        multiKeywordEvents: 0
    };
}

const bump = (map, key) => { map[key] = (map[key] || 0) + 1; };
const percent = (count, base) => (base > 0 ? Math.round((count / base) * 100) : 0);

function top(map, limit) {
    return Object.entries(map)
        .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
        .slice(0, limit);
}

class AutoModStats {
    constructor(filePath) {
        this.filePath = filePath;
        this.data = this.load();
    }

    load() {
        try {
            const raw = JSON.parse(fs.readFileSync(this.filePath, 'utf8'));
            const base = emptyData();
            return {
                ...base,
                ...raw,
                totals: { ...base.totals, ...raw.totals },
                byAccount: {
                    new: { ...base.byAccount.new, ...raw.byAccount?.new },
                    established: { ...base.byAccount.established, ...raw.byAccount?.established }
                },
                combos: { certain: { ...raw.combos?.certain }, borderline: { ...raw.combos?.borderline } }
            };
        } catch (error) {
            if (error.code !== 'ENOENT') {
                const backup = `${this.filePath}.corrupt-${Date.now()}`;
                try {
                    fs.renameSync(this.filePath, backup);
                    console.warn(`[AutoMod Stats] Could not read the stats file, moved it to ${backup} and started fresh.`);
                } catch {}
            }
            return emptyData();
        }
    }

    save() {
        try {
            fs.mkdirSync(path.dirname(this.filePath), { recursive: true });
            const temp = `${this.filePath}.tmp`;
            fs.writeFileSync(temp, JSON.stringify(this.data, null, 2));
            fs.renameSync(temp, this.filePath);
        } catch (error) {
            console.error('[AutoMod Stats] Failed to save stats:', error.message);
        }
    }

    get total() {
        const { certain, unsure, borderline } = this.data.totals;
        return certain + unsure + borderline;
    }

    record({ category, accountType, keywords }) {
        const unique = [...new Set(keywords)].sort();
        if (unique.length === 0 || !(category in this.data.totals)) return;

        this.data.totals[category]++;
        this.data.byAccount[accountType === 'new' ? 'new' : 'established'][category]++;
        unique.forEach(keyword => bump(this.data.appearances, keyword));

        if (category === 'unsure' && unique.length === 1) {
            bump(this.data.standalone, unique[0]);
        }

        if (unique.length >= 2) {
            this.data.multiKeywordEvents++;
            bump(this.data.combos[category === 'certain' ? 'certain' : 'borderline'], unique.join(' + '));
            for (let i = 0; i < unique.length; i++) {
                for (let j = i + 1; j < unique.length; j++) {
                    bump(this.data.pairs, `${unique[i]} + ${unique[j]}`);
                }
            }
        }

        this.save();
    }

    ratioText() {
        const { certain, unsure } = this.data.totals;
        if (certain === 0) return `${unsure} unsure : 0 certain (no certain events yet)`;
        return `${(unsure / certain).toFixed(2)} : 1 (${unsure} unsure : ${certain} certain)`;
    }

    shouldReport(every) {
        return every > 0 && this.total > 0 && this.total % every === 0;
    }

    report(topN = 5) {
        const { totals, byAccount, standalone, appearances, combos, pairs, multiKeywordEvents } = this.data;
        const total = this.total;
        const lines = [
            `[AutoMod STATS] ${total} flagged message${total === 1 ? '' : 's'} since ${this.data.since.slice(0, 10)}`,
            `Certain (would ban): ${totals.certain} | Unsure (1 keyword): ${totals.unsure} | Borderline (2+ keywords, below threshold): ${totals.borderline}`,
            `Unsure : Certain = ${this.ratioText()}, unsure is ${percent(totals.unsure, total)}% of all flagged messages`,
            `New/recent: ${byAccount.new.certain} certain, ${byAccount.new.unsure} unsure, ${byAccount.new.borderline} borderline | ` +
                `Established: ${byAccount.established.certain} certain, ${byAccount.established.unsure} unsure, ${byAccount.established.borderline} borderline`
        ];

        const alone = top(standalone, topN);
        lines.push('', `Keywords most often found standalone (share of ${totals.unsure} unsure events):`);
        if (alone.length === 0) lines.push('  none yet');
        for (const [keyword, count] of alone) {
            lines.push(`  ${keyword}: ${percent(count, totals.unsure)}% (${count} alone, ${appearances[keyword] || count} in total)`);
        }

        const certainCombos = top(combos.certain, topN);
        lines.push('', `Most common combinations in certain events (share of ${totals.certain}):`);
        if (certainCombos.length === 0) lines.push('  none yet');
        for (const [combo, count] of certainCombos) lines.push(`  ${combo}: ${percent(count, totals.certain)}% (${count})`);

        const borderlineCombos = top(combos.borderline, topN);
        if (borderlineCombos.length > 0) {
            lines.push('', `Most common combinations in borderline events (share of ${totals.borderline}):`);
            for (const [combo, count] of borderlineCombos) lines.push(`  ${combo}: ${percent(count, totals.borderline)}% (${count})`);
        }

        const topPairs = top(pairs, topN);
        if (topPairs.length > 0) {
            lines.push('', `Most common keyword pairs (share of ${multiKeywordEvents} events with 2+ keywords):`);
            for (const [pair, count] of topPairs) lines.push(`  ${pair}: ${percent(count, multiKeywordEvents)}% (${count})`);
        }

        return lines.join('\n');
    }
}

module.exports = AutoModStats;