#!/usr/bin/env node
/**
 * Repair image links in a curated notes file.
 *
 * Usage:
 *   node scripts/fix-curated-images.mjs <curated.md> <plugin-notes.md> <frames-dir>
 *
 * The plugin-generated notes file is the source of truth for screenshot links.
 * Any image link in the curated file that does not resolve on disk is removed,
 * and the verified links from the plugin notes are appended under a Screenshots
 * section so the curated file never contains broken images.
 */
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';

const [curatedPath, notesPath, framesDir] = process.argv.slice(2);
if (!curatedPath || !notesPath || !framesDir) {
  console.error('Usage: node scripts/fix-curated-images.mjs <curated.md> <plugin-notes.md> <frames-dir>');
  process.exit(2);
}

const IMAGE = /!\[[^\]]*\]\(([^)]+)\)/g;

function decodedRelativeTarget(raw) {
  let value = raw.trim();
  if (value.startsWith('file://')) value = value.replace(/^file:\/\/\/?/i, '');
  if (/^[A-Za-z]:[\\/]/.test(value)) return resolve(value);
  return resolve(dirname(notesPath), decodeURIComponent(value));
}

const notesText = readFileSync(notesPath, 'utf8');
const validTargets = [];
for (const match of notesText.matchAll(IMAGE)) {
  const target = decodedRelativeTarget(match[1] ?? '');
  if (existsSync(target) && !validTargets.includes(target)) validTargets.push(target);
}

const curatedAbs = resolve(curatedPath);
let curated = readFileSync(curatedAbs, 'utf8');
let removed = 0;

curated = curated
  .split(/\r?\n/)
  .map((line) => {
    const before = line;
    const cleaned = line.replace(IMAGE, (_whole, raw) => {
      const target = decodedRelativeTarget(raw);
      if (existsSync(target)) return _whole;
      removed++;
      return '';
    }).trimEnd();
    return cleaned;
  })
  .filter((line) => line.trim().length > 0)
  .join('\n');

// Drop an appended section from a previous run so repeats are idempotent.
curated = curated.replace(/\n## 📸 Screenshots[\s\S]*$/m, '').trimEnd();

const heading = '## 📸 Screenshots';
const noteDir = dirname(curatedAbs);
const links = validTargets.map((target) => {
  const relative = encodeRelative(target, noteDir);
  return `![Key slide](${relative})`;
});

if (links.length > 0) {
  curated += `\n\n${heading}\n\n${links.join('\n\n')}\n`;
}

writeFileSync(curatedAbs, curated, 'utf8');
console.log(`curated image repair: removed ${removed} broken link(s), attached ${links.length} verified screenshot(s)`);

function encodeRelative(target, fromDir) {
  const path = require_pathRelative(fromDir, target).replace(/\\/g, '/');
  return path.split('/').map((s) => encodeURIComponent(s).replace(/\(/g, '%28').replace(/\)/g, '%29')).join('/');
}

function require_pathRelative(from, to) {
  const fromParts = resolve(from).split(/[\\/]/).filter(Boolean);
  const toParts = resolve(to).split(/[\\/]/).filter(Boolean);
  let i = 0;
  while (i < fromParts.length && i < toParts.length && fromParts[i] === toParts[i]) i++;
  const rest = toParts.slice(i);
  if (fromParts.length - i === 0) return rest.join('/');
  return [...Array(fromParts.length - i).fill('..'), ...rest].join('/');
}
