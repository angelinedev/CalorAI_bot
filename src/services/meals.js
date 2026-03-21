import crypto from 'node:crypto';

function isoDate(input = new Date()) {
  return new Date(input).toISOString().slice(0, 10);
}

export class MealService {
  constructor({ mealsStore, profilesStore, eventLogger }) {
    this.mealsStore = mealsStore;
    this.profilesStore = profilesStore;
    this.eventLogger = eventLogger;
  }

  async ensureProfile(userId) {
    const profiles = await this.profilesStore.read();
    if (!profiles[userId]) {
      profiles[userId] = {
        userId,
        createdAt: new Date().toISOString(),
        timezone: 'Asia/Calcutta'
      };
      await this.profilesStore.write(profiles);
    }
    return profiles[userId];
  }

  async listMeals(userId, date = isoDate()) {
    const meals = await this.mealsStore.read();
    return meals
      .filter((meal) => meal.userId === userId && meal.loggedAt.slice(0, 10) === date)
      .sort((a, b) => a.loggedAt.localeCompare(b.loggedAt));
  }

  async createMeal(userId, input) {
    await this.ensureProfile(userId);

    const meal = {
      id: crypto.randomUUID().slice(0, 8),
      userId,
      name: input.name,
      calories: Number(input.calories || 0),
      protein: Number(input.protein || 0),
      carbs: Number(input.carbs || 0),
      fats: Number(input.fats || 0),
      notes: input.notes || '',
      loggedAt: input.loggedAt || new Date().toISOString(),
      source: input.source || 'manual'
    };

    await this.mealsStore.update((current) => [...current, meal]);
    await this.eventLogger.log({
      type: 'meal_logged',
      userId,
      mealId: meal.id,
      calories: meal.calories,
      source: meal.source
    });
    return meal;
  }

  async updateMeal(userId, mealId, patch) {
    let updatedMeal = null;

    await this.mealsStore.update((current) =>
      current.map((meal) => {
        if (meal.userId !== userId || meal.id !== mealId) {
          return meal;
        }

        updatedMeal = {
          ...meal,
          ...patch,
          calories: patch.calories !== undefined ? Number(patch.calories) : meal.calories,
          protein: patch.protein !== undefined ? Number(patch.protein) : meal.protein,
          carbs: patch.carbs !== undefined ? Number(patch.carbs) : meal.carbs,
          fats: patch.fats !== undefined ? Number(patch.fats) : meal.fats
        };
        return updatedMeal;
      })
    );

    if (!updatedMeal) {
      return null;
    }

    await this.eventLogger.log({
      type: 'meal_edited',
      userId,
      mealId,
      fields: Object.keys(patch)
    });
    return updatedMeal;
  }

  async deleteMeal(userId, mealId) {
    let deleted = null;

    await this.mealsStore.update((current) =>
      current.filter((meal) => {
        const shouldDelete = meal.userId === userId && meal.id === mealId;
        if (shouldDelete) {
          deleted = meal;
        }
        return !shouldDelete;
      })
    );

    if (!deleted) {
      return null;
    }

    await this.eventLogger.log({
      type: 'meal_deleted',
      userId,
      mealId
    });
    return deleted;
  }

  async getDailySummary(userId, date = isoDate()) {
    const meals = await this.listMeals(userId, date);
    const totals = meals.reduce(
      (acc, meal) => {
        acc.calories += meal.calories;
        acc.protein += meal.protein;
        acc.carbs += meal.carbs;
        acc.fats += meal.fats;
        return acc;
      },
      { calories: 0, protein: 0, carbs: 0, fats: 0 }
    );

    await this.eventLogger.log({
      type: 'summary_viewed',
      userId,
      date,
      mealCount: meals.length
    });

    return {
      date,
      totals,
      meals
    };
  }
}
