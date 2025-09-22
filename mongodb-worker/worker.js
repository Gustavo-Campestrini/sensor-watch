const amqp = require('amqplib');
const mongoose = require('mongoose');

const rabbitmqUrl = 'amqp://admin:admin@rabbitmq:5672'; // Usando as credenciais e o nome do serviço

const mongoUrl = "mongodb+srv://workerjs:rWjHdj53F7lzADbq@cluster0.zhwrc7g.mongodb.net/?retryWrites=true&w=majority&appName=Cluster0"; 

const queueName = 'alerts.log'; 

const alertSchema = new mongoose.Schema({
    type: String,    
    value: Number,    
    sensor: String, 
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
                    const alertData = JSON.parse(msg.content.toString());
                    console.log(" [x] Recebido:", alertData);

                    const newAlert = new Alert(alertData);

                    await newAlert.save();
                    console.log(" [✔] Alerta salvo no MongoDB.");

                    channel.ack(msg);

                } catch (error) {
                    console.error("Erro ao processar mensagem:", error.message);
                    channel.nack(msg, false, false); // O terceiro `false` evita que ela volte para a mesma fila imediatamente.
                }
            }
        }, { noAck: false });

    } catch (error) {
        console.error("Falha ao iniciar o worker:", error);
        setTimeout(startWorker, 5000);
    }
}

startWorker();