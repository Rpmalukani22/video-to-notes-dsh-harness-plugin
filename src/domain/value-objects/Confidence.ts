/**
 * Confidence value object - Represents confidence scores (0-1) with validation
 */

export class Confidence {
  private readonly _value: number;

  constructor(value: number) {
    if (value < 0 || value > 1) {
      throw new Error('Confidence must be between 0 and 1');
    }
    this._value = Math.round(value * 10000) / 10000; // 4 decimal precision
  }

  static zero(): Confidence {
    return new Confidence(0);
  }

  static one(): Confidence {
    return new Confidence(1);
  }

  static fromPercent(percent: number): Confidence {
    return new Confidence(percent / 100);
  }

  get value(): number {
    return this._value;
  }

  get percent(): number {
    return this._value * 100;
  }

  isHigh(threshold: number = 0.8): boolean {
    return this._value >= threshold;
  }

  isLow(threshold: number = 0.5): boolean {
    return this._value <= threshold;
  }

  add(other: Confidence): Confidence {
    return new Confidence(Math.min(1, this._value + other._value));
  }

  multiply(factor: number): Confidence {
    return new Confidence(Math.max(0, Math.min(1, this._value * factor)));
  }

  equals(other: Confidence): boolean {
    return this._value === other._value;
  }

  lessThan(other: Confidence): boolean {
    return this._value < other._value;
  }

  greaterThan(other: Confidence): boolean {
    return this._value > other._value;
  }

  greaterThanOrEqual(other: Confidence): boolean {
    return this._value >= other._value;
  }

  lessThanOrEqual(other: Confidence): boolean {
    return this._value <= other._value;
  }

  toString(): string {
    return `${(this._value * 100).toFixed(1)}%`;
  }

  toJSON(): number {
    return this._value;
  }
}