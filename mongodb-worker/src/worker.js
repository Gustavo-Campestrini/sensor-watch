const { connectToDatabase } = require('./database/connection');
const rabbitmqService = require('./services/rabbitmqService');

async function startWorker() {
    try {
        await connectToDatabase();
        const { connection, channel } = await rabbitmqService.setupRabbitMQ();

        rabbitmqService.startConsumer();

        process.on('SIGINT', async () => {
            console.log("\n[!] Recebido sinal de interrupção. Fechando conexões...");
            try {
                await channel.close();
                await connection.close();
                console.log("🔌 Conexões com RabbitMQ fechadas.");
            } catch (err) {
                console.error("Erro ao fechar conexão com RabbitMQ", err);
            } finally {
                process.exit(0);
            }
        });

    } catch (error) {
        console.error("🔥 Falha crítica ao iniciar o worker. Tentando novamente em 5 segundos...", error);
        setTimeout(startWorker, 5000);
    }
}

startWorker();