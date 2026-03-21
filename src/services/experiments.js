import { hashToBucket } from '../utils/hash.js';

const DEFAULT_VARIANTS = [
  {
    key: 'A',
    name: 'Precision Coach',
    systemTone: 'concise',
    intro: 'I will keep the guidance compact and action-focused.',
    followUp: 'Want a quick meal summary or another log?'
  },
  {
    key: 'B',
    name: 'Supportive Coach',
    systemTone: 'empathetic',
    intro: 'I will coach with a warmer, more encouraging tone.',
    followUp: 'You are building a streak. Want me to log, edit, or summarize a meal?'
  }
];

export class ExperimentService {
  constructor({ eventLogger, experimentName, statsigAdapter }) {
    this.eventLogger = eventLogger;
    this.experimentName = experimentName;
    this.statsigAdapter = statsigAdapter;
  }

  async assignUser(userId) {
    const externalAssignment = this.statsigAdapter
      ? await this.statsigAdapter.getAssignment({
          userId,
          experimentName: this.experimentName,
          variants: DEFAULT_VARIANTS
        })
      : null;

    const bucket = hashToBucket(`${this.experimentName}:${userId}`, 100);
    const localVariant = bucket < 50 ? DEFAULT_VARIANTS[0] : DEFAULT_VARIANTS[1];
    const variant = externalAssignment?.variant || localVariant;
    const source = externalAssignment?.source || 'local_deterministic';

    await this.eventLogger.log({
      type: 'experiment_exposure',
      userId,
      experiment: this.experimentName,
      variant: variant.key,
      source
    });
    return {
      experiment: this.experimentName,
      variant,
      source
    };
  }

  getVariants() {
    return DEFAULT_VARIANTS;
  }
}
