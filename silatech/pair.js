const config = require('../config');

module.exports = {
    name: 'pair',
    category: 'System',
    async execute(sock, msg, args, ctx) {
        if (!args[0]) {
            return ctx.sendWithTemplate(sock, ctx.chatId, {
                image: { url: config.BOT_IMAGE },
                caption: `📱 *PAIR COMMAND*\n\nUsage: ${ctx.PREFIX}pair 255789661031`
            }, msg);
        }
        await ctx.sendWithTemplate(sock, ctx.chatId, {
            image: { url: config.BOT_IMAGE },
            caption: `🔗 *PAIRING INSTRUCTIONS*\n\n📱 Number: ${args[0]}\n\n> *➥ POWERED BY ${config.BOT_NAME}*`
        }, msg);
    }
};
