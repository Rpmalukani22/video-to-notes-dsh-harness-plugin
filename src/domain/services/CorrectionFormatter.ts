import type { NoteSection } from '../entities/Note.js';
import type {
  Correction,
  CoverageCounts,
  CoverageGap,
  NoteValidationResult,
} from '../entities/ValidationFinding.js';
import { escapeAttribute } from './LanguageIntent.js';
import { stripRawMarkers } from './MarkerGuard.js';

const CORRECTION_PATTERN =
  /^> ⚠️ \*\*Instructor said "((?:[^"\\]|\\.)*)" — actually ((?:[^*\\\n]|\\.)*)\*\* \(basis: "((?:[^"\\]|\\.)*)" @ (\d{2}:\d{2}:\d{2}\.\d{3}) \[(ocr|transcript)\]\)$/;

export function formatCorrection(c: Correction): string {
  return (
    `> ⚠️ **Instructor said "${escape(c.instructorSaid)}" — actually ${escape(c.actually)}** ` +
    `(basis: "${escape(c.basisQuote)}" @ ${c.timestamp} [${c.basisSource}])`
  );
}

export function parseCorrection(line: string): Correction | null {
  const match = CORRECTION_PATTERN.exec(line.trim());
  if (match === null) return null;
  return {
    instructorSaid: unescape(match[1] ?? ''),
    actually: unescape(match[2] ?? ''),
    basisQuote: unescape(match[3] ?? ''),
    timestamp: match[4] ?? '',
    basisSource: (match[5] ?? 'ocr') as 'ocr' | 'transcript',
  };
}

export function formatCheck(claim: string): string {
  return `> ❓ **Check:** ${escapeAttribute(stripRawMarkers(claim))} — insufficient evidence in transcript/OCR.`;
}

export function dedupeCorrections(list: Correction[]): Correction[] {
  const seen = new Set<string>();
  return list.filter(correction => {
    const key = correction.instructorSaid.trim().toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/** Sole owner of the Validation & Accuracy section. */
export function buildValidationSection(
  findings: NoteValidationResult,
  counts: CoverageCounts,
  gaps: CoverageGap[]
): NoteSection {
  const lines: string[] = [];
  for (const correction of dedupeCorrections(findings.corrections)) {
    lines.push(formatCorrection(correction));
  }
  for (const item of findings.incomplete) {
    lines.push(formatCheck(`${item.topic}: ${item.detail}`));
  }
  lines.push(
    `- Transcript items represented: ${counts.transcriptCovered}/${counts.transcriptTotal}`
  );
  lines.push(`- OCR items represented: ${counts.ocrCovered}/${counts.ocrTotal}`);
  if (gaps.length > 0) {
    lines.push('', '<details><summary>Coverage gaps (verbatim source items)</summary>', '');
    for (const gap of gaps) {
      const safe = escapeAttribute(stripRawMarkers(gap.text));
      lines.push(`- [${gap.timestamp}] (${gap.source}) ${safe}`);
    }
    lines.push('', '</details>');
  }
  return {
    id: 'section-validation-accuracy',
    title: 'Validation & Accuracy',
    level: 2,
    timestamp: null,
    content: lines.join('\n'),
    subsections: [],
    citations: [],
    metadata: {},
  };
}

function escape(s: string): string {
  return s.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\*/g, '\\*').replace(/\n/g, '\\n');
}

function unescape(s: string): string {
  return s.replace(/\\(n|\*|"|\\)/g, (_match, char: string) =>
    char === 'n' ? '\n' : char === '*' ? '*' : char === '"' ? '"' : '\\'
  );
}
