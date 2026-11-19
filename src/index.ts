/**
 * Library entry point.
 *
 * Consumers that embed the pipeline (CLI, tests, another host) import from
 * here. The harness-specific entry point lives in `./plugin/index.ts`.
 */
export * from './domain/index.js';
export * from './application/index.js';
export * from './infrastructure/index.js';
export * from './plugin/index.js';
