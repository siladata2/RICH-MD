const config = require('../config');

module.exports = {
    name: 'owner',
    category: 'System',
    async execute(sock, msg, args, ctx) {
        await ctx.sendWithTemplate(sock, ctx.chatId, {
            image: { url: config.BOT_IMAGE },
            caption: `👑 *BOT OWNER*\n\n🏷️ Name: ${config.OWNER_NAME}\n📱 Number: +${config.OWNER_NUMBER}\n🔗 Channel: ${config.CHANNEL_LINK}\n👥 Group: ${config.GROUP_LINK}\n\n> *➥ POWERED BY ${config.BOT_NAME}*`
        }, msg);
    }
};
