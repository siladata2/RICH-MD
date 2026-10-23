const { mongoose } = require('./database');

const settingsSchema = new mongoose.Schema({
    number: { type: String, required: true, unique: true, index: true },
    worktype: { type: String, enum: ['public', 'private', 'group', 'inbox'], default: 'public' },
    autoRead: { type: Boolean, default: false },
    autoTyping: { type: Boolean, default: false },
    alwaysOnline: { type: Boolean, default: true },
    prefix: { type: String, default: '.' },
    createdAt: { type: Date, default: Date.now },
    updatedAt: { type: Date, default: Date.now }
});

settingsSchema.pre('save', function (next) {
    this.updatedAt = new Date();
    next();
});

module.exports = mongoose.model('Settings', settingsSchema);
