/**
 * Infrastructure layer exports.
 *
 * Only concrete adapters live here. Domain types and application ports are
 * imported from their own layers (`../domain`, `../application/ports/Interfaces`)
 * so there is a single declaration of every symbol.
 */

export * from './adapters/FfmpegVideoMetadataExtractor.js';
export * from './adapters/FfmpegFrameExtractor.js';
export * from './adapters/FfmpegAudioExtractor.js';
export * from './adapters/TesseractOCRProcessor.js';
export * from './adapters/WhisperTranscriptionEngine.js';
export * from './adapters/PySceneDetectSceneAnalyzer.js';
export * from './adapters/HarnessLLMProvider.js';
export * from './adapters/CloudLLMProviders.js';
export * from './adapters/LocalLLMProviders.js';

export * from './adapters/ConsoleLogger.js';
export * from './adapters/InMemoryMetricsCollector.js';
export * from './adapters/JsonCheckpointStore.js';
export * from './adapters/YamlConfigProvider.js';
export * from './adapters/EnvSecretProvider.js';
export * from './adapters/MarkdownNoteRenderer.js';
export * from './adapters/SimpleResourcePool.js';

export * from './composition/createServices.js';
