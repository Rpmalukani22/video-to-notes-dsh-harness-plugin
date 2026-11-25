import { describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

describe('Curated image repair', () => {
  it('drops invented file:// links and attaches verified encoded links', async () => {
    const root = await mkdtemp(join(tmpdir(), 'vtn-curated-'));
    const frames = join(root, 'demo_frames');
    try {
      await mkdir(frames, { recursive: true });
      await writeFile(join(frames, 'frame 01.jpg'), 'image');
      await writeFile(
        join(root, 'demo_notes.md'),
        '# Notes\n\n![Key slide](demo_frames/frame%2001.jpg)\n'
      );
      const curated = join(root, 'demo_CURATED_NOTES.md');
      await writeFile(
        curated,
        '# Curated\n\n![Invented](file:///C:/fake/frame_99.jpg)\n\nBody text.\n'
      );

      const output = execFileSync(
        process.execPath,
        [
          'scripts/fix-curated-images.mjs',
          curated,
          join(root, 'demo_notes.md'),
          frames,
        ],
        { cwd: process.cwd(), encoding: 'utf8' }
      );
      expect(output).toContain('removed 1 broken link(s)');
      expect(output).toContain('attached 1 verified screenshot(s)');
      const result = await readFile(curated, 'utf8');
      expect(result).not.toContain('file:///');
      expect(result).toContain('![Key slide](demo_frames/frame%2001.jpg)');
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
