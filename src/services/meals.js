import crypto from 'node:crypto';

function isoDate(input = new Date()) {
  return new Date(input).toISOString().slice(0, 10);
}

export class MealService {
  constructor({ database, eventLogger, statsigAdapter, n8nRelay }) {
    this.database = database;
    this.eventLogger = eventLogger;
    this.statsigAdapter = statsigAdapter;
    this.n8nRelay = n8nRelay;
  }

  async listMeals(userId, date = isoDate()) {
    return this.database.listMeals(userId, date);
  }

  async createMeal(userId, input) {
    const meal = this.database.createMeal({
      id: crypto.randomUUID().slice(0, 8),
      userId: String(userId),
      name: input.name,
      calories: Number(input.calories || 0),
      protein: Number(input.protein || 0),
      carbs: Number(input.carbs || 0),
      fats: Number(input.fats || 0),
      notes: input.notes || '',
      loggedAt: input.loggedAt || new Date().toISOString(),
      source: input.source || 'manual'
    });

    await this.eventLogger.log({
      type: 'meal_logged',
      userId: String(userId),
      mealId: meal.id,
      calories: meal.calories,
      source: meal.source
    });
    await this.statsigAdapter?.logEvent({
      userId,
      eventName: 'meal_logged',
      metadata: {
        meal_id: meal.id,
        meal_name: meal.name,
        calories: meal.calories,
        protein: meal.protein,
        carbs: meal.carbs,
        fats: meal.fats,
        source: meal.source
      }
    });
    await this.n8nRelay?.mealLogged(meal);
    return meal;
  }

  async updateMeal(userId, mealId, patch) {
    const updatedMeal = this.database.updateMeal(userId, mealId, patch);
    if (!updatedMeal) {
      return null;
    }

    await this.eventLogger.log({
      type: 'meal_edited',
      userId: String(userId),
      mealId,
      fields: Object.keys(patch)
    });
    await this.statsigAdapter?.logEvent({
      userId,
      eventName: 'meal_edited',
      metadata: {
        meal_id: mealId,
        fields: Object.keys(patch).join(',')
      }
    });
    await this.n8nRelay?.mealEdited(updatedMeal, Object.keys(patch));
    return updatedMeal;
  }

  async deleteMeal(userId, mealId) {
    const deleted = this.database.deleteMeal(userId, mealId);
    if (!deleted) {
      return null;
    }

    await this.eventLogger.log({
      type: 'meal_deleted',
      userId: String(userId),
      mealId
    });
    await this.statsigAdapter?.logEvent({
      userId,
      eventName: 'meal_deleted',
      metadata: {
        meal_id: mealId
      }
    });
    await this.n8nRelay?.mealDeleted(deleted);
    return deleted;
  }

  async getDailySummary(userId, date = isoDate()) {
    const summary = this.database.getDailySummary(userId, date);

    await this.eventLogger.log({
      type: 'summary_viewed',
      userId: String(userId),
      date,
      mealCount: summary.meals.length
    });
    await this.statsigAdapter?.logEvent({
      userId,
      eventName: 'summary_viewed',
      metadata: {
        date,
        meal_count: summary.meals.length,
        calories: summary.totals.calories
      }
    });
    await this.n8nRelay?.summaryViewed(userId, summary);

    return summary;
  }

  async getUserTrend(userId, days = 7) {
    return this.database.getMealTrend(userId, days);
  }
}
