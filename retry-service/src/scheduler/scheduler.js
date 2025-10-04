const Logger = require('../logger/logger');

class Scheduler {
  constructor(channel, config) {
    this.channel = channel;
    this.config = config;
    this.scheduledMessages = [];
    this.lastDispatchPerQueue = new Map();
    this.interval = null;
  }

  schedule(message) {
    this.scheduledMessages.push(message);
  }

  start() {
    Logger.info('[Scheduler] Iniciado (tick 1s)');
    this.interval = setInterval(() => this.tick(), 1000);
  }

  tick() {
    const now = Date.now();
    if (this.scheduledMessages.length === 0) return;

    const ready = [];
    for (let i = this.scheduledMessages.length - 1; i >= 0; i--) {
      if (this.scheduledMessages[i].retryAt <= now) {
        ready.push(this.scheduledMessages.splice(i, 1)[0]);
      }
    }
    if (ready.length === 0) return;

    let sent = 0;
    ready.forEach(msgInfo => {
      const createdAt = msgInfo.headers['x-created-at'];
      if (createdAt && (now - createdAt) > this.config.MESSAGE_TTL_MS) {
        Logger.warn(`[Retry] Descartando mensagem expirada (TTL ${(now - createdAt)}ms > ${this.config.MESSAGE_TTL_MS}ms)`);
        return;
      }

      const last = this.lastDispatchPerQueue.get(msgInfo.destinationQueue) || 0;
      const sinceLast = now - last;
      if (sinceLast < this.config.MIN_DISPATCH_INTERVAL_MS) {
        msgInfo.retryAt = now + (this.config.MIN_DISPATCH_INTERVAL_MS - sinceLast);
        this.scheduledMessages.push(msgInfo);
        return;
      }

      this.channel.sendToQueue(msgInfo.destinationQueue, msgInfo.content, {
        persistent: true,
        headers: msgInfo.headers,
      });
      this.lastDispatchPerQueue.set(msgInfo.destinationQueue, now);
      sent++;
    });

    if (sent > 0) Logger.info(`[Scheduler] Enviadas ${sent} mensagem(ns)`);
  }
}

module.exports = Scheduler;
