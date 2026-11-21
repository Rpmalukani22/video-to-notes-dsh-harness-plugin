import { describe, expect, it } from 'vitest';
import { mkdtemp, mkdir, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { AnalyzeVideo } from '../../../src/application/use-cases/AnalyzeVideo.js';
import type { AnalyzeVideoDeps } from '../../../src/application/use-cases/AnalyzeVideo.js';
import { ConsoleLogger } from '../../../src/infrastructure/adapters/ConsoleLogger.js';

type Cleaner = (workDir: string, legacyWorkDir: string, warnings: string[]) => Promise<void>;

describe('Intermediate audio cleanup', () => {
  it('removes both per-job WAV work folders and leaves other files alone', async () => {
    const root = await mkdtemp(join(tmpdir(), 'vtn-cleanup-'));
    const workDir = join(root, '.work', 'job1');
    const legacyDir = join(root, 'legacy', '.work', 'job1');
    const keepDir = join(root, 'notes');
    try {
      await mkdir(workDir, { recursive: true });
      await mkdir(legacyDir, { recursive: true });
      await mkdir(keepDir, { recursive: true });
      await writeFile(join(workDir, 'audio.wav'), 'x');
      await writeFile(join(workDir, 'enhanced_1_audio.wav'), 'x');
      await writeFile(join(legacyDir, 'audio.wav'), 'x');
      await writeFile(join(keepDir, 'notes.md'), 'keep');

      const analyze = new AnalyzeVideo({
        logger: new ConsoleLogger('error'),
      } as AnalyzeVideoDeps);
      const cleaner = (
        analyze as unknown as { cleanupIntermediateAudio: Cleaner }
      ).cleanupIntermediateAudio.bind(analyze);
      const warnings: string[] = [];
      await cleaner(workDir, legacyDir, warnings);

      await expect(stat(workDir)).rejects.toThrow();
      await expect(stat(legacyDir)).rejects.toThrow();
      expect(await stat(join(keepDir, 'notes.md'))).toBeDefined();
      expect(warnings).toHaveLength(0);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
