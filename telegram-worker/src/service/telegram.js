const config = require('../config/config.js');

/**
 * Envia uma mensagem para o Telegram usando a API fetch nativa do Node.js (v18+).
 * @param {string} text - O texto da mensagem a ser enviada.
 * @returns {Promise<object>} A resposta da API do Telegram.
 */
async function sendTelegramMessage(text) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 15000); 

  try {
    const response = await fetch(`https://api.telegram.org/bot${config.TELEGRAM_BOT_TOKEN}/sendMessage`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        chat_id: config.TELEGRAM_CHAT_ID,
        text: text,
        parse_mode: 'MarkdownV2'
      }),
      signal: controller.signal 
    });

    if (!response.ok) {
      const errorData = await response.json();
      throw new Error(`Erro da API do Telegram: ${response.status} - ${errorData.description}`);
    }

    return await response.json();

  } catch (error) {
    if (error.name === 'AbortError') {
      throw new Error('Tempo excedido ao tentar conectar com a API do Telegram.');
    }
    throw error;
  } finally {
    clearTimeout(timeoutId);
  }
}

module.exports = { sendTelegramMessage };