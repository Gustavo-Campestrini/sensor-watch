require('dotenv').config();
const amqp = require('amqplib');
const mongoose = require('mongoose');

const rabbitmqUrl = process.env.RABBITMQ_URL;
const mongoUrl    = process.env.MONGO_URL;

const mainQueue   = 'alerts.log';
const retryQueue  = 'alerts.log.retry';
const deadLetterQueue = 'alerts.log.dead-letter';
const dlxName     = 'alerts.log.dlx'; 

const MAX_RETRIES = 3;    


const alertSchema = new mongoose.Schema({
    type      : String,
    value    : Number,
    place    : String,
    timestamp: { type: Date, default: Date.now },
});
const Alert = mongoose.model('Alert', alertSchema);

async function publishToQueue(channel, queue, msg) {
    const originalContent = msg.content.toString();
    console.log(`[!] Movendo mensagem para a fila '${queue}'.`);
    channel.sendToQueue(queue, Buffer.from(originalContent), { persistent: true });
}


async function startWorker() {
    try {
        await mongoose.connect(mongoUrl, { useNewUrlParser: true, useUnifiedTopology: true });
        console.log("Conectado ao MongoDB com sucesso.");

        const connection = await amqp.connect(rabbitmqUrl);
        const channel = await connection.createChannel();
        console.log("Conectado ao RabbitMQ com sucesso.");


        await channel.assertExchange(dlxName, 'direct', { durable: true });
        await channel.assertQueue(deadLetterQueue, { durable: true });
        await channel.bindQueue(deadLetterQueue, dlxName, 'dead-letter');
        await channel.bindQueue(retryQueue, dlxName, 'retry');

        console.log(`[*] Aguardando mensagens na fila '${mainQueue}'.`);

        channel.consume(mainQueue, async (msg) => {
            if (msg === null) return;

            try {

                const headers = msg.properties.headers || {};
                const retryCount = headers['x-retry-count'] || 0;

                const messageContent = msg.content.toString();
                const alertData = JSON.parse(messageContent);

                const newAlert = new Alert(alertData);
                await newAlert.save();

                if (retryCount > 0) {
                    console.log(` [✔] Alerta salvo no MongoDB após ${retryCount} tentativa(s) de retry.`);
                } else {
                    console.log(" [✔] Alerta salvo no MongoDB (Primeira Tentativa).");
                }
                
                channel.ack(msg);

            } catch (error) {
                console.error("Erro ao processar mensagem:", error.message);
                
                try {
                    const headers = msg.properties.headers || {};
                    const retryCount = (headers['x-retry-count'] || 0) + 1;

                    if (retryCount > MAX_RETRIES) {
                        console.error(`[!] Mensagem excedeu ${MAX_RETRIES} tentativas. Enviando para a fila de erros.`);
                        await publishToQueue(channel, deadLetterQueue, msg);
                    } else {
                        console.log(`[!] Tentativa ${retryCount} de ${MAX_RETRIES}. Reagendando...`);
                        headers['x-retry-count'] = retryCount;
                        channel.sendToQueue(retryQueue, msg.content, { headers });
                    }

                    channel.ack(msg);

                } catch (publishError) {
                    console.error("Erro CRÍTICO ao tentar mover mensagem para retry/dead-letter:", publishError);
                    channel.nack(msg, false, false);
                }
            }
        }, { noAck: false });

    } catch (error) {
        console.error("Falha ao iniciar o worker:", error);
        setTimeout(startWorker, 5000);
    }
}

startWorker();