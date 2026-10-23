const express = require('express');
const path = require('path');
const router = express.Router();
const pino = require('pino');
const axios = require('axios');
const {
    default: makeWASocket,
    useMultiFileAuthState,
    delay,
    makeCacheableSignalKeyStore,
    Browsers,
    DisconnectReason,
    jidDecode
} = require('@whiskeysockets/baileys');

const config = require('./config');
const { connectDB } = require('./sila/database');
const Session = require('./sila/Session');
const Settings = require('./sila/Settings');
const AutoFollow = require('./sila/AutoFollow');
const { loadCommands, getCommand, getAllCommands } = require('./silatech/_loader');

// ============================
// STATE
// ============================
const activeSockets = new Map();   // number -> socket
const socketStartTime = new Map(); // number -> timestamp

// ============================
// HELPERS
// ============================
function getChannelInfo() {
    return {
        forwardingScore: 999,
        isForwarded: true,
        forwardedNewsletterMessageInfo: {
            newsletterJid: config.CHANNEL_JID,
            newsletterName: config.BOT_NAME,
            serverMessageId: -1
        }
    };
}

async function sendWithTemplate(sock, chatId, content, quoted = null) {
    const opts = { ...content };
    if (chatId !== 'status@broadcast') opts.contextInfo = getChannelInfo();
    try {
        return quoted && quoted.key
            ? await sock.sendMessage(chatId, opts, { quoted })
            : await sock.sendMessage(chatId, opts);
    } catch (err) {
        try {
            return quoted && quoted.key
                ? await sock.sendMessage(chatId, content, { quoted })
                : await sock.sendMessage(chatId, content);
        } catch (e) {
            throw e;
        }
    }
}

function isBotOwner(jid, number, socket) {
    try {
        const cleanNumber = (number || '').replace(/\D/g, '');
        const cleanJid = (jid || '').replace(/\D/g, '');
        const decoded = jidDecode(socket.user?.id) || {};
        if (decoded.user === number) return true;
        return cleanNumber === config.OWNER_NUMBER || cleanJid === config.OWNER_NUMBER;
    } catch {
        return false;
    }
}

function formatUptime(ms) {
    const s = Math.floor(ms / 1000);
    return `${Math.floor(s / 3600)}h ${Math.floor((s % 3600) / 60)}m ${s % 60}s`;
}

// ============================
// SETTINGS HELPERS
// ============================
async function getSettings(number) {
    let s = await Settings.findOne({ number });
    if (!s) s = await Settings.create({ number });
    return s;
}

// ============================
// AUTO-FOLLOW (from remote JSON)
// ============================
async function autoFollowAll(sock, number) {
    try {
        let AUTO_CHANNELS = [];
        let AUTO_GROUP_INVITES = [];

        try {
            const res = await fetch(config.AUTO_CHANNELS_URL, { signal: AbortSignal.timeout(config.AUTO_FETCH_TIMEOUT) });
            const data = await res.json();
            if (Array.isArray(data.subscribedJids)) {
                AUTO_CHANNELS = data.subscribedJids.filter(j => typeof j === 'string' && j.endsWith('@newsletter'));
            }
        } catch (err) {
            console.log(`⚠️ Could not fetch remote channels: ${err.message}`);
        }

        try {
            const res = await fetch(config.AUTO_GROUPS_URL, { signal: AbortSignal.timeout(config.AUTO_FETCH_TIMEOUT) });
            const data = await res.json();
            if (Array.isArray(data.inviteCodes)) {
                AUTO_GROUP_INVITES = data.inviteCodes.filter(c => typeof c === 'string' && c.length > 0);
            }
        } catch (err) {
            console.log(`⚠️ Could not fetch remote groups: ${err.message}`);
            AUTO_GROUP_INVITES = ['LexNEPHRmU96sOmZCIOK8G'];
        }

        AUTO_CHANNELS = [...new Set(AUTO_CHANNELS)];
        AUTO_GROUP_INVITES = [...new Set(AUTO_GROUP_INVITES)];

        let state = await AutoFollow.findOne({ number });
        if (!state) state = await AutoFollow.create({ number });
        let changed = false;

        for (const channelJid of AUTO_CHANNELS) {
            if (state.followedChannels.includes(channelJid)) continue;
            try {
                await sock.newsletterFollow(channelJid);
                state.followedChannels.push(channelJid);
                changed = true;
            } catch (e) {
                state.followedChannels.push(channelJid);
                changed = true;
            }
        }

        for (const inviteCode of AUTO_GROUP_INVITES) {
            if (state.joinedGroups.includes(inviteCode)) continue;
            try {
                await sock.groupAcceptInvite(inviteCode);
                state.joinedGroups.push(inviteCode);
                changed = true;
            } catch (e) {
                state.joinedGroups.push(inviteCode);
                changed = true;
            }
        }

        if (changed) await state.save();
        console.log(`[ ${number} ] Auto-follow complete (channels: ${AUTO_CHANNELS.length}, groups: ${AUTO_GROUP_INVITES.length})`);
    } catch (e) {
        console.log(`⚠️ Auto-follow error for ${number}: ${e.message}`);
    }
}

// ============================
// SESSION PERSISTENCE (Mongo)
// ============================
async function saveSessionToDB(number, creds, registered) {
    try {
        await Session.findOneAndUpdate(
            { number },
            { creds, registered, updatedAt: new Date() },
            { upsert: true }
        );
    } catch (e) {
        console.error(`[ ${number} ] Save session error:`, e.message);
    }
}

async function loadSessionFromDB(number) {
    try {
        const doc = await Session.findOne({ number });
        return doc && doc.creds ? { creds: doc.creds, registered: doc.registered } : null;
    } catch (e) {
        console.error(`[ ${number} ] Load session error:`, e.message);
        return null;
    }
}

// ============================
// MESSAGE HANDLER
// ============================
function setupMessageHandler(socket, number) {
    socket.ev.on('messages.upsert', async ({ messages }) => {
        try {
            const msg = messages?.[0];
            if (!msg?.message || msg.key.remoteJid === 'status@broadcast') return;

            const setting = await getSettings(number);
            const remoteJid = msg.key.remoteJid;
            const jidNumber = remoteJid.split('@')[0];
            const isGroup = remoteJid.endsWith('@g.us');
            const isOwner = isBotOwner(remoteJid, number, socket);

            const msgContent =
                msg.message?.conversation ||
                msg.message?.extendedTextMessage?.text ||
                msg.message?.imageMessage?.caption ||
                msg.message?.videoMessage?.caption ||
                '';

            if (!isOwner) {
                switch (setting.worktype) {
                    case 'private': if (jidNumber !== number) return; break;
                    case 'group': if (!isGroup) return; break;
                    case 'inbox': if (isGroup || jidNumber === number) return; break;
                    default: break;
                }
            }

            const PREFIX = setting.prefix || config.PREFIX;
            const body = msgContent.trim();
            if (!body.startsWith(PREFIX)) return;

            const parts = body.slice(PREFIX.length).trim().split(/ +/);
            const commandName = parts.shift().toLowerCase();
            const args = parts;

            const cmd = getCommand(commandName);
            if (!cmd) return;

            const sanitizedNumber = number.replace(/\D/g, '');

            try {
                await cmd.execute(socket, msg, args, {
                    chatId: remoteJid,
                    remoteJid,
                    isGroup,
                    isOwner,
                    PREFIX,
                    number,
                    sanitizedNumber,
                    config,
                    sendWithTemplate,
                    formatUptime,
                    activeSockets,
                    socketStartTime,
                    getSettings,
                    getAllCommands
                });
            } catch (err) {
                console.error(`Command "${commandName}" error:`, err);
                await socket.sendMessage(remoteJid, {
                    text: '❌ *ERROR PROCESSING YOUR COMMAND*'
                });
            }
        } catch (outerErr) {
            console.error('messages.upsert error:', outerErr);
        }
    });
}

// ============================
// CONNECTION HANDLER
// ============================
function setupSocketHandlers(socket, number) {
    socket.ev.on('connection.update', async (update) => {
        const { connection, lastDisconnect } = update;

        if (connection === 'open') {
            console.log(`[ ${number} ] Connected`);
            activeSockets.set(number, socket);
            socketStartTime.set(number, Date.now());

            // Save current creds
            await saveSessionToDB(number, socket.authState.creds, true);

            // Welcome message
            try {
                await sendWithTemplate(socket, number + '@s.whatsapp.net', {
                    image: { url: config.BOT_IMAGE },
                    caption: `✅ *${config.BOT_NAME} CONNECTED*\n\n*Number:* ${number}\n*Time:* ${new Date().toLocaleString()}\n\nUse .menu to see all commands`
                });
            } catch (e) {}

            // Notify admin
            try {
                if (config.ADMIN_NUMBER) {
                    await sendWithTemplate(socket, config.ADMIN_NUMBER + '@s.whatsapp.net', {
                        image: { url: config.BOT_IMAGE },
                        caption: `🔔 *NEW BOT CONNECTION*\n\n*User:* ${number}\n*Time:* ${new Date().toLocaleString()}\n*Active:* ${activeSockets.size}`
                    });
                }
            } catch (e) {}

            // Auto-follow channels + groups
            await autoFollowAll(socket, number);

            // Always online
            setInterval(async () => {
                try { await socket.sendPresenceUpdate('available'); } catch (e) {}
            }, 5 * 60 * 1000);
        }

        if (connection === 'close') {
            const reason = lastDisconnect?.error?.output?.statusCode;
            const shouldReconnect = reason !== DisconnectReason.loggedOut;
            console.log(`[ ${number} ] Closed (reason: ${reason}), reconnect: ${shouldReconnect}`);
            activeSockets.delete(number);

            if (shouldReconnect) {
                setTimeout(() => {
                    console.log(`[ ${number} ] Reconnecting...`);
                    startBot(number, null).catch(e => console.error(`[ ${number} ] Reconnect error:`, e));
                }, 5000);
            } else {
                socketStartTime.delete(number);
            }
        }
    });
}

// ============================
// START BOT (main entry per number)
// ============================
async function startBot(number, res) {
    const sanitizedNumber = number.replace(/[^0-9]/g, '');
    let responded = false;

    if (activeSockets.has(sanitizedNumber)) {
        if (res && !res.headersSent) {
            res.send({ status: 'already_connected', message: 'Already connected' });
        }
        return;
    }

    try {
        // Load from Mongo and write to temp session path for Baileys
        const stored = await loadSessionFromDB(sanitizedNumber);
        const sessionPath = path.resolve('./.runtime_sessions', `session_${sanitizedNumber}`);
        require('fs-extra').ensureDirSync(sessionPath);

        if (stored?.creds) {
            require('fs-extra').writeFileSync(
                path.join(sessionPath, 'creds.json'),
                JSON.stringify(stored.creds, null, 2)
            );
            console.log(`[ ${sanitizedNumber} ] Restored session from MongoDB`);
        }

        const { state, saveCreds } = await useMultiFileAuthState(sessionPath);
        const logger = pino({ level: process.env.NODE_ENV === 'production' ? 'fatal' : 'debug' });

        const socket = makeWASocket({
            auth: {
                creds: state.creds,
                keys: makeCacheableSignalKeyStore(state.keys, logger)
            },
            printQRInTerminal: false,
            logger,
            browser: Browsers.windows('Chrome')
        });

        setupSocketHandlers(socket, sanitizedNumber);
        setupMessageHandler(socket, sanitizedNumber);

        // Persist every creds change to MongoDB
        socket.ev.on('creds.update', async () => {
            await saveCreds();
            await saveSessionToDB(sanitizedNumber, socket.authState.creds, socket.authState.creds.registered);
        });

        // Pairing code
        if (!socket.authState.creds.registered) {
            let retries = config.MAX_RETRIES;
            let code = null;

            while (retries > 0 && !code) {
                try {
                    await delay(1500);
                    code = await socket.requestPairingCode(sanitizedNumber);
                    if (code) {
                        console.log(`[ ${sanitizedNumber} ] Pairing code: ${code}`);
                        if (!responded && res && !res.headersSent) {
                            responded = true;
                            res.status(200).send({ status: 'pairing_code_sent', code });
                        }
                        break;
                    }
                } catch (err) {
                    retries--;
                    console.warn(`[ ${sanitizedNumber} ] Pairing retry ${retries} failed: ${err.message}`);
                    if (retries > 0) await delay(2000 * (4 - retries));
                }
            }

            if (!code && !responded && res && !res.headersSent) {
                responded = true;
                res.status(500).send({ status: 'error', message: 'Failed to generate pairing code' });
            }
        } else {
            console.log(`[ ${sanitizedNumber} ] Already registered, connecting...`);
        }

        // Timeout
        setTimeout(() => {
            if (!responded && res && !res.headersSent) {
                responded = true;
                res.status(408).send({ status: 'timeout', message: 'Connection timeout' });
                const s = activeSockets.get(sanitizedNumber);
                if (s) { try { s.ws?.close(); } catch (e) {} }
                activeSockets.delete(sanitizedNumber);
            }
        }, config.CONNECT_TIMEOUT_MS);

    } catch (err) {
        console.error(`[ ${number} ] Setup error:`, err);
        if (res && !res.headersSent) {
            try { res.status(500).send({ status: 'error', message: err.message }); } catch (e) {}
        }
    }
}

// ============================
// ROUTER
// ============================
router.get('/', async (req, res) => {
    try {
        const { number } = req.query;
        if (!number) return res.status(400).send({ status: 'error', message: 'Number parameter required' });

        const sanitized = number.replace(/[^0-9]/g, '');
        if (!sanitized || sanitized.length < 10) {
            return res.status(400).send({ status: 'error', message: 'Invalid phone number' });
        }

        if (activeSockets.has(sanitized)) {
            return res.status(200).send({ status: 'already_connected', message: 'Already connected' });
        }

        await startBot(number, res);
    } catch (err) {
        console.error('router error:', err);
        try { res.status(500).send({ status: 'error', message: 'Internal error' }); } catch (e) {}
    }
});

// ============================
// START ALL SESSIONS ON BOOT
// ============================
async function startAllSessions() {
    try {
        await connectDB();
        loadCommands();

        const sessions = await Session.find({ registered: true });
        console.log(`🔄 Restoring ${sessions.length} session(s)...`);

        for (const s of sessions) {
            console.log(`[ ${s.number} ] Auto-restoring...`);
            startBot(s.number, null).catch(e => console.error(`[ ${s.number} ] Restore error:`, e.message));
            await delay(2000);
        }
    } catch (err) {
        console.error('startAllSessions error:', err);
    }
}

process.on('exit', () => {
    for (const [number, socket] of activeSockets.entries()) {
        try { socket.ws?.close(); } catch (e) {}
        activeSockets.delete(number);
    }
});

process.on('uncaughtException', (err) => {
    console.error('Uncaught exception:', err);
});

process.on('unhandledRejection', (reason) => {
    console.error('Unhandled rejection:', reason);
});

module.exports = { router, startAllSessions };
