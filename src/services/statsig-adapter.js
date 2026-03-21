export class StatsigAdapter {
  constructor({ serverKey }) {
    this.serverKey = serverKey;
    this.client = null;
    this.module = null;
    this.initialized = false;
  }

  async initialize() {
    if (this.initialized) {
      return this.client;
    }

    this.initialized = true;

    if (!this.serverKey) {
      return null;
    }

    try {
      this.module = await import('@statsig/statsig-node-core');
      this.client = new this.module.Statsig(this.serverKey);
      await this.client.initialize();
      return this.client;
    } catch {
      this.client = null;
      return null;
    }
  }

  async getAssignment({ userId, experimentName, variants }) {
    const client = await this.initialize();
    if (!client || !this.module) {
      return null;
    }

    try {
      const user = new this.module.StatsigUser({ userID: String(userId) });
      const experiment = client.getExperiment(user, experimentName);
      const variantKey = experiment.getValue('variant', '');
      const variant = variants.find((item) => item.key === variantKey);

      if (!variant) {
        return null;
      }

      return {
        variant,
        source: 'statsig'
      };
    } catch {
      return null;
    }
  }
}
