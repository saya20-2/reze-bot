const { SlashCommandBuilder } = require('discord.js');

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
                ephemeral: true
            });
        }

        if (queue.tracks.length === 0) {
            return interaction.reply({
                content: "*Aw, snap!* There are no more songs left in the queue to skip to! We're at the end of the line, boom! (Use `/clear stop:true` if you want me to stop.)",
                ephemeral: true
            });
        }

        const nextTrack = await lavalink.playNext(interaction.guildId);

        return interaction.reply(`Playtime's up! Skipped to the next track: **[${nextTrack.info.title}](${nextTrack.info.uri})**`);
    }
};