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

## Skill-doc deployment decision

T24 Step 2 (copying the updated `skills/*/SKILL.md` into `C:\Users\ruchi\.dsh\skills\...`, outside this repository) was **skipped**: writing to the harness runtime directory was not explicitly authorized for this session. The in-repo skill docs are updated and committed; the user can copy them when desired.

## Gate results

- `npx tsc --noEmit` — exit 0.
- `npm run build` — exit 0.
- `npx vitest run` — 36 files, 147 tests passed.
- Seeded eval now drives `LLMNoteValidator.validate` with a scripted provider whose basis is present in the OCR fixture; TP/FP/FN are derived from the validator output, not a hand-built correction. A negative seed (fabricated basis) is rejected and downgraded to a Check item.
- `scripts/e2e-check.ps1` — `E2E OK: sample_notes.md, sample_ocr.md, sample_transcript.md`; exactly three markdown files, screenshots folder non-empty, negative control detected the seeded marker.
- `scripts/e2e-check-llm.ps1 -Provider stub` — asserts three markdown files, bold formatting, `## Validation & Accuracy`, screenshot embeds, ≥2 stub endpoint calls and a `validation` line in the stub call log; appends its result to this file. It does **not** assert factual accuracy of the generated notes.
- Seeded accuracy test — TP=1, FP=0, FN=0, precision=1.0, recall=1.0, coverage 100% (scripted stub, labelled a harness check).
- `VTN_REAL_LLM_PROVIDER` is not configured in this harness: `SKIPPED (no provider)` for real-provider adversarial and accuracy evidence. No claim of real-provider resistance or factual accuracy is made.
- **Lint gate is RED (pre-existing baseline).** `npx eslint src --ext .ts` exits **1**. The problem count drifts as files change (~7.1k problems in recent runs); the dominant rule is `prettier/prettier` (CRLF/line-ending formatting, ~6.85k), followed by `consistent-type-imports` (~75), `no-unsafe-member-access` (~48), `no-unsafe-assignment` (~40), `no-unused-vars` (~25), plus `no-explicit-any` warnings (~26). Only ~140 are strict-type findings; the large majority is formatting. This means the plan's T22 lint step **fails** and the overall gate cannot be called green. No suppressions were added: `as any` / `@ts-ignore` / `eslint-disable` count is 0. Fixing this baseline is a separate repository-wide formatting task, not part of this feature.
LLM E2E OK (stub): three artifacts, validation section, embeds; stub calls=3 (with a `validation` call recorded)
LLM E2E OK (stub): three artifacts, validation section, embeds; stub calls=3 (with a `validation` call recorded)
LLM E2E OK (stub): three artifacts, validation section, embeds; stub calls=3
