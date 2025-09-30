require('dotenv').config();
const amqp = require('amqplib');
const config = require('./config/config.js');
const { sendTelegramMessage } = require('./service/telegram.js');
const { parseMessageContent } = require('./utils/messageParser.js');

/**
 * Pausa a execução por um determinado número de milissegundos.
 * @param {number} ms - O tempo de espera em milissegundos.
 * @returns {Promise<void>} Uma promessa que resolve após o tempo especificado.
 */
const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

if (!config.TELEGRAM_BOT_TOKEN || !config.TELEGRAM_CHAT_ID) {
  throw new Error('Configure TELEGRAM_BOT_TOKEN e TELEGRAM_CHAT_ID antes de iniciar o worker.');
}

async function setupRabbitMQ(channel) {
  await channel.assertExchange(config.ALERTS_EXCHANGE, 'fanout', { durable: true });
  await channel.assertQueue(config.ALERT_NOTIFICATION_QUEUE, { durable: true });
  await channel.assertQueue(config.ALERT_RETRY_QUEUE, { durable: true }); // Garante que a fila de retry existe
  await channel.bindQueue(config.ALERT_NOTIFICATION_QUEUE, config.ALERTS_EXCHANGE, '');
  await channel.prefetch(1);
  return config.ALERT_NOTIFICATION_QUEUE;
}

/**
 * Encaminha uma mensagem com falha para a fila de retentativas (retry).
 * @param {import('amqplib').Channel} channel - O canal do RabbitMQ.
 * @param {import('amqplib').ConsumeMessage} msg - A mensagem original que falhou.
 * @returns {Promise<boolean>} Retorna `true` se a mensagem foi encaminhada com sucesso, `false` caso contrário.
 */
async function forwardToRetryQueue(channel, msg) {
  console.warn(`Encaminhando mensagem para a fila de retry: ${config.ALERT_RETRY_QUEUE}`);
  try {
    channel.sendToQueue(config.ALERT_RETRY_QUEUE, msg.content, { 
      persistent: true, 
      headers: msg.properties.headers 
    });
    return true;
  } catch (forwardError) {
    console.error('Falha ao encaminhar para retry:', forwardError.message);
    return false;
  }
}

/**
 * Processa uma única mensagem recebida da fila de notificações.
 * Tenta enviar a mensagem formatada para o Telegram. Em caso de falha,
 * encaminha para a fila de retentativa.
 * @param {import('amqplib').Channel} channel - O canal do RabbitMQ.
 * @param {import('amqplib').ConsumeMessage} msg - A mensagem a ser processada.
 * @returns {Promise<void>}
 */
async function handleMessage(channel, msg) {
  const { formatted } = parseMessageContent(msg);

  try {
    await sendTelegramMessage(formatted);
    console.log("Alerta enviado com sucesso.");
    await sleep(500); 
    channel.ack(msg);
  } catch (error) {
    console.error(`Falha ao enviar para o Telegram: ${error.message}`);
    const forwarded = await forwardToRetryQueue(channel, msg);
    if (forwarded) {
      channel.ack(msg);
    } else {
      channel.nack(msg, false, false);
    }
  }
}

/**
 * Função principal que inicializa e executa o worker.
 * Conecta-se ao RabbitMQ, configura o canal, define o consumidor
 * e gerencia o ciclo de vida do processo.
 * @returns {Promise<void>}
 */
async function start() {
  let connection;
  let channel;

  /**
   * Encerra as conexões com o RabbitMQ de forma graciosa e finaliza o processo.
   * @param {number} [code=0] - O código de saída do processo.
   */
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