import { describe, it, expect } from 'vitest';
import { Timestamp } from '../../../src/domain/value-objects/Timestamp';

describe('Timestamp', () => {
  describe('fromPTS', () => {
    it('converts PTS to milliseconds correctly', () => {
      // 30 fps: each PTS tick is 1/30000 s, so 30000 ticks is one second.
      const timestamp = Timestamp.fromPTS(30000, { num: 1, den: 30000 });
      expect(timestamp.milliseconds).toBeCloseTo(1000, 0); // 1 second = 1000ms
    });

    it('handles zero PTS', () => {
      const timestamp = Timestamp.fromPTS(0, { num: 30000, den: 1001 });
      expect(timestamp.milliseconds).toBe(0);
    });
  });

  describe('fromISO', () => {
    it('parses HH:MM:SS.mmm format', () => {
      const timestamp = Timestamp.fromISO('00:01:30.500');
      expect(timestamp.milliseconds).toBe(90500);
    });

    it('parses HH:MM:SS format without milliseconds', () => {
      const timestamp = Timestamp.fromISO('01:00:00');
      expect(timestamp.milliseconds).toBe(3600000);
    });

    it('throws on invalid format', () => {
      expect(() => Timestamp.fromISO('invalid')).toThrow();
    });
  });

  describe('fromSeconds', () => {
    it('converts seconds to milliseconds', () => {
      const timestamp = Timestamp.fromSeconds(90.5);
      expect(timestamp.milliseconds).toBe(90500);
    });
  });

  describe('toISO', () => {
    it('formats as HH:MM:SS.mmm', () => {
      const timestamp = Timestamp.fromSeconds(90.5);
      expect(timestamp.toISO()).toBe('00:01:30.500');
    });

    it('handles hours', () => {
      const timestamp = Timestamp.fromSeconds(3661.123);
      expect(timestamp.toISO()).toBe('01:01:01.123');
    });

    it('pads single digits', () => {
      const timestamp = Timestamp.fromSeconds(5.005);
      expect(timestamp.toISO()).toBe('00:00:05.005');
    });
  });

  describe('toRelative', () => {
    it('returns relative format with + prefix', () => {
      const timestamp = Timestamp.fromSeconds(90);
      expect(timestamp.toRelative()).toBe('+00:01:30.000');
    });
  });

  describe('toDeepLink', () => {
    it('generates vtn:// protocol link', () => {
      const timestamp = Timestamp.fromSeconds(90.5);
      expect(timestamp.toDeepLink('video.mp4')).toBe('vtn://video.mp4?t=90.500');
    });
  });

  describe('drift', () => {
    it('calculates absolute difference in milliseconds', () => {
      const ts1 = Timestamp.fromSeconds(100);
      const ts2 = Timestamp.fromSeconds(101.5);
      expect(ts1.drift(ts2)).toBe(1500);
    });

    it('is symmetric', () => {
      const ts1 = Timestamp.fromSeconds(100);
      const ts2 = Timestamp.fromSeconds(101);
      expect(ts1.drift(ts2)).toBe(ts2.drift(ts1));
    });
  });

  describe('add/subtract', () => {
    it('adds milliseconds', () => {
      const ts = Timestamp.fromSeconds(100);
      const added = ts.add(5000);
      expect(added.milliseconds).toBe(105000);
    });

    it('subtracts milliseconds', () => {
      const ts = Timestamp.fromSeconds(100);
      const subtracted = ts.subtract(5000);
      expect(subtracted.milliseconds).toBe(95000);
    });

    it('does not go below zero on subtract', () => {
      const ts = Timestamp.fromSeconds(1);
      const subtracted = ts.subtract(5000);
      expect(subtracted.milliseconds).toBe(0);
    });
  });

  describe('comparison', () => {
    it('equals compares milliseconds', () => {
      const ts1 = Timestamp.fromSeconds(100);
      const ts2 = Timestamp.fromSeconds(100);
      expect(ts1.equals(ts2)).toBe(true);
    });

    it('lessThan compares correctly', () => {
      const ts1 = Timestamp.fromSeconds(100);
      const ts2 = Timestamp.fromSeconds(101);
      expect(ts1.lessThan(ts2)).toBe(true);
      expect(ts2.lessThan(ts1)).toBe(false);
    });

    it('greaterThan compares correctly', () => {
      const ts1 = Timestamp.fromSeconds(101);
      const ts2 = Timestamp.fromSeconds(100);
      expect(ts1.greaterThan(ts2)).toBe(true);
    });
  });
});