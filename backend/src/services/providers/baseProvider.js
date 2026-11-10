/**
 * Base Search Provider Interface
 */

export const PROVIDER_STATUS = {
  AVAILABLE: 'Available',
  WORKING: 'Working',
  UNAVAILABLE: 'Unavailable',
  RATE_LIMITED: 'Rate limited',
  EXTRACTION_FAILED: 'Extraction failed',
  NOT_CONFIGURED: 'Not configured',
};

export class BaseProvider {
  constructor({ id, name, isEnabled = true }) {
    if (!id || !name) {
      throw new Error('Provider must define id and name');
    }
    this.id = id;
    this.name = name;
    this.isEnabled = isEnabled;
    this.status = PROVIDER_STATUS.AVAILABLE;
    this.lastChecked = new Date().toISOString();
    this.lastError = null;
    this.consecutiveFailures = 0;
  }

  isConfigured() {
    return this.isEnabled;
  }

  getHealth() {
    return {
      id: this.id,
      name: this.name,
      status: this.isConfigured() ? this.status : PROVIDER_STATUS.NOT_CONFIGURED,
      lastChecked: this.lastChecked,
      error: this.lastError,
      consecutiveFailures: this.consecutiveFailures,
    };
  }

  markSuccess() {
    this.status = PROVIDER_STATUS.WORKING;
    this.lastChecked = new Date().toISOString();
    this.lastError = null;
    this.consecutiveFailures = 0;
  }

  markFailure(error, isRateLimit = false) {
    this.status = isRateLimit ? PROVIDER_STATUS.RATE_LIMITED : PROVIDER_STATUS.UNAVAILABLE;
    this.lastChecked = new Date().toISOString();
    this.lastError = error ? (error.message || String(error)) : 'Unknown error';
    this.consecutiveFailures++;
  }

  /**
   * Search method to be overridden by child providers.
   *
   * @param {string} _query
   * @param {Object} [_options]
   * @returns {Promise<{ results: Array, durationMs: number, error: string|null, status: string }>}
   */
  async search(_query, _options = {}) {
    throw new Error(`search() not implemented for provider ${this.id}`);
  }
}
