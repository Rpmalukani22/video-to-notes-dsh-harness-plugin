---
name: video-to-notes
description: "Convert video files into structured Markdown notes with key screenshots, on-screen OCR text, and synchronized transcript. Supports VAD control and audio enhancement."
category: productivity
risk: safe
tags: [video, notes, transcription, ocr, whisper, ffmpeg]
---

# Video to Notes

Converts local video files into 3 comprehensive outputs:
1. **Synthesized Notes (with screenshots):** `[video]_notes.md` — Complete study notes combining on-screen text and verbal discussion, concept validation callouts, and embedded screenshots.
2. **Full Raw Transcript:** `[video]_transcript.md` — Timestamped, paragraphed transcript.
3. **On-Screen Text (OCR):** `[video]_ocr.md` — Deduped text extracted from video frames.

## Tools Available

- `video_notes_doctor`: Checks binary availability (ffmpeg, tesseract, whisper-cli, scenedetect) and LLM status.
- `analyze_video`: Starts asynchronous analysis of a video file.
- `video_note_status`: Polls job progress and retrieves generated note paths.

## Usage Workflow

1. **Verify Environment:**
   Call `video_notes_doctor({ verbose: true })`.

2. **Run Analysis:**
   Call `analyze_video`:
   ```json
   {
     "videoPath": "C:/path/to/video.mp4",
     "preset": "lecture",
     "vadEnabled": true,
     "enhanceAudio": false
   }
   ```
   - If audio has heavy background noise, air conditioning, or fan noise that cuts off speech, set `"vadEnabled": false` or `"enhanceAudio": true`.

3. **Check Status:**
   Poll `video_note_status` with the returned `jobId` until status is `completed`.
   The tool output will display paths to all 3 generated markdown files and screenshots folder.
