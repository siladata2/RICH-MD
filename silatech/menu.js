const config = require('../config');

module.exports = {
    name: 'menu',
    category: 'System',
    async execute(sock, msg, args, ctx) {
        const commands = ctx.getAllCommands();
        const byCategory = {};
        for (const [, cmd] of commands) {
            const cat = cmd.category || 'Other';
            if (!byCategory[cat]) byCategory[cat] = [];
            byCategory[cat].push(Array.isArray(cmd.name) ? cmd.name[0] : cmd.name);
        }

        let text = `╭━━━━━━━━━━━━━━━━●◌\n│  🤖 *${config.BOT_NAME}*\n├━━━━━━━━━━━━━━━━●◌\n│ 👑 Owner: ${config.OWNER_NAME}\n│ 📱 ${ctx.sanitizedNumber}\n│ ⏱️ Uptime: ${ctx.formatUptime(Date.now() - (ctx.socketStartTime.get(ctx.sanitizedNumber) || Date.now()))}\n╰━━━━━━━━━━━━━━━━●◌\n\n`;

        for (const [cat, cmds] of Object.entries(byCategory)) {
            text += `*━━ ${cat} ━━*\n`;
            for (const c of cmds) text += `• ${ctx.PREFIX}${c}\n`;
            text += '\n';
        }
        text += `> *➥ POWERED BY ${config.BOT_NAME}*`;

        await ctx.sendWithTemplate(sock, ctx.chatId, {
            image: { url: config.BOT_IMAGE },
            caption: text
        }, msg);
    }
};
