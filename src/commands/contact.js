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
    const user = interaction.options.getUser('user');
    const reason = interaction.options.getString('reason');
    const userId = user.id;

    if (user.bot) return interaction.reply({ content: "Reze doesn't like talking to (other) clankers :(.", ephemeral: true });

    if (interaction.channelId !== process.env.MOD_CHAT_CHANNEL_ID) {
        return interaction.reply({ 
            content: `This command can only be used in <#${process.env.MOD_CHAT_CHANNEL_ID}>.`, 
            ephemeral: true 
        });
    }

    if (!interaction.member.roles.cache.has(process.env.INCUBATOR_ROLE_ID) && 
        !interaction.member.roles.cache.has(process.env.SMALL_INC_ROLE_ID)) {
        return interaction.reply({ content: "You do not have the required role.", ephemeral: true });
    }

    const modmail = interaction.client.modmail;
    if (!modmail || !modmail.locks) {
        console.error("ModMailManager or Locks Set is missing!");
        return interaction.reply({ content: "Internal error: ModMail system not initialized.", ephemeral: true });
    }

    if (modmail.locks.has(userId)) {
        return interaction.reply({ content: "A request for this user is already being processed. Please wait 5 seconds.", ephemeral: true });
    }

    modmail.locks.add(userId);
    setTimeout(() => modmail.locks.delete(userId), 5000);

    await interaction.deferReply({ ephemeral: true });

    try {
        const channel = await modmail.initiateStaffTicket(user, interaction.user, reason);
        await interaction.editReply({ content: `Reze messaged: ${user} in ${channel}` });
    } catch (err) {
        console.error(err);
        await interaction.editReply({ content: `Reze couldn't talk to ${user}.... ${err.message}` });
    }
}
}