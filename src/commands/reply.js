const { SlashCommandBuilder } = require('discord.js');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('reply')
        .setDescription('Reply to a ModMail ticket')
        .addStringOption(option => 
            option.setName('message')
                .setDescription('The message to send to the user')
                .setRequired(true)),

    async execute(interaction) {
        // 1. Get the User ID from the channel topic we set earlier
        const topic = interaction.channel.topic;
        if (!topic || !topic.includes('UserID:')) {
            return interaction.reply({ content: 'This is not a valid ModMail channel.', ephemeral: true });
        }

        const userId = topic.split('UserID:')[1];
        const replyText = interaction.options.getString('message');

        try {
            const user = await interaction.client.users.fetch(userId);
            
            // 2. Send the DM to the user
            await user.send(`**Staff (${interaction.user.username}):** ${replyText}`);
            
            // 3. Confirm to the mod
            await interaction.reply({ content: `Reply sent to ${user.tag}` });
        } catch (error) {
            console.error(error);
            await interaction.reply({ content: 'Failed to send DM. The user might have DMs disabled.', ephemeral: true });
        }
    }
};