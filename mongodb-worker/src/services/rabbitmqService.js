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

        await channel.assertExchange(config.DLX_NAME, 'direct', { durable: true });
        
        await channel.assertQueue(config.MAIN_QUEUE, {
            durable: true,
            deadLetterExchange: config.DLX_NAME,
            deadLetterRoutingKey: 'retry',
        });

        await channel.assertQueue(config.RETRY_QUEUE, {
             durable: true,
             deadLetterExchange: config.DLX_NAME,
             deadLetterRoutingKey: 'dead-letter',
             messageTtl: 30000,
        });
        
        await channel.assertQueue(config.DEAD_LETTER_QUEUE, { durable: true });

        await channel.bindQueue(config.DEAD_LETTER_QUEUE, config.DLX_NAME, 'dead-letter');
        await channel.bindQueue(config.RETRY_QUEUE, config.DLX_NAME, 'retry');

        return { connection, channel };

    } catch (error) {
        console.error("❌ Falha ao configurar o RabbitMQ:", error);
        throw error;
    }
}


/**
 * Lógica principal de processamento da mensagem.
 * @param {Object} msg A mensagem recebida do RabbitMQ.
 */
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


/**
 * Gerencia erros no processamento, decidindo entre retry ou dead-letter.
 * @param {Object} msg A mensagem que falhou.
 * @param {Error} error O erro que ocorreu.
 */
async function handleProcessingError(msg, error) {
    console.error("❗ Erro ao processar mensagem:", error.message);

    try {
        const headers = msg.properties.headers || {};
        const retryCount = (headers['x-retry-count'] || 0) + 1;

        if (retryCount > config.MAX_RETRIES) {
            console.error(`[💀] Mensagem excedeu ${config.MAX_RETRIES} tentativas. Enviando para a Dead Letter Queue.`);
            channel.nack(msg, false, false); 
        } else {
            console.log(`[🔄] Tentativa ${retryCount} de ${config.MAX_RETRIES}. Reagendando para retry...`);
            headers['x-retry-count'] = retryCount;
            channel.sendToQueue(config.RETRY_QUEUE, msg.content, { persistent: true, headers });
            channel.ack(msg);
        }
    } catch (publishError) {
        console.error("🔥 Erro CRÍTICO ao mover mensagem para retry/DLQ:", publishError);
        channel.nack(msg, false, true); 
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