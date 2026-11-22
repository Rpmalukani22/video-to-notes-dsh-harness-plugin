import { describe, expect, it } from 'vitest';
import { DEFAULT_PROCESSING_CONFIG, DEFAULT_VALIDATION_CONFIG } from '../../../src/infrastructure/adapters/YamlConfigProvider.js';

describe('Config gates (plan path)', () => {
  it('enables validation by default and keeps privacy local-only', () => {
    expect(DEFAULT_VALIDATION_CONFIG.enabled).toBe(true);
    expect(DEFAULT_PROCESSING_CONFIG.privacy).toBe('local-only');
    expect(DEFAULT_PROCESSING_CONFIG.transcription.multilingual).toBe(false);
  });
});
