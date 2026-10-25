const { SlashCommandBuilder } = require('discord.js');

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
            const isUrl = /^https?:\/\//i.test(query);
            const res = await player.node.rest.resolve(isUrl ? query : `ytsearch:${query}`);

            if (!res || res.loadType === 'empty' || res.loadType === 'error') {
                return interaction.editReply('Oops! Reze couldn’t find anything matching that query.');
            }

            if (res.loadType === 'playlist') {
                const tracks = res.data.tracks;
                if (!tracks || !tracks.length) return interaction.editReply('Couldn’t extract tracks from playlist!');
                queue.addMultiple(tracks);
                if (wasIdle) await lavalink.playNext(interaction.guildId);
                return interaction.editReply(`Boom! Loaded playlist **${res.data.info.name}** with **${tracks.length}** tracks!`);
            }

            const trackToPlay = res.loadType === 'search' ? res.data[0] : res.data;
            if (!trackToPlay || !trackToPlay.info) {
                return interaction.editReply('No valid track results found!');
            }

            queue.add(trackToPlay);

            if (wasIdle) {
                await lavalink.playNext(interaction.guildId);
                return interaction.editReply(`Now playing: **[${trackToPlay.info.title}](${trackToPlay.info.uri})**`);
            }

            return interaction.editReply(`Added to queue: **[${trackToPlay.info.title}](${trackToPlay.info.uri})**`);
        } catch (error) {
            console.error('Play command error:', error);
            return interaction.editReply('Madokami hasnt blessed us trying to play that track.');
        }
    }
};