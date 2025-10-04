const config = require('./config/config');
const RabbitMQConnection = require('./rabbitmq/connection');
const Scheduler = require('./scheduler/scheduler');
const RetryHandler = require('./retry/retry-handler');
const Logger = require('./logger/logger');

async function start() {
    const rabbit = new RabbitMQConnection(config.RABBITMQ_URL);
    const channel = await rabbit.connect();

    await channel.assertQueue(config.ALERT_RETRY_QUEUE, { durable: true });
    await channel.prefetch(1);

    const scheduler = new Scheduler(channel, config);
    scheduler.start();

    const retryHandler = new RetryHandler(channel, scheduler, config);

    Logger.info(`Aguardando mensagens na fila '${config.ALERT_RETRY_QUEUE}'...`);
    await channel.consume(config.ALERT_RETRY_QUEUE, (msg) => msg && retryHandler.handle(msg), { noAck: false });

    const shutdown = async () => {
        Logger.info('Desligando...');
        await rabbit.close();
        process.exit(0);
    };

    process.on('SIGINT', shutdown);
    process.on('SIGTERM', shutdown);
    process.on('uncaughtException', async (err) => { Logger.error(err.message); await shutdown(); });
    process.on('unhandledRejection', async (reason) => { Logger.error(reason); await shutdown(); });
}

start();
