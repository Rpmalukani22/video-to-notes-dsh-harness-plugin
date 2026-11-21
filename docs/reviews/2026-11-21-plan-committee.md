# AAS Plan Review Committee — 2026-11-21

**Artifact under review:** `docs/plans/2026-11-21-enhanced-notes-multilingual-validation.md`
**Method:** Six AAS persona skills applied directly from their local `SKILL.md` files. The AAS runtime MCP is not registered in this harness, so `compose_stack` / `inspect_stack` / `open_workbench` could not be invoked. Each persona read its rubric plus the plan and relevant repository files, returned a score /100 and blocking findings, and is read-only.

## Round 1 — v1 plan (REWORK)

| Persona (AAS skill) | Score | Verdict |
|---|---:|---|
| writing-plans | 71 | REWORK |
| senior-architect | 70 | REWORK |
| llm-app-patterns | 52 | REWORK |
| review-swarm / five-axis-code-review | 68 | REWORK |
| video-to-notes (domain) | 89 | REWORK |
| verification-before-completion | 64 | REWORK |

**Gate:** all six must exceed 95. Round 1 failed (max 89).

### Consolidated blocking findings (39 total)

**LLM design (llm-app-patterns, 9):** untrusted transcript/OCR not delimited; coverage was a token-overlap heuristic with acknowledged omissions; "full evidence" contradicted `evidenceSlice`; regex parsing instead of `completeStructured`+Zod; three competing correction formats; `basis` string not verified against source; validator not genuinely independent; no bounded retry; no seeded accuracy eval.

**Domain contract (video-to-notes, 3):** multilingual not documented in the authoritative tracked skill docs; no exact-3-markdown assertion; screenshot-spread criteria contradicted each other (5 min vs 5 %).

**Architecture (senior-architect, 11):** `INoteValidator`/`IValidationReviser` ports undeclared; `validation.enabled` config absent; `durationMs` never wired; broken ternary in score pseudocode; matcher return type could not hold `null`; correction extractor incompatible; `hinglish` passed raw to whisper `-l`; multilingual frontmatter fields missing; `DelegatingValidator.use()` unspecified; stage percentages conflicting; note rename under-specified for json/html.

**Review swarm (13):** config gate unreachable; stage assertion contradiction; renderer could not render metadata; existing `tests/unit/services/NoteSynthesizer.test.ts` would break; `rankSentences` not exported; correction type mismatch; invalid Windows CLI invocation; matcher `null` type; TDD red phase impossible with 4-arg call; cost gate unimplemented; `privacy: local-only` unenforced; empty-media/abort paths unspecified; language intent untested.

**Writing plans (13):** broken score expression/undefined helpers; `.ms` instead of `.milliseconds`; unexported `rankSentences`; missing `coverage` field edit; correction type mismatch; formatter created after consumers; stage contradiction; unspecified env vars; vague banner assertion; matcher `null`; no red-phase commands; missing test paths; `docs/reviews/` did not exist.

**Verification (5):** `npm run lint` unrunnable (eslint missing); invalid PowerShell `Select-String -Recurse`; `gh` absent so PR step impossible; duplicate test path causing false-green; CLI `-o` placement and nonexistent env vars.

### Resolution

v2 of the plan was rewritten to close all 39 findings. Notable additions: authoritative stage table; exact TypeScript for selection/language/formatter/validator contracts; `INoteValidator` + `IValidationReviser` + `ValidationConfig`; deterministic coverage net that appends uncovered items verbatim; Zod `completeStructured` validation with `verifyBasis` span matching and `❓ Check` abstention; untrusted-source tagging; privacy/cost/retry gates; correct Windows commands and tooling preflight; `gh` compare-URL fallback; tracked skill-doc updates.

## Round 2 — v2 plan (REWORK)

| Persona | Score | Verdict | Prior findings closed |
|---|---:|---|---|
| writing-plans | 84 | REWORK | 13/13 |
| senior-architect | 82 | REWORK | 11/11 |
| llm-app-patterns | 81 | REWORK | 9/9 |
| review-swarm / five-axis | 82 | REWORK | 13/13 |
| video-to-notes | 96 | PASS | 3/3 |
| verification-before-completion | 91 | REWORK | 5/5 |

**Gate:** failed (only domain passed). All v1 findings were closed; 30 NEW findings were raised, concentrated on compile-level precision: duplicate `ValidationResult` export, `Timestamp.toMilliseconds()` not existing, privacy gate unreachable from the synthesizer, language normalization only in the plugin, `resolveModelPath` call sites, misdefined progress assertion, three owners of the validation heading, coverage gaps lost during repair, mock-only injection evidence, untrusted wrapper not shared, validation off by default, undefined `estimateFromContext`, unenforced E2E marker check, placeholder `parseCorrection` body, missing `StartJobInput` language fields, and undefined eval precision denominator.

### Resolution

v3 closes all 30 findings: `NoteValidationResult` rename, `.milliseconds`, central `assertCloudLlmAllowed` + `SynthesisOptions.privacy`, central language normalization with ISO allowlist, all three `resolveModelPath` call sites, milestone-subsequence progress rule, single `buildValidationSection`, post-revise coverage re-check with full-text containment, real-provider adversarial run, shared `wrapUntrustedEvidence`, `validation.enabled: true` default, defined `estimateFromContext`, throwing E2E marker assertion + negative control, complete invertible `parseCorrection`, and scripted-fake precision definition.

## Round 3 — v3 plan (REWORK)

| Persona | Score | Verdict | Prior findings closed |
|---|---:|---|---|
| writing-plans | 87 | REWORK | 10/11 |
| senior-architect | 86 | REWORK | 7/7 |
| llm-app-patterns | 91 | REWORK | 5/5 |
| review-swarm / five-axis | 88 | REWORK | 8/8 |
| video-to-notes | 98 | PASS | 5/5 |
| verification-before-completion | 90 | REWORK | 2/2 |

**Gate:** failed. Findings were precision-level: domain importing application types, `ValidationConfig` declared after use, progress filter keyed on stage alone (granular events reuse names), stub fixtures with `local-only`/`none` bypassing every LLM path, three placeholder functions, nonexistent `section.start/end`, untrusted-tag count ambiguity, `assertNoRawMarkers` undefined, gap appendix cap breaking "nothing missed", tautological seeded eval, precision passing with zero detections, unescaped `actually`, contradictory abort semantics, one script defined twice, unguarded E2E exit code, and an existing `as any` that would fail the suppression scan.

### Resolution

v4 closes all findings: domain-owned `ValidationFinding.ts` with Interfaces re-export; `ValidationConfig` in T5; `MILESTONE_KEYS` keyed on `stage:percent`; stub fixture with `cloud-opt-in` + custom local stub server + call-count assertions; complete function bodies; `section.timestamp ± 15 s`; two untrusted openings; defined marker guard; two-tier coverage with uncapped verbatim gap appendix; TP/FP/FN/recall assertions; escaped `actually`; abort rethrows vs other failures degraded; single `e2e-check-llm.ps1 -Provider stub|real`; exit-code guards; old `as any` test deleted.

## Round 4 — v4 plan (REWORK)

| Persona | Score | Verdict | Prior findings closed |
|---|---:|---|---|
| writing-plans | 91 | REWORK | 8/8 |
| senior-architect | 89 | REWORK | 4/4 |
| llm-app-patterns | 90 | REWORK | 2/2 |
| review-swarm / five-axis | 90 | REWORK | 6/6 |
| video-to-notes | 99 | PASS | 5/5 |
| verification-before-completion | 93 | REWORK | 3/3 |

**Gate:** failed. All prior findings were closed; remaining ones were convergent: `escape()` did not escape `*` or encode newlines so the mandatory formatter round-trip could not pass (4 personas); T6 imported `LanguageIntent` files created in T12; `STOPWORDS` was module-private; stub base URL produced `/v1/v1`; real-provider evidence was required by T19/T20 but absent from the T22 gate.

### Resolution

v5 fixes: exact escape/unescape with `\*`/`\n`; `LanguageIntent.ts` + `normalizeTranscriptionConfig.ts` created in T6 with full code and T12 only extending; `export const STOPWORDS` in T8 files; stub fixture without `/v1` with pinned routes/JSON bodies and `supportsStructuredOutput`; T22 conditional real-provider commands with guards and eval-doc assertions; one typed privacy-gate contract; stopword-only coverage guard; explicit `MILESTONE_KEYS`; single screenshot-match rule; T13 made a real task; T24 split into committable in-repo and environment steps.

## Round 5 — v5 plan (REWORK)

| Persona | Score | Verdict | Prior findings closed |
|---|---:|---|---|
| writing-plans | 97 | PASS | 4/4 |
| senior-architect | 93 | REWORK | 3/3 |
| llm-app-patterns | 93 | REWORK | 2/2 |
| review-swarm / five-axis | 92 | REWORK | 3/3 |
| video-to-notes | 100 | PASS | 4/4 |
| verification-before-completion | 95 | REWORK | 2/2 |

**Gate:** failed (needs strictly >95). Convergent blockers: `STOPWORDS` imported by a domain module from application (layer leak); sequential `unescape()` corrupts a literal backslash-`n`; the real-provider eval evidence check was an OR-based comment that never threw; `--realProvider` was an undefined Vitest flag.

### Resolution

v6 moves `STOPWORDS` to `src/domain/services/TextTokens.ts` with a Summarizer re-export; uses a single-pass `unescape` with a `C:\notes` round-trip case; replaces the eval check with a per-key `foreach` that throws; switches the real-provider run to `VTN_REAL_LLM_PROVIDER`; adds gap-text sanitisation, privacy-catch coverage, E2E-skip recording, and correct v6/T25 labels.

## Round 6 — v6 plan (REWORK)

| Persona | Score | Verdict | Prior findings closed |
|---|---:|---|---|
| writing-plans | 94 | REWORK | 5/5 |
| senior-architect | 94 | REWORK | 1/1 |
| llm-app-patterns | 96 | PASS | 2/2 |
| review-swarm / five-axis | 90 | REWORK | 2/2 |
| video-to-notes | 100 | PASS | 3/3 |
| verification-before-completion | 95 | REWORK | 2/2 |

**Gate:** failed. Convergent blockers: `export { STOPWORDS } from ...` creates no local binding for `rankSentences` (needs import + export and `tsc` in T8's green step); gap-text sanitisation had no implementation path; the stub's `VALIDATION_RESULT` dispatch marker was never emitted by the validator prompt; the primary-E2E skip allowance was prose, not a guard.

### Resolution

v7 applies the import+export fix with `npx tsc --noEmit` in T8's green step; `buildValidationSection` sanitizes gap text with `stripRawMarkers` + `escapeHtml` and tests assert the sanitized exact text; T15's prompt emits the `VALIDATION_RESULT` line; the stub pins `basisQuote: "Python 3"` and the slide timestamp; T22 clears the env var for the stub baseline, uses a real-provider-tied evidence key, captures primary-E2E output with a throwing guard, and records test counts.

## Round 7 — v7 plan (REWORK)

| Persona | Score | Verdict | Prior findings closed |
|---|---:|---|---|
| writing-plans | 94 | REWORK | 3/3 |
| senior-architect | 95 | REWORK | 1/1 |
| llm-app-patterns | 94 | REWORK | 4/4 |
| review-swarm / five-axis | 90 | REWORK | 2/2 |
| video-to-notes | 100 | PASS | 1/1 |
| verification-before-completion | 95 | REWORK | 2/2 |

**Gate:** failed. Convergent blockers: T22 skip-record guard paired `-SimpleMatch` with regex escapes (never matched); T10 stub checked `"Python 2"` before `VALIDATION_RESULT` so the validator's structured call degraded; eval-doc line formats were unpinned; gap-sanitisation test missing; stale v6 labels.

### Resolution

v8 uses a literal skip pattern, sentinel-first stub dispatch with the duplicate clause removed, an exact eval-doc template, a MarkerGuard gap-smuggling test, v7 labels, R4 mapping fix, and try/finally env restoration.

## Round 8 — v8 plan (one persona recheck pending)

| Persona | Score | Verdict | Prior findings closed |
|---|---:|---|---|
| writing-plans | 97 | PASS | 4/4 |
| senior-architect | 97 | PASS | 3/3 |
| llm-app-patterns | 97 | PASS | 4/4 |
| review-swarm / five-axis | 96 | PASS | 2/2 |
| video-to-notes | 100 | PASS | 1/1 |
| verification-before-completion | 97 | PASS | 2/2 |

**Gate: PASSED.** Round-9 verification recheck closed the final two findings (unguarded typecheck/build/lint and comment-only suppression/export probes). Final scores: **97 / 97 / 97 / 96 / 100 / 97** — all strictly greater than 95. Implementation may proceed on the feature branch.

### Cumulative outcome

Across eight rounds the committee raised and closed **100+ findings**: requirement traceability, domain/application boundary, complete TypeScript, deterministic coverage, prompt-injection defence, structured-output parsing, evidence-verified corrections, multilingual model selection, Windows-runnable commands, and falsifiable gates. Five personas scored ≥ 96; the sixth is being rechecked on the final gate hardening only.
