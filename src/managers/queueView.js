const { EmbedBuilder } = require('discord.js');

const PAGE_SIZE = 10;

function formatDuration(ms) {
    const totalSeconds = Math.floor(ms / 1000);
    const hours = Math.floor(totalSeconds / 3600);
    const minutes = Math.floor((totalSeconds % 3600) / 60);
    const seconds = totalSeconds % 60;
    const ss = String(seconds).padStart(2, '0');
    if (hours > 0) return `${hours}:${String(minutes).padStart(2, '0')}:${ss}`;
    return `${minutes}:${ss}`;
}

function trackDuration(track) {
    return track.info.isStream ? 'LIVE' : formatDuration(track.info.length);
}

function trackLink(track, maxLength = 60) {
    let title = track.info.title.replace(/[\[\]]/g, '');
    if (title.length > maxLength) title = `${title.slice(0, maxLength - 1)}…`;
    return `[${title}](${track.info.uri})`;
}

function requesterTag(track) {
    return track.requester?.username ? ` • ${track.requester.username}` : '';
}

function isEmpty(queue) {
    return !queue.current && queue.tracks.length === 0;
}

// Builds the /queue embed. Used by the command and by the live refresh, so both always look the same.
function buildQueueEmbed(queue, requestedPage = 1) {
    const embed = new EmbedBuilder().setTitle('Music Queue');

    if (isEmpty(queue)) {
        return embed.setDescription('*Silence...* The queue is empty! Throw a song at me with `/play`.');
    }

    const totalPages = Math.max(1, Math.ceil(queue.tracks.length / PAGE_SIZE));
    const page = Math.min(Math.max(requestedPage, 1), totalPages);
    const start = (page - 1) * PAGE_SIZE;
    const sections = [];

    if (queue.current) {
        sections.push(`**Now playing**\n${trackLink(queue.current, 80)} \`${trackDuration(queue.current)}\`${requesterTag(queue.current)}`);
    }

    if (queue.tracks.length > 0) {
        const lines = queue.tracks
            .slice(start, start + PAGE_SIZE)
            .map((track, i) => `**${start + i + 1}.** ${trackLink(track)} \`${trackDuration(track)}\`${requesterTag(track)}`);
        sections.push(`**Up next**\n${lines.join('\n')}`);
    } else {
        sections.push('**Up next**\n*Nothing else lined up yet.*');
    }

    embed.setDescription(sections.join('\n\n'));

    if (queue.tracks.length > 0) {
        const hasStream = queue.tracks.some(t => t.info.isStream);
        const totalMs = queue.tracks.reduce((sum, t) => sum + (t.info.isStream ? 0 : t.info.length), 0);
        embed.setFooter({
            text: `Page ${page}/${totalPages} • ${queue.tracks.length} queued • ${formatDuration(totalMs)}${hasStream ? '+' : ''} remaining • updates live`
        });
    }
    return embed;
}

module.exports = { PAGE_SIZE, buildQueueEmbed, isEmpty };