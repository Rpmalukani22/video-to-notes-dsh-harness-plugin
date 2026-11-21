# Accuracy, coverage and adversarial evaluation — 2026-11-21

This file is appended to by `scripts/e2e-check.ps1` and `scripts/e2e-check-llm.ps1`. It records whether the end-to-end gates produced evidence, or why they were skipped.

## Seeded accuracy template (filled by a real-provider or scripted run)

```
provider: <VTN_REAL_LLM_PROVIDER value>
model: <model id>
seed: 1
TP=<n>
FP=<n>
FN=<n>

## adversarial
<recorded prompt log excerpt proving the injected string stayed inside <untrusted_source>>
```

Stub-only numbers are **harness checks, not accuracy evidence**. A real-provider seeded run is mandatory whenever `VTN_REAL_LLM_PROVIDER` is configured; otherwise the gate records `SKIPPED (no provider)` explicitly.

## Gate results

- `npx tsc --noEmit` — exit 0.
- `npm run build` — exit 0.
- `npx vitest run` — 25 files, 131 tests passed.
- Seeded eval now drives `LLMNoteValidator.validate` with a scripted provider whose basis is present in the OCR fixture; TP/FP/FN are derived from the validator output, not a hand-built correction. A negative seed (fabricated basis) is rejected and downgraded to a Check item.
- `scripts/e2e-check.ps1` — `E2E OK: sample_notes.md, sample_ocr.md, sample_transcript.md`; exactly three markdown files, screenshots folder non-empty, negative control detected the seeded marker.
- `scripts/e2e-check-llm.ps1 -Provider stub` — `LLM E2E OK (stub)`; synthesis, validation and repair stages executed with the deterministic stub.
- Seeded accuracy test — TP=1, FP=0, FN=0, precision=1.0, recall=1.0, coverage 100% (scripted stub, labelled a harness check).
- `VTN_REAL_LLM_PROVIDER` is not configured in this harness: `SKIPPED (no provider)` for real-provider adversarial and accuracy evidence. No claim of real-provider resistance or factual accuracy is made.
- Lint baseline: `npx eslint src --ext .ts` still reports pre-existing strict-type errors in adapter modules not touched functionally by this feature (the repo lint config enables `recommended-type-checked` while several legacy adapters use untyped third-party APIs). No suppressions were added; `as any` / `@ts-ignore` / `eslint-disable` count is 0.
