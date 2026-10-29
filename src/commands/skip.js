const { SlashCommandBuilder, MessageFlags } = require('discord.js');
const { createProgressReporter } = require('../managers/downloadProgress');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('skip')
        .setDescription('Skip the currently playing song'),
    async execute(interaction) {
        const lavalink = interaction.client.lavalinkManager;
        const queue = lavalink.getQueue(interaction.guildId);
        const player = lavalink.shoukaku.players.get(interaction.guildId);

        if (!player || (!player.track && !queue.current)) {
            return interaction.reply({
                content: "*Tick, tick, tick...* There's no music playing right now! You can't skip into empty space, silly!",
                flags: MessageFlags.Ephemeral
            });
        }

        if (queue.tracks.length === 0) {
            return interaction.reply({
                content: "*Aw, snap!* There are no more songs left in the queue to skip to! We're at the end of the line, boom! (Use `/clear stop:true` if you want me to stop.)",
                flags: MessageFlags.Ephemeral
            });
        }

        // The next song may still have to be downloaded, which takes longer than the 3 seconds
        // Discord allows before the command has to be acknowledged.
        await interaction.deferReply();
        const progress = createProgressReporter(content => interaction.editReply(content));

        try {
            const nextTrack = await lavalink.playNext(interaction.guildId, { onProgress: progress.report, silent: true });
            await progress.done();
            if (!nextTrack) return interaction.editReply("*Aw, snap!* The queue ran dry before I could skip!");
            const text = `Playtime's up! Skipped to the next track: **[${nextTrack.info.title}](${nextTrack.info.uri})**`;
            const reply = await interaction.editReply(text);
            lavalink.setNowPlaying(interaction.guildId, reply, text);
            return reply;
        } catch (error) {
            await progress.done();
            console.error('Skip command error:', error);
            return interaction.editReply("*Fizzle...* Couldn't start the next track. Check the logs!");
        }
    }
};