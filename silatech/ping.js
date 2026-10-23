const config = require('../config');

module.exports = {
    name: 'ping',
    category: 'System',
    async execute(sock, msg, args, ctx) {
        const start = Date.now();
        await new Promise(r => setTimeout(r, 50));
        const ping = Date.now() - start;
        await ctx.sendWithTemplate(sock, ctx.chatId, {
            image: { url: config.BOT_IMAGE },
            caption: `🏓 *PING*\n\n⚡ Speed: ${ping}ms\n⏱️ Uptime: ${ctx.formatUptime(Date.now() - (ctx.socketStartTime.get(ctx.sanitizedNumber) || Date.now()))}\n\n> *➥ POWERED BY ${config.BOT_NAME}*`
        }, msg);
    }
};
