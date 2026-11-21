import { describe, expect, it } from 'vitest';
import { assertNoRawMarkers } from '../../src/domain/services/MarkerGuard.js';

describe('E2E negative control (plan path)', () => {
  it('throws when a raw marker is present in notes', () => {
    expect(() => assertNoRawMarkers('**Visual Content:** leaked')).toThrow(/raw markers/);
    expect(() => assertNoRawMarkers('clean')).not.toThrow();
  });
});
