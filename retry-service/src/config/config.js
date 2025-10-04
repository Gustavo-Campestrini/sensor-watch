const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '../../.env') });

module.exports = {
  RABBITMQ_URL: process.env.RABBITMQ_URL || 'amqp://localhost',
  ALERT_NOTIFICATION_QUEUE: process.env.ALERT_NOTIFICATION_QUEUE || 'alerts.notification',
  ALERT_LOG_QUEUE:  process.env.ALERT_LOG_QUEUE || 'alerts.log',
  ALERT_RETRY_QUEUE: process.env.ALERT_RETRY_QUEUE || 'alerts.retry',
  ALERT_DQL: process.env.ALERT_DQL || 'alerts.dql',

  // Máximo de tentativas antes de enviar para a DLQ
  MAX_RETRIES: parseInt(process.env.MAX_RETRIES || '3', 10),

  // Delays entre cada tentativa (ms). Pode sobrescrever via RETRY_DELAYS_MS="5000,10000,30000"
  RETRY_DELAYS_MS: (process.env.RETRY_DELAYS_MS || '5000,10000,30000')
    .split(',')
    .map(v => parseInt(v.trim(), 10))
    .filter(n => !isNaN(n) && n >= 0),

  // Tempo máximo que a mensagem permanece válida desde a criação (ms)
  MESSAGE_TTL_MS: parseInt(process.env.MESSAGE_TTL_MS || '300000', 10), // 5 min

  // Intervalo mínimo entre despachos para a mesma fila (ms) - anti rajada
  MIN_DISPATCH_INTERVAL_MS: parseInt(process.env.MIN_DISPATCH_INTERVAL_MS || '500', 10),
};