// config/db.js
import mongoose from 'mongoose';
import dotenv from 'dotenv'


export const connectDB = async () => {
    try {
        const conn = await mongoose.connect(process.env.MONGO_URI,{
            dbName: "AI_Engineering_Manager",
        });
        console.log('\x1b[32m%s\x1b[0m', `[MongoDB] Connected: ${conn.connection.host}`);
    } catch (error) {
        console.error('\x1b[31m%s\x1b[0m', `[MongoDB] Connection Error: ${error.message}`);
        process.exit(1);
    }
};
