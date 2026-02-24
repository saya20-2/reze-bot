const { SlashCommandBuilder, PermissionFlagsBits } = require('discord.js');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('reply')
        .setDescription('Reply to a ModMail ticket')
        .addStringOption(option => 
            option.setName('message')
                .setDescription('The message to send to the user')
                .setRequired(true))
                .addAttachmentOption(option =>
            option.setName('file')
                .setDescription('Attach an image or file to the reply')
                .setRequired(false))
            .setDefaultMemberPermissions(PermissionFlagsBits.ManageMessages),

    async execute(interaction) {
        const topic = interaction.channel.topic;
        if (!topic || !topic.includes('UserID:')) {
            return interaction.reply({ content: 'not a valid modmail channel', ephemeral: true});
        }
        const userId = topic.split('UserID:')[1];
        if (!interaction.member.roles.cache.has(process.env.INCUBATOR_ROLE_ID) && 
            !interaction.member.roles.cache.has(process.env.SMALL_INC_ROLE_ID)) {
        return interaction.reply({ 
            content: "Only Incubators can reply to tickets.", 
            ephemeral: true 
        });
    }
        if (interaction.client.modmail.locks.has(userId)) {
            return interaction.reply({ content: "Reply was already sent", ephemeral: true});
        }

        interaction.client.modmail.locks.add(userId);
        setTimeout(() => { interaction.client.modmail.locks.delete(userId); }, 5000);
    
        await interaction.deferReply();

        const attachment = interaction.options.getAttachment('file');
        const replyText = interaction.options.getString('message');

        if (!replyText) {
            return interaction.reply({ content: "Provided message must be inside the specified 'Message' argument text box.", ephemeral: true });
        }

        try {
            const user = await interaction.client.users.fetch(userId);
            const payload = {
                content: `**Staff (${interaction.user.username}):** ${replyText}`
            };

            if (attachment) {
                payload.files = [attachment.url];
            }

            await user.send(payload);

            await interaction.editReply({ 
                content: `Replied to ${user.username}: ${replyText}`,
                files: attachment ? [attachment.url] : []
            });
        } catch (err) {
            console.error(err);
            await interaction.editReply({ content: 'Failed to send DM. The user might have DMs disabled.', ephemeral: true });
        }
    }
};