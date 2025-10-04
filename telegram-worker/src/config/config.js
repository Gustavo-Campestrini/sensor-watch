const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '../../.env') });

module.exports = {
  RABBITMQ_URL: process.env.RABBITMQ_URL,
  TELEGRAM_BOT_TOKEN: process.env.TELEGRAM_BOT_TOKEN,
  TELEGRAM_CHAT_ID: process.env.TELEGRAM_CHAT_ID,
  ALERTS_EXCHANGE: process.env.ALERTS_EXCHANGE,
  ALERT_NOTIFICATION_QUEUE: process.env.ALERT_NOTIFICATION_QUEUE,
  ALERT_RETRY_QUEUE: process.env.ALERT_RETRY_QUEUE,
  TELEGRAM_PARSE_MODE: process.env.TELEGRAM_PARSE_MODE,
};