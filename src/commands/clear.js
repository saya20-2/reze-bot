const { SlashCommandBuilder, MessageFlags } = require('discord.js');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('clear')
        .setDescription('Clear the queue, optionally stopping the music and leaving the voice channel')
        .addBooleanOption(option =>
            option.setName('stop')
                .setDescription('True: stop now and leave voice. False: clear the queue, current song finishes.')
                .setRequired(true)),
    async execute(interaction) {
        const stop = interaction.options.getBoolean('stop', true);
        const lavalink = interaction.client.lavalinkManager;
        const queue = lavalink.getQueue(interaction.guildId);
        const player = lavalink.shoukaku.players.get(interaction.guildId);

        if (!player) {
            return interaction.reply({
                content: "*Click.* There's nothing to clear, I'm not even playing anything! Don't scare me like that, silly!",
                flags: MessageFlags.Ephemeral
            });
        }

        const botChannelId = interaction.guild.members.me?.voice?.channelId;
        if (botChannelId && interaction.member.voice.channelId !== botChannelId) {
            return interaction.reply({
                content: "Hey! You need to be in my voice channel to do that. No sneak attacks from outside!",
                flags: MessageFlags.Ephemeral
            });
        }

        if (stop) {
            await lavalink.destroyPlayer(interaction.guildId);
            return interaction.reply("*BOOM!* Music stopped, queue cleared and I'm out of the voice channel. Call me when you need more noise.");
        }

        const removed = queue.tracks.length;
        if (removed === 0) {
            return interaction.reply({
                content: "The queue is already empty, nothing left to blow up!",
                flags: MessageFlags.Ephemeral
            });
        }

        queue.clearUpcoming();
        lavalink.refreshPrefetch(interaction.guildId);

        const nowPlaying = queue.current
            ? ` **[${queue.current.info.title}](${queue.current.info.uri})** will finish playing, then it's quiet time.`
            : '';
        return interaction.reply(`Cleared **${removed}** track${removed === 1 ? '' : 's'} from the queue.${nowPlaying}`);
    }
};