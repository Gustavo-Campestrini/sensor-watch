/**
 * Formata o payload de um alerta em uma mensagem de texto legível para humanos,
 * ideal para ser enviada via Telegram usando MarkdownV2.
 * @param {object} payload - O objeto de dados do alerta.
 * @param {string} [fallbackText=''] - Um texto para usar caso o payload não tenha descrição.
 * @returns {string} A mensagem formatada.
 */
function formatAlertMessage(payload, fallbackText = '') {
  const rawType = (payload.type || '').toString();
  const type = rawType.toLowerCase();

  const sensorInfo = {
    temperature: { translation: 'Temperatura', unit: '°C' },
    pressure:    { translation: 'Pressão',     unit: 'hPa' },
    vibration:   { translation: 'Vibração',    unit: 'mm/s' },
  };

  const info = sensorInfo[type] || { translation: rawType, unit: '' };
  const unit = info.unit;
  const translatedType = info.translation;
  const title = '🚨 *Alerta\\!*';

  const lines = [title];

  if (rawType) {
    lines.push(`*Tipo:* \`${escapeMarkdownV2(translatedType)}\``);
  }

  if (payload.place) {
    lines.push(`*Local:* \`${escapeMarkdownV2(payload.place)}\``);
  }

  if (payload.value !== undefined && payload.value !== null) {
    let formattedValue;
    if (typeof payload.value === 'number') {
      const displayUnit = unit ? ` ${unit}` : '';
      formattedValue = payload.value.toFixed(2) + displayUnit;
    } else {
      formattedValue = String(payload.value);
    }
    lines.push(`*Valor:* \`${escapeMarkdownV2(formattedValue)}\``);
  }

  if (payload.timestamp) {
    const date = new Date(payload.timestamp);
    const formattedDate = escapeMarkdownV2(date.toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' }));
    lines.push(`*Horário:* ${formattedDate}`);
  }

  if (fallbackText) {
    lines.push('');
    lines.push(fallbackText);
  }

  return lines.join('\n');
}

/**
 * Processa a mensagem bruta do RabbitMQ.
 * Tenta fazer o parse do JSON e normaliza os campos para um formato padrão.
 * Se o parse falhar, trata a mensagem como texto puro.
 * @param {object} msg - O objeto da mensagem original do RabbitMQ.
 * @returns {{payload: object, formatted: string}} - Um objeto contendo os dados normalizados e a mensagem formatada.
 */
function parseMessageContent(msg) {
  const content = msg.content.toString();

  try {
    const data = JSON.parse(content);

    const normalizedPayload = {
      type: data.type ?? data.alertType ?? data.sensorType ?? 'desconhecido',
      value: data.value ?? data.measure ?? null,
      place: data.place ?? data.location ?? null,
      timestamp: data.timestamp ?? new Date().toISOString(),
      metadata: data
    };

    return {
      payload: normalizedPayload,
      formatted: formatAlertMessage(normalizedPayload)
    };
  } catch (error) {
    const fallbackPayload = {
      type: 'Formato Inválido',
      timestamp: new Date().toISOString(),
      metadata: { rawMessage: content }
    };

    return {
      payload: fallbackPayload,
      formatted: formatAlertMessage(fallbackPayload, `A mensagem recebida não pôde ser processada:\n\n\`\`\`\n${content}\n\`\`\``)
    };
  }
}

/**
 * Escapa caracteres especiais para o formato MarkdownV2 do Telegram.
 * @param {string} text - O texto a ser escapado.
 * @returns {string} O texto com caracteres de escape.
 */
function escapeMarkdownV2(text) {
  const charsToEscape = ['_', '*', '[', ']', '(', ')', '~', '`', '>', '#', '+', '-', '=', '|', '{', '}', '.', '!'];
  return charsToEscape.reduce((acc, char) => acc.replace(new RegExp(`\\${char}`, 'g'), `\\${char}`), text);
}

module.exports = { parseMessageContent };