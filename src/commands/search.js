const { createProgressReporter } = require('../managers/downloadProgress');
const {
    SlashCommandBuilder,
    EmbedBuilder,
    ActionRowBuilder,
    StringSelectMenuBuilder,
    ComponentType
} = require('discord.js');
const SEARCH_PREFIX = 'ytsearch:';
const MAX_RESULTS = 10;
const SELECT_TIMEOUT_MS = 60_000;

function formatDuration(ms) {
    const totalSeconds = Math.floor(ms / 1000);
    const hours = Math.floor(totalSeconds / 3600);
    const minutes = Math.floor((totalSeconds % 3600) / 60);
    const ss = String(totalSeconds % 60).padStart(2, '0');
    return hours > 0 ? `${hours}:${String(minutes).padStart(2, '0')}:${ss}` : `${minutes}:${ss}`;
}

function trackDuration(track) {
    return track.info.isStream ? 'LIVE' : formatDuration(track.info.length);
}

function truncate(text, max) {
    return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

module.exports = {
    data: new SlashCommandBuilder()
        .setName('search')
        .setDescription('Search for a song and pick the right result from a list of 10')
        .addStringOption(option =>
            option.setName('query')
                .setDescription('Song title and artist, e.g. "Yonezu Kenshi Lemon"')
                .setRequired(true)),
    async execute(interaction) {
        await interaction.deferReply();
        const query = interaction.options.getString('query');

        if (!interaction.member.voice.channel) {
            return interaction.editReply('You need to be in a voice channel to play music, silly!');
        }

        const lavalink = interaction.client.lavalinkManager;
        const node = lavalink.shoukaku.nodes.values().next().value;
        if (!node) {
            return interaction.editReply('*Static...* I’m not connected to the music server right now, try again in a moment!');
        }

        let tracks;
        try {
            const res = await node.rest.resolve(`${SEARCH_PREFIX}${query}`);
            if (!res || res.loadType === 'error') {
                console.error(`[Lavalink Search Error] Type: ${res?.loadType}`, res?.data);
                return interaction.editReply('Oops! Something blew up while searching. Try again in a moment!');
            }
            tracks = res.loadType === 'search' ? res.data.slice(0, MAX_RESULTS) : [];
        } catch (error) {
            console.error('Search command error:', error);
            return interaction.editReply('Madokami hasnt blessed us trying to search for that.');
        }

        if (tracks.length === 0) {
            return interaction.editReply('Oops! Reze couldn’t find anything matching that query. Try different keywords!');
        }

        const list = tracks
            .map((t, i) => `**${i + 1}.** [${truncate(t.info.title.replace(/[\[\]]/g, ''), 70)}](${t.info.uri}) — ${truncate(t.info.author, 40)} \`${trackDuration(t)}\``)
            .join('\n');

        const embed = new EmbedBuilder()
            .setTitle(`Results for "${truncate(query, 80)}"`)
            .setDescription(list)
            .setFooter({ text: 'Pick a track from the menu below within 60 seconds.' });

        const menu = new StringSelectMenuBuilder()
            .setCustomId(`search-select-${interaction.id}`)
            .setPlaceholder('Choose a track (1-10)')
            .addOptions(tracks.map((t, i) => ({
                label: truncate(`${i + 1}. ${t.info.title}`, 100),
                description: truncate(`${t.info.author} • ${trackDuration(t)}`, 100),
                value: String(i)
            })));

        const message = await interaction.editReply({
            embeds: [embed],
            components: [new ActionRowBuilder().addComponents(menu)]
        });

        let selection;
        try {
            selection = await message.awaitMessageComponent({
                componentType: ComponentType.StringSelect,
                filter: i => i.user.id === interaction.user.id && i.customId === menu.data.custom_id,
                time: SELECT_TIMEOUT_MS
            });
        } catch {
            return interaction.editReply({ content: ' Search timed out, nothing was added.', embeds: [], components: [] });
        }

        await selection.deferUpdate();
        const track = tracks[Number(selection.values[0])];

        const channel = interaction.member.voice.channel;
        if (!channel) {
            return interaction.editReply({ content: 'You left the voice channel, so I didn’t add anything!', embeds: [], components: [] });
        }

        try {
            const queue = lavalink.getQueue(interaction.guildId);
            let player = lavalink.shoukaku.players.get(interaction.guildId);
            if (!player) {
                player = await lavalink.shoukaku.joinVoiceChannel({
                    guildId: interaction.guildId,
                    channelId: channel.id,
                    shardId: interaction.guild.shardId,
                });
                lavalink.setupPlayer(player);
            }

            const wasIdle = !queue.current;
            queue.add(track);
            const progress = createProgressReporter(content => interaction.editReply({ content, embeds: [], components: [] }));
            if (wasIdle) await lavalink.playNext(interaction.guildId, { onProgress: progress.report });
            await progress.done();

            const line = `**[${track.info.title}](${track.info.uri})**`;
            return interaction.editReply({
                content: wasIdle ? `Now playing: ${line}` : `Added to queue: ${line}`,
                embeds: [],
                components: []
            });
        } catch (error) {
            console.error('Search select error:', error);
            return interaction.editReply({ content: 'Madokami hasnt blessed us trying to play that track.', embeds: [], components: [] });
        }
    }
};