import { DailyAnalysisService } from './daily-analysis.js';

function formatMeal(meal) {
  return `${meal.id} - ${meal.name} - ${meal.calories} kcal - P${meal.protein}/C${meal.carbs}/F${meal.fats}`;
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

function isPortalCommand(input) {
  const normalized = String(input || '').trim().toLowerCase();
  return normalized === '/portal' || normalized === 'portal' || normalized === '/createportal';
}

export class HealthBotService {
  constructor({ mealService, experimentService, geminiService, dailyAnalysisService, accountService }) {
    this.mealService = mealService;
    this.experimentService = experimentService;
    this.geminiService = geminiService;
    this.dailyAnalysisService = dailyAnalysisService || new DailyAnalysisService({ geminiService });
    this.accountService = accountService;
  }

  async respond({ userId, text, profile = {} }) {
    const assignment = await this.experimentService.assignUser(userId);
    const message = text.trim();
    const lower = message.toLowerCase();

    if (!message || lower === '/start') {
      return this.composeReply(
        assignment,
        [
          'CalorAI is live.',
          assignment.variant.intro,
          'You can send a meal naturally, like "I just ate chicken biryani".',
          'Commands:',
          'log oats bowl | 320 | 14 | 48 | 8',
          'edit <mealId> calories=450',
          'delete <mealId>',
          '/summary',
          '/analysis',
          '/portal or /createportal'
        ],
        ['Quick log', 'Today summary', 'Daily analysis']
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
          '/analysis',
          '/portal or /createportal',
          'You can also say things like: I just ate chicken biryani'
        ],
        ['Today summary', 'Daily analysis']
      );
    }

    if (isPortalCommand(message)) {
      const creds = this.accountService.issuePortalCredentials({
        telegramUserId: userId,
        telegramUsername: profile.telegramUsername,
        displayName: profile.displayName
      });

      return this.composeReply(
        assignment,
        [
          'Your CalorAI portal credentials are ready.',
          `Username: ${creds.username}`,
          `Password: ${creds.password}`,
          `Portal: ${profile.portalUrl || 'Open the dashboard link shared by the admin.'}`,
          'Telegram shortcut: use /createportal any time to refresh the login.',
          'You can change the password later from the portal.'
        ],
        ['Today summary', 'Daily analysis']
      );
    }

    if (lower === '/summary' || lower === 'summary' || lower === 'today summary') {
      const summary = await this.mealService.getDailySummary(userId);
      return this.composeReply(assignment, [formatSummary(summary), assignment.variant.followUp], ['Log meal', 'Daily analysis']);
    }

    if (lower === '/analysis' || lower === 'analysis' || lower === 'day analysis' || lower === 'today analysis') {
      const summary = await this.mealService.getDailySummary(userId);
      const analysis = await this.dailyAnalysisService.generate({ summary, variant: assignment.variant });
      return this.composeReply(
        assignment,
        [analysis.headline, analysis.advice, '', formatSummary(summary)],
        analysis.suggestions?.length ? analysis.suggestions : ['Log meal', 'Today summary']
      );
    }

    if (lower === '/meals' || lower === 'list meals') {
      const meals = await this.mealService.listMeals(userId);
      const lines = meals.length ? meals.map(formatMeal) : ['No meals logged today yet.'];
      return this.composeReply(assignment, ['Today\'s meals', ...lines], ['Log meal', 'Daily analysis']);
    }

    if (lower === 'quick log') {
      return this.composeReply(
        assignment,
        ['Send a meal naturally, like "I just ate chicken biryani", or use:', 'log paneer wrap | 430 | 28 | 35 | 18'],
        ['Today summary', 'Help']
      );
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
        ['Today summary', 'Daily analysis']
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

    const geminiAction = await this.geminiService?.interpretMessage({
      message,
      variant: assignment.variant
    });

    if (geminiAction) {
      if (geminiAction.intent === 'summary') {
        const summary = await this.mealService.getDailySummary(userId);
        return this.composeReply(
          assignment,
          [geminiAction.reply, '', formatSummary(summary)],
          geminiAction.suggestions?.length ? geminiAction.suggestions : ['Log meal', 'Daily analysis']
        );
      }

      if (geminiAction.intent === 'log_meal' && geminiAction.meal?.name) {
        const meal = await this.mealService.createMeal(userId, {
          ...geminiAction.meal,
          notes: geminiAction.meal.notes || 'Estimated from natural-language message by Gemini.',
          source: 'gemini'
        });

        return this.composeReply(
          assignment,
          [geminiAction.reply, formatMeal(meal), assignment.variant.followUp],
          geminiAction.suggestions?.length ? geminiAction.suggestions : ['Today summary', 'Daily analysis']
        );
      }

      if (geminiAction.intent === 'edit_meal' && geminiAction.mealId && geminiAction.patch) {
        const updated = await this.mealService.updateMeal(userId, geminiAction.mealId, geminiAction.patch);
        if (updated) {
          return this.composeReply(
            assignment,
            [geminiAction.reply, formatMeal(updated)],
            geminiAction.suggestions?.length ? geminiAction.suggestions : ['Today summary']
          );
        }
      }

      if (geminiAction.intent === 'delete_meal' && geminiAction.mealId) {
        const deleted = await this.mealService.deleteMeal(userId, geminiAction.mealId);
        if (deleted) {
          return this.composeReply(
            assignment,
            [geminiAction.reply, assignment.variant.followUp],
            geminiAction.suggestions?.length ? geminiAction.suggestions : ['Log meal', 'Today summary']
          );
        }
      }

      return this.composeReply(
        assignment,
        [geminiAction.reply],
        geminiAction.suggestions?.length ? geminiAction.suggestions : ['Quick log', 'Today summary', 'Daily analysis']
      );
    }

    return this.composeReply(
      assignment,
      [
        assignment.variant.key === 'A'
          ? 'I can help fastest if you send a structured command.'
          : 'I can absolutely help. The quickest path is a structured command so I can log or edit accurately.',
        'Examples:',
        'I just ate chicken biryani',
        'log smoothie | 280 | 18 | 30 | 9',
        '/summary',
        '/analysis',
        '/portal or /createportal'
      ],
      ['Quick log', 'Today summary', 'Daily analysis']
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
