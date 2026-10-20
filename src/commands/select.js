const { SlashCommandBuilder } = require('discord.js');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('select')
        .setDescription('Jump straight to a track in the queue (position as shown in /queue)')
        .addIntegerOption(option =>
            option.setName('position')
                .setDescription('Queue position to play, e.g. 8 for the 8th track in /queue')
                .setMinValue(1)
                .setRequired(true)),
    async execute(interaction) {
        const position = interaction.options.getInteger('position', true);
        const lavalink = interaction.client.lavalinkManager;
        const queue = lavalink.getQueue(interaction.guildId);
        const player = lavalink.shoukaku.players.get(interaction.guildId);

        if (!player || (!player.track && !queue.current)) {
            return interaction.reply({
                content: "*Tick, tick, tick...* There's no music playing right now! Start something with `/play` first, silly!",
                ephemeral: true
            });
        }

        const botChannelId = interaction.guild.members.me?.voice?.channelId;
        if (botChannelId && interaction.member.voice.channelId !== botChannelId) {
            return interaction.reply({
                content: "Hey! You need to be in my voice channel to do that. No sneak attacks from outside!",
                ephemeral: true
            });
        }

        if (queue.tracks.length === 0) {
            return interaction.reply({
                content: "*Aw, snap!* The queue is empty, there's nothing to jump to!",
                ephemeral: true
            });
        }

        if (position > queue.tracks.length) {
            return interaction.reply({
                content: `Position **${position}** doesn't exist, the queue only has **${queue.tracks.length}** track${queue.tracks.length === 1 ? '' : 's'}. Check \`/queue\` for the numbers!`,
                ephemeral: true
            });
        }

        // Tracks before the chosen one are skipped, same as running /skip repeatedly
        const skipped = position - 1;
        queue.tracks.splice(0, skipped);

        try {
            const track = await lavalink.playNext(interaction.guildId);
            return interaction.reply(
                `Jumped to track **${position}**: **[${track.info.title}](${track.info.uri})**` +
                (skipped > 0 ? ` (skipped ${skipped} track${skipped === 1 ? '' : 's'})` : '')
            );
        } catch (error) {
            console.error('Select command error:', error);
            return interaction.reply({
                content: "*Fizzle...* Couldn't start that track. Check the logs!",
                ephemeral: true
            });
        }
    }
};