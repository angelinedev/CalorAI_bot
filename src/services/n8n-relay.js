export class N8nRelayService {
  constructor({ webhookUrl, eventLogger }) {
    this.webhookUrl = webhookUrl;
    this.eventLogger = eventLogger;
  }

  isEnabled() {
    return Boolean(this.webhookUrl);
  }

  async send(eventName, payload) {
    if (!this.isEnabled()) {
      return { ok: false, skipped: true };
    }

    try {
      const response = await fetch(this.webhookUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        signal: AbortSignal.timeout(3000),
        body: JSON.stringify({
          event: eventName,
          sentAt: new Date().toISOString(),
          payload
        })
      });

      await this.eventLogger?.log({
        type: 'n8n_webhook_sent',
        eventName,
        status: response.status
      });

      return { ok: response.ok, status: response.status };
    } catch (error) {
      await this.eventLogger?.log({
        type: 'n8n_webhook_failed',
        eventName,
        detail: error.message
      });

      return { ok: false, error: error.message };
    }
  }

  async mealLogged(meal) {
    return this.send('meal_logged', {
      userId: meal.userId,
      mealId: meal.id,
      mealName: meal.name,
      calories: meal.calories,
      protein: meal.protein,
      carbs: meal.carbs,
      fats: meal.fats,
      notes: meal.notes,
      loggedAt: meal.loggedAt,
      source: meal.source
    });
  }

  async mealEdited(meal, fields) {
    return this.send('meal_edited', {
      userId: meal.userId,
      mealId: meal.id,
      mealName: meal.name,
      calories: meal.calories,
      protein: meal.protein,
      carbs: meal.carbs,
      fats: meal.fats,
      editedFields: fields,
      loggedAt: meal.loggedAt
    });
  }

  async mealDeleted(meal) {
    return this.send('meal_deleted', {
      userId: meal.userId,
      mealId: meal.id,
      mealName: meal.name,
      calories: meal.calories,
      loggedAt: meal.loggedAt
    });
  }

  async summaryViewed(userId, summary) {
    return this.send('summary_viewed', {
      userId,
      date: summary.date,
      calories: summary.totals.calories,
      protein: summary.totals.protein,
      carbs: summary.totals.carbs,
      fats: summary.totals.fats,
      mealCount: summary.meals.length
    });
  }

  async portalCredentialsIssued(user, source = 'system') {
    return this.send('portal_credentials_issued', {
      userId: user.id,
      username: user.username,
      role: user.role,
      telegramUserId: user.telegramUserId || null,
      issuedSource: source
    });
  }
}
