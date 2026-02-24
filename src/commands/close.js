const { SlashCommandBuilder, PermissionFlagsBits } = require('discord.js');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('close')
        .setDescription('Closes the ticket and deletes the channel')
        .setDefaultMemberPermissions(PermissionFlagsBits.ManageMessages),

    async execute(interaction) {
        if (!interaction.member.roles.cache.has(process.env.INCUBATOR_ROLE_ID) && 
            !interaction.member.roles.cache.has(process.env.SMALL_INC_ROLE_ID)) {
        return interaction.reply({ 
            content: "No have permission to close tickets.", 
            ephemeral: true 
        });
    }
        const userId = interaction.channel.topic?.split('UserID:')[1];
        if (!userId) return interaction.reply({ content: "Not a ticket channel.", ephemeral: true });

        if (interaction.client.modmail.locks.has(userId)) {
            return interaction.reply({ content: "Already closing", ephemeral: true});
        }
        
        interaction.client.modmail.locks.add(userId);
        await interaction.deferReply();

        await interaction.editReply({
            content: "Ticket closing in 5 seconds...",
            files: ['./assets/reze_bye.gif']
        });

        try {
            const user = await interaction.client.users.fetch(userId);
            await user.send({
                content: "Ticket has been closed, DM again to open a new one!",
                files: ['./assets/reze_bye.gif']
            });
        } catch (e) {
            console.log('DM failed');
        }
        
        setTimeout(async () => {
        try {
            await interaction.channel.delete(`Ticket closed by ${interaction.user.tag}`);
            interaction.client.modmail.locks.delete(userId);
        } catch (err) {
            console.error('Failed to delete channel:', err);
            interaction.client.modmail.locks.delete(userId);
        }
    }, 5000);
        
    }
};