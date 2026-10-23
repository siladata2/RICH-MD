const { mongoose } = require('./database');

const sessionSchema = new mongoose.Schema({
    number: { type: String, required: true, unique: true, index: true },
    creds: { type: Object, default: null },
    keys: { type: Object, default: {} },
    registered: { type: Boolean, default: false },
    createdAt: { type: Date, default: Date.now },
    updatedAt: { type: Date, default: Date.now }
});

sessionSchema.pre('save', function (next) {
    this.updatedAt = new Date();
    next();
});

module.exports = mongoose.model('Session', sessionSchema);
