import { describe, expect, it } from 'vitest';
import { createServices } from '../../../src/infrastructure/composition/createServices.js';

describe('Validation wiring (plan path)', () => {
  it('exposes a validator and enables validation by default', async () => {
    const services = createServices({});
    await services.init();
    expect(services.validator).toBeDefined();
    expect(services.config.getVideoProcessingConfig().validation.enabled).toBe(true);
  });
});
