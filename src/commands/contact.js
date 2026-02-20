const { SlashCommandBuilder, PermissionFlagsBits } = require('discord.js');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('contact')
        .setDescription('Initiate a ModMail ticket with a user')
        .addUserOption(option => 
            option.setName('user')
                .setDescription('The user to contact')
                .setRequired(true))
        .addStringOption(option => 
            option.setName('reason')
                .setDescription('Reason for contacting')
                .setRequired(true))
        .setDefaultMemberPermissions(PermissionFlagsBits.ManageMessages),

    async execute(interaction) {
        if (interaction.channelId !== process.env.MOD_CHAT_CHANNEL_ID) { // PLACEHOLDER(!) test server ID, change to mod-chat ID before madocord deployment!
            return interaction.reply({ 
                content: `This command can only be used in <#${process.env.MOD_CHAT_CHANNEL_ID}>.`, 
                ephemeral: true 
            });
        }

        const user = interaction.options.getUser('user');
        const reason = interaction.options.getString('reason');

        if (user.bot) return interaction.reply({ content: "Reze doesnt like talking to (other) clankers :(.", ephemeral: true });

        await interaction.deferReply({ ephemeral: true });

        try {
            const channel = await interaction.client.modmail.initiateStaffTicket(user, interaction.user, reason);
            await interaction.editReply({ content: `Reze messaged: ${user} in ${channel}` });
        } catch (err) {
            console.error(err);
            await interaction.editReply({ content: `Reze couldnt to talk to ${user}.... ${err.message}` });
        }
    }
};