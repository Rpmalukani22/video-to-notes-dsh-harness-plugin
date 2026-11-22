/** Build a Markdown image whose relative path is safe for renderers. */

export function markdownImage(alt: string, relativePath: string): string {
  return `![${alt}](${encodeMarkdownPath(relativePath)})`;
}

/**
 * Encode each path segment (spaces, parentheses, #, unicode) while preserving
 * the `/` separators of a relative link. Files on disk keep their real names.
 */
export function encodeMarkdownPath(relativePath: string): string {
  const normalized = relativePath.replace(/\\/g, '/');
  return normalized
    .split('/')
    .map((segment) =>
      encodeURIComponent(segment).replace(/\(/g, '%28').replace(/\)/g, '%29')
    )
    .join('/');
}
