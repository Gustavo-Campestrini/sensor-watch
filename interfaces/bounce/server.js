require('dotenv').config();
const express = require('express');
const cors = require('cors');
const { Server } = require("socket.io");
const mongoose = require('mongoose');
const http = require = require('http');

const mongoUrl = process.env.MONGO_URL || "mongodb+srv://workerjs:rWjHdj53F7lzADbq@cluster0.zhwrc7g.mongodb.net/?retryWrites=true&w=majority&appName=Cluster0";
const PORT = 3000;

const app = express();
app.use(cors());
app.use(express.json()); 

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

const ThresholdSchema = new mongoose.Schema({
    sensor: { type: String, required: true, unique: true },
    upperLimit: { type: Number, required: true },
    lowerLimit: { type: Number, required: true },
    unit: String
});

const Threshold = mongoose.model('Threshold', ThresholdSchema);


app.get('/api/thresholds', async (req, res) => {
    try {
        const thresholds = await Threshold.find();
        res.status(200).json(thresholds);
    } catch (error) {
        console.error("Erro ao buscar limites:", error);
        res.status(500).json({ message: "Erro interno do servidor" });
    }
});

app.post('/api/thresholds', async (req, res) => {
    const { sensor, upperLimit, lowerLimit, unit } = req.body;

    if (!sensor || upperLimit === undefined || lowerLimit === undefined) {
        return res.status(400).json({ message: "Dados incompletos" });
    }

    try {
        const result = await Threshold.findOneAndUpdate(
            { sensor: sensor.toLowerCase() },
            { upperLimit, lowerLimit, unit: unit || '' },
            { new: true, upsert: true } 
        );
        
        console.log(`Limite do sensor ${sensor} atualizado.`);
        
        io.emit('threshold-update', result); 
        
        res.status(200).json(result);
    } catch (error) {
        console.error(`Erro ao atualizar limite do sensor ${sensor}:`, error);
        res.status(500).json({ message: "Erro ao salvar o limite" });
    }
});



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

    await initializeThresholds();

    server.listen(PORT, () => {
        console.log(`Servidor WebSocket e REST rodando em http://localhost:${PORT}`);
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

async function initializeThresholds() {
    const sensors = [
        { sensor: 'vibration', upperLimit: 10, lowerLimit: 1, unit: 'Hz' },
        { sensor: 'temperature', upperLimit: 40, lowerLimit: 10, unit: '°C' },
        { sensor: 'pressure', upperLimit: 100, lowerLimit: 50, unit: 'PSI' }
    ];

    for (const data of sensors) {
        await Threshold.findOneAndUpdate(
            { sensor: data.sensor },
            { $setOnInsert: data }, 
            { upsert: true, new: true, setDefaultsOnInsert: true }
        );
    }
    console.log("Limites iniciais garantidos no banco de dados.");
}


start();