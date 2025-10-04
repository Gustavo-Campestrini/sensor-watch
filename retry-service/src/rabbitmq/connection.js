const amqp = require('amqplib');
const Logger = require('../logger/logger');

class RabbitMQConnection {
  constructor(url) {
    this.url = url;
    this.connection = null;
    this.channel = null;
  }

  async connect() {
    this.connection = await amqp.connect(this.url);
    this.channel = await this.connection.createChannel();
    Logger.info('Conectado ao RabbitMQ');
    return this.channel;
  }

  async close() {
    try {
      if (this.channel) await this.channel.close();
      if (this.connection) await this.connection.close();
      Logger.info('Conexão com RabbitMQ encerrada');
    } catch (error) {
      Logger.error(`Erro ao fechar conexão: ${error.message}`);
    }
  }
}

module.exports = RabbitMQConnection;
