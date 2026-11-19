import { ISecretProvider } from '../../application/ports/Interfaces.js';

const ENV_KEYS: Record<string, string> = {
  'whisper-api-key': 'WHISPER_API_KEY',
  'videodb-api-key': 'VIDEODB_API_KEY',
  'deepseek-api-key': 'DEEPSEEK_API_KEY',
  'openai-api-key': 'OPENAI_API_KEY',
  'anthropic-api-key': 'ANTHROPIC_API_KEY',
  'google-api-key': 'GOOGLE_API_KEY',
  'custom-llm-api-key': 'CUSTOM_LLM_API_KEY',
};

/**
 * Reads secrets from the process environment. `get` resolves keys in the
 * documented set; `set`/`delete` shape the current process only (secrets must
 * never be written to disk by this provider).
 */
export class EnvSecretProvider implements ISecretProvider {
  private readonly _overrides = new Map<string, string>();

  async get(key: string): Promise<string | null> {
    if (this._overrides.has(key)) return this._overrides.get(key) ?? null;
    const envName = ENV_KEYS[key];
    if (!envName) return null;
    const value = process.env[envName];
    return value && value.length > 0 ? value : null;
  }

  async set(key: string, value: string): Promise<void> {
    this._overrides.set(key, value);
  }

  async delete(key: string): Promise<void> {
    this._overrides.delete(key);
  }

  /** Names of the environment variables this provider understands. */
  static envVarNames(): string[] {
    return Object.values(ENV_KEYS);
  }
}
