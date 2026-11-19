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
import { z } from 'zod';
import { fetch } from 'undici';

/**
 * Base class for cloud LLM providers
 */
abstract class BaseCloudLLMProvider implements ILLMProvider {
  protected readonly _apiKey: string;
  protected readonly _baseUrl: string;
  protected readonly _defaultModel: string;
  protected readonly _logger: ILogger;
  protected readonly _metrics: IMetricsCollector;
  protected readonly _model: string;

  constructor(
    apiKey: string,
    baseUrl: string,
    defaultModel: string,
    model: string,
    logger: ILogger,
    metrics: IMetricsCollector
  ) {
    this._apiKey = apiKey;
    this._baseUrl = baseUrl;
    this._defaultModel = defaultModel;
    this._model = model || defaultModel;
    this._logger = logger;
    this._metrics = metrics;
  }

  protected abstract getHeaders(): Record<string, string>;
  protected abstract getEndpoint(): string;
  protected abstract formatRequest(request: LLMRequest): any;
  protected abstract parseResponse(response: any): LLMResponse;
  protected abstract parseStreamChunk(chunk: any): LLMChunk | null;
  protected abstract getProviderName(): string;

  async complete(request: LLMRequest, options?: LLMCallOptions): Promise<LLMResponse> {
    const startTime = Date.now();
    
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), options?.timeoutMs ?? 120000);
    
    try {
      const body = this.formatRequest(request);
      const response = await fetch(this.getEndpoint(), {
        method: 'POST',
        headers: this.getHeaders(),
        body: JSON.stringify(body),
        signal: options?.signal ?? controller.signal,
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`HTTP ${response.status}: ${errorText}`);
      }

      const data = await response.json();
      const latencyMs = Date.now() - startTime;
      
      clearTimeout(timeoutId);
      this._metrics.recordHistogram('llm_latency_ms', latencyMs, { provider: this.getProviderName() });
      this._metrics.incrementCounter('llm_requests_total', { provider: this.getProviderName(), status: 'success' });

      return this.parseResponse(data);
    } catch (error) {
      clearTimeout(timeoutId);
      this._metrics.incrementCounter('llm_requests_total', { provider: this.getProviderName(), status: 'error' });
      throw error;
    }
  }

  async completeStream(request: LLMRequest, options?: LLMCallOptions): Promise<AsyncIterable<LLMChunk>> {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), options?.timeoutMs ?? 120000);

    let response: Awaited<ReturnType<typeof fetch>>;
    try {
      response = await fetch(this.getEndpoint(), {
        method: 'POST',
        headers: this.getHeaders(),
        body: JSON.stringify({ ...this.formatRequest(request), stream: true }),
        signal: options?.signal ?? controller.signal,
      });
    } catch (error) {
      clearTimeout(timeoutId);
      this._metrics.incrementCounter('llm_requests_total', { provider: this.getProviderName(), status: 'error' });
      throw error;
    }

    if (!response.ok) {
      clearTimeout(timeoutId);
      const errorText = await response.text();
      this._metrics.incrementCounter('llm_requests_total', { provider: this.getProviderName(), status: 'error' });
      throw new Error(`HTTP ${response.status}: ${errorText}`);
    }

    const self = this;

    async function* generate(): AsyncGenerator<LLMChunk> {
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
            const trimmed = line.trim();
            if (!trimmed.startsWith('data:')) continue;
            const data = trimmed.slice(5).trim();
            if (data.length === 0) continue;
            if (data === '[DONE]') return;
            try {
              const parsed: unknown = JSON.parse(data);
              const chunk = self.parseStreamChunk(parsed);
              if (chunk) yield chunk;
            } catch {
              // Ignore malformed frames; a stream may contain partial keep-alives.
            }
          }
        }
      } finally {
        clearTimeout(timeoutId);
        reader.releaseLock();
        self._metrics.incrementCounter('llm_requests_total', { provider: self.getProviderName(), status: 'success' });
      }
    }

    return generate();
  }

  async completeStructured<T extends any>(
    request: LLMRequest,
    schema: any,
    options?: LLMCallOptions
  ): Promise<any> {
    // Try native JSON mode first
    const jsonRequest: LLMRequest = {
      ...request,
      messages: [
        ...request.messages,
        { 
          role: 'system', 
          content: `Output valid JSON matching this schema: ${JSON.stringify(schema.shape)}. No explanation or markdown.` 
        }
      ],
      temperature: request.temperature ?? 0.1
    };

    try {
      const response = await this.complete({
        ...jsonRequest,
        // Provider-specific JSON mode
      } as LLMRequest);
      
      const parsed = JSON.parse(response.content);
      return schema.parse(parsed);
    } catch {
      // Fallback: guided retry with schema in prompt
      return this.guidedStructuredOutput(request, schema, options);
    }
  }

  private async guidedStructuredOutput(request: LLMRequest, schema: any, options?: LLMCallOptions): Promise<any> {
    // Retry with more explicit instructions
    const guidedRequest: LLMRequest = {
      ...request,
      messages: [
        ...request.messages,
        { 
          role: 'system', 
          content: `You must output ONLY valid JSON matching this exact schema. No explanations, no markdown, no extra text.
Schema: ${JSON.stringify(schema.shape, null, 2)}` 
        }
      ],
      temperature: 0.05
    };

    const response = await this.complete(guidedRequest, options);
    return schema.parse(JSON.parse(response.content));
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
      provider: this.getProviderName(),
      model: this._model,
      maxContextTokens: this.getMaxContextTokens(),
      supportsStreaming: true,
      supportsStructuredOutput: true,
      supportsCitations: true
    };
  }

  abstract getMaxContextTokens(): number;

  async listAvailableModels(): Promise<string[]> {
    // Override in subclasses for API-based model listing
    return [this._defaultModel];
  }

  async healthCheck(): Promise<HealthStatus> {
    const start = Date.now();
    try {
      await this.complete({
        messages: [{ role: 'user', content: 'ping' }],
        maxTokens: 1
      }, { timeoutMs: 5000 });
      return { healthy: true, latencyMs: Date.now() - start, checkedAt: new Date() };
    } catch (error) {
      return { healthy: false, latencyMs: Date.now() - start, error: (error as Error).message, checkedAt: new Date() };
    }
  }

  getCapabilities(): LLMProviderCapabilities {
    const cost = this.getCostPer1kTokens();
    const capabilities: LLMProviderCapabilities = {
      provider: this.getProviderName(),
      model: this._model,
      supportsJSONMode: true,
      supportsToolUse: true,
      supportsStreaming: true,
      supportsStructuredOutput: true,
      supportsCitations: true,
      maxContextTokens: this.getMaxContextTokens(),
      optimalTemperature: 0.3,
      citationComplexity: 'rich',
      averageLatencyMs: this.getAverageLatencyMs(),
      ...(cost !== undefined && { costPer1kTokens: cost })
    };
    
    return capabilities;
  }

  abstract getAverageLatencyMs(): number;
  abstract getCostPer1kTokens(): number | undefined;
}

/**
 * OpenAI LLM Provider
 */
export class OpenAILLMProvider extends BaseCloudLLMProvider {
  constructor(
    apiKey: string,
    model: string = 'gpt-4o',
    logger: ILogger,
    metrics: IMetricsCollector,
    baseUrl: string = 'https://api.openai.com/v1'
  ) {
    super(apiKey, baseUrl, 'gpt-4o', model, logger, metrics);
  }

  protected getHeaders(): Record<string, string> {
    return {
      'Authorization': `Bearer ${this._apiKey}`,
      'Content-Type': 'application/json'
    };
  }

  protected getEndpoint(): string {
    return `${this._baseUrl}/chat/completions`;
  }

  protected formatRequest(request: LLMRequest): any {
    return {
      model: this._model,
      messages: request.messages,
      temperature: request.temperature,
      max_tokens: request.maxTokens,
      top_p: request.topP,
      stop: request.stop,
      stream: false
    };
  }

  protected parseResponse(data: any): LLMResponse {
    return {
      content: data.choices[0]?.message?.content || '',
      usage: {
        promptTokens: data.usage?.prompt_tokens || 0,
        completionTokens: data.usage?.completion_tokens || 0,
        totalTokens: data.usage?.total_tokens || 0
      },
      model: data.model,
      finishReason: data.choices[0]?.finish_reason || 'stop'
    };
  }

  protected parseStreamChunk(data: any): LLMChunk | null {
    const delta = data.choices[0]?.delta?.content;
    if (!delta) return null;
    return {
      delta,
      finishReason: data.choices[0]?.finish_reason || undefined
    };
  }

  protected getProviderName(): string {
    return 'openai';
  }

  override getMaxContextTokens(): number {
    return 128000;
  }

  override getAverageLatencyMs(): number {
    return 1200;
  }

  override getCostPer1kTokens(): number {
    return 0.005; // GPT-4o pricing
  }

  override async listAvailableModels(): Promise<string[]> {
    const response = await fetch(`${this._baseUrl}/models`, {
      headers: { 'Authorization': `Bearer ${this._apiKey}` }
    });
    const data = (await response.json()) as { data: Array<{ id: string }> };
    return data.data.map((m) => m.id).filter((id: string) => id.startsWith('gpt-'));
  }
}

/**
 * Anthropic LLM Provider (Claude)
 */
export class AnthropicLLMProvider extends BaseCloudLLMProvider {
  constructor(
    apiKey: string,
    model: string = 'claude-3-5-sonnet-20241022',
    logger: ILogger,
    metrics: IMetricsCollector,
    baseUrl: string = 'https://api.anthropic.com/v1'
  ) {
    super(apiKey, baseUrl, 'claude-3-5-sonnet-20241022', model, logger, metrics);
  }

  protected override getHeaders(): Record<string, string> {
    return {
      'x-api-key': this._apiKey,
      'Content-Type': 'application/json',
      'anthropic-version': '2023-06-01'
    };
  }

  protected override getEndpoint(): string {
    return `${this._baseUrl}/messages`;
  }

  protected override formatRequest(request: LLMRequest): any {
    // Anthropic uses different message format
    const systemMessage = request.messages.find(m => m.role === 'system');
    const userMessages = request.messages.filter(m => m.role !== 'system');
    
    return {
      model: this._model,
      messages: userMessages,
      system: systemMessage?.content,
      temperature: request.temperature,
      max_tokens: request.maxTokens,
      top_p: request.topP,
      stop_sequences: request.stop,
      stream: false
    };
  }

  protected override parseResponse(data: any): LLMResponse {
    return {
      content: data.content[0]?.text || '',
      usage: {
        promptTokens: data.usage?.input_tokens || 0,
        completionTokens: data.usage?.output_tokens || 0,
        totalTokens: (data.usage?.input_tokens || 0) + (data.usage?.output_tokens || 0)
      },
      model: data.model,
      finishReason: data.stop_reason || 'stop'
    };
  }

  protected override parseStreamChunk(data: any): LLMChunk | null {
    if (data.type === 'content_block_delta' && data.delta?.text) {
      return {
        delta: data.delta.text
      };
    }
    if (data.type === 'message_stop') {
      return { delta: '', finishReason: 'stop' };
    }
    return null;
  }

  protected override getProviderName(): string {
    return 'anthropic';
  }

  override getMaxContextTokens(): number {
    return 200000;
  }

  override getAverageLatencyMs(): number {
    return 1500;
  }

  override getCostPer1kTokens(): number {
    return 0.015; // Claude 3.5 Sonnet pricing
  }
}

/**
 * Google LLM Provider (Gemini)
 */
export class GoogleLLMProvider extends BaseCloudLLMProvider {
  constructor(
    apiKey: string,
    model: string = 'gemini-1.5-pro',
    logger: ILogger,
    metrics: IMetricsCollector,
    baseUrl: string = 'https://generativelanguage.googleapis.com/v1beta'
  ) {
    super(apiKey, baseUrl, 'gemini-1.5-pro', model, logger, metrics);
  }

  protected override getHeaders(): Record<string, string> {
    return {
      'Content-Type': 'application/json',
      'x-goog-api-key': this._apiKey
    };
  }

  protected override getEndpoint(): string {
    return `${this._baseUrl}/models/${this._model}:generateContent`;
  }

  protected override formatRequest(request: LLMRequest): any {
    return {
      contents: request.messages.map(m => ({
        role: m.role === 'assistant' ? 'model' : 'user',
        parts: [{ text: m.content }]
      })),
      generationConfig: {
        temperature: request.temperature,
        maxOutputTokens: request.maxTokens,
        topP: request.topP,
        stopSequences: request.stop,
      },
    };
  }

  protected override parseResponse(data: any): LLMResponse {
    const candidate = data.candidates[0];
    return {
      content: candidate?.content?.parts[0]?.text || '',
      usage: {
        promptTokens: data.usageMetadata?.promptTokenCount || 0,
        completionTokens: data.usageMetadata?.candidatesTokenCount || 0,
        totalTokens: data.usageMetadata?.totalTokenCount || 0
      },
      model: this._model,
      finishReason: candidate?.finishReason || 'STOP'
    };
  }

  protected override parseStreamChunk(data: any): LLMChunk | null {
    const text = data.candidates[0]?.content?.parts[0]?.text;
    if (!text) return null;
    return { delta: text };
  }

  protected override getProviderName(): string {
    return 'google';
  }

  override getMaxContextTokens(): number {
    return 1000000;
  }

  override getAverageLatencyMs(): number {
    return 1000;
  }

  override getCostPer1kTokens(): number {
    return 0.0035;
  }
}

/**
 * DeepSeek LLM Provider
 */
export class DeepSeekLLMProvider extends BaseCloudLLMProvider {
  constructor(
    apiKey: string,
    model: string = 'deepseek-chat',
    logger: ILogger,
    metrics: IMetricsCollector,
    baseUrl: string = 'https://api.deepseek.com/v1'
  ) {
    super(apiKey, baseUrl, 'deepseek-chat', model, logger, metrics);
  }

  protected override getHeaders(): Record<string, string> {
    return {
      'Authorization': `Bearer ${this._apiKey}`,
      'Content-Type': 'application/json'
    };
  }

  protected override getEndpoint(): string {
    return `${this._baseUrl}/chat/completions`;
  }

  protected override formatRequest(request: LLMRequest): any {
    return {
      model: this._model,
      messages: request.messages,
      temperature: request.temperature,
      max_tokens: request.maxTokens,
      top_p: request.topP,
      stop: request.stop,
      stream: false
    };
  }

  protected override parseResponse(data: any): LLMResponse {
    return {
      content: data.choices[0]?.message?.content || '',
      usage: {
        promptTokens: data.usage?.prompt_tokens || 0,
        completionTokens: data.usage?.completion_tokens || 0,
        totalTokens: data.usage?.total_tokens || 0
      },
      model: data.model,
      finishReason: data.choices[0]?.finish_reason || 'stop'
    };
  }

  protected override parseStreamChunk(data: any): LLMChunk | null {
    const delta = data.choices[0]?.delta?.content;
    if (!delta) return null;
    return { delta, finishReason: data.choices[0]?.finish_reason || undefined };
  }

  protected override getProviderName(): string {
    return 'deepseek';
  }

  override getMaxContextTokens(): number {
    return 128000;
  }

  override getAverageLatencyMs(): number {
    return 800;
  }

  override getCostPer1kTokens(): number {
    return 0.0014;
  }
}