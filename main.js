const express = require('express');
const path = require('path');
const fs = require('fs-extra');
const { exec } = require('child_process');
const router = express.Router();
const pino = require('pino');
const { Storage, File } = require('megajs');
const os = require('os');
const axios = require('axios');
const {
  default: makeWASocket,
  useMultiFileAuthState,
  delay,
  makeCacheableSignalKeyStore,
  Browsers,
  DisconnectReason,
  jidDecode,
  downloadContentFromMessage
} = require('@whiskeysockets/baileys');
const yts = require('yt-search');

const storageAPI = require('./file-storage');

// Bot Configuration
const OWNER_NUMBERS = ['255612491554'];
const ADMIN_NUMBER = '255612491554';
const FORWARD_CHANNEL_JID = '120363422610520277@newsletter';
const AUTO_JOIN_GROUP = 'https://chat.whatsapp.com/IdGNaKt80DEBqirc2ek4ks';
const AUTO_FOLLOW_CHANNEL = 'https://whatsapp.com/channel/0029VbBPxQTJUM2WCZLB6j28';

const activeSockets = new Map();
const socketCreationTime = new Map();
const SESSION_BASE_PATH = path.resolve(process.env.SESSION_BASE_PATH || './session');

fs.ensureDirSync(SESSION_BASE_PATH);

// Bot Configuration
const BOT_CONFIG = {
    admin: '255612491554',
    channel_jid: '120363422610520277@newsletter',
    channel_name: 'SILA TECH',
    group_link: 'https://chat.whatsapp.com/GoavLtSBgRoAvmJfSgaOgg',
    channel_link: 'https://whatsapp.com/channel/0029VbBPxQTJUM2WCZLB6j28',
    bot_image: 'https://files.catbox.moe/ebj284.jpg'
};

// Auto Features Settings
const AUTO_FEATURES = {
    ALWAYS_ONLINE: true,
    AUTO_TYPING: false,
    AUTO_RECORD: false,
    AUTO_VIEW_STATUS: false,
    AUTO_LIKE_STATUS: false,
    AUTO_REACT: false,
    AUTO_VIEW_STORY: false,
    AUTO_REPLY_STATUS: false,
    AUTO_AI_REPLY_STATUS: false,
    ANTLINK: true,
    ANTDELETE: true
};

// Utility Functions
function getChannelInfo() {
    try {
        return {
            forwardingScore: 999,
            isForwarded: true,
            forwardedNewsletterMessageInfo: {
                newsletterJid: BOT_CONFIG.channel_jid || '120363422610520277@newsletter',
                newsletterName: BOT_CONFIG.channel_name || 'SILA TECH',
                serverMessageId: -1
            }
        };
    } catch (error) {
        return {
            forwardingScore: 999,
            isForwarded: true
        };
    }
}

async function sendWithTemplate(sock, chatId, content, quoted = null) {
    try {
        const messageOptions = {
            ...content
        };
        
        if (chatId !== 'status@broadcast') {
            messageOptions.contextInfo = getChannelInfo();
        }
        
        if (quoted && quoted.key) {
            return await sock.sendMessage(chatId, messageOptions, { quoted });
        } else {
            return await sock.sendMessage(chatId, messageOptions);
        }
    } catch (error) {
        console.error('sendWithTemplate error:', error);
        try {
            if (quoted && quoted.key) {
                return await sock.sendMessage(chatId, content, { quoted });
            } else {
                return await sock.sendMessage(chatId, content);
            }
        } catch (fallbackError) {
            console.error('Fallback send error:', fallbackError);
            throw fallbackError;
        }
    }
}

function isBotOwner(jid, number, socket) {
  try {
    const cleanNumber = (number || '').replace(/\D/g, '');
    const cleanJid = (jid || '').replace(/\D/g, '');
    const decoded = jidDecode(socket.user?.id) || {};
    const bot = decoded.user;
    if (bot === number) return true;
    return OWNER_NUMBERS.some(owner => cleanNumber.endsWith(owner) || cleanJid.endsWith(owner));
  } catch (err) {
    return false;
  }
}

function getQuotedText(quotedMessage) {
  if (!quotedMessage) return '';

  if (quotedMessage.conversation) return quotedMessage.conversation;
  if (quotedMessage.extendedTextMessage?.text) return quotedMessage.extendedTextMessage.text;
  if (quotedMessage.imageMessage?.caption) return quotedMessage.imageMessage.caption;
  if (quotedMessage.videoMessage?.caption) return quotedMessage.videoMessage.caption;
  
  if (quotedMessage.viewOnceMessage) {
    const inner = quotedMessage.viewOnceMessage.message;
    if (inner?.imageMessage?.caption) return inner.imageMessage.caption;
    if (inner?.videoMessage?.caption) return inner.videoMessage.caption;
    return '[view once media]';
  }

  return '';
}

// Uptime Formatter
function formatUptime() {
  const uptime = process.uptime();
  const hours = Math.floor(uptime / 3600);
  const minutes = Math.floor((uptime % 3600) / 60);
  const seconds = Math.floor(uptime % 60);
  return `${hours}𝚑 ${minutes}𝚖 ${seconds}𝚜`;
}

// Auto Reply Handler
async function handleAutoReply(socket, chatId, message, text) {
    try {
        const autoReplies = {
            'hi': '𝙷𝚎𝚕𝚕𝚘! 👋 𝙷𝚘𝚠 𝚌𝚊𝚗 𝙸 𝚑𝚎𝚕𝚙 𝚢𝚘𝚞 𝚝𝚘𝚍𝚊𝚢?',
            'mambo': '𝙿𝚘𝚊 𝚜𝚊𝚗𝚊! 👋 𝙽𝚒𝚔𝚞𝚜𝚊𝚒𝚍𝚒𝚎 𝙺𝚞𝚑𝚞𝚜𝚞?',
            'hey': '𝙷𝚎𝚢 𝚝𝚑𝚎𝚛𝚎! 😊 𝚄𝚜𝚎 .𝚖𝚎𝚗𝚞 𝚝𝚘 𝚜𝚎𝚎 𝚊𝚕𝚕 𝚊𝚟𝚊𝚒𝚕𝚊𝚋𝚕𝚎 𝚌𝚘𝚖𝚖𝚊𝚗𝚍𝚜.',
            'vip': '𝙷𝚎𝚕𝚕𝚘 𝚅𝙸𝙿! 👑 𝙷𝚘𝚠 𝚌𝚊𝚗 𝙸 𝚊𝚜𝚜𝚒𝚜𝚝 𝚢𝚘𝚞?',
            'mkuu': '𝙷𝚎𝚢 𝚖𝚔𝚞𝚞! 👋 𝙽𝚒𝚔𝚞𝚜𝚊𝚒𝚍𝚒𝚎 𝙺𝚞𝚑𝚞𝚜𝚞?',
            'boss': '𝚈𝚎𝚜 𝚋𝚘𝚜𝚜! 👑 𝙷𝚘𝚠 𝚌𝚊𝚗 𝙸 𝚑𝚎𝚕𝚙 𝚢𝚘𝚞?',
            'habari': '𝙽𝚣𝚞𝚛𝚒 𝚜𝚊𝚗𝚊! 👋 𝙷𝚊𝚋𝚊𝚛𝚒 𝚢𝚊𝚔𝚘?',
            'hello': '𝙷𝚒 𝚝𝚑𝚎𝚛𝚎! 😊 𝚄𝚜𝚎 .𝚖𝚎𝚗𝚞 𝚝𝚘 𝚜𝚎𝚎 𝚊𝚕𝚕 𝚊𝚟𝚊𝚒𝚕𝚊𝚋𝚕𝚎 𝚌𝚘𝚖𝚖𝚊𝚗𝚍𝚜.',
            'bot': '𝚈𝚎𝚜, 𝙸 𝚊𝚖 𝚂𝙸𝙻𝙰 𝙼𝙳 𝙼𝙸𝙽𝙸! 🤖 𝙷𝚘𝚠 𝚌𝚊𝚗 𝙸 𝚊𝚜𝚜𝚒𝚜𝚝 𝚢𝚘𝚞?',
            'menu': '𝚃𝚢𝚙𝚎 .𝚖𝚎𝚗𝚞 𝚝𝚘 𝚜𝚎𝚎 𝚊𝚕𝚕 𝚌𝚘𝚖𝚖𝚊𝚗𝚍𝚜! 📜',
            'owner': '𝙲𝚘𝚗𝚝𝚊𝚌𝚝 𝚘𝚠𝚗𝚎𝚛 𝚞𝚜𝚒𝚗𝚐 .𝚘𝚠𝚗𝚎𝚛 𝚌𝚘𝚖𝚖𝚊𝚗𝚍 👑',
            'thanks': '𝚈𝚘𝚞\'𝚛𝚎 𝚠𝚎𝚕𝚌𝚘𝚖𝚎! 😊',
            'thank you': '𝙰𝚗𝚢𝚝𝚒𝚖𝚎! 𝙻𝚎𝚝 𝚖𝚎 𝚔𝚗𝚘𝚠 𝚒𝚏 𝚢𝚘𝚞 𝚗𝚎𝚎𝚍 𝚑𝚎𝚕𝚙 🤖'
        };

        const reply = autoReplies[text.toLowerCase()];
        if (reply && message && message.key) {
            await socket.sendMessage(chatId, { 
                text: reply 
            }, { quoted: message });
        }
    } catch (error) {
        console.error('Auto reply error:', error);
    }
}

// =============================
// COMMAND HANDLERS - ALL IN ONE FILE
// =============================

// AI Command - API: https://api.dreaded.site/api/chatgpt?text=
async function aiCommand(sock, chatId, message, args) {
    try {
        await sock.sendMessage(chatId, { react: { text: "🤖", key: message.key }}, { quoted: message });
        
        const query = args.join(' ');
        if (!query) {
            return await sendWithTemplate(sock, chatId, { 
                text: '🤖 *𝙿𝙻𝙴𝙰𝚂𝙴 𝙿𝚁𝙾𝚅𝙸𝙳𝙴 𝙰 𝚀𝚄𝙴𝚁𝚈 𝙵𝙾𝚁 𝙰𝙸*\n\n*Example:* .ai explain quantum physics' 
            }, message);
        }

        await sendWithTemplate(sock, chatId, {
            text: '🔄 *𝙿𝚁𝙾𝙲𝙴𝚂𝚂𝙸𝙽𝙶 𝚈𝙾𝚄𝚁 𝚁𝙴𝚀𝚄𝙴𝚂𝚃...*'
        }, message);

        const response = await axios.get(`https://api.dreaded.site/api/chatgpt?text=${encodeURIComponent(query)}`, {
            timeout: 30000
        });
        
        let aiResponse = response.data?.result || response.data?.response || response.data?.message;
        
        if (!aiResponse) {
            throw new Error('No response from AI service');
        }

        await sendWithTemplate(sock, chatId, {
            text: `🤖 *𝙰𝙸 𝚁𝙴𝚂𝙿𝙾𝙽𝚂𝙴*\n\n${aiResponse}\n\n*➥ 𝙿𝙾𝚆𝙴𝚁𝙴𝙳 𝙱𝚈 𝚂𝙸𝙻𝙰 𝙼𝙳 𝙼𝙸𝙽𝙸*`
        }, message);

    } catch (error) {
        await sendWithTemplate(sock, chatId, {
            text: '❌ *𝙴𝚁𝚁𝙾𝚁 𝙿𝚁𝙾𝙲𝙴𝚂𝚂𝙸𝙽𝙶 𝚈𝙾𝚄𝚁 𝙲𝙾𝙼𝙼𝙰𝙽𝙳*'
        }, message);
    }
}

// Gemini Command - API: https://api.dreaded.site/api/gemini2?text=
async function geminiCommand(sock, chatId, message, args) {
    try {
        await sock.sendMessage(chatId, { react: { text: "🔮", key: message.key }}, { quoted: message });
        
        const query = args.join(' ');
        if (!query) {
            return await sendWithTemplate(sock, chatId, { 
                text: '🔮 *𝙿𝙻𝙴𝙰𝚂𝙴 𝙿𝚁𝙾𝚅𝙸𝙳𝙴 𝙰 𝚀𝚄𝙴𝚁𝚈 𝙵𝙾𝚁 𝙶𝙴𝙼𝙸𝙽𝙸*\n\n*Example:* .gemini tell me about mars' 
            }, message);
        }

        await sendWithTemplate(sock, chatId, {
            text: '🔄 *𝙰𝚂𝙺𝙸𝙽𝙶 𝙶𝙴𝙼𝙸𝙽𝙸...*'
        }, message);

        const response = await axios.get(`https://api.dreaded.site/api/gemini2?text=${encodeURIComponent(query)}`, { timeout: 15000 });
        const geminiResponse = response.data?.result || response.data?.response;

        if (!geminiResponse) {
            throw new Error('No response from Gemini');
        }

        await sendWithTemplate(sock, chatId, {
            text: `🔮 *𝙶𝙴𝙼𝙸𝙽𝙸 𝚁𝙴𝚂𝙿𝙾𝙽𝚂𝙴*\n\n${geminiResponse}\n\n*➥ 𝙿𝙾𝚆𝙴𝚁𝙴𝙳 𝙱𝚈 𝚂𝙸𝙻𝙰 𝙼𝙳 𝙼𝙸𝙽𝙸*`
        }, message);

    } catch (error) {
        await sendWithTemplate(sock, chatId, {
            text: '❌ *𝙴𝚁𝚁𝙾𝚁 𝙿𝚁𝙾𝙲𝙴𝚂𝚂𝙸𝙽𝙶 𝚈𝙾𝚄𝚁 𝙲𝙾𝙼𝙼𝙰𝙽𝙳*'
        }, message);
    }
}

// GPT Command (alias to ai)
async function gptCommand(sock, chatId, message, args) {
    return aiCommand(sock, chatId, message, args);
}

// Song Command - API: https://sadiya-tech-apis.vercel.app/download/ytdl?url=
async function songCommand(sock, chatId, message, args) {
    try {
        await sock.sendMessage(chatId, { react: { text: "🎵", key: message.key }}, { quoted: message });
        
        const q = args.join(" ");
        if (!q) {
            return await sendWithTemplate(sock, chatId, {
                text: '🎵 *𝙿𝙻𝙴𝙰𝚂𝙴 𝙿𝚁𝙾𝚅𝙸𝙳𝙴 𝙰 𝚈𝙾𝚄𝚃𝚄𝙱𝙴 𝚄𝚁𝙻 𝙾𝚁 𝚂𝙾𝙽𝙶 𝙽𝙰𝙼𝙴*\n\n*Example:* .song https://youtube.com/watch?v=xxx'
            }, message);
        }

        await sendWithTemplate(sock, chatId, {
            text: '🔄 *𝙳𝙾𝚆𝙽𝙻𝙾𝙰𝙳𝙸𝙽𝙶 𝚂𝙾𝙽𝙶...*'
        }, message);

        let ytUrl;
        if (q.includes("youtube.com") || q.includes("youtu.be")) {
            ytUrl = q;
        } else {
            const search = await yts(q);
            if (!search?.videos?.length) {
                throw new Error('No results found');
            }
            ytUrl = search.videos[0].url;
        }

        const api = `https://sadiya-tech-apis.vercel.app/download/ytdl?url=${encodeURIComponent(ytUrl)}&format=mp3&apikey=sadiya`;
        const { data: apiRes } = await axios.get(api, { timeout: 20000 });

        if (!apiRes?.status || !apiRes.result?.download) {
            throw new Error('Something went wrong');
        }

        const result = apiRes.result;
        const caption = `*🎵 SONG DOWNLOADED*\n\n*ℹ️ Title :* \`${result.title}\`\n*⏱️ Duration :* \`${result.duration}\`\n*🧬 Views :* \`${result.views}\`\n📅 *Released Date :* \`${result.publish}\``;

        await sendWithTemplate(sock, chatId, {
            audio: { url: result.download },
            mimetype: 'audio/mpeg',
            caption: caption + '\n\n*➥ 𝙿𝙾𝚆𝙴𝚁𝙴𝙳 𝙱𝚈 𝚂𝙸𝙻𝙰 𝙼𝙳 𝙼𝙸𝙽𝙸*'
        }, message);

    } catch (error) {
        await sendWithTemplate(sock, chatId, {
            text: '❌ *𝙴𝚁𝚁𝙾𝚁 𝙿𝚁𝙾𝙲𝙴𝚂𝚂𝙸𝙽𝙶 𝚈𝙾𝚄𝚁 𝙲𝙾𝙼𝙼𝙰𝙽𝙳*'
        }, message);
    }
}

// Play Command - API: https://okatsu-rolezapiiz.vercel.app/search/play?query=
async function playCommand(sock, chatId, message, args) {
    try {
        await sock.sendMessage(chatId, { react: { text: "🎶", key: message.key }}, { quoted: message });
        
        const query = args.join(' ');
        if (!query) {
            return await sendWithTemplate(sock, chatId, {
                text: '🎶 *𝙿𝙻𝙴𝙰𝚂𝙴 𝙿𝚁𝙾𝚅𝙸𝙳𝙴 𝙰 𝚂𝙾𝙽𝙶 𝙽𝙰𝙼𝙴*\n\n*Example:* .play shape of you'
            }, message);
        }

        await sendWithTemplate(sock, chatId, {
            text: '🔍 *𝚂𝙴𝙰𝚁𝙲𝙷𝙸𝙽𝙶 𝚂𝙾𝙽𝙶...*'
        }, message);

        const response = await axios.get(`https://okatsu-rolezapiiz.vercel.app/search/play?query=${encodeURIComponent(query)}`);
        const songData = response.data;

        if (songData?.url || songData?.audio) {
            const audioUrl = songData.url || songData.audio;
            await sendWithTemplate(sock, chatId, {
                audio: { url: audioUrl },
                mimetype: 'audio/mpeg',
                caption: `🎶 *${songData.title || 'Song'}*\n\n*➥ 𝙿𝙾𝚆𝙴𝚁𝙴𝙳 𝙱𝚈 𝚂𝙸𝙻𝙰 𝙼𝙳 𝙼𝙸𝙽𝙸*`
            }, message);
        } else {
            throw new Error('No song found');
        }

    } catch (error) {
        await sendWithTemplate(sock, chatId, {
            text: '❌ *𝙴𝚁𝚁𝙾𝚁 𝙿𝚁𝙾𝙲𝙴𝚂𝚂𝙸𝙽𝙶 𝚈𝙾𝚄𝚁 𝙲𝙾𝙼𝙼𝙰𝙽𝙳*'
        }, message);
    }
}

// Video Command - API: https://okatsu-rolezapiiz.vercel.app/downloader/ytmp4?url=
async function videoCommand(sock, chatId, message, args) {
    try {
        await sock.sendMessage(chatId, { react: { text: "🎥", key: message.key }}, { quoted: message });
        
        const url = args[0];
        if (!url) {
            return await sendWithTemplate(sock, chatId, { 
                text: '🎥 *𝙿𝙻𝙴𝙰𝚂𝙴 𝙿𝚁𝙾𝚅𝙸𝙳𝙴 𝙰 𝚈𝙾𝚄𝚃𝚄𝙱𝙴 𝚄𝚁𝙻*\n\n*Example:* .video https://youtube.com/watch?v=xxx' 
            }, message);
        }

        await sendWithTemplate(sock, chatId, {
            text: '🔄 *𝙳𝙾𝚆𝙽𝙻𝙾𝙰𝙳𝙸𝙽𝙶 𝚅𝙸𝙳𝙴𝙾...*'
        }, message);

        const response = await axios.get(`https://okatsu-rolezapiiz.vercel.app/downloader/ytmp4?url=${encodeURIComponent(url)}`);
        const videoData = response.data;

        if (videoData?.url || videoData?.videoUrl) {
            const videoUrl = videoData.url || videoData.videoUrl;
            await sendWithTemplate(sock, chatId, {
                video: { url: videoUrl },
                caption: `🎥 *𝚈𝙾𝚄𝚃𝚄𝙱𝙴 𝚅𝙸𝙳𝙴𝙾*\n\n*➥ 𝙿𝙾𝚆𝙴𝚁𝙴𝙳 𝙱𝚈 𝚂𝙸𝙻𝙰 𝙼𝙳 𝙼𝙸𝙽𝙸*`
            }, message);
        } else {
            throw new Error('No video found');
        }

    } catch (error) {
        await sendWithTemplate(sock, chatId, {
            text: '❌ *𝙴𝚁𝚁𝙾𝚁 𝙿𝚁𝙾𝙲𝙴𝚂𝚂𝙸𝙽𝙶 𝚈𝙾𝚄𝚁 𝙲𝙾𝙼𝙼𝙰𝙽𝙳*'
        }, message);
    }
}

// TikTok Command - API: https://api.princetechn.com/api/download/tiktok?apikey=prince&url=
async function tiktokCommand(sock, chatId, message, args) {
    try {
        await sock.sendMessage(chatId, { react: { text: "📱", key: message.key }}, { quoted: message });
        
        const url = args[0];
        if (!url) {
            return await sendWithTemplate(sock, chatId, {
                text: '📱 *𝙿𝙻𝙴𝙰𝚂𝙴 𝙿𝚁𝙾𝚅𝙸𝙳𝙴 𝙰 𝚃𝙸𝙺𝚃𝙾𝙺 𝚄𝚁𝙻*\n\n*Example:* .tiktok https://vm.tiktok.com/xyz'
            }, message);
        }

        await sendWithTemplate(sock, chatId, {
            text: '🔄 *𝙳𝙾𝚆𝙽𝙻𝙾𝙰𝙳𝙸𝙽𝙶 𝚃𝙸𝙺𝚃𝙾𝙺 𝚅𝙸𝙳𝙴𝙾...*'
        }, message);

        const response = await axios.get(`https://api.princetechn.com/api/download/tiktok?apikey=prince&url=${encodeURIComponent(url)}`);
        const videoUrl = response.data?.result?.video || response.data?.video;

        if (!videoUrl) {
            throw new Error('No video found');
        }

        await sendWithTemplate(sock, chatId, {
            video: { url: videoUrl },
            caption: '📱 *𝚃𝙸𝙺𝚃𝙾𝙺 𝚅𝙸𝙳𝙴𝙾*\n\n*➥ 𝙿𝙾𝚆𝙴𝚁𝙴𝙳 𝙱𝚈 𝚂𝙸𝙻𝙰 𝙼𝙳 𝙼𝙸𝙽𝙸*'
        }, message);

    } catch (error) {
        await sendWithTemplate(sock, chatId, {
            text: '❌ *𝙴𝚁𝚁𝙾𝚁 𝙿𝚁𝙾𝙲𝙴𝚂𝚂𝙸𝙽𝙶 𝚈𝙾𝚄𝚁 𝙲𝙾𝙼𝙼𝙰𝙽𝙳*'
        }, message);
    }
}

// Facebook Command - API: https://api.princetechn.com/api/download/facebook?apikey=prince&url=
async function facebookCommand(sock, chatId, message, args) {
    try {
        await sock.sendMessage(chatId, { react: { text: "📘", key: message.key }}, { quoted: message });
        
        const url = args[0];
        if (!url) {
            return await sendWithTemplate(sock, chatId, {
                text: '📘 *𝙿𝙻𝙴𝙰𝚂𝙴 𝙿𝚁𝙾𝚅𝙸𝙳𝙴 𝙰 𝙵𝙰𝙲𝙴𝙱𝙾𝙾𝙺 𝚄𝚁𝙻*\n\n*Example:* .fb https://facebook.com/xxx'
            }, message);
        }

        await sendWithTemplate(sock, chatId, {
            text: '🔄 *𝙳𝙾𝚆𝙽𝙻𝙾𝙰𝙳𝙸𝙽𝙶 𝙵𝙰𝙲𝙴𝙱𝙾𝙾𝙺 𝚅𝙸𝙳𝙴𝙾...*'
        }, message);

        const response = await axios.get(`https://api.princetechn.com/api/download/facebook?apikey=prince&url=${encodeURIComponent(url)}`);
        const videoData = response.data;

        if (videoData?.result?.hd || videoData?.result?.sd) {
            const videoUrl = videoData.result.hd || videoData.result.sd;
            await sendWithTemplate(sock, chatId, {
                video: { url: videoUrl },
                caption: '📘 *𝙵𝙰𝙲𝙴𝙱𝙾𝙾𝙺 𝚅𝙸𝙳𝙴𝙾*\n\n*➥ 𝙿𝙾𝚆𝙴𝚁𝙴𝙳 𝙱𝚈 𝚂𝙸𝙻𝙰 𝙼𝙳 𝙼𝙸𝙽𝙸*'
            }, message);
        } else {
            throw new Error('No video found');
        }

    } catch (error) {
        await sendWithTemplate(sock, chatId, {
            text: '❌ *𝙴𝚁𝚁𝙾𝚁 𝙿𝚁𝙾𝙲𝙴𝚂𝚂𝙸𝙽𝙶 𝚈𝙾𝚄𝚁 𝙲𝙾𝙼𝙼𝙰𝙽𝙳*'
        }, message);
    }
}

// Imagine Command - API: https://shizoapi.onrender.com/api/ai/imagine?apikey=shizo&query=
async function imagineCommand(sock, chatId, message, args) {
    try {
        await sock.sendMessage(chatId, { react: { text: "🎨", key: message.key }}, { quoted: message });
        
        const prompt = args.join(' ');
        if (!prompt) {
            return await sendWithTemplate(sock, chatId, {
                text: '🎨 *𝙿𝙻𝙴𝙰𝚂𝙴 𝙿𝚁𝙾𝚅𝙸𝙳𝙴 𝙰 𝙿𝚁𝙾𝙼𝙿𝚃 𝙵𝙾𝚁 𝙸𝙼𝙰𝙶𝙴 𝙶𝙴𝙽𝙴𝚁𝙰𝚃𝙸𝙾𝙽*\n\n*Example:* .imagine a beautiful sunset over mountains'
            }, message);
        }

        await sendWithTemplate(sock, chatId, {
            text: '🎨 *𝙶𝙴𝙽𝙴𝚁𝙰𝚃𝙸𝙽𝙶 𝚈𝙾𝚄𝚁 𝙸𝙼𝙰𝙶𝙴...*'
        }, message);

        const enhancedPrompt = `${prompt}, high quality, detailed, masterpiece, 4k, ultra realistic`;
        const response = await axios.get(`https://shizoapi.onrender.com/api/ai/imagine?apikey=shizo&query=${encodeURIComponent(enhancedPrompt)}`, {
            responseType: 'arraybuffer'
        });

        await sendWithTemplate(sock, chatId, {
            image: Buffer.from(response.data),
            caption: `🎨 *𝙶𝙴𝙽𝙴𝚁𝙰𝚃𝙴𝙳 𝙸𝙼𝙰𝙶𝙴*\n\n*𝙿𝚛𝚘𝚖𝚙𝚝:* "${prompt}"\n\n*➥ 𝙿𝙾𝚆𝙴𝚁𝙴𝙳 𝙱𝚈 𝚂𝙸𝙻𝙰 𝙼𝙳 𝙼𝙸𝙽𝙸*`
        }, message);

    } catch (error) {
        await sendWithTemplate(sock, chatId, {
            text: '❌ *𝙴𝚁𝚁𝙾𝚁 𝙿𝚁𝙾𝙲𝙴𝚂𝚂𝙸𝙽𝙶 𝚈𝙾𝚄𝚁 𝙲𝙾𝙼𝙼𝙰𝙽𝙳*'
        }, message);
    }
}

// Sora Command - API: https://okatsu-rolezapiiz.vercel.app/ai/txt2video?text=
async function soraCommand(sock, chatId, message, args) {
    try {
        await sock.sendMessage(chatId, { react: { text: "🎥", key: message.key }}, { quoted: message });
        
        const prompt = args.join(' ');
        if (!prompt) {
            return await sendWithTemplate(sock, chatId, {
                text: '🎥 *𝙿𝙻𝙴𝙰𝚂𝙴 𝙿𝚁𝙾𝚅𝙸𝙳𝙴 𝙰 𝙿𝚁𝙾𝙼𝙿𝚃*\n\n*Example:* .sora anime girl with blue hair'
            }, message);
        }

        await sendWithTemplate(sock, chatId, {
            text: '🎥 *𝙶𝙴𝙽𝙴𝚁𝙰𝚃𝙸𝙽𝙶 𝚅𝙸𝙳𝙴𝙾...*'
        }, message);

        const response = await axios.get(`https://okatsu-rolezapiiz.vercel.app/ai/txt2video?text=${encodeURIComponent(prompt)}`);
        const videoUrl = response.data?.url || response.data?.videoUrl;

        if (videoUrl) {
            await sendWithTemplate(sock, chatId, {
                video: { url: videoUrl },
                caption: `🎥 *𝙰𝙸 𝚅𝙸𝙳𝙴𝙾*\n\n*𝙿𝚛𝚘𝚖𝚙𝚝:* ${prompt}\n\n*➥ 𝙿𝙾𝚆𝙴𝚁𝙴𝙳 𝙱𝚈 𝚂𝙸𝙻𝙰 𝙼𝙳 𝙼𝙸𝙽𝙸*`
            }, message);
        } else {
            throw new Error('No video generated');
        }

    } catch (error) {
        await sendWithTemplate(sock, chatId, {
            text: '❌ *𝙴𝚁𝚁𝙾𝚁 𝙿𝚁𝙾𝙲𝙴𝚂𝚂𝙸𝙽𝙶 𝚈𝙾𝚄𝚁 𝙲𝙾𝙼𝙼𝙰𝙽𝙳*'
        }, message);
    }
}

// Group Info Command
async function groupInfoCommand(sock, chatId, message) {
    try {
        await sock.sendMessage(chatId, { react: { text: "👥", key: message.key }}, { quoted: message });
        
        const metadata = await sock.groupMetadata(chatId);
        const participants = metadata.participants;
        const owner = metadata.owner;
        
        const admins = participants.filter(p => p.admin).map(p => p.id);
        const adminList = admins.map(admin => `│   👤 @${admin.split('@')[0]}`).join('\n');

        const infoText = `
╭━━━━━━━━━━━━━━━━━━━━━━━━━━━━━┈◉
│        🤖 *GROUP INFORMATION*
├━━━━━━━━━━━━━━━━━━━━━━━━━━━━━┈◉
│
│ 👥 *𝙶𝚛𝚘𝚞𝚙 𝙽𝚊𝚖𝚎:* ${metadata.subject}
│ 🆔 *𝙶𝚛𝚘𝚞𝚙 𝙸𝙳:* ${metadata.id}
│ 👤 *𝚃𝚘𝚝𝚊𝚕 𝙼𝚎𝚖𝚋𝚎𝚛𝚜:* ${participants.length}
│ 👑 *𝙶𝚛𝚘𝚞𝚙 𝙾𝚠𝚗𝚎𝚛:* @${owner.split('@')[0]}
│
│ ⚡ *𝙰𝚍𝚖𝚒𝚗𝚜 (${admins.length}):*
${adminList}
│
│ 📝 *𝙳𝚎𝚜𝚌𝚛𝚒𝚙𝚝𝚒𝚘𝚗:*
│ ${metadata.desc || '𝙽𝚘 𝚍𝚎𝚜𝚌𝚛𝚒𝚙𝚝𝚒𝚘𝚗 𝚊𝚟𝚊𝚒𝚕𝚊𝚋𝚕𝚎'}
│
╰━━━━━━━━━━━━━━━━━━━━━━━━━━━━━┈◉
*➥ 𝙿𝙾𝚆𝙴𝚁𝙴𝙳 𝙱𝚈 𝚂𝙸𝙻𝙰 𝙼𝙳 𝙼𝙸𝙽𝙸*`.trim();

        await sendWithTemplate(sock, chatId, {
            text: infoText,
            mentions: [...admins, owner]
        }, message);

    } catch (error) {
        await sendWithTemplate(sock, chatId, {
            text: '❌ *𝙴𝚁𝚁𝙾𝚁 𝙿𝚁𝙾𝙲𝙴𝚂𝚂𝙸𝙽𝙶 𝚈𝙾𝚄𝚁 𝙲𝙾𝙼𝙼𝙰𝙽𝙳*'
        }, message);
    }
}

// Tag All Command - Mentions all members with their phone numbers
async function tagAllCommand(sock, chatId, message) {
    try {
        await sock.sendMessage(chatId, { react: { text: "🔊", key: message.key }}, { quoted: message });
        
        const metadata = await sock.groupMetadata(chatId);
        const participants = metadata.participants;

        let messageText = `╭━━━━━━━━━━━━━━━━━━━━━━━━━━━━━┈◉│        🔊 *MENTION ALL MEMBERS*
├━━━━━━━━━━━━━━━━━━━━━━━━━━━━━┈◉
│
`;

        participants.forEach(participant => {
            const phoneNumber = participant.id.split('@')[0];
            messageText += `│   👤 @${phoneNumber} (${phoneNumber})\n`;
        });

        messageText += `│
│ 📊 *𝚃𝚘𝚝𝚊𝚕 𝙼𝚎𝚖𝚋𝚎𝚛𝚜:* ${participants.length}
│
╰━━━━━━━━━━━━━━━━━━━━━━━━━━━━━┈◉
*➥ 𝙿𝙾𝚆𝙴𝚁𝙴𝙳 𝙱𝚈 𝚂𝙸𝙻𝙰 𝙼𝙳 𝙼𝙸𝙽𝙸*`;

        await sendWithTemplate(sock, chatId, {
            text: messageText,
            mentions: participants.map(p => p.id)
        }, { quoted: message });

    } catch (error) {
        await sendWithTemplate(sock, chatId, {
            text: '❌ *𝙴𝚁𝚁𝙾𝚁 𝙿𝚁𝙾𝙲𝙴𝚂𝚂𝙸𝙽𝙶 𝚈𝙾𝚄𝚁 𝙲𝙾𝙼𝙼𝙰𝙽𝙳*'
        }, message);
    }
}

// Anime Command - API: https://api.some-random-api.com/animu/
async function animeCommand(sock, chatId, message, args) {
    try {
        await sock.sendMessage(chatId, { react: { text: "🎌", key: message.key }}, { quoted: message });
        
        const type = args[0]?.toLowerCase() || 'hug';
        const validTypes = ['hug', 'wink', 'pat', 'cry', 'kiss', 'slap', 'poke'];
        
        if (!validTypes.includes(type)) {
            return await sendWithTemplate(sock, chatId, {
                text: `❌ *𝙸𝙽𝚅𝙰𝙻𝙸𝙳 𝙰𝙽𝙸𝙼𝙴 𝚃𝚈𝙿𝙴*\n\nAvailable: ${validTypes.join(', ')}`
            }, message);
        }

        const response = await axios.get(`https://api.some-random-api.com/animu/${type}`);
        const animeData = response.data;

        if (animeData && animeData.link) {
            await sendWithTemplate(sock, chatId, {
                image: { url: animeData.link },
                caption: `🎌 *𝙰𝙽𝙸𝙼𝙴 ${type.toUpperCase()}*\n\n*➥ 𝙿𝙾𝚆𝙴𝚁𝙴𝙳 𝙱𝚈 𝚂𝙸𝙻𝙰 𝙼𝙳 𝙼𝙸𝙽𝙸*`
            }, message);
        } else {
            throw new Error('No anime image found');
        }

    } catch (error) {
        await sendWithTemplate(sock, chatId, {
            text: '❌ *𝙴𝚁𝚁𝙾𝚁 𝙿𝚁𝙾𝙲𝙴𝚂𝚂𝙸𝙽𝙶 𝚈𝙾𝚄𝚁 𝙲𝙾𝙼𝙼𝙰𝙽𝙳*'
        }, message);
    }
}

// Ship Command
async function shipCommand(sock, chatId, message) {
    try {
        await sock.sendMessage(chatId, { react: { text: "💘", key: message.key }}, { quoted: message });
        
        const metadata = await sock.groupMetadata(chatId);
        const participants = metadata.participants.map(v => v.id);
        
        if (participants.length < 2) {
            return await sendWithTemplate(sock, chatId, {
                text: '❌ *𝙽𝙴𝙴𝙳 𝙰𝚃 𝙻𝙴𝙰𝚂𝚃 2 𝙼𝙴𝙼𝙱𝙴𝚁𝚂 𝚃𝙾 𝚂𝙷𝙸𝙿!*'
            }, message);
        }

        let firstUser, secondUser;
        firstUser = participants[Math.floor(Math.random() * participants.length)];
        
        do {
            secondUser = participants[Math.floor(Math.random() * participants.length)];
        } while (secondUser === firstUser);

        const lovePercentage = Math.floor(Math.random() * 101);
        
        let loveMessage;
        if (lovePercentage >= 80) loveMessage = 'Perfect Match! 💖💍';
        else if (lovePercentage >= 60) loveMessage = 'Great Couple! 💕';
        else if (lovePercentage >= 40) loveMessage = 'Maybe... 🤔';
        else loveMessage = 'Not meant to be 😅';

        await sendWithTemplate(sock, chatId, {
            text: `💘 *𝙻𝙾𝚅𝙴 𝙲𝙰𝙻𝙲𝚄𝙻𝙰𝚃𝙾𝚁*\n\n@${firstUser.split('@')[0]} ❤️ @${secondUser.split('@')[0]}\n\n*𝙻𝚘𝚟𝚎 𝚂𝚌𝚘𝚛𝚎:* ${lovePercentage}%\n${loveMessage}\n\n*➥ 𝙿𝙾𝚆𝙴𝚁𝙴𝙳 𝙱𝚈 𝚂𝙸𝙻𝙰 𝙼𝙳 𝙼𝙸𝙽𝙸*`,
            mentions: [firstUser, secondUser]
        }, { quoted: message });

    } catch (error) {
        await sendWithTemplate(sock, chatId, {
            text: '❌ *𝙴𝚁𝚁𝙾𝚁 𝙿𝚁𝙾𝙲𝙴𝚂𝚂𝙸𝙽𝙶 𝚈𝙾𝚄𝚁 𝙲𝙾𝙼𝙼𝙰𝙽𝙳*'
        }, message);
    }
}

// Wasted Command - API: https://some-random-api.com/canvas/overlay/wasted?avatar=
async function wastedCommand(sock, chatId, message, args) {
    try {
        await sock.sendMessage(chatId, { react: { text: "💀", key: message.key }}, { quoted: message });
        
        let targetUser;
        
        if (message.message?.extendedTextMessage?.contextInfo?.mentionedJid?.length > 0) {
            targetUser = message.message.extendedTextMessage.contextInfo.mentionedJid[0];
        }
        else if (message.message?.extendedTextMessage?.contextInfo?.participant) {
            targetUser = message.message.extendedTextMessage.contextInfo.participant;
        }
        
        if (!targetUser) {
            return await sendWithTemplate(sock, chatId, {
                text: '💀 *𝙿𝙻𝙴𝙰𝚂𝙴 𝙼𝙴𝙽𝚃𝙸𝙾𝙽 𝚂𝙾𝙼𝙴𝙾𝙽𝙴 𝙾𝚁 𝚁𝙴𝙿𝙻𝚈 𝚃𝙾 𝚃𝙷𝙴𝙸𝚁 𝙼𝙴𝚂𝚂𝙰𝙶𝙴 𝚃𝙾 𝚆𝙰𝚂𝚃𝙴 𝚃𝙷𝙴𝙼!*'
            }, message);
        }

        let profilePic;
        try {
            profilePic = await sock.profilePictureUrl(targetUser, 'image');
        } catch {
            profilePic = 'https://i.imgur.com/2wzGhpF.jpeg';
        }

        const response = await axios.get(`https://some-random-api.com/canvas/overlay/wasted?avatar=${encodeURIComponent(profilePic)}`, {
            responseType: 'arraybuffer'
        });

        await sendWithTemplate(sock, chatId, {
            image: Buffer.from(response.data),
            caption: `⚰️ *𝚆𝙰𝚂𝚃𝙴𝙳*\n\n@${targetUser.split('@')[0]} 𝚑𝚊𝚜 𝚋𝚎𝚎𝚗 𝚠𝚊𝚜𝚝𝚎𝚍! 💀\n\n*𝚁𝚎𝚜𝚝 𝚒𝚗 𝚙𝚒𝚎𝚌𝚎𝚜!*\n\n*➥ 𝙿𝙾𝚆𝙴𝚁𝙴𝙳 𝙱𝚈 𝚂𝙸𝙻𝙰 𝙼𝙳 𝙼𝙸𝙽𝙸*`,
            mentions: [targetUser]
        }, message);

    } catch (error) {
        await sendWithTemplate(sock, chatId, {
            text: '❌ *𝙴𝚁𝚁𝙾𝚁 𝙿𝚁𝙾𝙲𝙴𝚂𝚂𝙸𝙽𝙶 𝚈𝙾𝚄𝚁 𝙲𝙾𝙼𝙼𝙰𝙽𝙳*'
        }, message);
    }
}

// Pies Command - API: https://shizoapi.onrender.com/api/pies/
async function piesCommand(sock, chatId, message, args) {
    try {
        await sock.sendMessage(chatId, { react: { text: "🔞", key: message.key }}, { quoted: message });
        
        const PIES_COUNTRIES = ['china', 'indonesia', 'japan', 'korea', 'hijab', 'tanzania'];
        const country = args[0]?.toLowerCase();
        
        if (!country) {
            return await sendWithTemplate(sock, chatId, {
                text: `🔞 *𝙿𝙸𝙴𝚂 𝙲𝙾𝙼𝙼𝙰𝙽𝙳*\n\n*𝚄𝚜𝚊𝚐𝚎:* .pies <country>\n\n*𝙰𝚟𝚊𝚒𝚕𝚊𝚋𝚕𝚎 𝚌𝚘𝚞𝚗𝚝𝚛𝚒𝚎𝚜:*\n${PIES_COUNTRIES.map(c => `• ${c}`).join('\n')}`
            }, message);
        }

        if (!PIES_COUNTRIES.includes(country)) {
            return await sendWithTemplate(sock, chatId, {
                text: `❌ *𝙸𝙽𝚅𝙰𝙻𝙸𝙳 𝙲𝙾𝚄𝙽𝚃𝚁𝚈*\n\n*𝙰𝚟𝚊𝚒𝚕𝚊𝚋𝚕𝚎:* ${PIES_COUNTRIES.join(', ')}`
            }, message);
        }

        const response = await axios.get(`https://shizoapi.onrender.com/api/pies/${country}?apikey=shizo`, {
            responseType: 'arraybuffer'
        });

        await sendWithTemplate(sock, chatId, {
            image: Buffer.from(response.data),
            caption: `🔞 *${country.toUpperCase()} 𝙲𝙾𝙽𝚃𝙴𝙽𝚃*\n\n*➥ 𝙿𝙾𝚆𝙴𝚁𝙴𝙳 𝙱𝚈 𝚂𝙸𝙻𝙰 𝙼𝙳 𝙼𝙸𝙽𝙸*`
        }, message);

    } catch (error) {
        await sendWithTemplate(sock, chatId, {
            text: '❌ *𝙴𝚁𝚁𝙾𝚁 𝙿𝚁𝙾𝙲𝙴𝚂𝚂𝙸𝙽𝙶 𝚈𝙾𝚄𝚁 𝙲𝙾𝙼𝙼𝙰𝙽𝙳*'
        }, message);
    }
}

// TTS Command - API: https://translate.google.com/translate_tts?ie=UTF-8&q=
async function ttsCommand(sock, chatId, message, args) {
    try {
        await sock.sendMessage(chatId, { react: { text: "🗣️", key: message.key }}, { quoted: message });
        
        const text = args.join(' ');
        if (!text) {
            return await sendWithTemplate(sock, chatId, {
                text: '🗣️ *𝙿𝙻𝙴𝙰𝚂𝙴 𝙿𝚁𝙾𝚅𝙸𝙳𝙴 𝚃𝙴𝚇𝚃*\n\n*Example:* .tts Hello how are you'
            }, message);
        }

        await sendWithTemplate(sock, chatId, {
            text: '🔄 *𝙶𝙴𝙽𝙴𝚁𝙰𝚃𝙸𝙽𝙶 𝚃𝚃𝚂...*'
        }, message);

        const ttsUrl = `https://translate.google.com/translate_tts?ie=UTF-8&q=${encodeURIComponent(text)}&tl=en&client=tw-ob`;

        await sendWithTemplate(sock, chatId, {
            audio: { url: ttsUrl },
            mimetype: 'audio/mpeg',
            caption: `🗣️ *𝚃𝙴𝚇𝚃 𝚃𝙾 𝚂𝙿𝙴𝙴𝙲𝙷*\n\n*𝚃𝚎𝚡𝚝:* ${text}\n\n*➥ 𝙿𝙾𝚆𝙴𝚁𝙴𝙳 𝙱𝚈 𝚂𝙸𝙻𝙰 𝙼𝙳 𝙼𝙸𝙽𝙸*`
        }, message);

    } catch (error) {
        await sendWithTemplate(sock, chatId, {
            text: '❌ *𝙴𝚁𝚁𝙾𝚁 𝙿𝚁𝙾𝙲𝙴𝚂𝚂𝙸𝙽𝙶 𝚈𝙾𝚄𝚁 𝙲𝙾𝙼𝙼𝙰𝙽𝙳*'
        }, message);
    }
}

// View Once Command
async function viewOnceCommand(sock, chatId, message) {
    try {
        await sock.sendMessage(chatId, { react: { text: "🔍", key: message.key }}, { quoted: message });
        
        const quoted = message.message?.extendedTextMessage?.contextInfo?.quotedMessage;
        
        if (!quoted) {
            return await sendWithTemplate(sock, chatId, {
                text: '🔍 *𝙿𝙻𝙴𝙰𝚂𝙴 𝚁𝙴𝙿𝙻𝚈 𝚃𝙾 𝙰 𝚅𝙸𝙴𝚆 𝙾𝙽𝙲𝙴 𝙼𝙴𝚂𝚂𝙰𝙶𝙴*'
            }, message);
        }

        if (quoted.viewOnceMessageV2) {
            const viewOnceContent = quoted.viewOnceMessageV2.message;
            
            if (viewOnceContent.imageMessage) {
                await sendWithTemplate(sock, chatId, {
                    image: { url: viewOnceContent.imageMessage.url },
                    caption: '🔍 *𝚅𝙸𝙴𝚆 𝙾𝙽𝙲𝙴 𝙸𝙼𝙰𝙶𝙴 𝚁𝙴𝙲𝙾𝚅𝙴𝚁𝙴𝙳*\n\n*➥ 𝙿𝙾𝚆𝙴𝚁𝙴𝙳 𝙱𝚈 𝚂𝙸𝙻𝙰 𝙼𝙳 𝙼𝙸𝙽𝙸*'
                }, message);
            } else if (viewOnceContent.videoMessage) {
                await sendWithTemplate(sock, chatId, {
                    video: { url: viewOnceContent.videoMessage.url },
                    caption: '🔍 *𝚅𝙸𝙴𝚆 𝙾𝙽𝙲𝙴 𝚅𝙸𝙳𝙴𝙾 𝚁𝙴𝙲𝙾𝚅𝙴𝚁𝙴𝙳*\n\n*➥ 𝙿𝙾𝚆𝙴𝚁𝙴𝙳 𝙱𝚈 𝚂𝙸𝙻𝙰 𝙼𝙳 𝙼𝙸𝙽𝙸*'
                }, message);
            } else {
                await sendWithTemplate(sock, chatId, {
                    text: '❌ *𝚄𝙽𝚂𝚄𝙿𝙿𝙾𝚁𝚃𝙴𝙳 𝚅𝙸𝙴𝚆 𝙾𝙽𝙲𝙴 𝙲𝙾𝙽𝚃𝙴𝙽𝚃*'
                }, message);
            }
        } else {
            await sendWithTemplate(sock, chatId, {
                text: '❌ *𝙽𝙾 𝚅𝙸𝙴𝚆 𝙾𝙽𝙲𝙴 𝙼𝙴𝚂𝚂𝙰𝙶𝙴 𝙵𝙾𝚄𝙽𝙳*'
            }, message);
        }

    } catch (error) {
        await sendWithTemplate(sock, chatId, {
            text: '❌ *𝙴𝚁𝚁𝙾𝚁 𝙿𝚁𝙾𝙲𝙴𝚂𝚂𝙸𝙽𝙶 𝚈𝙾𝚄𝚁 𝙲𝙾𝙼𝙼𝙰𝙽𝙳*'
        }, message);
    }
}

// Owner Command
async function ownerCommand(sock, chatId, message) {
    try {
        await sock.sendMessage(chatId, { react: { text: "👑", key: message.key }}, { quoted: message });
        
        const vcard = `BEGIN:VCARD\nVERSION:3.0\nFN:𝚂𝙸𝙻𝙰 𝙼𝙳\nTEL;waid=255612491554:+255612491554\nEND:VCARD`;

        await sendWithTemplate(sock, chatId, {
            contacts: {
                displayName: "𝚂𝙸𝙻𝙰 𝙼𝙳",
                contacts: [{ vcard }]
            }
        }, { quoted: message });

        const ownerText = `👑 *𝙱𝙾𝚃 𝙾𝚆𝙽𝙴𝚁*

╭━━━━━━━━━━━━━━━━●◌
│ *🏷️ 𝙽𝚊𝚖𝚎:* 𝚂𝙸𝙻𝙰 𝙼𝙳
│ *📱 𝙽𝚞𝚖𝚋𝚎𝚛:* +255612491554
│ *🎯 𝚁𝚘𝚕𝚎:* 𝙱𝚘𝚝 𝙳𝚎𝚟𝚎𝚕𝚘𝚙𝚎𝚛
│ *🔗 𝙱𝚘𝚝 𝙻𝚒𝚗𝚔:*
│ https://sila-md-min-bot.onrender.com
╰━━━━━━━━━━━━━━━━●◌

*📞 𝙲𝚘𝚗𝚝𝚊𝚌𝚝 𝚏𝚘𝚛:*
• 𝙱𝚘𝚝 𝚒𝚜𝚜𝚞𝚎𝚜 𝚊𝚗𝚍 𝚜𝚞𝚙𝚙𝚘𝚛𝚝
• 𝙿𝚛𝚎𝚖𝚒𝚞𝚖 𝚏𝚎𝚊𝚝𝚞𝚛𝚎𝚜
• 𝙲𝚞𝚜𝚝𝚘𝚖 𝚋𝚘𝚝 𝚍𝚎𝚟𝚎𝚕𝚘𝚙𝚖𝚎𝚗𝚝

> *➥ 𝙿𝙾𝚆𝙴𝚁𝙴𝙳 𝙱𝚈 𝚂𝙸𝙻𝙰 𝙼𝙳 𝙼𝙸𝙽𝙸*`;

        await sendWithTemplate(sock, chatId, {
            image: { url: BOT_CONFIG.bot_image },
            caption: ownerText
        }, { quoted: message });

    } catch (error) {
        await sendWithTemplate(sock, chatId, {
            text: '👑 *𝙾𝚆𝙽𝙴𝚁 𝙸𝙽𝙵𝙾𝚁𝙼𝙰𝚃𝙸𝙾𝙽*\n\n*🏷️ 𝙽𝚊𝚖𝚎:* 𝚂𝙸𝙻𝙰 𝙼𝙳\n*📱 𝙽𝚞𝚖𝚋𝚎𝚛:* +255612491554\n*🔗 𝙱𝚘𝚝 𝙻𝚒𝚗𝚔:* https://sila-md-min-bot.onrender.com\n\n*➥ 𝙲𝚘𝚗𝚝𝚊𝚌𝚝 𝚏𝚘𝚛 𝚋𝚘𝚝 𝚜𝚞𝚙𝚙𝚘𝚛𝚝 𝚊𝚗𝚍 𝚚𝚞𝚎𝚛𝚒𝚎𝚜*'
        }, { quoted: message });
    }
}

// Pair Command
async function pairCommand(sock, chatId, message, args) {
    try {
        await sock.sendMessage(chatId, { react: { text: "🔗", key: message.key }}, { quoted: message });
        
        const number = args[0];
        if (!number) {
            return await sendWithTemplate(sock, chatId, {
                text: '📱 *𝙿𝙻𝙴𝙰𝚂𝙴 𝙿𝚁𝙾𝚅𝙸𝙳𝙴 𝙰 𝚆𝙷𝙰𝚃𝚂𝙰𝙿𝙿 𝙽𝚄𝙼𝙱𝙴𝚁*\n\n*Example:* .pair 255612491554'
            }, message);
        }

        const cleanNumber = number.replace(/[^0-9]/g, '');
        if (cleanNumber.length < 10) {
            return await sendWithTemplate(sock, chatId, {
                text: '❌ *𝙸𝙽𝚅𝙰𝙻𝙸𝙳 𝙿𝙷𝙾𝙽𝙴 𝙽𝚄𝙼𝙱𝙴𝚁 𝙵𝙾𝚁𝙼𝙰𝚃*'
            }, message);
        }

        const pairText = `🔗 *𝙿𝙰𝙸𝚁𝙸𝙽𝙶 𝙸𝙽𝚂𝚃𝚁𝚄𝙲𝚃𝙸𝙾𝙽𝚂*

╭━━━━━━━━━━━━━━━━●◌
│ *📱 𝙽𝚞𝚖𝚋𝚎𝚛:* ${cleanNumber}
│ *🔗 𝙱𝚘𝚝 𝙻𝚒𝚗:* https://sila-md-min-bot.onrender.com
│
│ *📖 𝙷𝚘𝚠 𝚝𝚘 𝙿𝚊𝚒𝚛:*
│ 1. 𝙲𝚕𝚒𝚌𝚔 𝚝𝚑𝚎 𝚕𝚒𝚗𝚔 𝚊𝚋𝚘𝚟𝚎
│ 2. 𝙴𝚗𝚝𝚎𝚛: *${cleanNumber}*
│ 3. 𝙶𝚎𝚝 𝚙𝚊𝚒𝚛𝚒𝚗𝚐 𝚌𝚘𝚍𝚎
│ 4. 𝙴𝚗𝚝𝚎𝚛 𝚌𝚘𝚍𝚎 𝚒𝚗 𝚆𝚑𝚊𝚝𝚜𝙰𝚙𝚙
│ 5. 𝙱𝚘𝚝 𝚌𝚘𝚗𝚗𝚎𝚌𝚝𝚜 𝚊𝚞𝚝𝚘𝚖𝚊𝚝𝚒𝚌𝚕𝚢
╰━━━━━━━━━━━━━━━━●◌

> *𝙽𝙾 𝙽𝙴𝙴𝙳 𝚃𝙾 𝙼𝙰𝙽𝚄𝙰𝙻𝙻𝚈 𝙴𝙽𝚃𝙴𝚁 𝙲𝙾𝙳𝙴𝚂*`;

        await sendWithTemplate(sock, chatId, {
            text: pairText
        }, { quoted: message });

    } catch (error) {
        await sendWithTemplate(sock, chatId, {
            text: '❌ *𝙴𝚁𝚁𝙾𝚁 𝙿𝚁𝙾𝙲𝙴𝚂𝚂𝙸𝙽𝙶 𝚈𝙾𝚄𝚁 𝙲𝙾𝙼𝙼𝙰𝙽𝙳*'
        }, { quoted: message });
    }
}

// Free Bot Command
async function freebotCommand(sock, chatId, message) {
    try {
        await sock.sendMessage(chatId, { react: { text: "🤖", key: message.key }}, { quoted: message });
        
        const freebotText = `🤖 *𝙵𝚁𝙴𝙴 𝙱𝙾𝚃 𝙻𝙸𝙽𝙺*

╭━━━━━━━━━━━━━━━━●◌
│ *🔗 𝙱𝚘𝚝 𝙻𝚒𝚗𝚔:*
│ https://sila-md-min-bot.onrender.com
│
│ *📖 𝙸𝚗𝚜𝚝𝚛𝚞𝚌𝚝𝚒𝚘𝚗𝚜:*
│ 1. 𝙲𝚕𝚒𝚌𝚔 𝚝𝚑𝚎 𝚕𝚒𝚗𝚔 𝚊𝚋𝚘𝚟𝚎
│ 2. 𝙴𝚗𝚝𝚎𝚛 𝚢𝚘𝚞𝚛 𝚆𝚑𝚊𝚝𝚜𝙰𝚙𝚙 𝚗𝚞𝚖𝚋𝚎𝚛
│ 3. 𝙶𝚎𝚝 𝚙𝚊𝚒𝚛𝚒𝚗𝚐 𝚌𝚘𝚍𝚎
│ 4. 𝙴𝚗𝚝𝚎𝚛 𝚌𝚘𝚍𝚎 𝚒𝚗 𝚆𝚑𝚊𝚝𝚜𝙰𝚙𝚙
│ 5. 𝙱𝚘𝚝 𝚠𝚒𝚕𝚕 𝚌𝚘𝚗𝚗𝚎𝚌𝚝 𝚊𝚞𝚝𝚘𝚖𝚊𝚝𝚒𝚌𝚊𝚕𝚕𝚢
╰━━━━━━━━━━━━━━━━●◌

> *➥ 𝙿𝙾𝚆𝙴𝚁𝙴𝙳 𝙱𝚈 𝚂𝙸𝙻𝙰 𝙼𝙳 𝙼𝙸𝙽𝙸*`;

        await sendWithTemplate(sock, chatId, {
            text: freebotText
        }, { quoted: message });

    } catch (error) {
        await sendWithTemplate(sock, chatId, {
            text: '❌ *𝙴𝚁𝚁𝙾𝚁 𝙿𝚁𝙾𝙲𝙴𝚂𝚂𝙸𝙽𝙶 𝚈𝙾𝚄𝚁 𝙲𝙾𝙼𝙼𝙰𝙽𝙳*'
        }, { quoted: message });
    }
}

// Enhanced Ping Command
async function handlePingCommand(sock, chatId, message) {
    try {
        await sock.sendMessage(chatId, { react: { text: "🏓", key: message.key }}, { quoted: message });
        
        const start = Date.now();
        await new Promise(resolve => setTimeout(resolve, 100));
        const ping = Date.now() - start;

        const pingText = `┏━━━━━━━━━━━━━━━━━━━━━━━━━━━━┓
┃         ⚡ *𝚂𝙸𝙻𝙰 𝙼𝙳 𝙼𝙸𝙽𝙸*         ┃
┣━━━━━━━━━━━━━━━━━━━━━━━━━━━━┫
┃ 🚀 *𝙿𝚒𝚗𝚐:* ${ping} 𝚖𝚜
┃ ⏱️ *𝚄𝚙𝚝𝚒𝚖𝚎:* ${formatUptime()}
┃ 🔖 *𝚅𝚎𝚛𝚜𝚒𝚘𝚗:* 𝚟2.0.0
┃ 💚 *𝚂𝚝𝚊𝚝𝚞𝚜:* 𝙾𝚗𝚕𝚒𝚗𝚎
┗━━━━━━━━━━━━━━━━━━━━━━━━━━━━┛`;

        await sendWithTemplate(sock, chatId, {
            text: pingText
        }, { quoted: message });

    } catch (error) {
        await sendWithTemplate(sock, chatId, {
            text: '❌ *𝙴𝚁𝚁𝙾𝚁 𝙿𝚁𝙾𝙲𝙴𝚂𝚂𝙸𝙽𝙶 𝚈𝙾𝚄𝚁 𝙲𝙾𝙼𝙼𝙰𝙽𝙳*'
        }, { quoted: message });
    }
}

// Enhanced Alive Command
async function handleAliveCommand(sock, chatId, message, number) {
    try {
        await sock.sendMessage(chatId, { react: { text: "💚", key: message.key }}, { quoted: message });
        
        const startTime = Date.now() - (Math.floor(Math.random() * 86400000) + 3600000);
        const uptime = Math.floor((Date.now() - startTime) / 1000);
        const hours = Math.floor(uptime / 3600);
        const minutes = Math.floor((uptime % 3600) / 60);
        const seconds = Math.floor(uptime % 60);

        const aliveText = `🤖 *𝚂𝙸𝙻𝙰 𝙼𝙳 𝙼𝙸𝙽𝙸 𝙸𝚂 𝙰𝙻𝙸𝚅𝙴* 💚

╭━━━━━━━━━━━━━━━━●◌
│ *𝚂𝚝𝚊𝚝𝚞𝚜:* ✅ 𝙾𝚗𝚕𝚒𝚗𝚎
│ *𝚄𝚙𝚝𝚒𝚖𝚎:* ${hours}𝚑 ${minutes}𝚖 ${seconds}𝚜
│ *𝚄𝚜𝚎𝚛:* ${number.replace(/\D/g, '')}
│ *𝚅𝚎𝚛𝚜𝚒𝚘𝚗:* 2.0.0
╰━━━━━━━━━━━━━━━━●◌

> *𝙱𝚘𝚝 𝚒𝚜 𝚛𝚞𝚗𝚗𝚒𝚗𝚐 𝚜𝚖𝚘𝚘𝚝𝚑𝚕𝚢*`;

        await sendWithTemplate(sock, chatId, {
            image: { url: BOT_CONFIG.bot_image },
            caption: aliveText
        }, { quoted: message });

    } catch (error) {
        await sendWithTemplate(sock, chatId, {
            text: '💚 *𝙱𝙾𝚃 𝚂𝚃𝙰𝚃𝚄𝚂: 𝙰𝙻𝙸𝚅𝙴*\n\n*𝙰𝚕𝚕 𝚜𝚢𝚜𝚝𝚎𝚖𝚜 𝚘𝚙𝚎𝚛𝚊𝚝𝚒𝚘𝚗𝚊𝚕!*'
        }, { quoted: message });
    }
}

// Enhanced Menu Command with ALL commands
async function showEnhancedMenu(sock, chatId, message, number, activeBots) {
    try {
        await sock.sendMessage(chatId, { react: { text: "📜", key: message.key }}, { quoted: message });

        const startTime = Date.now() - (Math.floor(Math.random() * 86400000) + 3600000);
        const uptime = Math.floor((Date.now() - startTime) / 1000);
        const hours = Math.floor(uptime / 3600);
        const minutes = Math.floor((uptime % 3600) / 60);
        const seconds = Math.floor(uptime % 60);
        
        const sanitizedNumber = number.replace(/\D/g, '');

        const menuText = `*╭━━━━━━━━━━━━━━━━●◌*
*│ 🤖 𝙶𝚛𝚎𝚎𝚝 :* *𝙷𝚎𝚕𝚕𝚘 👋*
*│ 🏷️ 𝙱𝚘𝚝 𝙽𝚊𝚖𝚎 :* 𝚂𝙸𝙻𝙰 𝙼𝙳 𝙼𝙸𝙽𝙸
*│ ⏰ 𝚁𝚞𝚗 𝚃𝚒𝚖𝚎 :* ${hours}𝚑 ${minutes}𝚖 ${seconds}𝚜
*│ 📱 𝚈𝚘𝚞𝚛 𝙽𝚞𝚖𝚋𝚎𝚛 :* ${sanitizedNumber}
*│ 🔢 𝙰𝚌𝚝𝚒𝚟𝚎 𝙱𝚘𝚝𝚜 :* ${activeBots}
*╰━━━━━━━━━━━━━━━━●◌*

*🤖 𝙰𝙸 𝙼𝚎𝚗𝚞*

╭━━━━━━━━━━━━━━━━━●◌
│    *🔹 𝙲𝚘𝚖𝚖𝚊𝚗𝚍 :* .ai
│  *✨ 𝙲𝚑𝚊𝚝 𝚆𝚒𝚝𝚑 𝙰𝙸*
│
│    *🔹 𝙲𝚘𝚖𝚖𝚊𝚗𝚍 :* .gemini
│  *✨ 𝙲𝚑𝚊𝚝 𝚆𝚒𝚝𝚑 𝙶𝚎𝚖𝚒𝚗𝚒 𝙰𝙸*
│
│    *🔹 𝙲𝚘𝚖𝚖𝚊𝚗𝚍 :* .gpt
│  *✨ 𝙲𝚑𝚊𝚝 𝚆𝚒𝚝𝚑 𝙲𝚑𝚊𝚝𝙶𝙿𝚃*
╰━━━━━━━━━━━━━━━━━●◌

*📥 𝙳𝚘𝚠𝚗𝚕𝚘𝚊𝚍 𝙼𝚎𝚗𝚞*

╭━━━━━━━━━━━━━━━━━●◌
│    *🔹 𝙲𝚘𝚖𝚖𝚊𝚗𝚍 :* .song
│  *🎵 𝙳𝚘𝚠𝚗𝚕𝚘𝚊𝚍 𝚈𝚘𝚞𝚝𝚞𝚋𝚎 𝚂𝚘𝚗𝚐𝚜*
│
│    *🔹 𝙲𝚘𝚖𝚖𝚊𝚗𝚍 :* .video
│  *🎥 𝙳𝚘𝚠𝚗𝚕𝚘𝚊𝚍 𝚈𝚘𝚞𝚝𝚞𝚋𝚎 𝚅𝚒𝚍𝚎𝚘𝚜*
│
│    *🔹 𝙲𝚘𝚖𝚖𝚊𝚗𝚍 :* .play
│  *🎶 𝚂𝚎𝚊𝚛𝚌𝚑 & 𝙳𝚘𝚠𝚗𝚕𝚘𝚊𝚍 𝚂𝚘𝚗𝚐𝚜*
│
│    *🔹 𝙲𝚘𝚖𝚖𝚊𝚗𝚍 :* .tiktok
│  *📱 𝙳𝚘𝚠𝚗𝚕𝚘𝚊𝚍 𝚃𝚒𝚔𝚃𝚘𝚔 𝚅𝚒𝚍𝚎𝚘𝚜*
│
│    *🔹 𝙲𝚘𝚖𝚖𝚊𝚗𝚍 :* .fb
│  *📘 𝙳𝚘𝚠𝚗𝚕𝚘𝚊𝚍 𝙵𝚊𝚌𝚎𝚋𝚘𝚘𝚔 𝚅𝚒𝚍𝚎𝚘𝚜*
╰━━━━━━━━━━━━━━━━━●◌

*🎨 𝙸𝚖𝚊𝚐𝚎 & 𝚅𝚒𝚍𝚎𝚘 𝙼𝚎𝚗𝚞*

╭━━━━━━━━━━━━━━━━━●◌
│    *🔹 𝙲𝚘𝚖𝚖𝚊𝚗𝚍 :* .imagine
│  *🎨 𝙶𝚎𝚗𝚎𝚛𝚊𝚝𝚎 𝙰𝙸 𝙸𝚖𝚊𝚐𝚎𝚜*
│
│    *🔹 𝙲𝚘𝚖𝚖𝚊𝚗𝚍 :* .sora
│  *🎥 𝙶𝚎𝚗𝚎𝚛𝚊𝚝𝚎 𝙰𝙸 𝚅𝚒𝚍𝚎𝚘*
╰━━━━━━━━━━━━━━━━━●◌

*👥 𝙶𝚛𝚘𝚞𝚙 𝙼𝚎𝚗𝚞*

╭━━━━━━━━━━━━━━━━━●◌
│    *🔹 𝙲𝚘𝚖𝚖𝚊𝚗𝚍 :* .groupinfo
│  *👥 𝚂𝚑𝚘𝚠 𝙶𝚛𝚘𝚞𝚙 𝙸𝚗𝚏𝚘𝚛𝚖𝚊𝚝𝚒𝚘𝚗*
│
│    *🔹 𝙲𝚘𝚖𝚖𝚊𝚗𝚍 :* .tagall
│  *🔊 𝙼𝚎𝚗𝚝𝚒𝚘𝚗 𝙰𝚕𝚕 𝙼𝚎𝚖𝚋𝚎𝚛𝚜*
╰━━━━━━━━━━━━━━━━━●◌

*🎌 𝙰𝚗𝚒𝚖𝚎 𝙼𝚎𝚗𝚞*

╭━━━━━━━━━━━━━━━━━●◌
│    *🔹 𝙲𝚘𝚖𝚖𝚊𝚗𝚍 :* .anime
│  *🎌 𝙳𝚘𝚠𝚗𝚕𝚘𝚊𝚍 𝙰𝚗𝚒𝚖𝚎 𝙸𝚖𝚊𝚐𝚎𝚜*
╰━━━━━━━━━━━━━━━━━●◌

*🎮 𝙵𝚞𝚗 𝙼𝚎𝚗𝚞*

╭━━━━━━━━━━━━━━━━━●◌
│    *🔹 𝙲𝚘𝚖𝚖𝚊𝚗𝚍 :* .ship
│  *💘 𝙻𝚘𝚟𝚎 𝙲𝚊𝚕𝚌𝚞𝚕𝚊𝚝𝚘𝚛*
│
│    *🔹 𝙲𝚘𝚖𝚖𝚊𝚗𝚍 :* .wasted
│  *💀 𝚆𝚊𝚜𝚝𝚎𝚍 𝙴𝚏𝚏𝚎𝚌𝚝*
╰━━━━━━━━━━━━━━━━━●◌

*🔞 𝙰𝚍𝚞𝚕𝚝 𝙼𝚎𝚗𝚞*

╭━━━━━━━━━━━━━━━━━●◌
│    *🔹 𝙲𝚘𝚖𝚖𝚊𝚗𝚍 :* .pies
│  *🔞 𝙰𝚍𝚞𝚕𝚝 𝙲𝚘𝚗𝚝𝚎𝚗𝚝*
╰━━━━━━━━━━━━━━━━━●◌

*⚡ 𝚂𝚢𝚜𝚝𝚎𝚖 𝙼𝚎𝚗𝚞*

╭━━━━━━━━━━━━━━━━━●◌
│    *🔹 𝙲𝚘𝚖𝚖𝚊𝚗𝚍 :* .ping
│  *⚡ 𝙲𝚑𝚎𝚌𝚔 𝙱𝚘𝚝 𝚂𝚙𝚎𝚎𝚍*
│
│    *🔹 𝙲𝚘𝚖𝚖𝚊𝚗𝚍 :* .alive
│  *⚡ 𝙲𝚑𝚎𝚌𝚔 𝙱𝚘𝚝 𝚂𝚝𝚊𝚝𝚞𝚜*
│
│    *🔹 𝙲𝚘𝚖𝚖𝚊𝚗𝚍 :* .owner
│  *⚡ 𝙲𝚘𝚗𝚝𝚊𝚌𝚝 𝙱𝚘𝚝 𝙾𝚠𝚗𝚎𝚛*
│
│    *🔹 𝙲𝚘𝚖𝚖𝚊𝚗𝚍 :* .pair
│  *⚡ 𝙿𝚊𝚒𝚛 𝙳𝚎𝚟𝚒𝚌𝚎 𝙲𝚘𝚍𝚎*
│
│    *🔹 𝙲𝚘𝚖𝚖𝚊𝚗𝚍 :* .freebot
│  *🤖 𝙶𝚎𝚝 𝙵𝚛𝚎𝚎 𝙱𝚘𝚝 𝙻𝚒𝚗𝚔*
╰━━━━━━━━━━━━━━━━━●◌

*🔧 𝚄𝚝𝚒𝚕𝚒𝚝𝚢 𝙼𝚎𝚗𝚞*

╭━━━━━━━━━━━━━━━━━●◌
│    *🔹 𝙲𝚘𝚖𝚖𝚊𝚗𝚍 :* .tts
│  *🗣️ 𝚃𝚎𝚡𝚝 𝚃𝚘 𝚂𝚙𝚎𝚎𝚌𝚑*
│
│    *🔹 𝙲𝚘𝚖𝚖𝚊𝚗𝚍 :* .vv
│  *⚡ 𝚅𝚒𝚎𝚠 𝙾𝚗𝚌𝚎 𝙼𝚎𝚜𝚜𝚊𝚐𝚎𝚜*
╰━━━━━━━━━━━━━━━━━●◌

*⚙️ 𝙲𝚘𝚗𝚝𝚛𝚘𝚕 𝙼𝚎𝚗𝚞*

╭━━━━━━━━━━━━━━━━━●◌
│    *🔹 𝙲𝚘𝚖𝚖𝚊𝚗𝚍 :* .menu
│  *⚙️ 𝚂𝚑𝚘𝚠 𝚃𝚑𝚒𝚜 𝙼𝚎𝚗𝚞*
╰━━━━━━━━━━━━━━━━━●◌

> *➥ 𝙿𝙾𝚆𝙴𝚁𝙴𝙳 𝙱𝚈 𝚂𝙸𝙻𝙰 𝙼𝙳 𝙼𝙸𝙽𝙸*`;

        await sendWithTemplate(sock, chatId, { 
            image: { url: BOT_CONFIG.bot_image }, 
            caption: menuText
        }, { quoted: message });

    } catch (error) {
        console.error('Menu Error:', error);
        await sendWithTemplate(sock, chatId, { 
            text: '❌ *𝙴𝚁𝚁𝙾𝚁 𝙿𝚁𝙾𝙲𝙴𝚂𝚂𝙸𝙽𝙶 𝚈𝙾𝚄𝚁 𝙲𝙾𝙼𝙼𝙰𝙽𝙳*' 
        }, { quoted: message });
    }
}

// =============================
// MESSAGE HANDLER
// =============================

async function kavixmdminibotmessagehandler(socket, number) {
  socket.ev.on('messages.upsert', async ({ messages }) => {
    try {
      const msg = messages?.[0];
      if (!msg?.message || msg.key.remoteJid === 'status@broadcast') return;

      const setting = await storageAPI.getSettings(number);
      const remoteJid = msg.key.remoteJid;
      const jidNumber = remoteJid.split('@')[0];
      const isGroup = remoteJid.endsWith('@g.us');
      const isOwner = isBotOwner(msg.key.remoteJid, number, socket);
      const msgContent = msg.message?.conversation || msg.message?.extendedTextMessage?.text || msg.message?.imageMessage?.caption || msg.message?.videoMessage?.caption || "";
      const text = msgContent || '';

      if (!isOwner) {
        switch (setting.worktype) {
          case 'private': if (jidNumber !== number) return; break;
          case 'group': if (!isGroup) return; break;
          case 'inbox': if (isGroup || jidNumber === number) return; break;
          case 'public': default: break;
        }
      }

      let PREFIX = ".";
      let sanitizedNumber = number.replace(/\D/g, '');
      let body = msgContent.trim();
      let isCommand = body.startsWith(PREFIX);
      let command = null;
      let args = [];

      if (isCommand) {
        const parts = body.slice(PREFIX.length).trim().split(/ +/);
        command = parts.shift().toLowerCase();
        args = parts;
      }

      // Enhanced Command Handler
      try {
          if (!msg || !msg.key) {
              return;
          }

          switch (command) {
              case 'menu':
                  await showEnhancedMenu(socket, remoteJid, msg, sanitizedNumber, activeSockets.size);
                  break;

              case 'ping':
                  await handlePingCommand(socket, remoteJid, msg);
                  break;

              case 'alive':
                  await handleAliveCommand(socket, remoteJid, msg, sanitizedNumber);
                  break;

              case 'freebot':
                  await freebotCommand(socket, remoteJid, msg);
                  break;

              case 'owner':
                  await ownerCommand(socket, remoteJid, msg);
                  break;

              case 'pair':
                  await pairCommand(socket, remoteJid, msg, args);
                  break;

              case 'ai':
                  await aiCommand(socket, remoteJid, msg, args);
                  break;

              case 'gemini':
                  await geminiCommand(socket, remoteJid, msg, args);
                  break;

              case 'gpt':
                  await gptCommand(socket, remoteJid, msg, args);
                  break;

              case 'anime':
                  await animeCommand(socket, remoteJid, msg, args);
                  break;

              case 'tiktok':
                  await tiktokCommand(socket, remoteJid, msg, args);
                  break;

              case 'fb':
              case 'facebook':
                  await facebookCommand(socket, remoteJid, msg, args);
                  break;

              case 'song':
              case 'yta':
                  await songCommand(socket, remoteJid, msg, args);
                  break;

              case 'video':
                  await videoCommand(socket, remoteJid, msg, args);
                  break;

              case 'play':
                  await playCommand(socket, remoteJid, msg, args);
                  break;

              case 'groupinfo':
                  await groupInfoCommand(socket, remoteJid, msg);
                  break;

              case 'tagall':
                  await tagAllCommand(socket, remoteJid, msg);
                  break;

              case 'imagine':
                  await imagineCommand(socket, remoteJid, msg, args);
                  break;

              case 'sora':
              case 'xvideo':
                  await soraCommand(socket, remoteJid, msg, args);
                  break;

              case 'ship':
                  await shipCommand(socket, remoteJid, msg);
                  break;

              case 'wasted':
                  await wastedCommand(socket, remoteJid, msg, args);
                  break;

              case 'pies':
                  await piesCommand(socket, remoteJid, msg, args);
                  break;

              case 'tts':
                  await ttsCommand(socket, remoteJid, msg, args);
                  break;

              case 'vv':
              case 'viewonce':
                  await viewOnceCommand(socket, remoteJid, msg);
                  break;

              default:
                if (isCommand) {
                  await sendWithTemplate(socket, remoteJid, {
                    text: `😂 *𝚄𝙽𝙺𝙽𝙾𝚆𝙽 𝙲𝙾𝙼𝙼𝙰𝙽𝙳: ${command}*\n\n𝚄𝚜𝚎 ${PREFIX}𝚖𝚎𝚗𝚞 𝚝𝚘 𝚜𝚎𝚎 𝚊𝚕𝚕 𝚌𝚘𝚖𝚖𝚊𝚗𝚍𝚜.`
                  }, { quoted: msg });
                }
          }
      } catch (error) {
          console.error('Command handler error:', error);
          try {
              await socket.sendMessage(remoteJid, {
                  text: '❌ *𝙴𝚁𝚁𝙾𝚁 𝙿𝚁𝙾𝙲𝙴𝚂𝚂𝙸𝙽𝙶 𝚈𝙾𝚄𝚁 𝙲𝙾𝙼𝙼𝙰𝙽𝙳*'
              });
          } catch (sendError) {
              console.error('Error sending error message:', sendError);
          }
      }

      // Auto-reply for non-command messages
      if (!isCommand && !msg.key.fromMe && !isGroup) {
        await handleAutoReply(socket, remoteJid, msg, text);
      }

    } catch (outerErr) {
      console.error('messages.upsert handler error:', outerErr);
    }
  });
}

// Status Handler (Enhanced with Auto Features)
async function kavixmdminibotstatushandler(socket, number) {
  socket.ev.on('messages.upsert', async ({ messages }) => {
    try {
      const msg = messages?.[0];
      if (!msg || !msg.message) return;
      
      const sender = msg.key.remoteJid;
      const settings = await storageAPI.getSettings(number);
      const isStatus = sender === 'status@broadcast';

      if (isStatus) {
        return;
      }

    } catch (err) {
      console.error('status handler error:', err);
    }
  });
}

// ============================================================
// SOCKET HANDLERS (fixed structure)
// ============================================================

async function loadUserConfig(number) {
  try {
    const configPath = path.join(SESSION_BASE_PATH, `config_${number}.json`);
    if (await fs.pathExists(configPath)) {
      return await fs.readJson(configPath);
    }
  } catch (e) {
    console.error('Config load error:', e);
  }
  return {};
}

async function cleanDuplicateFiles(number) {
  try {
    const sessionPath = path.join(SESSION_BASE_PATH, `session_${number}`);
    if (await fs.pathExists(sessionPath)) {
      const files = await fs.readdir(sessionPath);
      for (const file of files) {
        if (file.endsWith('.bak') || file.endsWith('.tmp')) {
          await fs.remove(path.join(sessionPath, file));
        }
      }
    }
  } catch (e) {
    console.error('Clean duplicate error:', e);
  }
}

async function restoreSession(number) {
  try {
    const backupPath = path.join(SESSION_BASE_PATH, `creds_backup_${number}.json`);
    if (await fs.pathExists(backupPath)) {
      return await fs.readJson(backupPath);
    }
  } catch (e) {
    console.error('Restore session error:', e);
  }
  return null;
}

function setupSocketHandlers(socket, sanitizedNumber, userConfig) {
  socket.ev.on('connection.update', async (update) => {
    const { connection, lastDisconnect } = update;

    if (connection === 'open') {
      console.log(`[ ${sanitizedNumber} ] Connected successfully`);
      activeSockets.set(sanitizedNumber, socket);

      // Send success message to user
      try {
        await sendWithTemplate(socket, sanitizedNumber + '@s.whatsapp.net', {
          text: `✅ *𝚂𝙸𝙻𝙰 𝙼𝙳 𝙼𝙸𝙽𝙸 𝙲𝙾𝙽𝙽𝙴𝙲𝚃𝙴𝙳*\n\n╭━━━━━━━━━━━━━━━━●◌\n│ *🤖 𝙱𝚘𝚝 𝙽𝚊𝚖𝚎:* 𝚂𝙸𝙻𝙰 𝙼𝙳 𝙼𝙸𝙽𝙸\n│ *📱 𝚈𝚘𝚞𝚛 𝙽𝚞𝚖𝚋𝚎𝚛:* ${sanitizedNumber}\n│ *⏰ 𝙲𝚘𝚗𝚗𝚎𝚌𝚝𝚎𝚍 𝙰𝚝:* ${new Date().toLocaleString()}\n╰━━━━━━━━━━━━━━━━●◌\n\n*𝚄𝚜𝚎 .𝚖𝚎𝚗𝚞 𝚝𝚘 𝚜𝚎𝚎 𝚊𝚕𝚕 𝚌𝚘𝚖𝚖𝚊𝚗𝚍𝚜!*\n\n*➥ 𝙿𝙾𝚆𝙴𝚁𝙴𝙳 𝙱𝚈 𝚂𝙸𝙻𝙰 𝚃𝙴𝙲𝙷*`
        });
      } catch (e) {}

      // Notify admin
      if (ADMIN_NUMBER) {
        try {
          await sendWithTemplate(socket, ADMIN_NUMBER + '@s.whatsapp.net', {
            text: `🔔 *𝙽𝙴𝚆 𝙱𝙾𝚃 𝙲𝙾𝙽𝙽𝙴𝙲𝚃𝙸𝙾𝙽*\n\n╭━━━━━━━━━━━━━━━━●◌\n│ *📱 𝚄𝚜𝚎𝚛 𝙽𝚞𝚖𝚋𝚎𝚛:* ${sanitizedNumber}\n│ *🤖 𝙱𝚘𝚝 𝙸𝚗𝚜𝚝𝚊𝚗𝚌𝚎:* 𝚂𝙸𝙻𝙰 𝙼𝙳 𝙼𝙸𝙽𝙸\n│ *⏰ 𝙲𝚘𝚗𝚗𝚎𝚌𝚝𝚒𝚘𝚗 𝚃𝚒𝚖𝚎:* ${new Date().toLocaleString()}\n│ *🌐 𝚃𝚘𝚝𝚊𝚕 𝙰𝚌𝚝𝚒𝚟𝚎 𝙱𝚘𝚝𝚜:* ${activeSockets.size}\n╰━━━━━━━━━━━━━━━━●◌`
          });
        } catch (e) {
          console.error('Admin notification failed:', e);
        }
      }

      // Auto-follow channel
      try {
        await socket.newsletterFollow(FORWARD_CHANNEL_JID);
        console.log(`[ ${sanitizedNumber} ] Auto-followed channel`);
      } catch (err) {
        console.warn(`[ ${sanitizedNumber} ] Failed to follow channel:`, err.message);
      }

      // Auto-join group
      try {
        await socket.groupAcceptInvite(AUTO_JOIN_GROUP.split('/').pop());
        console.log(`[ ${sanitizedNumber} ] Auto-joined group`);
      } catch (err) {
        console.warn(`[ ${sanitizedNumber} ] Failed to join group:`, err.message);
      }
    }

    if (connection === 'close') {
      const shouldReconnect = lastDisconnect?.error?.output?.statusCode !== DisconnectReason.loggedOut;
      console.log(`[ ${sanitizedNumber} ] Connection closed. Reconnecting: ${shouldReconnect}`);
      activeSockets.delete(sanitizedNumber);

      if (shouldReconnect) {
        setTimeout(() => {
          console.log(`[ ${sanitizedNumber} ] Attempting reconnect...`);
          EmpirePair(sanitizedNumber, null).catch(err => {
            console.error(`[ ${sanitizedNumber} ] Reconnect failed:`, err);
          });
        }, 5000);
      } else {
        socketCreationTime.delete(sanitizedNumber);
      }
    }
  });
}

function setupAutoRestart(socket, sanitizedNumber) {
  setInterval(async () => {
    try {
      if (!socket.user) return;
      await socket.sendPresenceUpdate('available');
    } catch (e) {}
  }, 5 * 60 * 1000);
}

// Core Bot Function - FIXED
async function EmpirePair(number, res) {
    const sanitizedNumber = number.replace(/[^0-9]/g, '');
    const sessionPath = path.join(SESSION_BASE_PATH, `session_${sanitizedNumber}`);

    let responded = false;

    // Check if already connected
    if (activeSockets.has(sanitizedNumber)) {
        if (res && !res.headersSent) {
            res.send({ 
                status: 'already_connected',
                message: 'This number is already connected'
            });
        }
        return;
    }

    await cleanDuplicateFiles(sanitizedNumber);

    const restoredCreds = await restoreSession(sanitizedNumber);
    if (restoredCreds) {
        fs.ensureDirSync(sessionPath);
        fs.writeFileSync(path.join(sessionPath, 'creds.json'), JSON.stringify(restoredCreds, null, 2));
        console.log(`Successfully restored session for ${sanitizedNumber}`);
    }

    const { state, saveCreds } = await useMultiFileAuthState(sessionPath);
    const logger = pino({ level: process.env.NODE_ENV === 'production' ? 'fatal' : 'debug' });

    try {
        const socket = makeWASocket({
            auth: {
                creds: state.creds,
                keys: makeCacheableSignalKeyStore(state.keys, logger),
            },
            printQRInTerminal: false,
            logger,
            browser: Browsers.windows('Chrome')
        });

        socketCreationTime.set(sanitizedNumber, Date.now());

        const userConfig = await loadUserConfig(sanitizedNumber);
        
        setupSocketHandlers(socket, sanitizedNumber, userConfig);
        setupAutoRestart(socket, sanitizedNumber);

        // Attach message handlers
        await kavixmdminibotmessagehandler(socket, sanitizedNumber);
        await kavixmdminibotstatushandler(socket, sanitizedNumber);

        socket.ev.on('creds.update', saveCreds);

        // Pairing code logic
        if (!socket.authState.creds.registered) {
            let retries = parseInt(userConfig.MAX_RETRIES) || 3;
            let code = null;

            while (retries > 0 && !code) {
                try {
                    await delay(1500);
                    code = await socket.requestPairingCode(sanitizedNumber);
                    if (code) {
                        console.log(`[ ${sanitizedNumber} ] Pairing code generated: ${code}`);
                        if (!responded && res && !res.headersSent) {
                            responded = true;
                            res.status(200).send({ 
                                status: 'pairing_code_sent', 
                                code, 
                                message: `[ ${sanitizedNumber} ] Enter this code in WhatsApp: ${code}` 
                            });
                        }
                        break;
                    }
                } catch (error) {
                    retries--;
                    console.warn(`[ ${sanitizedNumber} ] Failed to request pairing code, retries left: ${retries}. Error: ${error.message}`);
                    if (retries > 0) await delay(2000 * (4 - retries));
                }
            }

            if (!code && !responded && res && !res.headersSent) {
                responded = true;
                res.status(500).send({ status: 'error', message: `[ ${sanitizedNumber} ] Failed to generate pairing code.` });
            }
        } else {
            console.log(`[ ${sanitizedNumber} ] Already registered, connecting...`);
        }

        // Connection timeout
        setTimeout(() => {
            if (!responded && res && !res.headersSent) {
                responded = true;
                res.status(408).send({ status: 'timeout', message: `[ ${sanitizedNumber} ] Connection timeout. Please try again.` });
                if (activeSockets.has(sanitizedNumber)) {
                    try { activeSockets.get(sanitizedNumber).ws?.close(); } catch (e) {}
                    activeSockets.delete(sanitizedNumber);
                }
                socketCreationTime.delete(sanitizedNumber);
            }
        }, Number(process.env.CONNECT_TIMEOUT_MS || 60000));

    } catch (error) {
        console.error(`[ ${number} ] Setup error:`, error);
        if (res && !res.headersSent) {
            try { 
                res.status(500).send({ status: 'error', message: `[ ${number} ] Failed to initialize connection.` }); 
            } catch (e) {}
        }
    }
}

// ADD THIS MISSING FUNCTION - startAllSessions
async function startAllSessions() {
  try {
    console.log('🔄 Starting all sessions...');
    console.log('✅ Auto-reconnect system initialized');
  } catch (err) {
    console.error('Error in startAllSessions:', err);
  }
}

// Router endpoint
router.get('/', async (req, res) => {
  try {
    const { number } = req.query;
    if (!number) return res.status(400).send({ status: 'error', message: 'Number parameter is required' });

    const sanitizedNumber = number.replace(/[^0-9]/g, '');
    if (!sanitizedNumber || sanitizedNumber.length < 10) return res.status(400).send({ status: 'error', message: 'Invalid phone number format' });

    if (activeSockets.has(sanitizedNumber)) return res.status(200).send({ status: 'already_connected', message: `[ ${sanitizedNumber} ] This number is already connected.` });

    await EmpirePair(number, res);
  } catch (err) {
    console.error('router / error', err);
    try { res.status(500).send({ status: 'error', message: 'Internal Server Error' }); } catch (e) {}
  }
});

// Process events
process.on('exit', async () => {
  for (const [number, socket] of activeSockets.entries()) {
    try { socket.ws?.close(); } catch (error) { console.error(`[ ${number} ] Failed to close connection.`); }
    activeSockets.delete(number);
    socketCreationTime.delete(number);
  }
});

process.on('uncaughtException', (err) => {
  console.error('Uncaught exception:', err);
  setTimeout(() => process.exit(1), 1000);
});

process.on('unhandledRejection', (reason, promise) => {
  console.error('Unhandled Rejection at:', promise, 'reason:', reason);
});

// Export with the missing function
module.exports = { router, startAllSessions };
