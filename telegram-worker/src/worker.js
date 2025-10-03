require('dotenv').config();
const amqp = require('amqplib');
const config = require('./config/config.js');
const { sendTelegramMessage } = require('./service/telegram.js');
const { parseMessageContent } = require('./utils/messageParser.js');


const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

if (!config.TELEGRAM_BOT_TOKEN || !config.TELEGRAM_CHAT_ID) {
  throw new Error('Configure TELEGRAM_BOT_TOKEN e TELEGRAM_CHAT_ID antes de iniciar o worker.');
}

async function setupRabbitMQ(channel) {
  await channel.assertExchange(config.ALERTS_EXCHANGE, 'fanout', { durable: true });
  await channel.assertQueue(config.ALERT_NOTIFICATION_QUEUE, { durable: true });
  await channel.assertQueue(config.ALERT_RETRY_QUEUE, { durable: true }); 
  await channel.bindQueue(config.ALERT_NOTIFICATION_QUEUE, config.ALERTS_EXCHANGE, '');
  await channel.prefetch(1);
  return config.ALERT_NOTIFICATION_QUEUE;
}

async function forwardToRetryQueue(channel, msg, error) {
  console.warn(`Encaminhando mensagem para a fila de retry: ${config.ALERT_RETRY_QUEUE}`);
  
  try {
    const originalHeaders = msg.properties.headers || {};
    const newHeaders = {
      ...originalHeaders,
      'x-source-service': 'telegram-worker', 
      'x-failure-reason': error.message,    
      'x-failure-timestamp': new Date().toISOString() 
    };

    channel.sendToQueue(config.ALERT_RETRY_QUEUE, msg.content, { 
      persistent: true, 
      headers: newHeaders 
    });
    return true;
  } catch (forwardError) {
    console.error('Falha ao encaminhar para retry:', forwardError.message);
    return false;
  }
}


async function handleMessage(channel, msg) {
  const { formatted } = parseMessageContent(msg);

  const headers = msg.properties.headers || {};
  const retryCount = headers['x-retry-count'] || 0;

  try {
    await sendTelegramMessage(formatted);
    console.log(`Alerta enviado com sucesso na tentativa #${retryCount}`)
    await sleep(500); 
    channel.ack(msg);
  } catch (error) {
    console.error(`Falha ao enviar para o Telegram na tentativa ${retryCount}: ${error.message}`);
    const forwarded = await forwardToRetryQueue(channel, msg, error);
    if (forwarded) {
      channel.ack(msg);
    } else {
      channel.nack(msg, false, false);
    }
  }
}


async function start() {
  let connection;
  let channel;

  
  const shutdown = async (code = 0) => {
    try {
      if (channel) await channel.close();
      if (connection) await connection.close();
      console.log('Conexão com RabbitMQ encerrada.');
    } catch (error) {
      console.error('Erro ao encerrar conexões:', error.message);
    } finally {
      process.exit(code);
    }
  };

  process.on('SIGINT', () => shutdown(0));
  process.on('SIGTERM', () => shutdown(0));
  process.on('uncaughtException', (error) => {
    console.error('Exceção não tratada:', error.message, error.stack);
    shutdown(1);
  });
  process.on('unhandledRejection', (reason) => {
    console.error('Promise rejeitada sem tratamento:', reason);
    shutdown(1);
  });

  try {
    connection = await amqp.connect(config.RABBITMQ_URL);
    channel = await connection.createChannel();
    
    const queueName = await setupRabbitMQ(channel);

    console.log(`Aguardando mensagens na fila '${queueName}'...`);
    
    await channel.consume(queueName, (msg) => {
      if (msg) handleMessage(channel, msg);
    }, { noAck: false });

  } catch (error) {
    console.error('Falha durante a inicialização:', error.message);
    await shutdown(1);
  }
}

start();