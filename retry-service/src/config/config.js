const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '../../.env') });

module.exports = {
  RABBITMQ_URL: process.env.RABBITMQ_URL,
  ALERTS_EXCHANGE: process.env.ALERTS_EXCHANGE || 'alerts.notification',
  ALERT_NOTIFICATION_QUEUE: process.env.ALERT_NOTIFICATION_QUEUE || 'alerts.notification2',
  ALERT_RETRY_QUEUE: process.env.ALERT_RETRY_QUEUE || 'alerts.retry',
  ALERT_RETRY_DLX: process.env.ALERT_RETRY_DLX || 'alerts.retry-dlx',
};