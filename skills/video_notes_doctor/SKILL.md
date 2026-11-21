---
name: video_notes_doctor
description: "Diagnose and check the environment for video-to-notes: ffmpeg, ffprobe, tesseract, whisper-cli, scenedetect, and LLM provider configuration."
category: diagnostics
risk: safe
tags: [video, diagnostics, doctor, video-to-notes]
---

# Video Notes Doctor

Diagnoses tool prerequisites and LLM provider setup for the `video-to-notes` plugin.

## How to Execute

Invoke the `video_notes_doctor` tool directly:

```json
{
  "verbose": true
}
```

The report will detail:
- ffmpeg / ffprobe status (required)
- Tesseract OCR status (optional, for slide text extraction)
- whisper-cli status and models (optional, for speech-to-text)
- scenedetect status (optional, for scene change detection)
- Current LLM provider and synthesis mode (Harness LLM, DeepSeek, OpenAI, Anthropic, or offline extractive)
- Multilingual readiness: for Hinglish/Hindi transcription a non-English `ggml-base.bin` (or `ggml-small.bin`) must be present in the Whisper model directory. An English-only `ggml-*.en.bin` is insufficient; the doctor report flags this when `multilingual` is requested.
