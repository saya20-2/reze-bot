const { SlashCommandBuilder, PermissionFlagsBits } = require('discord.js');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('close')
        .setDescription('Closes the ticket and deletes the channel')
        .setDefaultMemberPermissions(PermissionFlagsBits.ManageMessages),

    async execute(interaction) {
        if (!interaction.member.roles.cache.has(process.env.INCUBATOR_ROLE_ID)) {
        return interaction.reply({ 
            content: "No have permission to close tickets.", 
            ephemeral: true 
        });
    }
        const userId = interaction.channel.topic?.split('UserID:')[1];
        if (!userId) return interaction.reply({ content: "Not a ticket channel.", ephemeral: true });

        await interaction.reply("Closing ticket in 5 seconds...");
        
        // Notify user
        try {
            const user = await interaction.client.users.fetch(userId);
            await user.send("Your ticket has been closed by staff. DM again to open a new one.");
        } catch (e) { /* ignore if DMs closed */ }

        setTimeout(() => interaction.channel.delete().catch(() => {}), 5000);
    }
};