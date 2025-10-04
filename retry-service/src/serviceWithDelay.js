require('dotenv').config();
const amqp = require('amqplib');
const config = require('./config/config.js');

// Lista em memória de mensagens aguardando o momento de retry
const scheduledMessages = [];
// Controle de último envio por fila (throttling)
const lastDispatchPerQueue = new Map();

/**
 * Agendador responsável por liberar mensagens quando o retryAt é atingido.
 * Aplica TTL (descarta mensagens expiradas) e throttling por fila.
 * @param {import('amqplib').Channel} channel
 */
function startScheduler(channel) {
  console.log('[Scheduler] Iniciado (tick 1s).');
  setInterval(() => {
    const now = Date.now();
    if (scheduledMessages.length === 0) return;

    const ready = [];
    for (let i = scheduledMessages.length - 1; i >= 0; i--) {
      if (scheduledMessages[i].retryAt <= now) {
        ready.push(scheduledMessages.splice(i, 1)[0]);
      }
    }
    if (ready.length === 0) return;

    let sent = 0;
    ready.forEach(msgInfo => {
      const createdAt = msgInfo.headers['x-created-at'];
      if (createdAt && (now - createdAt) > config.MESSAGE_TTL_MS) {
        console.warn(`[Retry] Descartando mensagem expirada (TTL ${(now - createdAt)}ms > ${config.MESSAGE_TTL_MS}ms).`);
        return; // descarta
      }

      const last = lastDispatchPerQueue.get(msgInfo.destinationQueue) || 0;
      const sinceLast = now - last;
      if (sinceLast < config.MIN_DISPATCH_INTERVAL_MS) {
        // Reagenda para o momento mínimo necessário
        msgInfo.retryAt = now + (config.MIN_DISPATCH_INTERVAL_MS - sinceLast);
        scheduledMessages.push(msgInfo);
        return;
      }

      channel.sendToQueue(msgInfo.destinationQueue, msgInfo.content, {
        persistent: true,
        headers: msgInfo.headers,
      });
      lastDispatchPerQueue.set(msgInfo.destinationQueue, now);
      sent++;
    });
    if (sent > 0) console.log(`[Scheduler] Enviadas ${sent} mensagem(ns).`);
  }, 1000);
}

/**
 * @param {import('amqplib').Channel} channel
 * @param {import('amqplib').ConsumeMessage} msg
 */
async function handleRetryMessage(channel, msg) {
  const headers = msg.properties.headers || {};
  const retryCount = (headers['x-retry-count'] || 0) + 1;
  const sourceService = headers['x-source-service'] || 'desconhecido';

  if (!headers['x-created-at']) {
    headers['x-created-at'] = Date.now();
  }

  if (retryCount <= config.MAX_RETRIES) {
    const newHeaders = { ...headers, 'x-retry-count': retryCount };

    let destinationQueue = headers['x-destination-queue'];

    if (!destinationQueue) {
      switch (sourceService) {
        case 'mongodb-worker': destinationQueue = config.ALERT_LOG_QUEUE; break;
        case 'telegram-worker': destinationQueue = config.ALERT_NOTIFICATION_QUEUE; break;
      }
    }

    if (!destinationQueue) {
      console.warn(`[Retry] Nenhuma fila de destino definida (sem 'x-destination-queue' e origem '${sourceService}' não mapeada). Descartando.`);
      channel.ack(msg);
      return;
    }

    let delay;
    if (Array.isArray(config.RETRY_DELAYS_MS) && config.RETRY_DELAYS_MS.length > 0 && config.RETRY_DELAYS_MS.some(v => v > 0)) {
      delay = config.RETRY_DELAYS_MS[Math.min(retryCount - 1, config.RETRY_DELAYS_MS.length - 1)];
    } else {
      const base = config.BACKOFF_BASE_MS;
      const factor = config.BACKOFF_FACTOR <= 1 ? 2 : config.BACKOFF_FACTOR; 
      const raw = base * Math.pow(factor, retryCount - 1);
      delay = Math.min(raw, config.BACKOFF_MAX_MS);
      if (config.BACKOFF_JITTER_PCT > 0) {
        const pct = config.BACKOFF_JITTER_PCT;
        const variation = delay * pct;
        const min = delay - variation;
        const max = delay + variation;
        delay = Math.max(0, Math.round(min + Math.random() * (max - min)));
      }
    }
    const retryAt = Date.now() + delay;

    console.log(`[Retry] Tentativa #${retryCount} (delay ${delay}ms${config.RETRY_DELAYS_MS.length ? ' / tabela' : ' / exponencial'}) -> '${destinationQueue}'.`);
    scheduledMessages.push({
      destinationQueue,
      content: msg.content,
      headers: newHeaders,
      retryAt,
    });
  } else {
    console.warn('[Retry] Máximo de tentativas atingido. Enviando para DLQ.');
    channel.sendToQueue(config.ALERT_DQL, msg.content, { persistent: true, headers });
  }
  channel.ack(msg);
}

async function start() {
  let connection;
  let channel;

  const shutdown = async (code = 0) => {
    console.log("Desligando...");
    try {
      if (channel) await channel.close();
      if (connection) await connection.close();
      console.log("Conexão com RabbitMQ encerrada.");
    } catch (error) {
      console.error("Erro ao encerrar conexões:", error.message);
    } finally {
      process.exit(code);
    }
  };

  process.on("SIGINT", () => shutdown(0));
  process.on("SIGTERM", () => shutdown(0));
  process.on("uncaughtException", (error) => {
    console.error(
      "[Retry-Service] Exceção não tratada:",
      error.message,
      error.stack
    );
    shutdown(1);
  });
  process.on("unhandledRejection", (reason) => {
    console.error("Promise rejeitada sem tratamento:", reason);
    shutdown(1);
  });

  try {
    connection = await amqp.connect(config.RABBITMQ_URL);
    channel = await connection.createChannel();
    await channel.assertQueue(config.ALERT_RETRY_QUEUE, { durable: true });
    await channel.prefetch(1);

    startScheduler(channel);

    console.log(
      `Aguardando mensagens na fila '${config.ALERT_RETRY_QUEUE}'...`
    );

    await channel.consume(
      config.ALERT_RETRY_QUEUE,
      (msg) => {
        if (msg) handleRetryMessage(channel, msg);
      },
      { noAck: false }
    );
  } catch (error) {
    console.error("Falha na inicialização:", error.message);
    await shutdown(1);
  }
}

start();