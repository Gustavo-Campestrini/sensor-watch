const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '../../.env') });

module.exports = {
  RABBITMQ_URL      : process.env.RABBITMQ_URL,
  MONGO_URL         : process.env.MONGO_URL,
  MAIN_QUEUE        : process.env.MAIN_QUEUE || 'alerts.log',
  RETRY_QUEUE       : process.env.RETRY_QUEUE || 'alerts.retry',
};