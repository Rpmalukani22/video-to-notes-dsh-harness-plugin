# Plan: Video-to-Notes Application for DeepSeek Harness

> **Historical planning document.** It describes intent, not the current state.
> See `STATUS.md` for what is implemented and `README.md` for usage.

## High-Level Approach

Build a modular, extensible video analysis pipeline that connects to DeepSeek Harness, processes MP4 videos (single files or folders), extracts both visual and audio content using multiple complementary techniques (OCR on key frames, speech-to-text transcription, scene analysis), and generates comprehensive structured notes in Markdown format. The system uses a plugin architecture with the recently installed agentic-awesome-skills as the skill library, enabling multiple analysis modes and output formats.

The application will be implemented as a DeepSeek Harness plugin/bundle that can be installed and used within the Harness ecosystem, with CLI and programmatic interfaces.

## Scope

### In Scope
- MP4 video input (single file or folder of videos)
- Multi-modal extraction: OCR on key frames + speech-to-text + scene analysis
- Structured Markdown notes output with timestamps, sections, summaries
- DeepSeek Harness integration (plugin/bundle architecture)
- Configurable extraction intervals and quality settings
- Batch processing of multiple videos
- Plugin system for extensibility with agentic-awesome-skills
- Review committee validation with multiple personas
- TDD approach with comprehensive tests

### Out of Scope
- Real-time video streaming analysis
- Live camera feed processing
- Video editing or modification
- Cloud-based video processing (all local)
- Speaker diarization (basic transcription only)
- Non-MP4 formats (can be added via configuration)

## Architecture Decision: Clean Architecture with Plugin System

Following the **architecture-patterns** skill guidance, we'll use:
- **Core Domain**: Video processing pipelines, note generation
- **Application Layer**: Use cases (analyze video, batch process, generate notes)
- **Interface Adapters**: CLI, Harness plugin API, REST endpoints
- **Frameworks**: FFmpeg, Tesseract, Whisper, VideoDB SDK (optional)

## Action Items

### Phase 1: Foundation & Setup
- [ ] 1.1 Create project structure with Clean Architecture layers
- [ ] 1.2 Set up TypeScript/Node.js project with strict typing
- [ ] 1.3 Configure build system (tsc, vitest, eslint, prettier)
- [ ] 1.4 Create DeepSeek Harness plugin manifest and entry points
- [ ] 1.5 Set up dependency injection container for plugin system

### Phase 2: Core Video Processing Pipeline
- [ ] 2.1 Implement VideoMetadataExtractor (ffprobe wrapper)
- [ ] 2.2 Implement FrameExtractor (FFmpeg scene detection + interval extraction)
- [ ] 2.3 Implement OCRProcessor (Tesseract integration with language packs)
- [ ] 2.4 Implement AudioExtractor (FFmpeg audio extraction to WAV/MP3)
- [ ] 2.5 Implement TranscriptionEngine (Whisper.cpp / faster-whisper integration)
- [ ] 2.6 Implement SceneAnalyzer (scene detection, shot boundaries)
- [ ] 2.7 Create unified VideoProcessor orchestrator

### Phase 3: Note Generation System
- [ ] 3.1 Design NoteSchema (Markdown frontmatter + structured sections)
- [ ] 3.2 Implement ContentAggregator (merge OCR + transcript + scenes)
- [ ] 3.3 Implement Summarizer (LLM-based section summarization)
- [ ] 3.4 Implement TimestampAligner (sync visual and audio timestamps)
- [ ] 3.5 Implement NoteRenderer (Markdown output with navigation)
- [ ] 3.6 Add support for multiple output formats (MD, JSON, HTML)

### Phase 4: DeepSeek Harness Integration
- [ ] 4.1 Create HarnessPlugin class implementing dsh-plugin interface
- [ ] 4.2 Register video-analysis skills with Harness skill system
- [ ] 4.3 Implement CLI commands (analyze, batch, configure)
- [ ] 4.4 Create configuration schema (intervals, languages, models)
- [ ] 4.5 Add progress reporting and cancellation support

### Phase 5: Agentic Skills Integration
- [ ] 5.1 Create skill adapters for video-content-extractor
- [ ] 5.2 Create skill adapter for audio-transcriber
- [ ] 5.3 Create skill adapter for watch-igaming (QA table generation)
- [ ] 5.4 Create skill adapter for videodb (optional cloud features)
- [ ] 5.5 Implement skill router (video-router patterns)
- [ ] 5.6 Add skill composition for complex workflows

### Phase 6: Review Committee System
- [ ] 6.1 Define ReviewPersona interface and base class
- [ ] 6.2 Implement 5 review personas:
  - [ ] 6.2.1 SecurityReviewer (security, privacy, data handling)
  - [ ] 6.2.2 ArchitectureReviewer (design patterns, scalability, maintainability)
  - [ ] 6.2.3 UXReviewer (output quality, usability, note structure)
  - [ ] 6.2.4 PerformanceReviewer (resource usage, processing speed, memory)
  - [ ] 6.2.5 DomainExpertReviewer (video analysis accuracy, completeness)
- [ ] 6.3 Implement ReviewOrchestrator (parallel review, scoring, consensus)
- [ ] 6.4 Add review iteration loop (auto-revise until 95+ score)

### Phase 7: Testing & Quality Assurance
- [ ] 7.1 Write unit tests for each core component (TDD)
- [ ] 7.2 Write integration tests for full pipeline
- [ ] 7.3 Create test fixtures (sample videos with known content)
- [ ] 7.4 Implement contract tests for plugin interfaces
- [ ] 7.5 Add property-based testing for timestamp alignment
- [ ] 7.6 Set up CI/CD with quality gates

### Phase 8: Documentation & Release
- [ ] 8.1 Write comprehensive README with usage examples
- [ ] 8.2 Create API documentation (TypeDoc)
- [ ] 8.3 Write architecture decision records (ADRs)
- [ ] 8.4 Create release branch and tag v0.1.0
- [ ] 8.5 Publish to Harness plugin registry (if applicable)

## Validation Criteria

### Minimum Acceptance (per Review Committee)
- Overall score ≥ 95/100 across all 5 personas
- No persona scores below 85/100
- All critical security findings resolved
- All architecture violations addressed
- Test coverage ≥ 80% for core pipeline

### Functional Validation
- [ ] Processes 10-minute MP4 in < 2 minutes (local hardware)
- [ ] OCR accuracy ≥ 90% on clear text frames
- [ ] Transcription WER ≤ 10% on clear audio
- [ ] Notes contain all major topics from video
- [ ] Timestamps accurate within ±2 seconds
- [ ] Batch processing handles 50+ videos

### Quality Gates
- [ ] Zero critical/high security vulnerabilities (npm audit)
- [ ] TypeScript strict mode passes
- [ ] All tests pass in CI
- [ ] Bundle size < 50MB (excluding models)
- [ ] Memory usage < 2GB for 1-hour video

## Open Questions

1. **Model Selection**: Use local Whisper.cpp (privacy) vs. cloud API (accuracy)? → Default to local with cloud fallback option
2. **VideoDB Integration**: Include optional cloud features? → Yes, as optional plugin with explicit auth
3. **GPU Acceleration**: Require CUDA/Metal for Whisper? → Optional, CPU fallback required
4. **Output Format**: Single markdown file per video or combined? → Configurable, default single file

## Skill Mapping (from agentic-awesome-skills)

| Component | Primary Skill | Support Skills |
|-----------|---------------|----------------|
| Frame Extraction | video-content-extractor | watch-igaming (scene detection) |
| OCR Processing | video-content-extractor | - |
| Audio Transcription | audio-transcriber | - |
| Scene Analysis | watch-igaming | video-router |
| Note Generation | video-content-extractor | watch-igaming (QA tables) |
| Cloud Option | videodb | seek-and-analyze-video |
| Architecture | architecture-patterns | clean-code |
| Testing | test-driven-development | testing-patterns |
| Review Committee | multi-agent-task-orchestrator | agent-orchestrator |
| Plugin System | cordis-plugin-development | dsh-skill-filesystem |

## Implementation Priority Order

1. **Core Pipeline** (Phases 1-2) - Foundation everything builds on
2. **Note Generation** (Phase 3) - Core value delivery
3. **Harness Integration** (Phase 4) - Platform requirement
4. **Skills Integration** (Phase 5) - Leverages installed skills
5. **Review Committee** (Phase 6) - Quality assurance
6. **Testing** (Phase 7) - Continuous throughout
7. **Documentation** (Phase 8) - Final polish

## Risk Mitigation

| Risk | Likelihood | Impact | Mitigation |
|------|------------|--------|------------|
| FFmpeg/Tesseract/Whisper not installed | High | High | Auto-detect, provide install scripts, clear errors |
| Large video memory issues | Medium | High | Streaming processing, chunked frames, configurable limits |
| OCR/Transcription accuracy low | Medium | Medium | Configurable models, quality flags, manual review option |
| Harness API changes | Low | Medium | Version pinning, adapter pattern, integration tests |
| Skill compatibility issues | Medium | Medium | Skill version pinning, fallback implementations |

---

*Plan created using concise-planning, architecture-patterns, and agentic-awesome-skills catalog.*
*Review Committee evaluation required before implementation begins.*