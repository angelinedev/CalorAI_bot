function heuristicLines(summary, variant) {
  const { calories, protein, carbs, fats } = summary.totals;
  const lines = [];

  if (!summary.meals.length) {
    lines.push('Not enough data yet.');
    lines.push('Log your next meal and I will give a sharper day review.');
    return lines;
  }

  if (calories < 1200) {
    lines.push('Your intake looks low for the day.');
    lines.push('You should probably eat a bit more with a balanced meal or snack.');
  } else if (calories > 2400) {
    lines.push('Your intake is running high today.');
    lines.push('A lighter next meal would help balance things out.');
  } else {
    lines.push('Your calorie intake looks fairly balanced today.');
  }

  if (protein < 60) {
    lines.push('Protein is low, so add eggs, paneer, curd, dal, tofu, or chicken next.');
  } else if (protein >= 100) {
    lines.push('Protein looks strong today.');
  }

  if (carbs > 300) {
    lines.push('Carbs are on the higher side, so keep the next meal simpler.');
  }

  if (fats > 90) {
    lines.push('Fat intake is high, so a less oily next meal would be smart.');
  }

  lines.push(
    variant.key === 'A'
      ? 'Next move: go protein-first in the next meal.'
      : 'Next move: keep going, just steer your next meal based on today\'s balance.'
  );

  return lines;
}

export class DailyAnalysisService {
  constructor({ geminiService }) {
    this.geminiService = geminiService;
  }

  async generate({ summary, variant }) {
    const ai = await this.geminiService?.analyzeDailySummary({ summary, variant });
    if (ai?.headline && ai?.advice) {
      return {
        headline: ai.headline,
        advice: ai.advice,
        suggestions: ai.suggestions?.length ? ai.suggestions : ['Log meal', 'Today summary'],
        source: 'gemini'
      };
    }

    const [headline, ...rest] = heuristicLines(summary, variant);
    return {
      headline: `Daily analysis for ${summary.date}`,
      advice: [headline, ...rest].join('\n'),
      suggestions: ['Log meal', 'Today summary', 'List meals'],
      source: 'heuristic'
    };
  }
}
