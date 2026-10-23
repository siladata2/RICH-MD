const mongoose = require('mongoose');
const { MONGODB_URI, DB_NAME } = require('../config');

async function connectDB() {
    try {
        if (mongoose.connection.readyState === 1) return mongoose.connection;
        await mongoose.connect(MONGODB_URI, { dbName: DB_NAME });
        console.log('✅ MongoDB connected:', DB_NAME);
        return mongoose.connection;
    } catch (err) {
        console.error('❌ MongoDB connection error:', err.message);
        process.exit(1);
    }
}

module.exports = { connectDB, mongoose };
