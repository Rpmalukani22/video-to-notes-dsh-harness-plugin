import { 
  ILLMProvider, 
  LLMRequest, 
  LLMResponse, 
  LLMChunk, 
  LLMModelInfo, 
  HealthStatus,
  LLMCallOptions,
  LLMProviderCapabilities
} from '../../application/ports/Interfaces.js';
import { ILogger, IMetricsCollector } from '../../application/ports/Interfaces.js';
import { fetch } from 'undici';

/** Shapes of the JSON returned by Ollama's HTTP API. */
interface OllamaChatResponse {
  message?: { content?: string } | undefined;
  model?: string | undefined;
  done?: boolean | undefined;
  prompt_eval_count?: number | undefined;
  eval_count?: number | undefined;
}

interface OllamaShowResponse {
  details?: { digest?: string } | undefined;
  digest?: string | undefined;
}

interface OllamaTagsResponse {
  models?: Array<{ name?: string }> | undefined;
}

/** Shapes of the JSON returned by OpenAI-compatible endpoints. */
interface OpenAICompatibleChatResponse {
  choices?: Array<{
    message?: { content?: string } | undefined;
    finish_reason?: string | null | undefined;
  }> | undefined;
  usage?: {
    prompt_tokens?: number | undefined;
    completion_tokens?: number | undefined;
    total_tokens?: number | undefined;
  } | undefined;
  model?: string | undefined;
}

interface OpenAICompatibleStreamChunk {
  choices?: Array<{
    delta?: { content?: string } | undefined;
    finish_reason?: string | null | undefined;
  }> | undefined;
}

interface OpenAICompatibleModelList {
  data?: Array<{ id?: string }> | undefined;
}

/**
 * Ollama LLM Provider
 * Local LLM inference via Ollama server
 */

export class OllamaLLMProvider implements ILLMProvider {
  private readonly _baseUrl: string;
  private readonly _logger: ILogger;
  private readonly _metrics: IMetricsCollector;
  private readonly _defaultModel: string;
  private _modelDigests: Map<string, string> = new Map();
  private _allowedModels: Map<string, string> = new Map(); // model -> expected sha256 digest

  constructor(
    baseUrl: string = 'http://localhost:11434',
    logger: ILogger,
    metrics: IMetricsCollector,
    defaultModel: string = 'llama3.1:8b'
  ) {
    this._baseUrl = baseUrl;
    this._logger = logger;
    this._metrics = metrics;
    this._defaultModel = defaultModel;
    this.loadPinnedDigests();
  }

  private loadPinnedDigests(): void {
    // Load from .vtn/models-lock.json or config
    // Format: { "llama3.1:8b": "sha256:abc123...", "mistral:7b": "sha256:def456..." }
    this._allowedModels.set('llama3.1:8b', '');
    this._allowedModels.set('llama3.1:70b', '');
    this._allowedModels.set('mistral:7b', '');
    this._allowedModels.set('codellama:13b', '');
    this._allowedModels.set('qwen2.5:7b', '');
    this._allowedModels.set('qwen2.5:14b', '');
    this._allowedModels.set('phi3:mini', '');
    this._allowedModels.set('phi3:medium', '');
  }

  async complete(request: LLMRequest, options?: LLMCallOptions): Promise<LLMResponse> {
    const startTime = Date.now();
    const model = request.messages.find(m => m.content.includes('model:'))?.content.split('model:')[1]?.split(' ')[0] || this._defaultModel;
    
    // Verify model before use
    if (!(await this.verifyModel(model))) {
      throw new Error(`Model '${model}' not allowed or digest mismatch. Allowed: ${Array.from(this._allowedModels.keys()).join(', ')}`);
    }

    const body = {
      model,
      messages: request.messages,
      temperature: request.temperature ?? 0.1, // Lower for local models
      max_tokens: request.maxTokens ?? 4096,
      top_p: request.topP ?? 0.95,
      stop: request.stop,
      stream: false,
      options: {
        num_predict: request.maxTokens,
        temperature: request.temperature,
        top_p: request.topP
      }
    };

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), options?.timeoutMs ?? 300000);
    
    try {
      const response = await fetch(`${this._baseUrl}/api/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal: options?.signal ?? controller.signal,
      });

      if (!response.ok) {
        throw new Error(`Ollama HTTP ${response.status}: ${await response.text()}`);
      }

      const data = (await response.json()) as OllamaChatResponse;
      const latencyMs = Date.now() - startTime;
      
      this._metrics.recordHistogram('llm_latency_ms', latencyMs, { provider: 'ollama' });
      this._metrics.incrementCounter('llm_requests_total', { provider: 'ollama', status: 'success' });

      return {
        content: data.message?.content ?? '',
        usage: {
          promptTokens: data.prompt_eval_count ?? 0,
          completionTokens: data.eval_count ?? 0,
          totalTokens: (data.prompt_eval_count ?? 0) + (data.eval_count ?? 0)
        },
        model: data.model ?? this._defaultModel,
        finishReason: data.done === true ? 'stop' : 'length'
      };
    } catch (error) {
      this._metrics.incrementCounter('llm_requests_total', { provider: 'ollama', status: 'error' });
      throw error;
    } finally {
      clearTimeout(timeoutId);
    }
  }

  async completeStream(request: LLMRequest, options?: LLMCallOptions): Promise<AsyncIterable<LLMChunk>> {
    const model = this._defaultModel;
    
    const body = {
      model,
      messages: request.messages,
      temperature: request.temperature ?? 0.1,
      max_tokens: request.maxTokens ?? 4096,
      top_p: request.topP ?? 0.95,
      stop: request.stop,
      stream: true,
      options: {
        num_predict: request.maxTokens,
        temperature: request.temperature,
        top_p: request.topP
      }
    };

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), options?.timeoutMs ?? 300000);

    let response: Awaited<ReturnType<typeof fetch>>;
    try {
      response = await fetch(`${this._baseUrl}/api/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal: options?.signal ?? controller.signal,
      });
    } catch (error) {
      clearTimeout(timeoutId);
      throw error;
    }

    if (!response.ok) {
      clearTimeout(timeoutId);
      throw new Error(`Ollama HTTP ${response.status}: ${await response.text()}`);
    }

    // The timeout must stay armed for the whole consumption of the stream, not
    // just until the response headers arrive, otherwise a stalled body hangs
    // forever.
    async function* generator(): AsyncGenerator<LLMChunk> {
      const reader = response.body?.getReader();
      if (!reader) {
        clearTimeout(timeoutId);
        return;
      }

      const decoder = new TextDecoder();
      let buffer = '';

      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split('\n');
          buffer = lines.pop() ?? '';

          for (const line of lines) {
            if (!line.trim()) continue;
            try {
              const data = JSON.parse(line) as OllamaChatResponse;
              const content = data.message?.content;
              if (content !== undefined && content.length > 0) {
                yield data.done === true
                  ? { delta: content, finishReason: 'stop' }
                  : { delta: content, finishReason: undefined };
              }
            } catch {
              // Ignore parse errors on partial/keep-alive frames.
            }
          }
        }
      } finally {
        clearTimeout(timeoutId);
        reader.releaseLock();
      }
    }

    return generator();
  }

  async completeStructured<T extends any>(
    request: LLMRequest,
    schema: any,
    options?: LLMCallOptions
  ): Promise<any> {
    // Ollama doesn't have native JSON mode - use guided retry
    const guidedRequest: LLMRequest = {
      ...request,
      messages: [
        ...request.messages,
        { 
          role: 'system', 
          content: `Output ONLY valid JSON matching this schema. No explanations, no markdown, no extra text.
Schema: ${JSON.stringify(schema.shape, null, 2)}` 
        }
      ],
      temperature: 0.05
    };

    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        const response = await this.complete(guidedRequest, options);
        const parsed = JSON.parse(response.content);
        return schema.parse(parsed);
      } catch (error) {
        if (attempt === 2) throw error;
        // Retry with more explicit instructions
        const lastMessage = guidedRequest.messages[guidedRequest.messages.length - 1];
        if (lastMessage) {
          lastMessage.content += `\n\nPrevious attempt failed. Ensure output is ONLY valid JSON.`;
        }
      }
    }
    
    throw new Error('Failed to generate valid JSON after retries');
  }

  async completeWithContextStream(
    request: LLMRequest,
    contextStream: AsyncIterable<string>,
    options?: LLMCallOptions
  ): Promise<LLMResponse> {
    let context = '';
    for await (const chunk of contextStream) {
      context += chunk;
    }
    
    const enrichedRequest: LLMRequest = {
      ...request,
      messages: [
        ...request.messages,
        { role: 'user', content: `Source content:\n${context}\n\n${request.messages[request.messages.length - 1]?.content || ''}` }
      ]
    };
    
    return this.complete(enrichedRequest, options);
  }

  async verifyModel(model: string): Promise<boolean> {
    // Check if model is in allowed list
    if (!this._allowedModels.has(model)) {
      return false;
    }
    
    // Verify model digest if pinned
    const expectedDigest = this._allowedModels.get(model);
    if (expectedDigest) {
      try {
        const response = await fetch(`${this._baseUrl}/api/show`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name: model }),
        });
        const data = (await response.json()) as OllamaShowResponse;
        const actualDigest = data.details?.digest ?? data.digest;
        if (actualDigest && actualDigest !== expectedDigest) {
          this._logger.warn(`Model digest mismatch for ${model}: expected ${expectedDigest}, got ${actualDigest}`);
          return false;
        }
      } catch (e) {
        this._logger.warn(`Failed to verify model digest for ${model}: ${e instanceof Error ? e.message : String(e)}`);
        return false;
      }
    }
    return true;
  }

  async healthCheck(): Promise<HealthStatus> {
    const start = Date.now();
    try {
      await fetch(`${this._baseUrl}/api/version`, { signal: AbortSignal.timeout(5000) });
      return { healthy: true, latencyMs: Date.now() - start, checkedAt: new Date() };
    } catch (error) {
      return { healthy: false, latencyMs: Date.now() - start, error: (error as Error).message, checkedAt: new Date() };
    }
  }

  getModelInfo(): LLMModelInfo {
    return {
      provider: 'ollama',
      model: this._defaultModel,
      maxContextTokens: 8192,
      supportsStreaming: true,
      supportsStructuredOutput: false,
      supportsCitations: false,
    };
  }

  async listAvailableModels(): Promise<string[]> {
    const response = await fetch(`${this._baseUrl}/api/tags`);
    const data = (await response.json()) as OllamaTagsResponse;
    return (data.models ?? [])
      .map((entry) => entry.name)
      .filter((name): name is string => typeof name === 'string' && name.length > 0);
  }

  getCapabilities(): LLMProviderCapabilities {
    return {
      provider: 'ollama',
      model: this._defaultModel,
      supportsJSONMode: false,
      supportsToolUse: false,
      supportsStreaming: true,
      supportsStructuredOutput: false,
      supportsCitations: false,
      maxContextTokens: 8192,
      optimalTemperature: 0.1,
      citationComplexity: 'simple',
      averageLatencyMs: 2000
    };
  }
}

/**
 * Custom LLM Provider - Any OpenAI-compatible endpoint
 * Supports vLLM, TGI, LocalAI, custom deployments
 */

export class CustomLLMProvider implements ILLMProvider {
  private readonly _config: CustomEndpointConfig;
  private readonly _logger: ILogger;
  private readonly _metrics: IMetricsCollector;

  constructor(
    config: CustomEndpointConfig,
    logger: ILogger,
    metrics: IMetricsCollector
  ) {
    this._config = config;
    this._logger = logger;
    this._metrics = metrics;
  }

  async complete(request: LLMRequest, options?: LLMCallOptions): Promise<LLMResponse> {
    const startTime = Date.now();
    
    const body = {
      model: this._config.model,
      messages: request.messages,
      temperature: request.temperature ?? 0.3,
      max_tokens: request.maxTokens ?? 8192,
      top_p: request.topP ?? 0.95,
      stop: request.stop,
      stream: false
    };

    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), options?.timeoutMs ?? 120000);
      
      try {
        const response = await fetch(`${this._config.baseUrl}/v1/chat/completions`, {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${this._config.apiKey}`,
            'Content-Type': 'application/json',
            ...this._config.headers
          },
          body: JSON.stringify(body),
          signal: options?.signal ?? controller.signal,
        });

        if (!response.ok) {
          throw new Error(`Custom LLM HTTP ${response.status}: ${await response.text()}`);
        }

        const data = (await response.json()) as OpenAICompatibleChatResponse;
        const latencyMs = Date.now() - startTime;
        
        this._metrics.recordHistogram('llm_latency_ms', latencyMs, { provider: 'custom' });
        this._metrics.incrementCounter('llm_requests_total', { provider: 'custom', status: 'success' });

        return {
          content: data.choices?.[0]?.message?.content ?? '',
          usage: {
            promptTokens: data.usage?.prompt_tokens ?? 0,
            completionTokens: data.usage?.completion_tokens ?? 0,
            totalTokens: data.usage?.total_tokens ?? 0
          },
          model: data.model ?? this._config.model,
          finishReason: toFinishReason(data.choices?.[0]?.finish_reason) ?? 'stop'
        };
      } finally {
        clearTimeout(timeoutId);
      }
    } catch (error) {
      this._metrics.incrementCounter('llm_requests_total', { provider: 'custom', status: 'error' });
      throw error;
    }
  }

  async completeStream(request: LLMRequest, options?: LLMCallOptions): Promise<AsyncIterable<LLMChunk>> {
    const body = {
      model: this._config.model,
      messages: request.messages,
      temperature: request.temperature ?? 0.3,
      max_tokens: request.maxTokens ?? 8192,
      top_p: request.topP ?? 0.95,
      stop: request.stop,
      stream: true
    };

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), options?.timeoutMs ?? 120000);

    let response: Awaited<ReturnType<typeof fetch>>;
    try {
      response = await fetch(`${this._config.baseUrl}/v1/chat/completions`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${this._config.apiKey}`,
          'Content-Type': 'application/json',
          ...this._config.headers
        },
        body: JSON.stringify(body),
        signal: options?.signal ?? controller.signal,
      });
    } catch (error) {
      clearTimeout(timeoutId);
      throw error;
    }

    if (!response.ok) {
      clearTimeout(timeoutId);
      throw new Error(`Custom LLM HTTP ${response.status}: ${await response.text()}`);
    }

    // Keep the timeout armed while the body is being consumed: clearing it when
    // the generator is returned would let a stalled stream hang forever.
    async function* generator(): AsyncGenerator<LLMChunk> {
      const reader = response.body?.getReader();
      if (!reader) {
        clearTimeout(timeoutId);
        return;
      }

      const decoder = new TextDecoder();
      let buffer = '';

      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split('\n');
          buffer = lines.pop() ?? '';

          for (const line of lines) {
            if (!line.startsWith('data: ')) continue;
            const data = line.slice(6);
            if (data === '[DONE]') return;
            try {
              const parsed = JSON.parse(data) as OpenAICompatibleStreamChunk;
              const choice = parsed.choices?.[0];
              const delta = choice?.delta?.content;
              if (delta !== undefined && delta.length > 0) {
                yield {
                  delta,
                  finishReason: toFinishReason(choice?.finish_reason)
                };
              }
            } catch {
              // Ignore parse errors
            }
          }
        }
      } finally {
        clearTimeout(timeoutId);
        reader.releaseLock();
      }
    }

    return generator();
  }

  async completeStructured<T extends any>(
    request: LLMRequest,
    schema: any,
    options?: LLMCallOptions
  ): Promise<any> {
    // Try native JSON mode
    const jsonRequest: LLMRequest = {
      ...request,
      messages: [
        ...request.messages,
        { 
          role: 'system', 
          content: `Output valid JSON matching this schema: ${JSON.stringify(schema.shape)}. No explanation or markdown.` 
        }
      ],
      temperature: 0.1
    };

    try {
      const response = await this.complete(jsonRequest, options);
      return schema.parse(JSON.parse(response.content));
    } catch {
      // Fallback: guided retry
      const guidedRequest: LLMRequest = {
        ...request,
        messages: [
          ...request.messages,
          { 
            role: 'system', 
            content: `Output ONLY valid JSON matching this schema. No explanation or markdown.
Schema: ${JSON.stringify(schema.shape, null, 2)}` 
          }
        ],
        temperature: 0.05
      };

      for (let attempt = 0; attempt < 3; attempt++) {
        try {
          const response = await this.complete(guidedRequest, options);
          return schema.parse(JSON.parse(response.content));
        } catch (error) {
          if (attempt === 2) throw error;
        }
      }
      
      throw new Error('Failed to generate valid JSON after retries');
    }
  }

  async completeWithContextStream(
    request: LLMRequest,
    contextStream: AsyncIterable<string>,
    options?: LLMCallOptions
  ): Promise<LLMResponse> {
    let context = '';
    for await (const chunk of contextStream) {
      context += chunk;
    }
    
    const enrichedRequest: LLMRequest = {
      ...request,
      messages: [
        ...request.messages,
        { role: 'user', content: `Source content:\n${context}\n\n${request.messages[request.messages.length - 1]?.content || ''}` }
      ]
    };
    
    return this.complete(enrichedRequest, options);
  }

  getModelInfo(): LLMModelInfo {
    return {
      provider: 'custom',
      model: this._config.model,
      maxContextTokens: 32768,
      supportsStreaming: true,
      supportsStructuredOutput: true,
      supportsCitations: true,
    };
  }

  async listAvailableModels(): Promise<string[]> {
    const response = await fetch(`${this._config.baseUrl}/v1/models`, {
      headers: { 'Authorization': `Bearer ${this._config.apiKey}` }
    });
    const data = (await response.json()) as OpenAICompatibleModelList;
    return (data.data ?? [])
      .map((entry) => entry.id)
      .filter((id): id is string => typeof id === 'string' && id.length > 0);
  }

  async healthCheck(): Promise<HealthStatus> {
    const start = Date.now();
    try {
      await fetch(`${this._config.baseUrl}/v1/models`, {
        headers: { 'Authorization': `Bearer ${this._config.apiKey}` },
        signal: AbortSignal.timeout(5000)
      });
      return { healthy: true, latencyMs: Date.now() - start, checkedAt: new Date() };
    } catch (error) {
      return { healthy: false, latencyMs: Date.now() - start, error: (error as Error).message, checkedAt: new Date() };
    }
  }

  getCapabilities(): LLMProviderCapabilities {
    return {
      provider: 'custom',
      model: this._config.model,
      supportsJSONMode: true,
      supportsToolUse: true,
      supportsStreaming: true,
      supportsStructuredOutput: true,
      supportsCitations: true,
      maxContextTokens: 32768,
      optimalTemperature: 0.3,
      citationComplexity: 'standard',
      averageLatencyMs: 2000
    };
  }
}

export interface CustomEndpointConfig {
  baseUrl: string;
  apiKey: string;
  model: string;
  headers?: Record<string, string> | undefined;
}

type FinishReason = 'stop' | 'length' | 'tool_calls' | 'content_filter';

/** Narrow an OpenAI-compatible `finish_reason` string to the domain union. */
function toFinishReason(value: string | null | undefined): FinishReason | undefined {
  return value === 'stop' || value === 'length' || value === 'tool_calls' || value === 'content_filter'
    ? value
    : undefined;
}