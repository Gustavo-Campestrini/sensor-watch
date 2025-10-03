require("dotenv").config();
const amqp = require("amqplib");
const config = require("./config/config.js");
const MAX_RETRIES = 3;

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
      console.log(
        `[Retry-Service] Reenviando diretamente para a fila '${destinationQueue}'.  Processando tentativa #${retryCount} de ${MAX_RETRIES}`
      );
      channel.sendToQueue(destinationQueue, msg.content, {
        headers: newHeaders,
        persistent: true,
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
