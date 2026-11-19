/**
 * Domain layer exports
 * Pure TypeScript - no external dependencies
 */

// Value Objects
export * from './value-objects/Timestamp.js';
export * from './value-objects/Confidence.js';
export * from './value-objects/BoundingBox.js';
export { OCRResult, LineOCRResult } from './value-objects/OCRResult.js';
export type { WordTimestamp } from './value-objects/OCRResult.js';

// Entities
export * from './entities/Video.js';
export * from './entities/Frame.js';
export * from './entities/Transcript.js';
export * from './entities/Scene.js';
export * from './entities/Note.js';

// Domain Events
export * from './events/DomainEvents.js';

// Domain Services
export * from './services/TimestampAligner.js';
export * from './services/ContentAggregator.js';
export * from './services/DeduplicationService.js';