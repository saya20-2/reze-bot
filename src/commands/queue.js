const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');

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

module.exports = {
    data: new SlashCommandBuilder()
        .setName('queue')
        .setDescription('Show the current music queue')
        .addIntegerOption(option =>
            option.setName('page')
                .setDescription('Page of the queue to show')
                .setMinValue(1)),
    async execute(interaction) {
        const lavalink = interaction.client.lavalinkManager;
        const queue = lavalink.getQueue(interaction.guildId);

        if (!queue.current && queue.tracks.length === 0) {
            return interaction.reply({
                content: "*Silence...* The queue is empty! Throw a song at me with `/play` before this place gets boring, boom!",
                ephemeral: true
            });
        }

        const totalPages = Math.max(1, Math.ceil(queue.tracks.length / PAGE_SIZE));
        const page = Math.min(interaction.options.getInteger('page') ?? 1, totalPages);
        const start = (page - 1) * PAGE_SIZE;

        const sections = [];

        if (queue.current) {
            sections.push(`**Now playing**\n${trackLink(queue.current, 80)} \`${trackDuration(queue.current)}\``);
        }

        if (queue.tracks.length > 0) {
            const lines = queue.tracks
                .slice(start, start + PAGE_SIZE)
                .map((track, i) => `**${start + i + 1}.** ${trackLink(track)} \`${trackDuration(track)}\``);
            sections.push(`**Up next**\n${lines.join('\n')}`);
        } else {
            sections.push('**Up next**\n*Nothing else lined up yet.*');
        }

        const embed = new EmbedBuilder()
            .setTitle('Music Queue')
            .setDescription(sections.join('\n\n'));

        if (queue.tracks.length > 0) {
            const hasStream = queue.tracks.some(t => t.info.isStream);
            const totalMs = queue.tracks.reduce((sum, t) => sum + (t.info.isStream ? 0 : t.info.length), 0);
            embed.setFooter({
                text: `Page ${page}/${totalPages} • ${queue.tracks.length} queued • ${formatDuration(totalMs)}${hasStream ? '+' : ''} remaining`
            });
        }

        return interaction.reply({ embeds: [embed] });
    }
};