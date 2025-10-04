const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '../../.env') });

module.exports = {
  RABBITMQ_URL: process.env.RABBITMQ_URL || 'amqp://localhost',
  ALERT_NOTIFICATION_QUEUE: process.env.ALERT_NOTIFICATION_QUEUE || 'alerts.notification',
  ALERT_LOG_QUEUE:  process.env.ALERT_LOG_QUEUE || 'alerts.log',
  ALERT_RETRY_QUEUE: process.env.ALERT_RETRY_QUEUE || 'alerts.retry',
  ALERT_DQL: process.env.ALERT_DQL || 'alerts.dql',

  MAX_RETRIES: parseInt(process.env.MAX_RETRIES || '3', 10),

  RETRY_DELAYS_MS: (process.env.RETRY_DELAYS_MS)
    .split(',')
    .map(v => parseInt(v.trim(), 10))
    .filter(n => !isNaN(n) && n >= 0),

  BACKOFF_BASE_MS: parseInt(process.env.BACKOFF_BASE_MS),
  BACKOFF_FACTOR: parseFloat(process.env.BACKOFF_FACTOR),      
  BACKOFF_MAX_MS: parseInt(process.env.BACKOFF_MAX_MS), 
  BACKOFF_JITTER_PCT: Math.min(Math.max(parseFloat(process.env.BACKOFF_JITTER_PCT || '0'), 0), 1),

  MESSAGE_TTL_MS: parseInt(process.env.MESSAGE_TTL_MS), 

  MIN_DISPATCH_INTERVAL_MS: parseInt(process.env.MIN_DISPATCH_INTERVAL_MS),
};