const { SlashCommandBuilder } = require('discord.js');

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
                .setRequired(false)),

    async execute(interaction) {
        if (!interaction.member.roles.cache.has(process.env.STAFF_ROLE_ID)) {
        return interaction.reply({ 
            content: "Only Incubators can reply to tickets.", 
            ephemeral: true 
        });
    }
        const topic = interaction.channel.topic;
        if (!topic || !topic.includes('UserID:')) {
            return interaction.reply({ content: 'This is not a valid ModMail channel.', ephemeral: true });
        }

        const attachment = interaction.options.getAttachment('file');
        const replyText = interaction.options.getString('message');

        if (!replyText) {
            return interaction.reply({ content: "Provided message must be inside the specified 'Message' argument text box.", ephemeral: true });
        }

        await interaction.deferReply();

        const userId = topic.split('UserID:')[1];

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