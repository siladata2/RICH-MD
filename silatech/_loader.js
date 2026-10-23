const fs = require('fs');
const path = require('path');

const commands = new Map();

function loadCommands() {
    const dir = __dirname;
    const files = fs.readdirSync(dir).filter(f => f.endsWith('.js') && !f.startsWith('_'));

    for (const file of files) {
        try {
            delete require.cache[require.resolve(path.join(dir, file))];
            const mod = require(path.join(dir, file));
            if (!mod || !mod.name || typeof mod.execute !== 'function') {
                console.warn(`⚠️ Invalid command file: ${file}`);
                continue;
            }
            const names = Array.isArray(mod.name) ? mod.name : [mod.name];
            for (const n of names) commands.set(n.toLowerCase(), mod);
            console.log(`✅ Loaded command: ${names.join(', ')}`);
        } catch (e) {
            console.error(`❌ Failed to load ${file}:`, e.message);
        }
    }
    console.log(`📦 Total commands loaded: ${commands.size}`);
}

function getCommand(name) {
    if (!name) return null;
    return commands.get(name.toLowerCase()) || null;
}

function getAllCommands() {
    return commands;
}

module.exports = { loadCommands, getCommand, getAllCommands };
