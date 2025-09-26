require('dotenv').config();
const amqp = require('amqplib');
const mongoose = require('mongoose');

const rabbitmqUrl = process.env.RABBITMQ_URL;
const mongoUrl    = process.env.MONGO_URL;
const queueName   = 'alerts.log'; 

const alertSchema = new mongoose.Schema({
    type      : String,    
    value    : Number,    
    place    : String, 
    timestamp: { type: Date, default: Date.now }, 
});

const Alert = mongoose.model('Alert', alertSchema);

async function startWorker() {
    try {
        await mongoose.connect(mongoUrl, { useNewUrlParser: true, useUnifiedTopology: true });
        console.log("Conectado ao MongoDB com sucesso.");

        const connection = await amqp.connect(rabbitmqUrl);
        const channel = await connection.createChannel();
        console.log("Conectado ao RabbitMQ com sucesso.");

        await channel.assertQueue(queueName, { durable: true });
        console.log(`[*] Aguardando mensagens na fila '${queueName}'. Para sair, pressione CTRL+C`);

        channel.consume(queueName, async (msg) => {
            if (msg !== null) {
                try {
                    const messageContent = msg.content.toString();
                    const alertData = JSON.parse(messageContent);

                    const newAlert = new Alert(alertData);

                    await newAlert.save();
                    console.log(" [✔] Alerta salvo no MongoDB.");

                    // Confirma o processamento da mensagem para removê-la da fila 
                    channel.ack(msg);

                } catch (error) {
                    console.error("Erro ao processar mensagem:", error.message);
                    // a mensagem é rejeitada (nack) e não será removida da fila,
                    // permitindo que seja reprocessada ou enviada para uma DLQ, conforme a configuração do RabbitMQ.
                    channel.nack(msg, false, false); // O terceiro `false` evita que ela volte para a mesma fila imediatamente.
                }
            }
        }, { noAck: false });

    } catch (error) {
        console.error("Falha ao iniciar o worker:", error);
        // Tenta reiniciar o worker após um tempo em caso de falha na conexão inicial
        setTimeout(startWorker, 5000);
    }
}

startWorker();