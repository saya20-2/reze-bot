const { SlashCommandBuilder, MessageFlags } = require('discord.js');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('toggle-lyrics')
        .setDescription('Toggle lyrics shown below the now playing message')
        .addBooleanOption(option =>
            option.setName('romanized')
                .setDescription('Switch between romanized (true) and original (false) lyrics. This also enables lyrics.')),
    async execute(interaction) {
        const lavalink = interaction.client.lavalinkManager;
        const queue = lavalink.getQueue(interaction.guildId);

        const botChannelId = interaction.guild.members.me?.voice?.channelId;
        if (botChannelId && interaction.member.voice.channelId !== botChannelId) {
            return interaction.reply({
                content: "Hey! You need to be in my voice channel to do that. No sneak attacks from outside!",
                flags: MessageFlags.Ephemeral
            });
        }

        const romanized = interaction.options.getBoolean('romanized');
        const state = queue.lyrics;

        const enable = romanized !== null ? true : !state.enabled;
        lavalink.setLyricsPreferences(interaction.guildId, { enabled: enable, romanized: romanized ?? undefined });

        const script = state.romanized ? 'romanized' : 'original';
        const text = !enable
            ? 'Lyrics are **off**. Turn them back on with `/toggle-lyrics` any time.'
            : queue.current
                ? `Lyrics are **on** (${script}), here they come!`
                : `Lyrics are **on** (${script}), they will show up with the next song.`;
        const reply = await interaction.reply(text).then(() => interaction.fetchReply());
        lavalink.flushLyrics(interaction.guildId);
        return reply;
    }
};