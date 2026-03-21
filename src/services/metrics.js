import { readFile } from 'node:fs/promises';
import path from 'node:path';

export class MetricsService {
  constructor({ dataDir, experimentService }) {
    this.filePath = path.join(dataDir, 'events.jsonl');
    this.experimentService = experimentService;
  }

  async readEvents() {
    try {
      const raw = await readFile(this.filePath, 'utf8');
      return raw
        .split('\n')
        .filter(Boolean)
        .map((line) => JSON.parse(line));
    } catch {
      return [];
    }
  }

  async getDashboardMetrics() {
    const events = await this.readEvents();
    const uniqueUsers = new Set(events.map((event) => event.userId).filter(Boolean));
    const mealEvents = events.filter((event) => event.type.startsWith('meal_'));
    const exposures = events.filter((event) => event.type === 'experiment_exposure');
    const sentMessages = events.filter((event) => event.type === 'telegram_message_sent');

    const variantBreakdown = this.experimentService.getVariants().map((variant) => ({
      variant: variant.key,
      name: variant.name,
      users: new Set(exposures.filter((event) => event.variant === variant.key).map((event) => event.userId)).size
    }));

    const activationUsers = new Set(
      events.filter((event) => event.type === 'meal_logged').map((event) => event.userId)
    ).size;

    return {
      overview: {
        totalEvents: events.length,
        totalUsers: uniqueUsers.size,
        activationRate: uniqueUsers.size ? Number((activationUsers / uniqueUsers.size).toFixed(2)) : 0,
        mealsLogged: mealEvents.filter((event) => event.type === 'meal_logged').length,
        mealsEdited: mealEvents.filter((event) => event.type === 'meal_edited').length,
        mealsDeleted: mealEvents.filter((event) => event.type === 'meal_deleted').length,
        outboundMessages: sentMessages.length
      },
      experiments: {
        name: this.experimentService.experimentName,
        variants: variantBreakdown
      },
      recentEvents: events.slice(-30).reverse()
    };
  }

  async getEvaluationFramework() {
    return {
      northStar: 'Increase the number of users who log at least one meal per day.',
      primaryMetrics: [
        'Activation rate: users with at least one meal_logged event / exposed users',
        'Meal logging volume per user per day',
        'Summary views after logging'
      ],
      guardrailMetrics: [
        'Delete rate after logging',
        'Edit rate, which can indicate parser accuracy issues',
        'Message send failures'
      ],
      notes: [
        'Variant A optimizes for speed and clarity.',
        'Variant B optimizes for warmth and continued engagement.',
        'Statsig can replace the local deterministic assignment service in production.'
      ]
    };
  }
}
