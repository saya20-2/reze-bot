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
            const isUrl = /^https?:\/\//i.test(query);
            const searchTarget = isUrl ? query : `ytsearch:${query}`;
            const res = await node.rest.resolve(searchTarget);

            if (!res || res.loadType === 'empty' || res.loadType === 'error') {
                console.error(`[Lavalink Resolve Error] Type: ${res?.loadType}`, res?.data);
                return interaction.editReply('Oops! Reze couldn’t find anything matching that query. Try a different search!');
            }

            const wasIdle = !queue.current;

            if (res.loadType === 'playlist') {
                let tracks = res.data.tracks;
                if (!tracks || !tracks.length) {
                    return interaction.editReply('Couldn’t extract tracks from that playlist!');
                }

                const selected = res.data.info?.selectedTrack ?? -1;
                const startedMidway = selected > 0 && selected < tracks.length;
                if (startedMidway) tracks = tracks.slice(selected);

                queue.addMultiple(tracks);
                if (wasIdle) await lavalink.playNext(interaction.guildId);

                return interaction.editReply(
                    `Boom! Loaded playlist **${res.data.info.name}** with **${tracks.length}** tracks into the queue!` +
                    (startedMidway ? ' (Starting from the video in your link.)' : '')
                );
            }

            const tracks = Array.isArray(res.data) ? res.data : [res.data];
            if (!tracks.length) {
                return interaction.editReply('No track results found!');
            }

            const track = tracks[0];
            queue.add(track);
            if (wasIdle) {
                await lavalink.playNext(interaction.guildId);
                return interaction.editReply(`Now playing: **[${track.info.title}](${track.info.uri})** 💣`);
            }
            return interaction.editReply(`Added to queue: **[${track.info.title}](${track.info.uri})** ⚡`);
        } catch (error) {
            console.error('Play command error:', error);
            return interaction.editReply('Madokami hasnt blessed us trying to play that track.');
        }
    }
};