const { SlashCommandBuilder } = require('discord.js');
const { createProgressReporter } = require('../managers/downloadProgress');
const { findSeed, loadMix, curate } = require('../managers/radio');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('radio')
        .setDescription('Start a radio from a song: queues related songs picked by YouTube')
        .addStringOption(option =>
            option.setName('song')
                .setDescription('The song name or YouTube link to build the radio from')
                .setRequired(true))
        .addIntegerOption(option =>
            option.setName('count')
                .setDescription('How many songs in total, including the first one (default 25)')
                .setMinValue(5)
                .setMaxValue(50))
        .addBooleanOption(option =>
            option.setName('replace')
                .setDescription('Clear the upcoming songs first instead of adding after them')),
    async execute(interaction) {
        await interaction.deferReply();
        const query = interaction.options.getString('song');
        const count = interaction.options.getInteger('count') ?? 25;
        const replace = interaction.options.getBoolean('replace') ?? false;
        const channel = interaction.member.voice.channel;

        if (!channel) {
            return interaction.editReply('You need to be in a voice channel to play music, silly!');
        }

        const lavalink = interaction.client.lavalinkManager;
        const queue = lavalink.getQueue(interaction.guildId);
        queue.textChannelId = interaction.channelId;
        let player = lavalink.shoukaku.players.get(interaction.guildId);

        try {
            if (!player) {
                player = await lavalink.shoukaku.joinVoiceChannel({
                    guildId: interaction.guildId,
                    channelId: channel.id,
                    shardId: interaction.guild.shardId,
                });
                lavalink.setupPlayer(player);
            }

            const node = player.node;
            const { track: seed, error } = await findSeed(node, query);
            if (error) return interaction.editReply(error);

            if (replace) queue.clearUpcoming();
            const alreadyQueued = [queue.current, ...queue.tracks].filter(Boolean);

            const mix = await loadMix(node, seed, count);
            const related = curate(mix, { seed, alreadyQueued, limit: count - 1 });

            const wasIdle = !queue.current;
            const progress = createProgressReporter(content => interaction.editReply(content));

            queue.add(seed);
            queue.addMultiple(related);
            if (wasIdle) await lavalink.playNext(interaction.guildId, { onProgress: progress.report, silent: true });
            await progress.done();

            const link = `**[${seed.info.title}](${seed.info.uri})**`;
            const text = related.length > 0
                ? `Radio started from ${link} with **${related.length}** related songs picked by YouTube.`
                : `YouTube didn’t give me any related songs for ${link}, so it’s just that one for now.`;
            const reply = await interaction.editReply(text);

            if (wasIdle) lavalink.setNowPlaying(interaction.guildId, reply, text);
            else lavalink.refreshPrefetch(interaction.guildId);
            return reply;
        } catch (err) {
            console.error('Radio command error:', err);
            return interaction.editReply('Madokami hasnt blessed us trying to start that radio.');
        }
    }
};