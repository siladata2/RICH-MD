const config = require('../config');

module.exports = {
    name: 'freebot',
    category: 'System',
    async execute(sock, msg, args, ctx) {
        await ctx.sendWithTemplate(sock, ctx.chatId, {
            image: { url: config.BOT_IMAGE },
            caption: `🤖 *FREE BOT LINK*\n\n🔗 Channel: ${config.CHANNEL_LINK}\n👥 Group: ${config.GROUP_LINK}\n\n> *➥ POWERED BY ${config.BOT_NAME}*`
        }, msg);
    }
};
