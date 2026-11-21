import { describe, expect, it } from 'vitest';
import { assertNoRawMarkers, stripRawMarkers } from '../../../src/domain/services/MarkerGuard.js';

describe('MarkerGuard (plan path)', () => {
  it('detects and strips raw markers', () => {
    expect(() => assertNoRawMarkers('**Visual Content:**')).toThrow();
    expect(stripRawMarkers('a **Transcript:** b')).toBe('a  b');
  });
});
