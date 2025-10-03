const amqp = require('amqplib');
const config = require('../config/config');
const Alert = require('../database/models/Alert');

let connection = null;
let channel = null;


async function setupRabbitMQ() {
    try {
        connection = await amqp.connect(config.RABBITMQ_URL);
        channel = await connection.createChannel();
        console.log("✅ Conectado ao RabbitMQ com sucesso.");
        
        await channel.assertQueue(config.MAIN_QUEUE, {
            durable: true,
        });


        return { connection, channel };

    } catch (error) {
        console.error("❌ Falha ao configurar o RabbitMQ:", error);
        throw error;
    }
}


async function processMessage(msg) {
    const messageContent = msg.content.toString();
    const alertData = JSON.parse(messageContent); 

    const newAlert = new Alert(alertData);
    await newAlert.save(); 

    const headers = msg.properties.headers || {};
    const retryCount = headers['x-retry-count'] || 0;

    if (retryCount > 0) {
        console.log(`[✔] Mensagem processada com sucesso após ${retryCount} tentativa(s).`);
    } else {
        console.log("[✔] Mensagem processada com sucesso (Primeira Tentativa).");
    }
    
    channel.ack(msg);
}



async function handleProcessingError(msg, error) {
    console.error("❗ Erro ao processar mensagem:", error.message);

    try {
        const originalHeaders = msg.properties.headers || {};
        const headers = {
            ...originalHeaders,
            'x-source-service': 'mongodb-worker', 
            'x-failure-reason': error.message, 
            'x-failure-timestamp': new Date().toISOString() 
        };

        console.log(`[🔄] Encaminhando mensagem para a fila de retry '${config.RETRY_QUEUE}'.`);
        channel.sendToQueue(config.RETRY_QUEUE, msg.content, { persistent: true, headers: headers });
        channel.ack(msg);

    } catch (publishError) {
        console.error("🔥 Erro CRÍTICO ao mover mensagem para a fila de retry:", publishError);
        channel.nack(msg, false, false); 
    }
}


function startConsumer() {
    console.log(`[*] Aguardando mensagens na fila '${config.MAIN_QUEUE}'. Para sair, pressione CTRL+C`);
    channel.consume(config.MAIN_QUEUE, async (msg) => {
        if (msg === null) return;

        try {
            await processMessage(msg);
        } catch (error) {
            await handleProcessingError(msg, error);
        }
    }, { noAck: false }); 
}

module.exports = {
    setupRabbitMQ,
    startConsumer,
    connection,
    channel
};