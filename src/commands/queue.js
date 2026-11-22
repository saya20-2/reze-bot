const { SlashCommandBuilder } = require('discord.js');
const { PAGE_SIZE, buildQueueEmbed, isEmpty } = require('../managers/queueView');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('queue')
        .setDescription('Show the current music queue (the message keeps itself up to date)')
        .addIntegerOption(option =>
            option.setName('page')
                .setDescription('Page of the queue to show')
                .setMinValue(1)),
    async execute(interaction) {
        const lavalink = interaction.client.lavalinkManager;
        const queue = lavalink.getQueue(interaction.guildId);

        if (isEmpty(queue)) {
            return interaction.reply({
                content: "*Silence...* The queue is empty! Throw a song at me with `/play` before this place gets boring, boom!",
                ephemeral: true
            });
        }

        const totalPages = Math.max(1, Math.ceil(queue.tracks.length / PAGE_SIZE));
        const page = Math.min(interaction.options.getInteger('page') ?? 1, totalPages);

        const message = await interaction.reply({ embeds: [buildQueueEmbed(queue, page)], fetchReply: true });
        // only the latest output continues to update itself
        lavalink.setQueueView(interaction.guildId, message, page);
        return message;
    }
};