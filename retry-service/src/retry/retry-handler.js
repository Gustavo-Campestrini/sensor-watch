const Logger = require('../logger/logger');

class RetryHandler {
  constructor(channel, scheduler, config) {
    this.channel = channel;
    this.scheduler = scheduler;
    this.config = config;
  }

  handle(msg) {
    const headers = msg.properties.headers || {};
    const retryCount = (headers['x-retry-count'] || 0) + 1;
    const sourceService = headers['x-source-service'] || 'desconhecido';

    if (!headers['x-created-at']) headers['x-created-at'] = Date.now();

    if (retryCount <= this.config.MAX_RETRIES) {
      const newHeaders = { ...headers, 'x-retry-count': retryCount };
      let destinationQueue = headers['x-destination-queue'];

      if (!destinationQueue) {
        switch (sourceService) {
          case 'mongodb-worker': destinationQueue = this.config.ALERT_LOG_QUEUE; break;
          case 'telegram-worker': destinationQueue = this.config.ALERT_NOTIFICATION_QUEUE; break;
        }
      }

      if (!destinationQueue) {
        Logger.warn(`[Retry] Nenhuma fila de destino definida. Descartando.`);
        this.channel.ack(msg);
        return;
      }

      const delay = this.calculateDelay(retryCount);
      const retryAt = Date.now() + delay;

      Logger.info(`[Retry] Tentativa #${retryCount} (delay ${delay}ms) -> '${destinationQueue}'`);
      this.scheduler.schedule({ destinationQueue, content: msg.content, headers: newHeaders, retryAt });
    } else {
      Logger.warn('[Retry] Máximo de tentativas atingido. Enviando para DLQ.');
      this.channel.sendToQueue(this.config.ALERT_DQL, msg.content, { persistent: true, headers });
    }

    this.channel.ack(msg);
  }

  calculateDelay(retryCount) {
    if (Array.isArray(this.config.RETRY_DELAYS_MS) && this.config.RETRY_DELAYS_MS.length > 0) {
      return this.config.RETRY_DELAYS_MS[Math.min(retryCount - 1, this.config.RETRY_DELAYS_MS.length - 1)];
    }

    const base = this.config.BACKOFF_BASE_MS;
    const factor = this.config.BACKOFF_FACTOR <= 1 ? 2 : this.config.BACKOFF_FACTOR;
    let delay = Math.min(base * Math.pow(factor, retryCount - 1), this.config.BACKOFF_MAX_MS);

    if (this.config.BACKOFF_JITTER_PCT > 0) {
      const variation = delay * this.config.BACKOFF_JITTER_PCT;
      const min = delay - variation;
      const max = delay + variation;
      delay = Math.round(min + Math.random() * (max - min));
    }

    return delay;
  }
}

module.exports = RetryHandler;
