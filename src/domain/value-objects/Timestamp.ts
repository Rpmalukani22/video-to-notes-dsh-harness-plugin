/**
 * Timestamp value object - Master clock alignment for video processing
 * Uses FFmpeg presentation timestamps (PTS) as the master clock
 */

export class Timestamp {
  private readonly _milliseconds: number;
  private readonly _pts: number;
  private readonly _timebase: { num: number; den: number };

  constructor(milliseconds: number, pts: number = 0, timebase: { num: number; den: number } = { num: 1, den: 1000 }) {
    if (milliseconds < 0) {
      throw new Error('Timestamp cannot be negative');
    }
    this._milliseconds = milliseconds;
    this._pts = pts;
    this._timebase = timebase;
  }

  static fromPTS(pts: number, timebase: { num: number; den: number }): Timestamp {
    const milliseconds = (pts * timebase.num * 1000) / timebase.den;
    return new Timestamp(milliseconds, pts, timebase);
  }

  static fromISO(iso: string): Timestamp {
    // Parse HH:MM:SS.mmm format
    const match = iso.match(/^(\d{2}):(\d{2}):(\d{2})(?:\.(\d{3}))?$/);
    if (!match) {
      throw new Error(`Invalid ISO timestamp format: ${iso}`);
    }
    const hours = parseInt(match[1] ?? '0', 10);
    const minutes = parseInt(match[2] ?? '0', 10);
    const seconds = parseInt(match[3] ?? '0', 10);
    const milliseconds = match[4] ? parseInt(match[4], 10) : 0;
    const totalMs = ((hours * 60 + minutes) * 60 + seconds) * 1000 + milliseconds;
    return new Timestamp(totalMs);
  }

  static fromMilliseconds(milliseconds: number): Timestamp {
    return new Timestamp(milliseconds);
  }

  static fromSeconds(seconds: number): Timestamp {
    return new Timestamp(seconds * 1000);
  }

  get milliseconds(): number {
    return this._milliseconds;
  }

  get seconds(): number {
    return this._milliseconds / 1000;
  }

  get pts(): number {
    return this._pts;
  }

  get timebase(): { num: number; den: number } {
    return this._timebase;
  }

  toISO(): string {
    const totalSeconds = Math.floor(this._milliseconds / 1000);
    const ms = this._milliseconds % 1000;
    const hours = Math.floor(totalSeconds / 3600);
    const minutes = Math.floor((totalSeconds % 3600) / 60);
    const seconds = totalSeconds % 60;
    return `${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}.${ms.toString().padStart(3, '0')}`;
  }

  toRelative(): string {
    return `+${this.toISO()}`;
  }

  toDeepLink(videoPath: string): string {
    // vtn://video.mp4?t=754.567
    const seconds = this._milliseconds / 1000;
    return `vtn://${videoPath}?t=${seconds.toFixed(3)}`;
  }

  drift(other: Timestamp): number {
    return Math.abs(this._milliseconds - other._milliseconds);
  }

  add(ms: number): Timestamp {
    return new Timestamp(this._milliseconds + ms, this._pts, this._timebase);
  }

  subtract(ms: number): Timestamp {
    return new Timestamp(Math.max(0, this._milliseconds - ms), this._pts, this._timebase);
  }

  equals(other: Timestamp): boolean {
    return this._milliseconds === other._milliseconds;
  }

  lessThan(other: Timestamp): boolean {
    return this._milliseconds < other._milliseconds;
  }

  greaterThan(other: Timestamp): boolean {
    return this._milliseconds > other._milliseconds;
  }

  toString(): string {
    return this.toISO();
  }

  toJSON(): string {
    return this.toISO();
  }
}