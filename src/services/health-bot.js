function formatMeal(meal) {
  return `${meal.id} • ${meal.name} • ${meal.calories} kcal • P${meal.protein}/C${meal.carbs}/F${meal.fats}`;
}

function formatSummary(summary) {
  return [
    `Summary for ${summary.date}`,
    `Calories: ${summary.totals.calories}`,
    `Protein: ${summary.totals.protein} g`,
    `Carbs: ${summary.totals.carbs} g`,
    `Fats: ${summary.totals.fats} g`,
    summary.meals.length ? 'Meals:' : 'No meals logged yet.',
    ...summary.meals.map(formatMeal)
  ].join('\n');
}

function parseKeyValueSegments(text) {
  return text.split(/\s+/).reduce((acc, token) => {
    const [key, value] = token.split('=');
    if (value !== undefined) {
      acc[key.toLowerCase()] = value;
    }
    return acc;
  }, {});
}

function parseLogCommand(text) {
  const payload = text.replace(/^(log|add)\s+/i, '');
  const [namePart, caloriesPart = '0', proteinPart = '0', carbsPart = '0', fatsPart = '0'] = payload
    .split('|')
    .map((part) => part.trim());

  if (!namePart) {
    return null;
  }

  return {
    name: namePart,
    calories: Number(caloriesPart),
    protein: Number(proteinPart),
    carbs: Number(carbsPart),
    fats: Number(fatsPart),
    source: 'chat'
  };
}

export class HealthBotService {
  constructor({ mealService, experimentService }) {
    this.mealService = mealService;
    this.experimentService = experimentService;
  }

  async respond({ userId, text }) {
    const assignment = await this.experimentService.assignUser(userId);
    const message = text.trim();
    const lower = message.toLowerCase();

    if (!message || lower === '/start') {
      return this.composeReply(
        assignment,
        [
          'CalorAI is live.',
          assignment.variant.intro,
          'Use:',
          'log oats bowl | 320 | 14 | 48 | 8',
          'edit <mealId> calories=450',
          'delete <mealId>',
          '/summary'
        ],
        ['Quick log', 'Today summary', 'Help']
      );
    }

    if (lower === '/help' || lower === 'help') {
      return this.composeReply(
        assignment,
        [
          'Commands',
          'log meal name | calories | protein | carbs | fats',
          'edit mealId calories=400 protein=20',
          'delete mealId',
          '/summary',
          '/meals'
        ],
        ['Today summary', 'List meals']
      );
    }

    if (lower === '/summary' || lower === 'summary' || lower === 'today summary') {
      const summary = await this.mealService.getDailySummary(userId);
      return this.composeReply(assignment, [formatSummary(summary), assignment.variant.followUp], ['Log meal', 'List meals']);
    }

    if (lower === '/meals' || lower === 'list meals') {
      const meals = await this.mealService.listMeals(userId);
      const lines = meals.length ? meals.map(formatMeal) : ['No meals logged today yet.'];
      return this.composeReply(assignment, ['Today\'s meals', ...lines], ['Log meal', 'Today summary']);
    }

    if (lower.startsWith('log ') || lower.startsWith('add ')) {
      const parsed = parseLogCommand(message);
      if (!parsed) {
        return this.composeReply(assignment, ['I could not parse that meal. Try:', 'log paneer wrap | 430 | 28 | 35 | 18'], ['Help']);
      }

      const meal = await this.mealService.createMeal(userId, parsed);
      return this.composeReply(
        assignment,
        [`Logged ${meal.name}.`, formatMeal(meal), assignment.variant.followUp],
        ['Today summary', `Delete ${meal.id}`]
      );
    }

    if (lower.startsWith('edit ')) {
      const parts = message.split(/\s+/);
      const mealId = parts[1];
      const patch = parseKeyValueSegments(parts.slice(2).join(' '));
      const updated = await this.mealService.updateMeal(userId, mealId, patch);

      if (!updated) {
        return this.composeReply(assignment, [`I could not find meal ${mealId}.`], ['List meals']);
      }

      return this.composeReply(assignment, [`Updated ${updated.name}.`, formatMeal(updated)], ['Today summary']);
    }

    if (lower.startsWith('delete ')) {
      const mealId = message.split(/\s+/)[1];
      const deleted = await this.mealService.deleteMeal(userId, mealId);

      if (!deleted) {
        return this.composeReply(assignment, [`I could not find meal ${mealId}.`], ['List meals']);
      }

      return this.composeReply(assignment, [`Deleted ${deleted.name}.`, assignment.variant.followUp], ['Log meal', 'Today summary']);
    }

    return this.composeReply(
      assignment,
      [
        assignment.variant.key === 'A'
          ? 'I can help fastest if you send a structured command.'
          : 'I can absolutely help. The quickest path is a structured command so I can log or edit accurately.',
        'Examples:',
        'log smoothie | 280 | 18 | 30 | 9',
        '/summary'
      ],
      ['Quick log', 'Today summary', 'Help']
    );
  }

  composeReply(assignment, lines, suggestions = []) {
    return {
      experiment: assignment.experiment,
      variant: assignment.variant,
      text: lines.join('\n'),
      suggestions
    };
  }
}
