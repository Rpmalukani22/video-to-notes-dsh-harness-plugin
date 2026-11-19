import { ILogger } from '../../application/ports/Interfaces.js';

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

const LEVEL_ORDER: Record<LogLevel, number> = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40,
};

/**
 * Minimal structured logger that writes to stderr, keeping stdout clean for
 * tool output and CLI data.
 */
export class ConsoleLogger implements ILogger {
  private readonly _minLevel: LogLevel;
  private readonly _scope: string;

  constructor(minLevel: LogLevel = 'info', scope: string = 'video-to-notes') {
    this._minLevel = minLevel;
    this._scope = scope;
  }

  debug(message: string, meta?: object): void {
    this.write('debug', message, meta);
  }

  info(message: string, meta?: object): void {
    this.write('info', message, meta);
  }

  warn(message: string, meta?: object): void {
    this.write('warn', message, meta);
  }

  error(message: string, meta?: object): void {
    this.write('error', message, meta);
  }

  child(scope: string): ConsoleLogger {
    return new ConsoleLogger(this._minLevel, `${this._scope}:${scope}`);
  }

  private write(level: LogLevel, message: string, meta?: object): void {
    if (LEVEL_ORDER[level] < LEVEL_ORDER[this._minLevel]) return;
    const line = `${new Date().toISOString()} ${level.toUpperCase()} [${this._scope}] ${message}`;
    const suffix = meta ? ` ${safeJson(meta)}` : '';
    process.stderr.write(`${line}${suffix}\n`);
  }
}

function safeJson(value: object): string {
  try {
    return JSON.stringify(value);
  } catch {
    return '[unserializable]';
  }
}

/** A logger that discards everything. Useful in tests. */
export class NullLogger implements ILogger {
  debug(): void {}
  info(): void {}
  warn(): void {}
  error(): void {}
}
