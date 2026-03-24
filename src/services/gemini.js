function safeJsonParse(raw) {
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function extractResponseText(payload) {
  const parts = payload?.candidates?.[0]?.content?.parts || [];
  return parts
    .map((part) => part?.text || '')
    .join('')
    .trim();
}

const RESPONSE_SCHEMA = {
  type: 'OBJECT',
  properties: {
    intent: {
      type: 'STRING',
      enum: ['log_meal', 'edit_meal', 'delete_meal', 'summary', 'help', 'coach']
    },
    reply: { type: 'STRING' },
    suggestions: {
      type: 'ARRAY',
      items: { type: 'STRING' }
    },
    mealId: { type: 'STRING' },
    meal: {
      type: 'OBJECT',
      properties: {
        name: { type: 'STRING' },
        calories: { type: 'NUMBER' },
        protein: { type: 'NUMBER' },
        carbs: { type: 'NUMBER' },
        fats: { type: 'NUMBER' },
        notes: { type: 'STRING' }
      }
    },
    patch: {
      type: 'OBJECT',
      properties: {
        name: { type: 'STRING' },
        calories: { type: 'NUMBER' },
        protein: { type: 'NUMBER' },
        carbs: { type: 'NUMBER' },
        fats: { type: 'NUMBER' },
        notes: { type: 'STRING' }
      }
    }
  },
  required: ['intent', 'reply', 'suggestions']
};

const DAILY_ANALYSIS_SCHEMA = {
  type: 'OBJECT',
  properties: {
    headline: { type: 'STRING' },
    advice: { type: 'STRING' },
    suggestions: {
      type: 'ARRAY',
      items: { type: 'STRING' }
    }
  },
  required: ['headline', 'advice', 'suggestions']
};

export class GeminiService {
  constructor({ apiKey, model, eventLogger }) {
    this.apiKey = apiKey;
    this.model = model;
    this.eventLogger = eventLogger;
  }

  isEnabled() {
    return Boolean(this.apiKey);
  }

  async interpretMessage({ message, variant }) {
    if (!this.isEnabled()) {
      return null;
    }

    const prompt = [
      'You are the meal-parsing brain for a Telegram nutrition bot.',
      'Return only JSON that matches the schema.',
      'If the user casually mentions food they ate, treat it as intent=log_meal and estimate calories/macros conservatively.',
      'If the message asks for today totals, use intent=summary.',
      'If the user clearly wants help, use intent=help.',
      'If the message is conversational but not a meal log, use intent=coach.',
      'Never invent a mealId. Only set mealId when the user explicitly gave one.',
      `Reply style: ${variant.systemTone}.`,
      `User message: ${message}`
    ].join('\n');

    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${this.model}:generateContent?key=${this.apiKey}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        signal: AbortSignal.timeout(12000),
        body: JSON.stringify({
          systemInstruction: {
            parts: [
              {
                text: 'You power a calorie-tracking Telegram bot. Be accurate, concise, and return valid structured JSON.'
              }
            ]
          },
          contents: [
            {
              role: 'user',
              parts: [{ text: prompt }]
            }
          ],
          generationConfig: {
            temperature: 0.2,
            maxOutputTokens: 400,
            responseMimeType: 'application/json',
            responseSchema: RESPONSE_SCHEMA
          }
        })
      }
    );

    if (!response.ok) {
      const errorText = await response.text();
      await this.eventLogger?.log({
        type: 'gemini_parse_failed',
        status: response.status,
        detail: errorText.slice(0, 200)
      });
      return null;
    }

    const payload = await response.json();
    const text = extractResponseText(payload);
    const parsed = safeJsonParse(text);

    if (!parsed) {
      await this.eventLogger?.log({
        type: 'gemini_parse_failed',
        status: 200,
        detail: 'Invalid JSON payload from Gemini'
      });
      return null;
    }

    await this.eventLogger?.log({
      type: 'gemini_parse_used',
      intent: parsed.intent
    });

    return parsed;
  }

  async analyzeDailySummary({ summary, variant }) {
    if (!this.isEnabled()) {
      return null;
    }

    const prompt = [
      'You are a practical nutrition coach inside a Telegram bot.',
      'Review the current day summary and give short, actionable advice.',
      'Mention whether the user likely needs to eat a bit more, stay steady, or keep the next meal lighter.',
      'Avoid medical claims and avoid sounding strict.',
      `Reply style: ${variant.systemTone}.`,
      `Date: ${summary.date}`,
      `Meals logged: ${summary.meals.length}`,
      `Calories: ${summary.totals.calories}`,
      `Protein: ${summary.totals.protein}`,
      `Carbs: ${summary.totals.carbs}`,
      `Fats: ${summary.totals.fats}`,
      `Meals: ${summary.meals.map((meal) => `${meal.name} (${meal.calories} kcal)`).join(', ') || 'none'}`
    ].join('\n');

    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${this.model}:generateContent?key=${this.apiKey}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        signal: AbortSignal.timeout(12000),
        body: JSON.stringify({
          systemInstruction: {
            parts: [
              {
                text: 'You produce short daily nutrition reviews in valid JSON.'
              }
            ]
          },
          contents: [
            {
              role: 'user',
              parts: [{ text: prompt }]
            }
          ],
          generationConfig: {
            temperature: 0.3,
            maxOutputTokens: 300,
            responseMimeType: 'application/json',
            responseSchema: DAILY_ANALYSIS_SCHEMA
          }
        })
      }
    );

    if (!response.ok) {
      return null;
    }

    const payload = await response.json();
    return safeJsonParse(extractResponseText(payload));
  }
}
