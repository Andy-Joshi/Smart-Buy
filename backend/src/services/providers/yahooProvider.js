import { BaseProvider, PROVIDER_STATUS } from './baseProvider.js';

export class YahooPublicProvider extends BaseProvider {
  constructor() {
    super({
      id: 'yahoo_public',
      name: 'Public Search (Yahoo India)',
      isEnabled: true,
    });
  }

  async search(_query, _options = {}) {
    // Return empty results immediately to dedicate Yahoo scheduler queue bandwidth to Amazon and Croma
    return {
      results: [],
      durationMs: 1,
      error: null,
      status: PROVIDER_STATUS.WORKING,
    };
  }
}
