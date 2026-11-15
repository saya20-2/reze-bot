const { SlashCommandBuilder, MessageFlags } = require('discord.js');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('shuffle')
        .setDescription('Shuffle the current music queue'),
    async execute(interaction) {
        const lavalink = interaction.client.lavalinkManager;
        const queue = lavalink.getQueue(interaction.guildId);

        if (queue.tracks.length < 2) {
            return interaction.reply({
                content: "*Pfft!* You want to shuffle... what, just one lonely little song or empty air? There aren't enough tracks to mix up! How about we find some songs to play first?",
                flags: MessageFlags.Ephemeral
            });
        }

        queue.shuffle();
        lavalink.refreshPrefetch(interaction.guildId);

        return interaction.reply("Queue shuffeled. Let's see what blows up (our eardrums) next.");
    }
};