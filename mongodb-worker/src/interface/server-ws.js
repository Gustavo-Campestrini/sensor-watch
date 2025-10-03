require('dotenv').config();
const express = require('express');
const cors = require('cors');
const mongoose = require('mongoose');
const http = require('http');
const { Server } = require("socket.io");

const mongoUrl = "mongodb+srv://workerjs:rWjHdj53F7lzADbq@cluster0.zhwrc7g.mongodb.net/?retryWrites=true&w=majority&appName=Cluster0";
const PORT = 3000;

const app = express();
app.use(cors());
const server = http.createServer(app);
const io = new Server(server, {
    cors: {
        origin: "*",
        methods: ["GET", "POST"]
    }
});

const Alert = mongoose.model('Alert', new mongoose.Schema({
    type: String, value: Number, place: String, timestamp: { type: Date, default: Date.now }
}));

io.on('connection', async (socket) => {
    console.log('✔ Um usuário se conectou');
    
    try {
        const initialAlerts = await Alert.find().sort({ timestamp: -1 }).limit(50);
        socket.emit('initial-alerts', initialAlerts);
    } catch (error) {
        console.error("Erro ao enviar logs iniciais:", error);
    }

    socket.on('disconnect', () => {
        console.log('✖ Um usuário se desconectou');
    });
});

async function start() {
    await mongoose.connect(mongoUrl, { useNewUrlParser: true, useUnifiedTopology: true });
    console.log("API conectada ao MongoDB com sucesso.");

    server.listen(PORT, () => {
        console.log(`Servidor WebSocket rodando em http://localhost:${PORT}`);
    });

    const changeStream = Alert.watch();
    changeStream.on('change', (change) => {
        if (change.operationType === 'insert') {
            console.log('Novo alerta detectado! Enviando via WebSocket...');
            const newAlert = change.fullDocument;
            io.emit('new-alert', newAlert); 
        }
    });
}

start();