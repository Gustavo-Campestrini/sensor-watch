require('dotenv').config();
const amqp = require('amqplib');
const config = require('./config/config.js');

/**
 * Processa uma mensagem da fila de retentativas.
 * Incrementa o contador de tentativas e decide se a mensagem deve ser
 * reenviada para o processamento normal ou movida para a fila de descarte final (DLQ).
 * @param {import('amqplib').Channel} channel - O canal do RabbitMQ.
 * @param {import('amqplib').ConsumeMessage} msg - A mensagem a ser processada.
 * @returns {Promise<void>}
 */
async function handleRetryMessage(channel, msg) {
  const headers = msg.properties.headers || {};
  const retryCount = (headers['x-retry-count'] || 0) + 1;
  
  console.log(`[Retry-Service] Mensagem recebida. Tentativa #${retryCount} de ${config.MAX_RETRIES}`);

  if (retryCount <= config.MAX_RETRIES) {
    console.log(`[Retry-Service] Reenviando para a exchange '${config.ALERTS_EXCHANGE}'...`);
    const newHeaders = { ...headers, 'x-retry-count': retryCount };
    // Publica de volta na exchange principal para ser reprocessada pelos workers originais
    channel.publish(config.ALERTS_EXCHANGE, '', msg.content, { headers: newHeaders });
  } else {
    console.warn(`[Retry-Service] Limite de tentativas atingido. Enviando para a DLQ final.`);
    // Publica na exchange de falhas permanentes
    channel.publish(config.ALERT_FINAL_DLX, '', msg.content, { headers });
  }

  // Confirma que a mensagem foi tratada (seja por retry ou envio para DLQ)
  channel.ack(msg);
}

/**
 * Função principal que inicializa e executa o serviço de retentativas.
 * Conecta-se ao RabbitMQ, garante que a fila de retentativas exista,
 * e consome mensagens para processamento. Também gerencia o ciclo de vida do processo.
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
    console.log('Desligando...');
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
    console.error('[Retry-Service] Exceção não tratada:', error.message, error.stack);
    shutdown(1);
  });
  process.on('unhandledRejection', (reason) => {
    console.error('Promise rejeitada sem tratamento:', reason);
    shutdown(1);
  });

  try {
    connection = await amqp.connect(config.RABBITMQ_URL);
    channel = await connection.createChannel();
    await channel.assertQueue(config.ALERT_RETRY_QUEUE, { durable: true });
    await channel.prefetch(1);

    console.log(`Aguardando mensagens na fila '${config.ALERT_RETRY_QUEUE}'...`);

    await channel.consume(config.ALERT_RETRY_QUEUE, (msg) => {
      if (msg) handleRetryMessage(channel, msg);
    }, { noAck: false });

  } catch (error) {
    console.error('Falha na inicialização:', error.message);
    await shutdown(1);
  }
}

start();