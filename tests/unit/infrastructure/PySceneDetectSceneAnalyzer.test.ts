import { describe, it, expect } from 'vitest';

import { parseSceneList } from '../../../src/infrastructure/adapters/PySceneDetectSceneAnalyzer';

/**
 * Verbatim output shape of PySceneDetect 0.7.1 (`list-scenes`). The table is
 * the only place scene ranges appear; the trailing comma list is cut points.
 */
const SCENEDETECT_0_7_OUTPUT = `[PySceneDetect] PySceneDetect 0.7.1
[PySceneDetect] Detected 3 scenes, average shot length 3.3 seconds.
[PySceneDetect] Writing scene list to CSV file:
  sample-Scenes.csv
[PySceneDetect] Scene List:
-----------------------------------------------------------------------
 | Scene # | Start Frame |  Start Time  |  End Frame  |   End Time   |
-----------------------------------------------------------------------
 |      1  |           1 | 00:00:00.000 |           1 | 00:00:05.000 |
 |      2  |           2 | 00:00:05.000 |           3 | 00:00:10.000 |
 |      3  |           4 | 00:00:10.000 |           3 | 00:00:11.020 |
-----------------------------------------------------------------------
[PySceneDetect] Comma-separated timecode list:
  00:00:05.000,00:00:10.000
`;

describe('parseSceneList', () => {
  it('reads the pipe-delimited table printed by PySceneDetect 0.7', () => {
    expect(parseSceneList(SCENEDETECT_0_7_OUTPUT)).toEqual([
      { start: 0, end: 5 },
      { start: 5, end: 10 },
      { start: 10, end: 11.02 },
    ]);
  });

  it('does not mistake the comma-separated cut list for a scene range', () => {
    const cutsOnly = `[PySceneDetect] Comma-separated timecode list:
  00:00:05.000,00:00:10.000
`;
    expect(parseSceneList(cutsOnly)).toEqual([]);
  });

  it('reads legacy "Scene N: start - end" lines', () => {
    const legacy = `Scene 1: 00:00:00.000 - 00:01:30.000
Scene 2: 00:01:30.000 - 00:03:00.000
`;
    expect(parseSceneList(legacy)).toEqual([
      { start: 0, end: 90 },
      { start: 90, end: 180 },
    ]);
  });

  it('reads CSV rows from releases that print them', () => {
    const csv = `1, 00:00:00.000, 00:01:30.000, 90.0
2, 00:01:30.000, 00:03:00.000, 90.0
`;
    expect(parseSceneList(csv)).toEqual([
      { start: 0, end: 90 },
      { start: 90, end: 180 },
    ]);
  });

  it('returns nothing when the output has no scene ranges', () => {
    expect(parseSceneList('[PySceneDetect] Detected 0 scenes\n')).toEqual([]);
  });
});
