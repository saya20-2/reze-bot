const BAR_WIDTH = 20;
const MIN_EDIT_INTERVAL_MS = 2000;

function megabytes(bytes) {
    return (bytes / (1024 * 1024)).toFixed(1);
}

function format(progress) {
    const title = progress.title ? `**${progress.title}**` : 'your song';

    if (progress.stage === 'fallback') {
        return `Couldn’t download ${title}, trying another way...`;
    }
    if (progress.stage === 'downloading') {
        if (progress.percent == null) {
            return `Downloading ${title}\n${megabytes(progress.downloaded)} MB so far...`;
        }
        const filled = Math.round((progress.percent / 100) * BAR_WIDTH);
        const bar = '█'.repeat(filled) + '░'.repeat(BAR_WIDTH - filled);
        return `Downloading ${title}\n\`${bar}\` ${Math.floor(progress.percent)}% (${megabytes(progress.downloaded)} / ${megabytes(progress.total)} MB)`;
    }
    return `Preparing ${title}...`;
}

function createProgressReporter(editFn) {
    let lastEdit = 0;
    let lastStage = null;
    let finished = false;
    let pending = Promise.resolve();

    function report(progress) {
        if (finished) return;
        const now = Date.now();
        const important = progress.stage !== 'downloading' || lastStage !== 'downloading';
        if (!important && now - lastEdit < MIN_EDIT_INTERVAL_MS) return;
        lastEdit = now;
        lastStage = progress.stage;
        pending = pending.then(() => editFn(format(progress))).catch(() => {});
    }

    async function done() {
        finished = true;
        await pending;
    }

    return { report, done };
}

module.exports = { createProgressReporter, format };