const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '../../.env') });

module.exports = {
  RABBITMQ_URL: process.env.RABBITMQ_URL,
  ALERT_NOTIFICATION_QUEUE: 'alerts.notification',
  ALERT_LOG_QUEUE:  'alerts.log',
  ALERT_RETRY_QUEUE:'alerts.retry',
  ALERT_DQL: 'alerts.dql',
};