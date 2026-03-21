export class TelegramService {
  constructor({ config, eventLogger }) {
    this.config = config;
    this.eventLogger = eventLogger;
  }

  hasBotToken() {
    return Boolean(this.config.telegramBotToken);
  }

  async sendMessage(chatId, text, suggestions = []) {
    await this.eventLogger.log({
      type: 'telegram_message_sent',
      userId: String(chatId),
      channel: 'telegram',
      suggestions
    });

    if (!this.hasBotToken()) {
      return { ok: false, skipped: true };
    }

    const replyMarkup = suggestions.length
      ? {
          keyboard: suggestions.map((label) => [{ text: label }]),
          resize_keyboard: true
        }
      : undefined;

    const response = await fetch(`${this.config.telegramApiBase}/bot${this.config.telegramBotToken}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: chatId,
        text,
        reply_markup: replyMarkup
      })
    });

    return response.json();
  }
}
