import {
  ILLMProvider,
  LLMRequest,
  LLMResponse,
  LLMChunk,
  LLMModelInfo,
  HealthStatus,
  LLMCallOptions,
  LLMProviderCapabilities,
  ILogger,
  IMetricsCollector,
} from '../../application/ports/Interfaces.js';
import type { ZodTypeAny, infer as ZodInfer } from 'zod';

/**
 * Harness LLM adapter.
 *
 * The DeepSeek Harness `llm` service is reached through a deliberately narrow,
 * structural bridge (`HarnessLlmBridge`) instead of the `@deepseek-ai/dsh-llm`
 * types. That keeps the application and infrastructure layers free of harness
 * dependencies and lets the adapter be unit tested with a fake bridge.
 */

export interface HarnessLlmMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface HarnessLlmUsage {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
}

export interface HarnessLlmChunk {
  text?: string | undefined;
  usage?: HarnessLlmUsage | undefined;
  finishReason?: 'stop' | 'length' | 'tool_calls' | 'content_filter' | undefined;
}

export interface HarnessLlmStreamOptions {
  provider: string;
  model: string;
  messages: HarnessLlmMessage[];
  system?: string | undefined;
  temperature?: number | undefined;
  maxTokens?: number | undefined;
  signal?: AbortSignal | undefined;
}

export interface HarnessLlmBridge {
  listProviders(): Array<{ id: string; name: string }>;
  listModels(provider: string): Promise<Array<{ id: string; name: string }>>;
  stream(options: HarnessLlmStreamOptions): AsyncIterable<HarnessLlmChunk>;
}

/* ------------------------------------------------------------------ */
/* Structural view of the harness `llm` service (no dsh imports).      */
/* ------------------------------------------------------------------ */

export interface DshTextBlockLike {
  type: 'text';
  text: string;
}

export interface DshUserInputLike {
  role: 'user';
  content: DshTextBlockLike[];
}

export interface DshGenerateOptionsLike {
  provider: string;
  model: string;
  messages: DshUserInputLike[];
  system?: string | undefined;
  temperature?: number | undefined;
  maxTokens?: number | undefined;
  signal?: AbortSignal | undefined;
}

export interface DshStreamChunkLike {
  type: string;
  text?: string | undefined;
  usage?: {
    inputTokens?: number | undefined;
    outputTokens?: number | undefined;
    totalTokens?: number | undefined;
  } | undefined;
  reason?: string | undefined;
}

export interface DshLlmLike {
  listProviders(): ReadonlyArray<{ id: string; name?: string | undefined }>;
  listModels(provider: string): Promise<ReadonlyArray<{ id: string; name?: string | undefined }>>;
  stream(options: DshGenerateOptionsLike): AsyncIterable<DshStreamChunkLike>;
}

const FINISH_REASONS = new Set(['stop', 'length', 'tool_calls', 'content_filter']);

function mapFinishReason(reason: string | undefined): 'stop' | 'length' | 'tool_calls' | 'content_filter' {
  if (reason === 'tool-calls' || reason === 'tool_calls') return 'tool_calls';
  if (reason === 'content-filter' || reason === 'content_filter') return 'content_filter';
  if (reason === 'length' || reason === 'max-tokens') return 'length';
  if (reason !== undefined && FINISH_REASONS.has(reason)) {
    return reason as 'stop' | 'length' | 'tool_calls' | 'content_filter';
  }
  return 'stop';
}

/**
 * Collapse an application-level message list into a single harness user input.
 *
 * Harness assistant messages require durable ids and sources, so a one-shot
 * caller cannot fabricate a valid conversation history. Summarisation prompts
 * are single-shot by design; system turns are hoisted into `system` and the
 * remaining turns are rendered into one user message with role prefixes.
 */
function toUserInput(messages: HarnessLlmMessage[]): DshUserInputLike {
  const turns = messages.filter((message) => message.role !== 'system');
  const text = turns
    .map((message) => (message.role === 'assistant' ? `Assistant:\n${message.content}` : message.content))
    .join('\n\n');
  return { role: 'user', content: [{ type: 'text', text }] };
}

function collectSystem(messages: HarnessLlmMessage[], explicit: string | undefined): string | undefined {
  const parts = messages
    .filter((message) => message.role === 'system')
    .map((message) => message.content.trim())
    .filter((part) => part.length > 0);
  if (explicit !== undefined && explicit.trim().length > 0) parts.push(explicit.trim());
  return parts.length > 0 ? parts.join('\n\n') : undefined;
}

/** Wrap a live harness `llm` service in the bridge the adapter consumes. */
export function createHarnessBridge(llm: DshLlmLike): HarnessLlmBridge {
  return {
    listProviders(): Array<{ id: string; name: string }> {
      return llm.listProviders().map((provider) => ({
        id: provider.id,
        name: provider.name ?? provider.id,
      }));
    },

    async listModels(provider: string): Promise<Array<{ id: string; name: string }>> {
      const models = await llm.listModels(provider);
      return models.map((model) => ({ id: model.id, name: model.name ?? model.id }));
    },

    async *stream(options: HarnessLlmStreamOptions): AsyncIterable<HarnessLlmChunk> {
      const request: DshGenerateOptionsLike = {
        provider: options.provider,
        model: options.model,
        messages: [toUserInput(options.messages)],
      };
      const system = collectSystem(options.messages, options.system);
      if (system !== undefined) request.system = system;
      if (options.temperature !== undefined) request.temperature = options.temperature;
      if (options.maxTokens !== undefined) request.maxTokens = options.maxTokens;
      if (options.signal !== undefined) request.signal = options.signal;

      for await (const chunk of llm.stream(request)) {
        if (chunk.type === 'text-delta' && typeof chunk.text === 'string') {
          yield { text: chunk.text };
          continue;
        }
        if (chunk.type === 'usage' && chunk.usage !== undefined) {
          const promptTokens = chunk.usage.inputTokens ?? 0;
          const completionTokens = chunk.usage.outputTokens ?? 0;
          yield {
            usage: {
              promptTokens,
              completionTokens,
              totalTokens: chunk.usage.totalTokens ?? promptTokens + completionTokens,
            },
          };
          continue;
        }
        if (chunk.type === 'finish') {
          yield { finishReason: mapFinishReason(chunk.reason) };
        }
      }
    },
  };
}

const DEFAULT_MODEL_CONTEXT = 128000;

export interface HarnessLLMProviderOptions {
  provider?: string | undefined;
  model?: string | undefined;
}

/**
 * Adapts the harness LLM service to the application's `ILLMProvider` port.
 * With no bridge the adapter fails fast and loudly instead of silently
 * returning empty summaries.
 */
export class HarnessLLMProvider implements ILLMProvider {
  private readonly _logger: ILogger;
  private readonly _metrics: IMetricsCollector;
  private readonly _bridge: HarnessLlmBridge | null;
  private readonly _provider: string;
  private readonly _model: string;

  constructor(
    logger: ILogger,
    metrics: IMetricsCollector,
    bridge?: HarnessLlmBridge | null,
    options: HarnessLLMProviderOptions = {}
  ) {
    this._logger = logger;
    this._metrics = metrics;
    this._bridge = bridge ?? null;
    this._provider = options.provider ?? 'deepseek';
    this._model = options.model ?? 'deepseek-chat';
  }

  private requireBridge(): HarnessLlmBridge {
    if (this._bridge === null) {
      throw new Error(
        'Harness LLM bridge is not configured. Enable the plugin inside DeepSeek Harness, ' +
          'or set llm.provider to a cloud/local provider in the video-to-notes config.'
      );
    }
    return this._bridge;
  }

  async complete(request: LLMRequest, options?: LLMCallOptions): Promise<LLMResponse> {
    const startTime = Date.now();
    let content = '';
    let usage: HarnessLlmUsage = { promptTokens: 0, completionTokens: 0, totalTokens: 0 };
    let finishReason: LLMResponse['finishReason'] = 'stop';

    try {
      for await (const chunk of this.streamInternal(request, options)) {
        if (chunk.delta.length > 0) content += chunk.delta;
        if (chunk.usage !== undefined) usage = chunk.usage;
        if (chunk.finishReason !== undefined) finishReason = chunk.finishReason;
      }
    } catch (error) {
      this._metrics.incrementCounter('llm_requests_total', { provider: 'harness', status: 'error' });
      throw error;
    }

    this._metrics.recordHistogram('llm_latency_ms', Date.now() - startTime, { provider: 'harness' });
    this._metrics.incrementCounter('llm_requests_total', { provider: 'harness', status: 'success' });

    return {
      content,
      usage,
      model: this._model,
      finishReason,
    };
  }

  async completeStream(request: LLMRequest, options?: LLMCallOptions): Promise<AsyncIterable<LLMChunk>> {
    return this.streamInternal(request, options);
  }

  private async *streamInternal(request: LLMRequest, options?: LLMCallOptions): AsyncGenerator<LLMChunk> {
    const bridge = this.requireBridge();

    const stream = bridge.stream({
      provider: this._provider,
      model: this._model,
      messages: request.messages.map((message) => ({ role: message.role, content: message.content })),
      ...(request.systemPrompt !== undefined ? { system: request.systemPrompt } : {}),
      ...(request.temperature !== undefined ? { temperature: request.temperature } : {}),
      ...(request.maxTokens !== undefined ? { maxTokens: request.maxTokens } : {}),
      ...(options?.signal !== undefined ? { signal: options.signal } : {}),
    });

    for await (const chunk of stream) {
      const delta: LLMChunk = { delta: chunk.text ?? '' };
      if (chunk.usage !== undefined) delta.usage = chunk.usage;
      if (chunk.finishReason !== undefined) delta.finishReason = chunk.finishReason;
      if (delta.delta.length > 0 || delta.usage !== undefined || delta.finishReason !== undefined) {
        yield delta;
      }
    }
  }

  async completeStructured<T extends ZodTypeAny>(
    request: LLMRequest,
    schema: T,
    options?: LLMCallOptions
  ): Promise<ZodInfer<T>> {
    const instruction =
      'Respond with a single JSON value only. No prose, no markdown fences, no commentary.';

    const firstRequest: LLMRequest = {
      ...request,
      temperature: request.temperature ?? 0.2,
      systemPrompt: request.systemPrompt !== undefined ? `${request.systemPrompt}\n\n${instruction}` : instruction,
    };

    const first = await this.complete(firstRequest, options);
    const firstParsed = parseJsonValue(first.content);
    if (firstParsed.ok) {
      const result = schema.safeParse(firstParsed.value);
      if (result.success) return result.data;
    }

    const retryRequest: LLMRequest = {
      ...request,
      temperature: 0.05,
      systemPrompt:
        `${instruction} The previous answer was rejected by the validator. ` +
        'Output the corrected JSON value only.',
      messages: [
        ...request.messages,
        { role: 'user', content: 'Return the JSON value again, strictly valid and complete.' },
      ],
    };

    const retry = await this.complete(retryRequest, options);
    const retryParsed = parseJsonValue(retry.content);
    if (!retryParsed.ok) {
      throw new Error('Harness LLM did not return parseable JSON for a structured request');
    }
    return schema.parse(retryParsed.value);
  }

  async completeWithContextStream(
    request: LLMRequest,
    contextStream: AsyncIterable<string>,
    options?: LLMCallOptions
  ): Promise<LLMResponse> {
    let context = '';
    for await (const piece of contextStream) context += piece;

    const last = request.messages[request.messages.length - 1];
    const tail = last !== undefined ? last.content : '';
    const enriched: LLMRequest = {
      ...request,
      messages: [...request.messages, { role: 'user', content: `Source content:\n${context}\n\n${tail}` }],
    };

    return this.complete(enriched, options);
  }

  getModelInfo(): LLMModelInfo {
    return {
      provider: 'harness',
      model: this._model,
      maxContextTokens: DEFAULT_MODEL_CONTEXT,
      supportsStreaming: true,
      supportsStructuredOutput: true,
      supportsCitations: false,
    };
  }

  async listAvailableModels(): Promise<string[]> {
    if (this._bridge === null) return [];
    try {
      const models = await this._bridge.listModels(this._provider);
      return models.map((model) => model.id);
    } catch (error) {
      this._logger.warn(
        `Could not list harness models for provider '${this._provider}': ` +
          (error instanceof Error ? error.message : String(error))
      );
      return [];
    }
  }

  async healthCheck(): Promise<HealthStatus> {
    const start = Date.now();
    const checkedAt = new Date();

    if (this._bridge === null) {
      return {
        healthy: false,
        latencyMs: Date.now() - start,
        error: 'Harness LLM bridge is not configured',
        checkedAt,
      };
    }

    try {
      const providers = this._bridge.listProviders();
      const modelIds = await this._bridge.listModels(this._provider);
      if (modelIds.length === 0) {
        return {
          healthy: false,
          latencyMs: Date.now() - start,
          error:
            providers.length === 0
              ? 'Harness exposes no LLM providers'
              : `Harness provider '${this._provider}' advertises no models`,
          checkedAt,
        };
      }
      return { healthy: true, latencyMs: Date.now() - start, checkedAt };
    } catch (error) {
      return {
        healthy: false,
        latencyMs: Date.now() - start,
        error: error instanceof Error ? error.message : String(error),
        checkedAt,
      };
    }
  }

  getCapabilities(): LLMProviderCapabilities {
    return {
      provider: 'harness',
      model: this._model,
      supportsJSONMode: false,
      supportsToolUse: false,
      supportsStreaming: true,
      supportsStructuredOutput: true,
      supportsCitations: false,
      maxContextTokens: DEFAULT_MODEL_CONTEXT,
      optimalTemperature: 0.2,
      citationComplexity: 'standard',
      averageLatencyMs: 1500,
    };
  }
}

type JsonParseOutcome = { ok: true; value: unknown } | { ok: false };

function parseJsonValue(raw: string): JsonParseOutcome {
  const direct = raw.trim();
  const withoutFence = direct.startsWith('```')
    ? direct.replace(/^```[a-zA-Z]*\s*/, '').replace(/```\s*$/, '').trim()
    : direct;

  for (const candidate of [withoutFence, extractFirstJsonSpan(withoutFence)]) {
    if (candidate === null) continue;
    try {
      return { ok: true, value: JSON.parse(candidate) };
    } catch {
      // try the next candidate
    }
  }
  return { ok: false };
}

function extractFirstJsonSpan(text: string): string | null {
  const start = text.search(/[[{]/);
  if (start === -1) return null;
  const open = text[start];
  const close = open === '{' ? '}' : ']';
  const end = text.lastIndexOf(close);
  if (end <= start) return null;
  return text.slice(start, end + 1);
}
