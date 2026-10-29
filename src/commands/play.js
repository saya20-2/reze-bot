const { SlashCommandBuilder } = require('discord.js');
const { createProgressReporter } = require('../managers/downloadProgress');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('play')
        .setDescription('Play a song or playlist from YouTube or URL')
        .addStringOption(option =>
            option.setName('query')
                .setDescription('The song name, URL, or playlist link to play')
                .setRequired(true)),
    async execute(interaction) {
        await interaction.deferReply();
        const query = interaction.options.getString('query');
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

            const wasIdle = !queue.current;
            const progress = createProgressReporter(content => interaction.editReply(content));
            const isUrl = /^https?:\/\//i.test(query);
            const res = await player.node.rest.resolve(isUrl ? query : `ytsearch:${query}`);

            if (!res || res.loadType === 'empty' || res.loadType === 'error') {
                return interaction.editReply('Oops! Reze couldn’t find anything matching that query.');
            }

            if (res.loadType === 'playlist') {
                const tracks = res.data.tracks;
                if (!tracks || !tracks.length) return interaction.editReply('Couldn’t extract tracks from playlist!');
                queue.addMultiple(tracks);
                if (wasIdle) await lavalink.playNext(interaction.guildId, { onProgress: progress.report, silent: true });
                await progress.done();
                const text = `Boom! Loaded playlist **${res.data.info.name}** with **${tracks.length}** tracks!`;
                const reply = await interaction.editReply(text);
                if (wasIdle) lavalink.setNowPlaying(interaction.guildId, reply, text);
                else lavalink.refreshPrefetch(interaction.guildId);
                return reply;
            }

            const trackToPlay = res.loadType === 'search' ? res.data[0] : res.data;
            if (!trackToPlay || !trackToPlay.info) {
                return interaction.editReply('No valid track results found!');
            }

            queue.add(trackToPlay);

            const link = `**[${trackToPlay.info.title}](${trackToPlay.info.uri})**`;

            if (wasIdle) {
                await lavalink.playNext(interaction.guildId, { onProgress: progress.report, silent: true });
                await progress.done();
                const text = `Now playing: ${link}`;
                const reply = await interaction.editReply(text);
                lavalink.setNowPlaying(interaction.guildId, reply, text);
                return reply;
            }

            const reply = await interaction.editReply(`Added to queue: ${link}`);
            lavalink.refreshPrefetch(interaction.guildId);
            return reply;
        } catch (error) {
            console.error('Play command error:', error);
            return interaction.editReply('Madokami hasnt blessed us trying to play that track.');
        }
    }
};