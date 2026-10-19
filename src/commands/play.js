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

                // Auto-play next track in queue when current track ends
                player.on('end', async () => {
                    if (queue.tracks.length > 0) {
                        const nextTrack = queue.tracks.shift();
                        queue.current = nextTrack;
                        await player.playTrack({ track: { encoded: nextTrack.encoded }});
                    } else {
                        queue.current = null;
                    }
                });

                player.on('exception', (error) => {
                    console.error('[Lavalink Player Exception]:', error);
                    queue.current = null;
                });
            }

            const node = player.node;
            const isUrl = /^https?:\/\//i.test(query);
            const searchTarget = isUrl ? query : `ytsearch:${query}`;
            const res = await node.rest.resolve(searchTarget);

            if (!res || res.loadType === 'empty' || res.loadType === 'error') {
                console.error(`[Lavalink Resolve Error] Type: ${res?.loadType}`, res?.data);
                return interaction.editReply('Oops! Reze couldn’t find anything matching that query. Try a different search!');
            }

            let tracks = [];

            if (res.loadType === 'playlist') {
                tracks = res.data.tracks;
                if (!tracks || !tracks.length) {
                    return interaction.editReply('Couldn’t extract tracks from that playlist!');
                }
                
                queue.addMultiple(tracks);

                if (!player.track && !queue.current) {
        const firstTrack = queue.tracks.shift();
        queue.current = firstTrack;
        await player.playTrack({ track: { encoded: firstTrack.encoded } });
    }
    return interaction.editReply(`Boom! Loaded playlist **${res.data.info.name}** with **${tracks.length}** tracks into the queue!`);

            } else {
                tracks = Array.isArray(res.data) ? res.data : [res.data];
                if (!tracks.length) {
                    return interaction.editReply('💥 No track results found!');
                }
            } 
        
        
        const track = tracks[0];
            if (!player.track && !queue.current) {
                queue.current = track;
                await player.playTrack({ track: { encoded: track.encoded } });
                return interaction.editReply(`Now playing: **[${track.info.title}](${track.info.uri})** 💣`);
            } else {
                queue.add(track);
                return interaction.editReply(`Added to queue: **[${track.info.title}](${track.info.uri})** ⚡`);
            } // 👈 Added missing closing brace
        } catch (error) {
            console.error('Play command error:', error);
            return interaction.editReply('Madokami hasnt blessed us trying to play that track.');
        }
    }
};