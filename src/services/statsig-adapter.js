export class StatsigAdapter {
  constructor({ serverKey, eventLogger }) {
    this.serverKey = serverKey;
    this.eventLogger = eventLogger;
    this.client = null;
    this.module = null;
    this.initialized = false;
    this.sdkType = null;
    this.lastError = null;
  }

  hasUsableKey() {
    return Boolean(this.serverKey && this.serverKey !== 'your_statsig_server_key');
  }

  async initialize() {
    if (this.initialized) {
      return this.client;
    }

    this.initialized = true;

    if (!this.hasUsableKey()) {
      this.lastError = 'Missing STATSIG_SERVER_KEY';
      return null;
    }

    try {
      this.module = await import('@statsig/statsig-node-core');
      this.client = new this.module.Statsig(this.serverKey);
      await this.client.initialize();
      this.sdkType = 'node-core';
      return this.client;
    } catch (coreError) {
      try {
        const legacyModule = await import('statsig-node');
        const legacyClient = legacyModule.default || legacyModule;
        await legacyClient.initialize(this.serverKey);
        this.module = legacyModule;
        this.client = legacyClient;
        this.sdkType = 'legacy';
        return this.client;
      } catch (legacyError) {
        this.client = null;
        this.lastError = `Statsig init failed: ${coreError.message}; legacy fallback failed: ${legacyError.message}`;
        await this.eventLogger?.log({
          type: 'statsig_init_failed',
          detail: this.lastError
        });
        return null;
      }
    }
  }

  async getAssignment({ userId, experimentName, variants }) {
    const client = await this.initialize();
    if (!client || !this.module) {
      return null;
    }

    try {
      const user =
        this.sdkType === 'node-core'
          ? new this.module.StatsigUser({ userID: String(userId) })
          : { userID: String(userId) };
      const experiment = client.getExperiment(user, experimentName);
      const variantKey = experiment.getValue('variant', '');
      const variant = variants.find((item) => item.key === variantKey);

      if (!variant) {
        this.lastError = `Experiment "${experimentName}" did not return variant A/B.`;
        await this.eventLogger?.log({
          type: 'statsig_variant_missing',
          experiment: experimentName,
          detail: this.lastError
        });
        return null;
      }

      return {
        variant,
        source: 'statsig'
      };
    } catch (error) {
      this.lastError = error.message;
      await this.eventLogger?.log({
        type: 'statsig_assignment_failed',
        experiment: experimentName,
        detail: error.message
      });
      return null;
    }
  }

  async logEvent({ userId, eventName, value = null, metadata = {} }) {
    const client = await this.initialize();
    if (!client || !this.module) {
      return false;
    }

    try {
      const user =
        this.sdkType === 'node-core'
          ? new this.module.StatsigUser({ userID: String(userId) })
          : { userID: String(userId) };
      const normalizedMetadata = Object.fromEntries(
        Object.entries(metadata).map(([key, item]) => [key, String(item)])
      );
      await client.logEvent(user, eventName, value, normalizedMetadata);
      return true;
    } catch (error) {
      this.lastError = error.message;
      await this.eventLogger?.log({
        type: 'statsig_log_event_failed',
        eventName,
        detail: error.message
      });
      return false;
    }
  }

  async getStatus() {
    await this.initialize();
    return {
      configured: this.hasUsableKey(),
      initialized: Boolean(this.client),
      sdkType: this.sdkType || 'none',
      lastError: this.lastError
    };
  }
}
