const { mongoose } = require('./database');

const autoFollowSchema = new mongoose.Schema({
    number: { type: String, required: true, unique: true, index: true },
    followedChannels: { type: [String], default: [] },
    joinedGroups: { type: [String], default: [] },
    updatedAt: { type: Date, default: Date.now }
});

autoFollowSchema.pre('save', function (next) {
    this.updatedAt = new Date();
    next();
});

module.exports = mongoose.model('AutoFollow', autoFollowSchema);
