import { describe, expect, it } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { FrameCopier } from '../../../src/infrastructure/adapters/FrameCopier.js';
import { Frame } from '../../../src/domain/entities/Frame.js';
import { Timestamp } from '../../../src/domain/value-objects/Timestamp.js';

describe('FrameCopier (plan path)', () => {
  it('saves timeline-spread frames with unique names', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'vtn-frames-'));
    try {
      const frames = Array.from({ length: 12 }, (_, i) =>
        new Frame(`f${i}`, 'v', Timestamp.fromMilliseconds(i * 300000), i * 300000, null, Buffer.from([1, 2, 3]))
      );
      const map = await new FrameCopier().copyKeyFrames(frames, dir, 'demo', 4, 3600000);
      expect(map.size).toBe(4);
      expect(new Set(map.values()).size).toBe(4);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
