import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm, writeFile } from 'fs/promises';
import { join } from 'path';
import { tmpdir } from 'os';

import { WhisperTranscriptionEngine } from '../../../src/infrastructure/adapters/WhisperTranscriptionEngine';
import { ILogger, IMetricsCollector } from '../../../src/application/ports/Interfaces';

const logger: ILogger = {
  debug: () => undefined,
  info: () => undefined,
  warn: () => undefined,
  error: () => undefined,
};

const metrics: IMetricsCollector = {
  incrementCounter: () => undefined,
  recordHistogram: () => undefined,
  setGauge: () => undefined,
  startTimer: () => ({ stop: () => undefined }),
};

describe('WhisperTranscriptionEngine model resolution', () => {
  let modelDir: string;

  beforeEach(async () => {
    modelDir = await mkdtemp(join(tmpdir(), 'vtn-whisper-'));
  });

  afterEach(async () => {
    await rm(modelDir, { recursive: true, force: true });
  });

  it('accepts the whisper.cpp ggml-base.en.bin filename', async () => {
    await writeFile(join(modelDir, 'ggml-base.en.bin'), '');
    const engine = new WhisperTranscriptionEngine('whisper-cli', modelDir, logger, metrics);

    await expect(engine.warmup()).resolves.toBeUndefined();
  });

  it('accepts ggml-base.bin without the language suffix', async () => {
    await writeFile(join(modelDir, 'ggml-base.bin'), '');
    const engine = new WhisperTranscriptionEngine('whisper-cli', modelDir, logger, metrics);

    await expect(engine.warmup()).resolves.toBeUndefined();
  });

  it('accepts a pre-converted base.int8.bin', async () => {
    await writeFile(join(modelDir, 'base.int8.bin'), '');
    const engine = new WhisperTranscriptionEngine('whisper-cli', modelDir, logger, metrics);

    await expect(engine.warmup()).resolves.toBeUndefined();
  });

  it('lists every accepted filename when the model is missing', async () => {
    const engine = new WhisperTranscriptionEngine('whisper-cli', modelDir, logger, metrics);

    await expect(engine.warmup()).rejects.toThrow(/base\.int8\.bin/);
    await expect(engine.warmup()).rejects.toThrow(/ggml-base\.bin/);
    await expect(engine.warmup()).rejects.toThrow(/ggml-base\.en\.bin/);
  });
});
