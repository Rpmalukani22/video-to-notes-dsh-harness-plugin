import { describe, it, expect } from 'vitest';
import { Confidence } from '../../../src/domain/value-objects/Confidence';

describe('Confidence', () => {
  describe('constructor', () => {
    it('creates confidence with valid value', () => {
      const c = new Confidence(0.85);
      expect(c.value).toBe(0.85);
    });

    it('clamps to 4 decimal places', () => {
      const c = new Confidence(0.856789);
      expect(c.value).toBe(0.8568);
    });

    it('throws on negative value', () => {
      expect(() => new Confidence(-0.1)).toThrow('Confidence must be between 0 and 1');
    });

    it('throws on value > 1', () => {
      expect(() => new Confidence(1.1)).toThrow('Confidence must be between 0 and 1');
    });

    it('accepts 0 and 1', () => {
      expect(new Confidence(0).value).toBe(0);
      expect(new Confidence(1).value).toBe(1);
    });
  });

  describe('static factories', () => {
    it('zero() returns 0', () => {
      expect(Confidence.zero().value).toBe(0);
    });

    it('one() returns 1', () => {
      expect(Confidence.one().value).toBe(1);
    });

    it('fromPercent converts correctly', () => {
      expect(Confidence.fromPercent(85).value).toBe(0.85);
    });
  });

  describe('percent', () => {
    it('returns percentage', () => {
      const c = new Confidence(0.85);
      expect(c.percent).toBe(85);
    });
  });

  describe('isHigh/isLow', () => {
    it('isHigh returns true for high confidence', () => {
      const c = new Confidence(0.9);
      expect(c.isHigh(0.8)).toBe(true);
    });

    it('isHigh returns false for low confidence', () => {
      const c = new Confidence(0.5);
      expect(c.isHigh(0.8)).toBe(false);
    });

    it('uses default threshold 0.8', () => {
      const c = new Confidence(0.85);
      expect(c.isHigh()).toBe(true);
    });

    it('isLow works correctly', () => {
      const c = new Confidence(0.3);
      expect(c.isLow(0.5)).toBe(true);
    });
  });

  describe('arithmetic', () => {
    it('add clamps at 1', () => {
      const c1 = new Confidence(0.7);
      const c2 = new Confidence(0.5);
      expect(c1.add(c2).value).toBe(1);
    });

    it('add works normally below 1', () => {
      const c1 = new Confidence(0.3);
      const c2 = new Confidence(0.4);
      expect(c1.add(c2).value).toBe(0.7);
    });

    it('multiply clamps at 1', () => {
      const c = new Confidence(0.8);
      expect(c.multiply(2).value).toBe(1);
    });

    it('multiply clamps at 0', () => {
      const c = new Confidence(0.5);
      expect(c.multiply(-1).value).toBe(0);
    });
  });

  describe('comparison', () => {
    it('equals compares values', () => {
      expect(new Confidence(0.5).equals(new Confidence(0.5))).toBe(true);
      expect(new Confidence(0.5).equals(new Confidence(0.6))).toBe(false);
    });

    it('lessThan works', () => {
      expect(new Confidence(0.5).lessThan(new Confidence(0.6))).toBe(true);
      expect(new Confidence(0.6).lessThan(new Confidence(0.5))).toBe(false);
    });

    it('greaterThan works', () => {
      expect(new Confidence(0.6).greaterThan(new Confidence(0.5))).toBe(true);
      expect(new Confidence(0.5).greaterThan(new Confidence(0.6))).toBe(false);
    });
  });

  describe('toString/toJSON', () => {
    it('toString returns percentage string', () => {
      expect(new Confidence(0.85).toString()).toBe('85.0%');
    });

    it('toJSON returns number', () => {
      expect(new Confidence(0.75).toJSON()).toBe(0.75);
    });
  });
});