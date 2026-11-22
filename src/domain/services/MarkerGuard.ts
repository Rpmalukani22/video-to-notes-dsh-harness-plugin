/**
 * Guards the final notes against raw pipeline markers leaking back in.
 * This is the single owner of marker removal.
 */

const RAW_MARKERS = ['**Visual Content:**', '**Transcript:**', '**On screen**', '**Transcript**'];

export function stripRawMarkers(text: string): string {
  let result = text;
  for (const marker of RAW_MARKERS) {
    result = result.split(marker).join('');
  }
  return result;
}

export function findRawMarkers(text: string): string[] {
  return RAW_MARKERS.filter(marker => text.includes(marker));
}

/** Throws with the offending markers; used by the E2E negative control and unit tests. */
export function assertNoRawMarkers(markdown: string): void {
  const found = findRawMarkers(markdown);
  if (found.length > 0) {
    throw new Error(`raw markers found: ${found.join('; ')}`);
  }
}
