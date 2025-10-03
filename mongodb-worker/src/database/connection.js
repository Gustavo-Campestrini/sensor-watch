const mongoose = require('mongoose');
const config = require('../config/config');

async function connectToDatabase() {
    try {
        await mongoose.connect(config.MONGO_URL, {
            useNewUrlParser: true,
            useUnifiedTopology: true,
        });
        console.log("✅ Conectado ao MongoDB com sucesso.");
    } catch (error) {
        console.error("❌ Falha ao conectar ao MongoDB:", error);
        throw error; 
    }
}

module.exports = { connectToDatabase };