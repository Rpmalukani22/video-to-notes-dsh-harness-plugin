# Multi-Persona Review — `video-to-notes`

**Review date:** 2026-11-19
**Target:** `C:\src\ai_workspace\video-to-notes` (v0.1.0)
**Method:** Agentic Awesome Skills (AAS) review stack — evidence-first, reproducible, no claim accepted without a command that demonstrates it.
**Ultimate goal:** ship this repository as an installable **DeepSeek Harness (DSH)** plugin bundle.

---

## 0. Executive verdict

| Gate | Claimed by repo | Actual | Verdict |
|---|---|---|---|
| Compiles | "production-ready" (README) | **47 TypeScript errors** | ❌ |
| Tests | badge: CI passing | **5/5 test files fail to load, 0 tests run** | ❌ |
| Review committee | "unanimous, ≥95/100" (`REVIEW_SIGN_OFF.md`) | Not reproducible; contradicted by the above | ❌ Retracted |
| CLI binary | `vtn analyze …` | `bin` missing from `package.json`; `src/index.ts` absent | ❌ |
| DSH plugin | "native plugin with web UI panel" | Implements an **invented** contract; DSH would never discover it | ❌ |
| Architecture intent | Clean/DDD, ports & adapters | Ports exist; **8 of 18 adapters do not exist** | ⚠️ Partial |
| Security posture | "SSRF protection, XSS sanitization" | No such code; crash bug in the abort signal | ❌ |

**Overall score (AAS weighted): 2.1 / 10 — prototype, not a product.**

The most valuable asset in this repo is the *design*: the port interfaces, the domain model, and the plan documents. The implementation is a façade: a substantial amount of it returns hard-coded success values, and the DeepSeek Harness adapter targets an API that does not exist.

Two things must happen in order:

1. **Stop asserting quality.** Retract `REVIEW_SIGN_OFF.md` and the "production-ready" language. A reviewer or an agent that trusts these documents will waste days.
2. **Make the thing true or make it small.** Either implement the missing adapters or cut scope to a plugin that does one real thing end-to-end (video → transcript → note). Scope cut is strongly recommended; see §5.

---

## 1. Evidence pack (reproduce before reading further)

Run from the repo root. Every finding below cites one of these.

```powershell
# E1 — compile
npx tsc --noEmit --incremental false        # -> 47 errors, exit 1

# E2 — tests
npx vitest run --reporter=basic             # -> 5 failed / 5 files, "no tests"

# E3 — packaging
Get-Content package.json | Select-String '"type"|"bin"|"main"'
                                            # -> no "type": "module"; no "bin"; main=dist/index.js

# E4 — missing entry points
Test-Path src/index.ts                      # -> False
Test-Path src/interfaces/cli/doctor.ts      # -> False  (referenced by scripts.doctor)
Test-Path dist                              # -> False

# E5 — missing adapters
Get-ChildItem src -Recurse -Filter *.ts |
  Select-String '^export class' |
  ForEach-Object { $_.Line.Trim() }
# -> no NoteRenderer, no ResourcePool/LocalWorkerPool, no CheckpointStore,
#    no MetricsCollector, no Logger, no ConfigurationProvider, no SecretProvider

# E6 — stubs
Get-ChildItem src -Recurse -Filter *.ts |
  Select-String 'Placeholder|placeholder|In production|For now'
```

Relevant environment facts used later:

- DSH runtime installed at `C:\Users\ruchi\.dsh\profiles\node_modules\@deepseek-ai\*` (junctions into the npx cache), version **0.2.2-rc.1**.
- DSH plugin contract = Cordis `name` / `inject` / `Config` / `apply` named exports. Confirmed in `dsh-tool-todo/lib/index.js` (`export { Config, apply, inject, name };`) and `dsh-skill-filesystem`.
- Bundle manifest = `package.json` field `"dsh": { "bundle": { "patch": "./cordis.patch.yml" } }`. Confirmed in `dsh-base/package.json`.
- Tool factory = `defineTool` from `@deepseek-ai/dsh-tools`, registered via `ctx.tools.register(...)`. Confirmed in `dsh-tools/lib/index.js:310` and `dsh-tool-todo/lib/index.js`.
- LLM service key is `"llm"`. Confirmed in `dsh-llm/lib/index.js:1816` (`super(ctx, "llm")`).

---

## 2. The DSH contract — ground truth vs. what this repo implements

This is the single most important section, because the stated goal fails here first.

### 2.1 What a DSH plugin actually is

A DSH plugin is a **Cordis plugin module**. It exports **named** bindings — a default export is not used. Minimal correct shape:

```ts
// dist/index.js  (ESM, "type": "module")
import z from '@deepseek-ai/schemastery'
import { defineTool } from '@deepseek-ai/dsh-tools'

export const name = 'video-to-notes'
export const inject = ['tools']            // service keys this plugin consumes
export const Config = z.object({           // schemastery, validated per row
  ffmpegPath: z.string().default('ffmpeg'),
})
export function apply(ctx, config) {       // async is allowed
  ctx.tools.register(defineTool({ /* ... */ }))
}
```

A **bundle** (installable via `dsh plugin add`) is a package whose `package.json` carries:

```json
{
  "type": "module",
  "exports": { ".": { "types": "./dist/index.d.ts", "default": "./dist/index.js" } },
  "dsh": { "bundle": { "patch": "./cordis.patch.yml" } }
}
```

and a `cordis.patch.yml` at the package root that inserts rows:

```yaml
- insert:
    - id: video-to-notes
      name: 'video-to-notes'
      config:
        ffmpegPath: ffmpeg
```

### 2.2 What this repo implements instead

`src/interfaces/harness-plugin/index.ts` invents:

| Invented (repo) | Real DSH |
|---|---|
| `export default harnessPlugin` | named exports only; default is ignored |
| `interface HarnessPluginManifest { permissions, entryPoints, lifecycle }` | no manifest; `package.json` + `cordis.patch.yml` |
| `onLoad(context)` / `onUnload()` | `apply(ctx, config)`; teardown via `ctx.effect` / disposers |
| `permissions: ['read:video-input', 'exec:ffmpeg']` | no plugin permission strings; sandbox + approval services own this |
| `skills: [{ id, version: 'pinned-commit-hash' }]` | skill registration or `@deepseek-ai/dsh-skill` provider; literal `'pinned-commit-hash'` is a placeholder |
| `render(): JSX.Element`, `onFileDrop(files: FileList)` | no JSX in the agent host; UI is a Cordis client module, separate package |
| `analyzeVideo(input, context)` as a class method | a registered **tool** with a JSON Schema, invoked by the model |

Result: **DSH cannot load this plugin.** Not "loads with warnings" — the loader would look for `apply`/`name`, find neither, and the row would fail to activate.

### 2.3 Gap matrix for the stated goal

| Requirement | State | Blocking issue |
|---|---|---|
| ESM package | ❌ | `package.json` has no `"type": "module"`; tsc emits CJS under NodeNext |
| Named plugin exports | ❌ | only `default` + class |
| `apply(ctx, config)` | ❌ | absent |
| `defineTool` registration | ❌ | tools are class methods |
| Valid `Config` schema | ❌ | none |
| `dsh.bundle.patch` | ❌ | absent |
| `cordis.patch.yml` | ❌ | absent |
| Peer deps on `@deepseek-ai/*` | ❌ | absent |
| Build produces `dist/` | ❌ | build fails (47 errors) |
| Tools return schema-valid output | ❌ | outputs are `any` |

---

## 3. Findings

Severity: **P0** blocks the stated goal · **P1** blocks correctness/trust · **P2** quality · **P3** polish.
Every finding has an exact fix and a verification command.

---

### 3.1 Build & Release (persona: Build/Release Engineer)

#### BLD-01 — Build fails with 47 errors · **P0**

**Evidence (E1).** Errors cluster into six mechanical groups; none require design work.

| Group | Count | Files |
|---|---|---|
| Missing/renamed exports | 20 | `interfaces/cli/index.ts`, `interfaces/rest-api/index.ts`, `interfaces/harness-plugin/index.ts` |
| `exactOptionalPropertyTypes` violations | 3 | `HarnessLLMProvider.ts:90`, `WhisperTranscriptionEngine.ts:52,149` |
| Duplicate symbol re-export | 2 | `infrastructure/index.ts:17` (`Citation`, `NoteSection`) |
| Missing `.js` extension | 1 | `TesseractOCRProcessor.ts:177` |
| Untyped `RequestInit.timeout` | 2 | `LocalLLMProviders.ts:274,559` |
| Duplicate methods / logic bugs | 8 | `WhisperTranscriptionEngine.ts:156,169`, `TesseractOCRProcessor.ts:83,105`, `LocalLLMProviders.ts:214,264` |

**Fix order (do not reorder — each step removes errors the next depends on):**

**Step 1 — stop the infrastructure barrel from re-exporting other layers.**
`src/infrastructure/index.ts` currently ends with:

```ts
export * from '../domain';
export * from '../application/ports/Interfaces';
export * from '../application/use-cases/AnalyzeVideo';
export * from '../application/use-cases/BatchProcess';
```

Replace the whole file with:

```ts
/**
 * Infrastructure layer exports.
 * Adapters only. Do NOT re-export domain or application here: it inverts the
 * dependency rule and makes `Citation` / `NoteSection` ambiguous.
 */
export * from './adapters/FfmpegVideoMetadataExtractor';
export * from './adapters/FfmpegFrameExtractor';
export * from './adapters/FfmpegAudioExtractor';
export * from './adapters/TesseractOCRProcessor';
export * from './adapters/WhisperTranscriptionEngine';
export * from './adapters/PySceneDetectSceneAnalyzer';
export * from './adapters/HarnessLLMProvider';
export * from './adapters/CloudLLMProviders';
export * from './adapters/LocalLLMProviders';
```

Verify: `npx tsc --noEmit` — the two `TS2308` errors disappear.

**Step 2 — fix the interface consumers.** `cli/index.ts:14-27`, `rest-api/index.ts:21-26`, and `harness-plugin/index.ts:14-29` import class names that never existed (`VideoMetadataExtractor`, `NoteRenderer`, `WinstonLogger`, …). Replace each with either the real adapter name or the port:

```ts
// delete the whole import block from '../../infrastructure' in cli/index.ts
// and import only what you construct:
import { FfmpegVideoMetadataExtractor } from '../../infrastructure/adapters/FfmpegVideoMetadataExtractor';
```

Do **not** paper over this with `// @ts-ignore` or `as any`. The reason the names are wrong is that the classes were never written (see ARC-03).

**Step 3 — `exactOptionalPropertyTypes`.** In `HarnessLLMProvider.ts:90`, the object literal passes `usage: ... | undefined` into `LLMChunk`. Fix the *type*, not the call site:

```ts
// src/application/ports/Interfaces.ts
export interface LLMChunk {
  delta: string;
  finishReason?: string;
  usage?: { promptTokens: number; completionTokens: number; totalTokens: number };
}
```

and in `HarnessLLMProvider.ts:90` build the object conditionally:

```ts
const chunk: LLMChunk = { delta };
if (usage) chunk.usage = usage;
if (finishReason) chunk.finishReason = finishReason;
yield chunk;
```

Same pattern for `WhisperTranscriptionEngine.ts:52,149`: spread `...({ language: x } as const)` only when defined, or change `TranscriptionConfig.language` to `language?: string | undefined`.

**Step 4 — `.js` extensions.** With `moduleResolution: NodeNext`, every relative import needs an extension. `TesseractOCRProcessor.ts:177`:

```ts
// before
from '../../domain/value-objects/Confidence'
// after
from '../../domain/value-objects/Confidence.js'
```

Sweep the whole tree for the same defect:

```powershell
Get-ChildItem src -Recurse -Filter *.ts |
  Select-String "from '\.\.?/[^']*(?<!\.js)'" |
  ForEach-Object { "$($_.Path):$($_.LineNumber)" }
```

**Step 5 — `RequestInit.timeout` does not exist.** `LocalLLMProviders.ts:274` and `:559`:

```ts
// before
await fetch(url, { timeout: 5000 });
// after
await fetch(url, { signal: AbortSignal.timeout(5000) });
```

`AbortSignal.timeout` exists in Node 17.3+; `engines` is `>=20`, so it is safe. `undici` is already a dependency if you prefer `request()` with `headersTimeout`.

**Step 6 — logic defects that present as type errors.** See LOG-01 … LOG-05. They must be fixed, not silenced: `.join` on a `string` and a duplicated method are runtime landmines.

**Verify:** `npx tsc --noEmit --incremental false` → `0` errors.

---

#### BLD-02 — `package.json` cannot produce a runnable package · **P0**

Three separate defects:

1. **No `"type": "module"`.** `tsconfig` uses `module: NodeNext`. Without `"type": "module"` the emitted `.js` is CommonJS, and Cordis — which imports ESM — fails.
2. **No `"bin"`, but README documents `vtn`.** `README.md:80` (`vtn analyze …`) cannot work.
3. **`scripts.doctor` points at a file that does not exist** (`src/interfaces/cli/doctor.ts`, E4).

**Fix** — patch `package.json`:

```json
{
  "type": "module",
  "main": "dist/index.js",
  "types": "dist/index.d.ts",
  "bin": { "vtn": "dist/cli.js" },
  "files": ["dist", "cordis.patch.yml"],
  "scripts": {
    "build": "tsc -p tsconfig.build.json",
    "doctor": "node dist/cli.js doctor"
  }
}
```

and create `src/cli.ts` (a thin bin shim) plus `src/index.ts`:

```ts
// src/index.ts — public library surface
export * from './domain/index.js';
export * from './application/index.js';
export * from './infrastructure/index.js';
```

**Verify:** `npm run build && node dist/cli.js --help`.

---

#### BLD-03 — `tsconfig` points at a directory that does not exist · **P2**

`"typeRoots": ["./node_modules/@types", "./src/types"]` but `src/types/` is absent (E4). TypeScript silently ignores a missing typeRoot; the risk is that someone later "fixes" it by adding a broken ambient file.

**Fix:** delete the `typeRoots` line. `@types/node` is resolved automatically.

---

#### BLD-04 — Stray root file and no build config split · **P3**

`test-ts.ts` (101 bytes) sits in the repo root and is not part of any script. `tsconfig.json` includes `src/**/*` and excludes tests, but the build also emits declarations for the CLI entry which we do not want in the library build.

**Fix:** delete `test-ts.ts`; add `tsconfig.build.json`:

```json
{
  "extends": "./tsconfig.json",
  "exclude": ["tests", "**/*.test.ts", "**/*.spec.ts", "src/interfaces/rest-api/**"]
}
```

---

### 3.2 Architecture (persona: Architecture Reviewer)

#### ARC-01 — The port file declares the same interface twice · **P1**

**Evidence.** `src/application/ports/Interfaces.ts`:

- `BatchConfig` at **259** and again at **341**
- `LLMConfig` at **272** and again at **321**
- `Citation` at **231** and again at **427**
- `NoteSection` at **413** *and* `src/domain/entities/Note.ts:6`

TypeScript merges duplicate `interface` declarations, so this compiles — until someone adds a field to one copy and not the other. The second `LLMConfig` (321) silently drops `capabilities`, `contextManagement`, `performance`, and `cost`.

**Fix:** keep exactly one declaration per name.

```ts
// delete lines 321-334 (the second, poorer LLMConfig)
// delete lines 341-348 (the second BatchConfig)
// delete lines 427-437 (the duplicate Citation); import it from the domain instead:
export type { Citation, NoteSection } from '../../domain/entities/Note';
```

**Verify:**

```powershell
Select-String -Path src/application/ports/Interfaces.ts -Pattern '^export interface (\w+)' |
  Group-Object { ($_.Line -split '\s+')[2] } | Where-Object Count -gt 1
# -> no output
```

---

#### ARC-02 — Infrastructure imports from domain and application · **P1**

Covered mechanically in BLD-01 Step 1, but the architectural point stands: `infrastructure/index.ts` re-exporting `../application/use-cases/*` means a change to a use case can break adapter consumers, and it produced the `Citation` ambiguity. The dependency rule is *inward only*.

**Fix:** one-directional imports. Add an ESLint rule so it cannot regress:

```jsonc
// .eslintrc.json — add to "rules"
"no-restricted-imports": ["error", {
  "patterns": [{
    "group": ["**/infrastructure/*"],
    "importNames": [],
    "message": "domain/application must not import infrastructure"
  }]
}]
```

Apply the rule per-directory with `overrides` so it only fires under `src/domain` and `src/application`.

---

#### ARC-03 — Eight ports have no adapter · **P0**

`AnalyzeVideo`'s constructor demands **18** collaborators. These have interfaces but **no implementation** (E5):

| Port | Needed for | Present? |
|---|---|---|
| `INoteRenderer` | writing `.md` / `.json` / `.html` | ❌ |
| `IResourcePool<T>` (×3) | ffmpeg / whisper / tesseract pooling | ❌ |
| `ICheckpointStore` | resume | ❌ |
| `IMetricsCollector` | Prometheus counters | ❌ |
| `ILogger` | structured logging | ❌ |
| `IConfigurationProvider` | presets + env + file merge | ❌ |
| `ISecretProvider` | API keys without leaking into config | ❌ |
| (implied) `GroundedSummarizer` | citations + hallucination check | ❌ |

This is why every entry point (CLI, REST, plugin) invented a `{ execute: async () => ... }` placeholder — the composition root is impossible as designed.

**Fix (minimum viable set):** implement five files before touching the plugin:

```
src/infrastructure/rendering/MarkdownNoteRenderer.ts   -> INoteRenderer
src/infrastructure/config/YamlConfigProvider.ts         -> IConfigurationProvider
src/infrastructure/config/EnvSecretProvider.ts          -> ISecretProvider
src/infrastructure/observability/ConsoleLogger.ts       -> ILogger
src/infrastructure/observability/NoopMetrics.ts         -> IMetricsCollector
src/infrastructure/persistence/JsonCheckpointStore.ts   -> ICheckpointStore
src/infrastructure/pool/ProcessPool.ts                  -> IResourcePool<T>
```

`ConsoleLogger` (exact, drop-in):

```ts
import type { ILogger } from '../../application/ports/Interfaces';

export class ConsoleLogger implements ILogger {
  constructor(private readonly level: 'debug' | 'info' | 'warn' | 'error' = 'info') {}
  private out(l: string, msg: string, meta?: Record<string, unknown>) {
    const line = JSON.stringify({ ts: new Date().toISOString(), level: l, msg, ...meta });
    (l === 'error' ? console.error : console.log)(line);
  }
  debug(msg: string, meta?: Record<string, unknown>) { if (this.level === 'debug') this.out('debug', msg, meta); }
  info(msg: string, meta?: Record<string, unknown>)  { this.out('info', msg, meta); }
  warn(msg: string, meta?: Record<string, unknown>)  { this.out('warn', msg, meta); }
  error(msg: string, meta?: Record<string, unknown>) { this.out('error', msg, meta); }
  child(_bindings: Record<string, unknown>): ILogger { return this; }
}
```

> Confirm the exact `ILogger` member list in `Interfaces.ts:403` before compiling; implement every member that is not optional.

`NoopMetrics` should be a real class with a `startTimer()` returning a function; returning `undefined` will break callers.

**Verify:**
```powershell
Select-String -Path src/application/ports/Interfaces.ts -Pattern '^export interface I' |
  ForEach-Object { ($_.Line -split '\s+')[2] }
```
Every name must have at least one `implements` in `src/infrastructure`. Script it and fail CI.

---

#### ARC-04 — No composition root · **P0**

Three entry points each hand-roll a fake analyzer (`cli/index.ts:406`, `rest-api/index.ts:377`, `harness-plugin/index.ts:197`). None constructs a real `AnalyzeVideo`. Even after ARC-03, wiring 18 dependencies three times will drift.

**Fix:** one factory, one place.

```ts
// src/infrastructure/composition/createServices.ts
import { AnalyzeVideo } from '../../application/use-cases/AnalyzeVideo';
import { BatchProcess } from '../../application/use-cases/BatchProcess';
// ... import adapters

export interface Services {
  analyzeVideo: AnalyzeVideo;
  batchProcess: BatchProcess;
  dispose(): Promise<void>;
}

export function createServices(config: ProcessingConfig, secrets: ISecretProvider): Services {
  const logger = new ConsoleLogger();
  const metrics = new NoopMetrics();
  const checkpoint = new JsonCheckpointStore(config.output.checkpointDir ?? './.vtn/checkpoints');
  const renderer = new MarkdownNoteRenderer();
  const llm = createLlmProvider(config.llm, secrets);   // switch lives here, once
  const ffmpegPool = new ProcessPool(() => ({ path: config.ffmpegPath }), config.batch.maxConcurrent);
  // ... etc

  const analyzeVideo = new AnalyzeVideo(
    new FfmpegVideoMetadataExtractor(config.ffmpegPath),
    new FfmpegFrameExtractor(config.ffmpegPath),
    new TesseractOCRProcessor(config.ocr, metrics, logger),
    new FfmpegAudioExtractor(config.ffmpegPath),
    new WhisperTranscriptionEngine(config.transcription, metrics, logger),
    new PySceneDetectSceneAnalyzer(config.sceneDetectPath),
    new TimestampAligner(),
    new ContentAggregator(),
    renderer, llm, configProvider, secrets,
    ffmpegPool, whisperPool, tesseractPool,
    checkpoint, metrics, logger,
  );
  return { analyzeVideo, batchProcess: new BatchProcess(analyzeVideo, checkpoint, logger), dispose: async () => { /* close pools */ } };
}
```

Every entry point then does `const svc = createServices(...)` and nothing else.

**Verify:** `Select-String -Path src/interfaces -Recurse -Pattern 'Placeholder for actual analyzer'` → no output.

---

### 3.3 Security (persona: Security Reviewer)

#### SEC-01 — `new AbortSignal()` throws at runtime · **P0**

**Evidence.** `harness-plugin/index.ts:232` and `cli/index.ts:createPipelineContext`.

```ts
signal: new AbortSignal()   // TypeError: Illegal constructor
```

`AbortSignal` has no public constructor. Every CLI invocation and every plugin `onLoad` path dies here before any work starts.

**Fix:**

```ts
const controller = new AbortController();
// store controller so it can be aborted on SIGINT
signal: controller.signal
```

In the CLI, wire it properly:

```ts
const controller = new AbortController();
process.once('SIGINT', () => controller.abort());
```

**Verify:** `node -e "new AbortSignal()"` → throws; `node -e "new AbortController().signal"` → ok.

---

#### SEC-02 — REST API is unauthenticated and half-implemented · **P1**

`src/interfaces/rest-api/index.ts`:

- `:352` calls `request.file()`, which requires `@fastify/multipart` to be registered. It is not a dependency and not registered → `TypeError` on every upload.
- No auth hook, no origin restriction, no body size limit beyond Fastify defaults (1 MB — too small for video, and no streaming strategy).
- `:377` `processVideoAsync` is fire-and-forget: an exception becomes an unhandled rejection and kills the process on modern Node.
- `saveTempFile` writes to disk with no quota and no cleanup.

**Fix:** if the REST API is not a deliverable, delete it (`src/interfaces/rest-api/**`) and remove `fastify`, `@fastify/cors`, `@fastify/rate-limit` from dependencies. If it is, minimum changes:

```ts
import multipart from '@fastify/multipart';
await app.register(multipart, { limits: { fileSize: 2 * 1024 * 1024 * 1024, files: 1 } });
app.addHook('onRequest', async (req, reply) => {
  if (req.headers.authorization !== `Bearer ${expectedToken}`) {
    return reply.code(401).send({ error: 'unauthorized' });
  }
});
```

and wrap the background job:

```ts
this.processVideoAsync(jobId, tempPath, config).catch((err) => {
  this.logger.error('job failed', { jobId, err });
  this.jobs.set(jobId, { status: 'failed' });
});
```

**Verify:** `curl -X POST http://127.0.0.1:3000/api/videos -F file=@x.mp4` → `401`, not a stack trace.

---

#### SEC-03 — SSRF is claimed, not implemented · **P1**

`README.md:42` claims "SSRF protection". `LocalLLMProviders.ts` and `CloudLLMProviders.ts` call `fetch(this._config.baseUrl + ...)` with a user-supplied `baseUrl` and no allowlist, no scheme check, no redirect policy.

**Fix:** central guard used by all providers:

```ts
// src/infrastructure/net/assertAllowedEndpoint.ts
export function assertAllowedEndpoint(raw: string, allowlist: string[] = ['localhost', '127.0.0.1', '::1']): URL {
  const url = new URL(raw);                       // throws on garbage
  if (url.protocol !== 'http:' && url.protocol !== 'https:') throw new Error(`unsupported protocol: ${url.protocol}`);
  if (url.username || url.password) throw new Error('credentials in URL are not allowed');
  const host = url.hostname.replace(/^\[|\]$/g, '');
  const isIp = /^[\d.]+$|^[0-9a-f:]+$/i.test(host);
  if (isIp && isPrivateIp(host) && !allowlist.includes(host)) throw new Error(`blocked private address: ${host}`);
  return url;
}
```

`isPrivateIp` must cover `10/8`, `172.16/12`, `192.168/16`, `169.254/16`, `127/8`, `::1`, `fc00::/7`, and IPv4-mapped IPv6. Call it at provider construction, not per request.

**Verify:** add `tests/unit/net/assertAllowedEndpoint.test.ts` asserting `169.254.169.254` and `http://user:pw@x` both throw.

---

#### SEC-04 — Path traversal through model/config names · **P2**

`WhisperTranscriptionEngine.ts:63` and `TesseractOCRProcessor` join config-controlled strings into filesystem paths:

```ts
const modelPath = join(this._modelDir, `${config.model}.bin`);
```

`config.model = '../../../../etc/passwd'` escapes `_modelDir`. Same risk for `tessdataDir` and `vocabularyBoost`.

**Fix:**

```ts
function safeJoin(base: string, name: string): string {
  if (!/^[A-Za-z0-9._-]+$/.test(name)) throw new Error(`invalid name: ${name}`);
  const p = resolve(base, name);
  if (!p.startsWith(resolve(base) + sep)) throw new Error('path escapes base directory');
  return p;
}
```

**Verify:** unit test with `'../x'` and `'..\\x'`.

---

#### SEC-05 — Secrets can leak into persisted notes · **P2**

`LLMConfig.customEndpoint.apiKey` is a plain string. `NoteFrontmatter.processingConfigSummary` (domain) is designed to embed configuration; if it stringifies the whole config, the key lands in the `.md` file.

**Fix:** never serialize `LLMConfig` directly. Use an explicit allowlist:

```ts
const summary = {
  provider: cfg.llm.provider,
  model: cfg.llm.model,
  temperature: cfg.llm.temperature,
  // apiKey intentionally omitted
};
```

and add a redaction test asserting the output never contains the key.

---

#### SEC-06 — `spawn` usage is correct; keep it that way · **P2 (positive)**

All five adapters use `spawn(bin, argsArray)` (no `shell: true`), which prevents shell injection. Two gaps:

- `TesseractOCRProcessor.ts:143` hard-codes `spawn('tesseract', …)` instead of a configurable path.
- `WhisperTranscriptionEngine.ts:82` passes `timeout: 300000` in `spawn` options — valid for `spawn`, but the child keeps running on Windows unless killed; use `AbortController` + `proc.kill()`.

**Fix:** add `killSignal`/abort handling and assert in a lint rule that `shell: true` never appears under `src/infrastructure`.

---

### 3.4 Logic & Correctness (persona: Architecture + QA)

#### LOG-01 — `.join` on a `string` crashes transcription · **P0**

`WhisperTranscriptionEngine.ts:78`:

```ts
args.push('--prompt', config.vocabularyBoost.join(' '));
```

`TranscriptionConfig.vocabularyBoost?: string` (`Interfaces.ts:96`), not `string[]`. Runtime `TypeError` whenever a vocabulary boost is configured.

**Fix:** decide the type and make both sides agree. Recommended: keep `string` (whisper takes a prompt string) and

```ts
if (config.vocabularyBoost) args.push('--prompt', config.vocabularyBoost);
```

**Verify:** unit test that constructs a config with `vocabularyBoost: 'kubernetes, OAuth'` and asserts no throw.

---

#### LOG-02 — Duplicate method implementations · **P0**

`WhisperTranscriptionEngine.ts`: `transcribeWithEscalation` is defined at ~:45 (inline in `transcribe`) and again at **:156**; `getSupportedModels` twice (**:150** and **:169**). TS2393.

The duplication is not cosmetic: the first copy escalates by recursively calling `this.transcribe`, which re-enters the escalation block — a config with `enableEscalation: true` and a persistently low confidence recurses until stack exhaustion (or infinite model escalation if the chain lookup ever returns a new model).

**Fix:** delete the second definitions; extract escalation into one guarded method:

```ts
private async runWithEscalation(audio: AudioFile, config: TranscriptionConfig, depth = 0): Promise<TranscriptionResult> {
  const result = await this.runTranscription(audio.path, config);
  const next = this.getNextLargerModel(config.model);
  if (!config.enableEscalation || depth >= (config.maxEscalations ?? 1) || result.averageConfidence >= config.escalationThreshold || next === config.model) {
    return result;
  }
  this._logger.info('escalating', { from: config.model, to: next, confidence: result.averageConfidence });
  return this.runWithEscalation(audio, { ...config, model: next }, depth + 1);
}
```

**Verify:** test with a stub `runTranscription` that always returns confidence 0 and `maxEscalations: 2`; assert exactly 3 calls.

---

#### LOG-03 — OCR calls a method that does not exist · **P0**

`TesseractOCRProcessor.ts:83`:

```ts
const inputPath = frame.imagePath || await this.saveBufferToTemp(frame.imageData!);
```

`saveBufferToTemp` is never defined. Any frame without an `imagePath` throws.

Also `:105` `return config.psm;` where `psm` is a `string` — the method is typed `Promise<number>`; and `:177` imports a value object without `.js`.

**Fix:**

```ts
private async saveBufferToTemp(buf: Buffer): Promise<string> {
  const p = join(tmpdir(), `vtn_frame_${randomUUID()}.png`);
  await writeFile(p, buf);
  this._tempFiles.push(p);              // cleaned in dispose()
  return p;
}

private async selectPSM(frame: Frame, config: OCRConfig): Promise<number> {
  if (config.psm !== 'auto') return Number(config.psm);
  return 6;
}
```

Add `dispose()` that unlinks `_tempFiles`. Verify with a test that passes a `Frame` with `imageData` set and `imagePath` undefined.

---

#### LOG-04 — Doctor always reports success · **P0 (trust)**

`cli/index.ts`:

```ts
private async checkFFmpeg(): Promise<any> { return { ok: true, name: 'FFmpeg', message: 'Found', fix: 'brew install ffmpeg' }; }
private async checkTesseract(): Promise<any> { return { ok: true, ... }; }
private async checkWhisper(): Promise<any> { return { ok: true, ... }; }
private async checkPySceneDetect(): Promise<any> { return { ok: true, ... }; }
```

Four hard-coded `true`. The command whose entire purpose is to detect missing dependencies cannot detect a missing dependency.

**Fix:** actually probe.

```ts
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
const run = promisify(execFile);

async function probe(bin: string, args: string[], fix: string) {
  try {
    const { stdout } = await run(bin, args, { timeout: 10_000 });
    return { ok: true, name: bin, message: stdout.split('\n')[0].trim(), fix };
  } catch (e) {
    return { ok: false, name: bin, message: (e as Error).message, fix };
  }
}

// ffmpeg  -> probe('ffmpeg', ['-version'], 'brew install ffmpeg')
// tesseract -> probe('tesseract', ['--version'], 'brew install tesseract')
// whisper-cli -> probe('whisper-cli', ['--help'], 'build https://github.com/ggerganov/whisper.cpp')
// scenedetect -> probe('scenedetect', ['--version'], 'pip install scenedetect[opencv]')
```

Exit non-zero when any check fails, and print the `fix` line. `doctor` becomes a real acceptance test.

**Verify:** rename `ffmpeg` on PATH (or pass `--ffmpeg-path /nonexistent`) and confirm `doctor` exits `1` with the fix hint.

---

#### LOG-05 — Local providers never time out · **P1**

`LocalLLMProviders.ts:274,559` pass `timeout` to `fetch`, which ignores unknown keys. A hung Ollama endpoint blocks the pipeline forever.

**Fix:** `signal: AbortSignal.timeout(ms)` (see BLD-01 Step 5) **and** wrap the body read, because the signal does not cover a slow stream after headers:

```ts
const res = await fetch(url, { signal: AbortSignal.timeout(connectMs) });
const body = await res.text();   // guard with a second timeout if streaming
```

---

#### LOG-06 — Deduplication is a placeholder that always returns "unique" · **P1**

`DeduplicationService.ts:48-69`:

```ts
// Simplified implementation - in production use a proper pHash library
// This is a placeholder that uses timestamp + image data
// Use SHA-256 in production
```

Consequence: every near-duplicate slide is OCR'd and transcribed again. On a one-hour lecture this is the difference between ~5 minutes and ~40 minutes, and it inflates the note with repeated text.

**Fix:** implement a real 64-bit dHash, no dependency needed:

```ts
export function dHash(gray: Uint8Array, w: number, h: number): bigint {
  // resize to 9x8 upstream with sharp
  let bits = 0n;
  for (let y = 0; y < 8; y++) {
    for (let x = 0; x < 8; x++) {
      const left = gray[y * w + x]!, right = gray[y * w + x + 1]!;
      bits = (bits << 1n) | (left > right ? 1n : 0n);
    }
  }
  return bits;
}
export const hamming = (a: bigint, b: bigint): number => {
  let v = a ^ b, c = 0;
  while (v) { v &= v - 1n; c++; }
  return c;
};
// duplicate when hamming(a, b) <= threshold (default 5)
```

Use `sharp().resize(9, 8).grayscale().raw().toBuffer()` to produce `gray`.

**Verify:** `tests/unit/domain/dHash.test.ts` — identical images → distance 0; a shifted slide → > threshold.

---

#### LOG-07 — The pipeline never calls its adapters · **P0**

`AnalyzeVideo.ts`:

```
:250  // This is a placeholder - actual implementation uses metadataExtractor
:318  // Placeholder - actual implementation would process frames through OCR
:328  // Placeholder - actual implementation uses transcriptionEngine
:346  // Placeholder - actual implementation uses GroundedSummarizer
```

The use case constructs 18 adapters and then does not call four of the most important ones. Any successful run today returns a note assembled from whatever the stubs produce.

**Fix:** replace each comment with the call, respecting the ports:

```ts
// :250
const metadata = await this._metadataExtractor.extract(videoPath, context.signal);

// :318
const ocrResults = await Promise.all(frames.map((f) => this._ocrProcessor.process(f, config.ocr)));

// :328
const transcript = await this._transcriptionEngine.transcribe(audio, config.transcription);

// :346
const summary = await this._llmProvider.summarize({ sections, transcript, ocrResults }, config.llm);
```

Then delete the unused private fields if any remain — a field that is stored but never read is a lie about capability.

**Verify:** an integration test with a 3-second fixture video (`tests/fixtures/sample-3s.mp4`) asserting the returned `Note` has ≥1 section and ≥1 citation; mark it `skip` unless `VTN_E2E=1`.

---

#### LOG-08 — `BatchProcess` does not glob, checkpoint, or report · **P1**

`BatchProcess.ts:260` ("actual implementation would use fast-glob"), `:276` ("Placeholder - save to checkpoint store"), `:280` ("Placeholder - report progress").

**Fix:**

```ts
import fg from 'fast-glob';
const files = await fg(inputPaths.map((p) => p.replace(/\\/g, '/')), {
  onlyFiles: true,
  absolute: true,
  deep: 4,
  ignore: ['**/node_modules/**'],
});
```

Checkpoint after each video:

```ts
await this._checkpointStore.save(batchCheckpointKey, {
  completed: [...completedVideos],
  failed: [...failedVideos],
  updatedAt: new Date().toISOString(),
});
```

Progress: call `input.progressCallback?.(update)` in `reportBatchProgress` — it is currently accepted and dropped.

**Verify:** batch two files, kill the process, rerun with `resume: true`, assert the completed file is skipped.

---

#### LOG-09 — `BatchProcess` shares mutable arrays across workers · **P2**

`runWorker` pushes into shared `results`, `completedVideos`, `failedVideos`. JS is single-threaded so this is safe *today*, but the summary is computed by counting the arrays while workers are still running (`:112` initial report reads them before any work). It produces a misleading ETA of `0 videos/hour`.

**Fix:** return per-worker results and aggregate after `Promise.all`, or compute progress from an atomic counter object. Do not read the arrays to derive ETA before the first completion.

---

#### LOG-10 — `HarnessLLMProvider` streams into a non-streaming type · **P2**

`:90` wraps a raw chunk with `any` fields. With `exactOptionalPropertyTypes` this is exactly the bug BLD-01 Step 3 describes. Additionally, the provider does not handle `[DONE]`, partial JSON across chunk boundaries, or non-200 responses with a useful error.

**Fix:** buffer by line, parse `data:` frames, and skip `[DONE]`:

```ts
for (const line of buffer.split('\n')) {
  if (!line.startsWith('data:')) continue;
  const payload = line.slice(5).trim();
  if (payload === '[DONE]') return;
  const json = JSON.parse(payload);
  yield { delta: json.choices?.[0]?.delta?.content ?? '' };
}
```

---

### 3.5 User Experience (persona: UX/DX Reviewer)

#### UX-01 — Terminal output is mojibake · **P2**

`cli/index.ts` progress bar:

```ts
const bar = '�-^'.repeat(filled) + '�-`'.repeat(barLength - filled);
```

The source file was saved through a lossy encoding conversion; the intended characters were `█` and `░`. It prints replacement glyphs on every run.

**Fix:** use ASCII, which is safe on every Windows code page:

```ts
const bar = '#'.repeat(filled) + '-'.repeat(barLength - filled);
```

and add `.editorconfig` + `.gitattributes` (`* text=auto eol=lf`) to stop the recurrence. Sweep the repo:

```powershell
Get-ChildItem src -Recurse -Filter *.ts | Select-String "�" | ForEach-Object { "$($_.Path):$($_.LineNumber)" }
```

---

#### UX-02 — Documented commands do not exist · **P1**

`README.md` documents `vtn analyze`, `vtn batch`, `vtn init`, `vtn doctor`. Only `analyze` and `batch` are registered in `cli/index.ts`; `init` is absent; `doctor` points at a missing file; and there is no `bin`, so none of them run after `npm i -g`.

**Fix:** either implement `init` (an interactive writer for `~/.vtn/config.yaml`) or remove it from the README. Do not document a command you have not executed. Add a doc test:

```ts
// tests/docs/readme-commands.test.ts
it('every documented vtn subcommand is registered', () => {
  const readme = readFileSync('README.md', 'utf8');
  const documented = [...readme.matchAll(/```bash\n([\s\S]*?)```/g)]
    .flatMap((m) => [...m[1]!.matchAll(/^vtn (\w+)/gm)].map((x) => x[1]!));
  const registered = program.commands.map((c) => c.name());
  for (const cmd of documented) expect(registered).toContain(cmd);
});
```

---

#### UX-03 — Error surface is a stack trace · **P2**

Every `catch` either rethrows raw or logs to `console`. A missing ffmpeg produces `Error: spawn ffmpeg ENOENT` with no guidance, even though `doctor` knows the fix string.

**Fix:** one error type carrying remediation:

```ts
export class VtnError extends Error {
  constructor(message: string, readonly code: string, readonly fix?: string, readonly cause?: unknown) { super(message); this.name = 'VtnError'; }
}
```

CLI top level:

```ts
try { await program.parseAsync(); }
catch (e) {
  const err = e instanceof VtnError ? e : new VtnError((e as Error).message, 'UNEXPECTED');
  process.stderr.write(`\n  ${err.message}\n`);
  if (err.fix) process.stderr.write(`  Fix: ${err.fix}\n`);
  process.exitCode = 1;
}
```

---

#### UX-04 — No machine-readable output · **P3**

There is no `--json` flag, so CI cannot consume results and agents cannot assert on them.

**Fix:** add `--json` to `analyze` and `doctor`; when set, suppress the progress bar and print one JSON object to stdout.

---

### 3.6 Performance (persona: Performance Engineer)

#### PERF-01 — Every frame becomes a PNG, then a process spawn · **P1**

`FfmpegFrameExtractor` writes one PNG per frame; `TesseractOCRProcessor` spawns `tesseract` per frame (~80–150 ms startup each on Windows). For a 30-minute lecture at 1 frame/5 s = 360 frames ≈ 45 s of pure process startup, plus OCR.

**Fix, in order of payoff:**

1. Batch OCR: pass a list file to tesseract (`--batch`) or a `.lstm`-friendly wrapper, amortising startup.
2. Reuse the three constructed `IResourcePool`s (ARC-03) instead of spawning ad hoc — that is what they are for.
3. Run OCR and transcription concurrently; they share no data until aggregation.
4. Only extract frames at scene boundaries plus one per static interval (the plan already says this; the code does not).

**Verify:** instrument with `metrics.recordHistogram('ocr_duration_ms', …)` and compare before/after on the fixture video.

---

#### PERF-02 — Whisper thread count is hard-coded · **P2**

`WhisperTranscriptionEngine.ts:76`: `'--threads', '4'`. On a 4-core laptop this starves the rest of the pipeline; on a 32-core workstation it wastes 28 cores.

**Fix:**

```ts
'--threads', String(Math.max(1, Math.min(8, os.availableParallelism() - 1)))
```

Make it configurable via `TranscriptionConfig.threads`.

---

#### PERF-03 — Memory: whole transcript and all OCR text held in RAM · **P2**

`ContentAggregator` builds sections from full arrays. A 3-hour video with word-level timestamps can exceed 1 GB. There is no streaming or chunking, despite `LLMConfig.contextManagement.strategy` existing.

**Fix:** stream sections into the LLM one at a time (map-reduce) and release each section after summarising; keep only `{ startMs, endMs, summary, citations }`.

---

#### PERF-04 — Temp files accumulate · **P2**

Whisper JSON, OCR preprocessed PNGs, and audio WAVs are written to `tmpdir()` and never deleted (`TesseractOCRProcessor.ts:85`, `WhisperTranscriptionEngine.ts:60`). A batch of 100 videos leaves thousands of files.

**Fix:** every adapter implements `dispose()`, and `createServices().dispose()` calls them; or wrap each unit of work in a `try/finally` that unlinks its temp paths.

---

### 3.7 Quality Assurance (persona: QA Lead)

#### QA-01 — The test suite runs zero tests · **P0**

**Evidence (E2).** All five files fail with:

```
Failed to load url ../../../../src/domain/value-objects/Confidence
```

The tests live at `tests/unit/domain/*.test.ts`; `../../../../src` resolves **above** the repo root. One extra `../`.

**Fix:** replace `../../../../src/` with `../../../src/` in every test file.

```powershell
Get-ChildItem tests -Recurse -Filter *.test.ts |
  ForEach-Object {
    (Get-Content $_.FullName -Raw) -replace '\.\./\.\./\.\./\.\./src/', '../../../src/' |
      Set-Content $_.FullName -NoNewline
  }
```

**Verify:** `npx vitest run` → `Test Files 5 passed`, `Tests >0`.

---

#### QA-02 — Coverage excludes exactly the untested code · **P1**

`vitest.config.ts` excludes `src/interfaces/**` and enforces 80% thresholds on the rest. The result is a number that looks healthy while the entry points — the only code a user touches — are unmeasured. Combined with QA-01, the badge is meaningless.

**Fix:** after QA-01, remove the `src/interfaces/cli/**` exclusion, keep `rest-api` only if the API survives, and set a ratchet: current coverage + 5%, never lower. Do not set an aspiration you have never met.

---

#### QA-03 — No integration or E2E tests, no fixtures · **P1**

`tests/unit` covers `Timestamp`, `Confidence`, `BoundingBox`, `TimestampAligner`, `ContentAggregator`. Nothing covers the pipeline, the adapters, the CLI, or the plugin. `vitest.config.ts` excludes `tests/integration/**` — a directory that does not exist.

**Fix:** add, with synthetic fixtures generated at test time (no binary committed):

```ts
// tests/integration/pipeline.test.ts
// ffmpeg -f lavfi -i color=c=white:s=640x360:d=3 -vf "drawtext=text='HELLO'" out.mp4
```

Skip unless `VTN_E2E=1`; assert `note.sections.length > 0` and `note.citations.length > 0`.

---

#### QA-04 — No CI · **P1**

`.github/` does not exist. The README shows a CI badge pointing at `your-org`. Nothing has ever gated a merge.

**Fix:** add `.github/workflows/ci.yml`:

```yaml
name: CI
on: [push, pull_request]
jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: 20, cache: npm }
      - run: npm ci
      - run: npx tsc --noEmit
      - run: npm run lint
      - run: npm test -- --coverage
      - run: node dist/cli.js doctor || true   # informational until LOG-04 lands
```

Then pin the actions by SHA (AAS supply-chain rule) rather than tag.

---

### 3.8 DeepSeek Harness Integration (persona: DSH Integration Engineer)

#### DSH-01 — The adapter implements an API that does not exist · **P0**

Fully covered in §2.2. Restating the consequence: `src/interfaces/harness-plugin/index.ts` must be **deleted and rewritten**, not patched. There is no salvageable concept in it except the function names.

**Fix:** see §5 for the complete replacement.

---

#### DSH-02 — No bundle metadata · **P0**

Missing: `"type": "module"`, `"dsh": { "bundle": { "patch": "./cordis.patch.yml" } }`, `cordis.patch.yml`, peer deps. Without these, `dsh plugin add video-to-notes` installs a package that registers nothing.

**Fix:** §5.2 and §5.3.

---

#### DSH-03 — "Skills" are declared with a literal placeholder · **P1**

```ts
skills: [
  { id: 'video-content-extractor', version: 'pinned-commit-hash' },
  { id: 'audio-transcriber',      version: 'pinned-commit-hash' },
  { id: 'watch-igaming',          version: 'pinned-commit-hash' },
]
```

`'pinned-commit-hash'` is a template string that was never substituted. `watch-igaming` has nothing to do with this codebase. Nothing reads this list.

**Fix:** delete the list. If the plugin should contribute skills, ship them as `SKILL.md` files and register a provider with the `skills` service (`inject: ['skills']`), following `dsh-skill-filesystem`.

---

#### DSH-04 — Web panel is not a DSH UI · **P2**

`render(): JSX.Element` requires `jsx` enabled and a React runtime that DSH does not host in the agent process. DSH web UI is a set of separate client-module packages (`dsh-client-ui-*`). A plugin cannot inject a React component into the panel without publishing a client module.

**Fix:** for v1, drop the panel. Deliver value through tools and text; add UI later as a separate `dsh-plugin-video-to-notes-ui` package built against `dsh-client-modules`.

---

#### DSH-05 — Nothing registers a tool · **P0**

The model cannot call any of this. There is no `defineTool`, no schema, no `ctx.tools.register`.

**Fix:** §5.4.

---

### 3.9 Documentation & Honesty (persona: all)

#### DOC-01 — `REVIEW_SIGN_OFF.md` is not true · **P0**

It states five personas approved with scores ≥95/100, three review rounds, "unanimously approved for implementation". The same repository fails to compile, runs zero tests, and cannot be loaded by the harness it claims to target. A document like this is worse than no document: it causes downstream agents (including this review) to start from a false premise.

**Fix:** replace the file with a status page that cannot rot:

```markdown
# Status

Build: see CI badge.
Last verified: <date> by `<commit>`.
Known gaps: link to the issue list, not prose.

The previous REVIEW_SIGN_OFF.md claimed unanimous committee approval.
It was not reproducible and has been withdrawn.
```

Add a CI job that regenerates the badge from `tsc` + `vitest` exit codes.

#### DOC-02 — `README.md` overstates · **P1**

"production-ready", "SSRF protection", "XSS sanitization", "model digest verification", "native plugin", "CI badge". None are true today. Rewrite the header as:

> **Status: alpha.** Compiles: no. Tests: not yet running. See `STATUS.md`.

Then earn each claim back with a passing check.

#### DOC-03 — `PLAN_REVISED.md` (114 KB) vs 3.5 kLOC · **P2**

The plan is roughly one order of magnitude larger than the implementation. It is excellent design material and should be kept, but it should be labelled `docs/design/` and not presented as delivered scope.

---

## 4. Remediation plan

Sequential; each phase has a hard exit criterion. Do not start a phase until the previous exit criterion is demonstrated.

| Phase | Goal | Exit criterion | Est. |
|---|---|---|---|
| **0** | Honesty reset | `REVIEW_SIGN_OFF.md` replaced; README status line corrected | 1 h |
| **1** | Compile | `npx tsc --noEmit` → 0 errors | 1–2 d |
| **2** | Tests run | `npx vitest run` → 5 files pass, >0 tests | 2 h |
| **3** | Adapters | every `I*` port has ≥1 `implements`; `createServices()` compiles | 3–5 d |
| **4** | Real behaviour | LOG-07 fixed; E2E on a 3 s fixture produces a non-empty note with a citation | 2–3 d |
| **5** | DSH plugin | `dsh plugin add` then a session calls `analyze_video` and returns a note | 2–3 d |
| **6** | Hardening | SEC-02..05 fixed; CI green; SEC-06 lint rule | 2 d |

**Recommended scope cut.** Phases 3–4 as written implement ffmpeg + Tesseract + Whisper + scene detect + embeddings + 7 LLM providers. That is a product, not a plugin. Ship the plugin with:

- **In:** ffmpeg metadata + frame extraction, Whisper transcription, one LLM provider (harness `llm` service), Markdown rendering.
- **Out (v2):** OCR, scene classification, embeddings, batch, REST API, web panel, cloud providers.

This reduces the adapter count from 18 to 9 and makes phase 3 a week of work instead of a month.

---

## 5. Target design: a real DSH plugin

### 5.1 Package layout

```
video-to-notes/
  package.json               # type:module, dsh.bundle.patch, peerDeps
  cordis.patch.yml
  tsconfig.json
  src/
    domain/                  # unchanged (pure)
    application/             # ports + use cases
    infrastructure/          # adapters + composition/createServices.ts
    plugin/
      index.ts               # name / inject / Config / apply  <-- the plugin
      tools/
        analyzeVideo.ts      # defineTool(...)
        getNote.ts
      config.ts
```

### 5.2 `package.json` (complete, copy-paste)

```json
{
  "name": "video-to-notes",
  "version": "0.1.0",
  "type": "module",
  "description": "DeepSeek Harness plugin: turn a video into structured Markdown notes.",
  "main": "dist/plugin/index.js",
  "types": "dist/plugin/index.d.ts",
  "exports": {
    ".": { "types": "./dist/plugin/index.d.ts", "default": "./dist/plugin/index.js" },
    "./cordis.patch.yml": "./cordis.patch.yml",
    "./package.json": "./package.json"
  },
  "files": ["dist", "cordis.patch.yml"],
  "bin": { "vtn": "dist/cli.js" },
  "dsh": { "bundle": { "patch": "./cordis.patch.yml" } },
  "scripts": {
    "build": "tsc -p tsconfig.build.json",
    "test": "vitest run",
    "lint": "eslint src --ext .ts",
    "check": "npm run lint && npm run build && npm run test"
  },
  "peerDependencies": {
    "@deepseek-ai/cordis": "~4.1.0",
    "@deepseek-ai/dsh-tools": "0.2.2-rc.1",
    "@deepseek-ai/schemastery": "~3.19.0"
  },
  "devDependencies": {
    "@deepseek-ai/cordis": "~4.1.0",
    "@deepseek-ai/dsh-tools": "0.2.2-rc.1",
    "@deepseek-ai/schemastery": "~3.19.0",
    "@types/node": "^20.19.43",
    "typescript": "^5.3.3",
    "vitest": "^1.6.1"
  },
  "engines": { "node": ">=20.0.0" }
}
```

> `dsh` resolves peer packages from the profile's `node_modules`. If `npm i` cannot find `0.2.2-rc.1` on the public registry, install the harness first (`npx @deepseek-ai/dsh --version`) and point npm at the npx cache, or vendor the three packages as `file:` deps while developing.

### 5.3 `cordis.patch.yml`

```yaml
# Registers this plugin in a dsh profile. Applied as a bundle layer.
- insert:
    - id: video-to-notes
      name: 'video-to-notes'
      config:
        ffmpegPath: ffmpeg
        whisperPath: whisper-cli
        outputDir: ./notes
        maxConcurrent: 2
```

### 5.4 `src/plugin/index.ts` (complete)

```ts
import type { Context } from '@deepseek-ai/cordis';
import z from '@deepseek-ai/schemastery';
import { registerAnalyzeVideoTool } from './tools/analyzeVideo.js';
import { registerGetNoteTool } from './tools/getNote.js';
import { createServices, type Services } from '../infrastructure/composition/createServices.js';

export const name = 'video-to-notes';

/** `tools` is the only hard dependency. `llm` is optional: the plugin can run
 *  with an external provider configured instead of the harness model. */
export const inject = ['tools'];

export interface Config {
  ffmpegPath: string;
  whisperPath: string;
  outputDir: string;
  maxConcurrent: number;
}

export const Config: z<Config> = z.object({
  ffmpegPath: z.string().default('ffmpeg'),
  whisperPath: z.string().default('whisper-cli'),
  outputDir: z.string().default('./notes'),
  maxConcurrent: z.natural().min(1).max(16).default(2),
});

export async function apply(ctx: Context, config: Config): Promise<void> {
  // Lazily built so that merely loading the profile does not spawn ffmpeg.
  let services: Services | undefined;
  const getServices = (): Services => (services ??= createServices(config, ctx));

  const disposers = [
    registerAnalyzeVideoTool(ctx, getServices),
    registerGetNoteTool(ctx, getServices),
  ];

  // Teardown is owned by the plugin, not by a console.log.
  ctx.effect(() => () => {
    for (const dispose of disposers) dispose();
    void services?.dispose();
    services = undefined;
  });
}
```

> `ctx.effect` is the Cordis idiom for scoped cleanup; if the installed cordis version exposes `ctx.on('dispose', …)` instead, use that — verify against `@deepseek-ai/cordis` types before shipping.

### 5.5 `src/plugin/tools/analyzeVideo.ts` (complete)

```ts
import type { Context } from '@deepseek-ai/cordis';
import { defineTool } from '@deepseek-ai/dsh-tools';
import { z } from 'zod';
import type { Services } from '../../infrastructure/composition/createServices.js';

/**
 * Analysis can take minutes. The tool therefore returns a job id immediately
 * and a status tool reports progress; a synchronous tool would risk the
 * harness's per-call timeout and pin the model loop.
 */
export function registerAnalyzeVideoTool(ctx: Context, getServices: () => Services): () => void {
  return ctx.tools.register(
    defineTool({
      name: 'analyze_video',
      description:
        'Convert a local video file into structured Markdown notes with timestamps and citations. ' +
        'Returns a job id; poll video_note_status for progress and the output path.',
      parameters: {
        videoPath: {
          type: 'string',
          required: true,
          description: 'Absolute path to the video file.',
        },
        preset: {
          type: 'string',
          enum: ['lecture', 'tutorial', 'meeting', 'documentary'],
          description: 'Tuning preset. Defaults to lecture.',
        },
      },
      output: {
        schema: {
          type: 'object',
          additionalProperties: false,
          required: ['jobId', 'status'],
          properties: {
            jobId: { type: 'string', required: true },
            status: { type: 'string', required: true, enum: ['accepted'] },
          },
        },
        render: (_args, value) => [{ type: 'text', text: `Started job ${value.jobId}. Poll video_note_status for progress.` }],
      },
      async execute(args) {
        const svc = getServices();
        const jobId = await svc.jobs.start({
          videoPath: args.videoPath,
          preset: args.preset ?? 'lecture',
        });
        return { jobId, status: 'accepted' as const };
      },
    }),
  );
}
```

Validation helper (used by every tool so a bad `videoPath` fails with a message, not a stack):

```ts
import { stat } from 'node:fs/promises';
import { isAbsolute } from 'node:path';

export async function assertReadableVideo(p: string): Promise<void> {
  if (!isAbsolute(p)) throw new Error(`videoPath must be absolute: ${p}`);
  const s = await stat(p).catch(() => undefined);
  if (!s?.isFile()) throw new Error(`videoPath is not a file: ${p}`);
}
```

### 5.6 `src/plugin/tools/getNote.ts` (complete)

```ts
import type { Context } from '@deepseek-ai/cordis';
import { defineTool } from '@deepseek-ai/dsh-tools';
import type { Services } from '../../infrastructure/composition/createServices.js';

export function registerGetNoteTool(ctx: Context, getServices: () => Services): () => void {
  return ctx.tools.register(
    defineTool({
      name: 'video_note_status',
      description: 'Report progress for an analyze_video job and, when finished, return the note path and its Markdown.',
      parameters: {
        jobId: { type: 'string', required: true, description: 'Job id returned by analyze_video.' },
      },
      output: {
        schema: {
          type: 'object',
          additionalProperties: false,
          required: ['jobId', 'status'],
          properties: {
            jobId: { type: 'string', required: true },
            status: { type: 'string', required: true, enum: ['queued', 'running', 'failed', 'completed'] },
            percent: { type: 'integer' },
            notePath: { type: 'string' },
          },
        },
        render: (_args, v) =>
          v.status === 'completed'
            ? [{ type: 'text', text: `Note written to ${v.notePath}` }]
            : [{ type: 'text', text: `${v.jobId}: ${v.status}${v.percent != null ? ` (${v.percent}%)` : ''}` }],
      },
      async execute(args) {
        const job = await getServices().jobs.get(args.jobId);
        if (!job) throw new Error(`unknown job: ${args.jobId}`);
        return job;
      },
    }),
  );
}
```

### 5.7 Install and verify

```powershell
npm run build
dsh plugin --profile web add C:\src\ai_workspace\video-to-notes
dsh web
# in a new session:
#   > analyze_video  C:\media\lecture.mp4
#   > video_note_status  <jobId>
```

Acceptance: the tool appears in the model's tool list, a bad path yields a readable error, and a valid path produces a `.md` file whose first section contains a timestamp.

If the tool does not appear, check in this order: `"type":"module"` present → `exports["."].default` points at a file that exists in `dist` → `cordis.patch.yml` row `name` equals the package `name` → the package exposes `name`/`apply` (log `Object.keys(await import('video-to-notes'))`).

---

## 6. Definition of done

A single script, runnable in CI, that returns 0 only when every claim in this review is satisfied:

```powershell
# scripts/verify.ps1
$ErrorActionPreference = 'Stop'
npx tsc --noEmit                                  # 0 errors
npx vitest run --coverage                         # >0 tests, thresholds met
Select-String -Path src -Recurse -Pattern 'Placeholder|In production use' -Quiet -ErrorAction SilentlyContinue
if ($?) { throw 'stub markers remain' }
$ports = (Select-String -Path src/application/ports/Interfaces.ts -Pattern '^export interface I(\w+)').Matches
foreach ($p in $ports) {
  $impl = Select-String -Path src/infrastructure -Recurse -Pattern "implements I$($p.Groups[1].Value)" -Quiet
  if (-not $impl) { throw "port without adapter: I$($p.Groups[1].Value)" }
}
node dist/cli.js doctor                           # exit 0 on a provisioned machine
node -e "import('./dist/plugin/index.js').then(m=>{if(!m.name||!m.apply)process.exit(1)})"
```

---

## 7. What is genuinely good

Worth preserving while the above is fixed:

- **Domain model.** `Timestamp`, `Confidence`, `BoundingBox`, `OCRResult`, `Transcript`, `Note` are small, immutable, validated, and independently testable. This is the strongest part of the codebase.
- **Port definitions.** `Interfaces.ts`, once de-duplicated, is a clear contract set with sensible naming and no infrastructure leakage.
- **`spawn(bin, args[])` discipline.** No `shell: true` anywhere — the injection class is absent by construction.
- **Design documents.** `PLAN_REVISED.md` and `ARCHITECTURE.md` are better than most shipped products' design records. The problem is the delta to the code, not the thinking.
- **The five test files** (once their import paths are fixed) target the right things: value-object invariants and the aligner.

---

## 8. Issue index

| ID | Sev | Area | One-line |
|---|---|---|---|
| BLD-01 | P0 | Build | 47 TS errors across 6 mechanical groups |
| BLD-02 | P0 | Build | No `type:module`, no `bin`, `doctor` script points at missing file |
| BLD-03 | P2 | Build | `typeRoots` references absent `src/types` |
| BLD-04 | P3 | Build | Stray `test-ts.ts`; no build tsconfig split |
| ARC-01 | P1 | Arch | `LLMConfig`/`BatchConfig`/`Citation`/`NoteSection` declared twice |
| ARC-02 | P1 | Arch | `infrastructure` re-exports domain+application |
| ARC-03 | P0 | Arch | 8 ports have no adapter |
| ARC-04 | P0 | Arch | No composition root; 3 fake analyzers |
| SEC-01 | P0 | Sec | `new AbortSignal()` throws |
| SEC-02 | P1 | Sec | REST: no auth, no multipart, unhandled rejections |
| SEC-03 | P1 | Sec | SSRF claimed, not implemented |
| SEC-04 | P2 | Sec | Path traversal via model/tessdata names |
| SEC-05 | P2 | Sec | API key may reach note frontmatter |
| SEC-06 | P2 | Sec | `tesseract` hard-coded; spawn timeout doesn't kill |
| LOG-01 | P0 | Logic | `.join` on a `string` |
| LOG-02 | P0 | Logic | Duplicate methods + unbounded escalation recursion |
| LOG-03 | P0 | Logic | `saveBufferToTemp` missing; PSM type mismatch |
| LOG-04 | P0 | Logic | `doctor` hard-codes success |
| LOG-05 | P1 | Logic | `fetch` timeout never applied |
| LOG-06 | P1 | Logic | Dedup is a placeholder; always unique |
| LOG-07 | P0 | Logic | Pipeline never calls 4 adapters |
| LOG-08 | P1 | Logic | Batch: no glob, no checkpoint, no progress |
| LOG-09 | P2 | Logic | Summary reads arrays mid-flight |
| LOG-10 | P2 | Logic | LLM stream parsing incomplete |
| UX-01 | P2 | UX | Mojibake progress bar |
| UX-02 | P1 | UX | Documented commands don't exist |
| UX-03 | P2 | UX | No remediation in errors |
| UX-04 | P3 | UX | No `--json` |
| PERF-01 | P1 | Perf | One process spawn per frame |
| PERF-02 | P2 | Perf | Hard-coded `--threads 4` |
| PERF-03 | P2 | Perf | Whole transcript in RAM |
| PERF-04 | P2 | Perf | Temp files never cleaned |
| QA-01 | P0 | QA | Test imports one level too deep; 0 tests run |
| QA-02 | P1 | QA | Coverage excludes interfaces |
| QA-03 | P1 | QA | No integration/E2E, no fixtures |
| QA-04 | P1 | QA | No CI |
| DSH-01 | P0 | DSH | Invented plugin contract |
| DSH-02 | P0 | DSH | No bundle metadata |
| DSH-03 | P1 | DSH | Placeholder skill versions |
| DSH-04 | P2 | DSH | Web panel is not a DSH UI |
| DSH-05 | P0 | DSH | No tool registration |
| DOC-01 | P0 | Docs | Sign-off document is false |
| DOC-02 | P1 | Docs | README overstates |
| DOC-03 | P2 | Docs | Plan ≫ implementation |

**Totals:** 44 findings — P0 × 15, P1 × 14, P2 × 13, P3 × 2.
(Build errors are counted separately: 47 compiler diagnostics, mapped to BLD-01.)
