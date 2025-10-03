require("dotenv").config();
const amqp = require("amqplib");
const config = require("./config/config.js");
const MAX_RETRIES = 3;

const RETRY_DELAYS = [5000, 10000, 30000]; 

const scheduledMessages = [];

function startScheduler(channel) {
  console.log('[Scheduler] Agendador interno iniciado, verificando a cada segundo.');
  setInterval(() => {
    const now = Date.now();
    const messagesToSend = [];

    for (let i = scheduledMessages.length - 1; i >= 0; i--) {
      if (scheduledMessages[i].retryAt <= now) {
        messagesToSend.push(scheduledMessages.splice(i, 1)[0]);
      }
    }

    if (messagesToSend.length > 0) {
      console.log(`[Scheduler] Enviando ${messagesToSend.length} mensagem(ns) agendada(s).`);
      messagesToSend.forEach(msgInfo => {
        channel.sendToQueue(msgInfo.destinationQueue, msgInfo.content, {
          persistent: true,
          headers: msgInfo.headers,
        });
      });
    }
  }, 1000); 
}

async function handleRetryMessage(channel, msg) {
  const headers = msg.properties.headers || {};
  const retryCount = (headers["x-retry-count"] || 0) + 1;
  const sourceService = headers["x-source-service"] || "desconhecido";

  if (retryCount <= MAX_RETRIES) {
    const newHeaders = { ...headers, "x-retry-count": retryCount };

    let destinationQueue = "";
    switch (sourceService) {
      case "mongodb-worker":
        destinationQueue = config.ALERT_LOG_QUEUE;
        break;
      case "telegram-worker":
        destinationQueue = config.ALERT_NOTIFICATION_QUEUE;
        break;
    }

    if (destinationQueue) {
      const delay = RETRY_DELAYS[retryCount - 1];
      const retryAt = Date.now() + delay;

      console.log(
        `[Retry-Service] Agendando em memória para '${destinationQueue}' em ${delay / 1000}s. Tentativa #${retryCount}`
      );

      scheduledMessages.push({
        destinationQueue,
        content: msg.content,
        headers: newHeaders,
        retryAt,
      });

    } else {
      console.warn(
        `[Retry-Service] Origem '${sourceService}' desconhecida. Descartando mensagem.`
      );
    }
  } else {
    console.warn(
      `[Retry-Service] Limite de tentativas atingido. Enviando para a DLQ final.`
    );
    channel.sendToQueue(config.ALERT_DQL, msg.content, {
      persistent: true,
      headers: headers,
    });
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